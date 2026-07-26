import type { StreamExecutor } from "@open-cursor/client";
import type {
  ShellArgs,
  ShellStream,
} from "@open-cursor/protocol/__generated__/agent/v1/shell_exec_pb.js";
import {
  ShellRejected,
  ShellStream as ShellStreamClass,
  ShellStreamExit,
  ShellStreamStdout,
} from "@open-cursor/protocol/__generated__/agent/v1/shell_exec_pb.js";

import { toolResultToText } from "../../shared/tool-result.js";
import { requestToolExecution } from "../relay.js";
import { decodeToolCallId, type PiToolContext } from "../types.js";
import { confirmIfDangerous } from "./shell.js";

export class LocalShellStreamExecutor implements StreamExecutor<ShellArgs, ShellStream> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async *execute(_ctx: unknown, args: ShellArgs): AsyncIterable<ShellStream> {
    const toolCallId = decodeToolCallId(args.toolCallId);
    const workingDirectory = args.workingDirectory || this.ctx.cwd;

    if (!this.ctx.getActiveTools().has("bash")) {
      yield new ShellStreamClass({
        event: {
          case: "rejected",
          value: new ShellRejected({
            command: args.command,
            workingDirectory,
            reason: "Tool not available",
            isReadonly: false,
          }),
        },
      });
      yield new ShellStreamClass({
        event: {
          case: "exit",
          value: new ShellStreamExit({
            code: 1,
            cwd: workingDirectory,
            aborted: false,
          }),
        },
      });
      return;
    }

    const approved = await confirmIfDangerous(() => this.ctx.getCtx(), args.command);
    if (!approved) {
      yield new ShellStreamClass({
        event: {
          case: "rejected",
          value: new ShellRejected({
            command: args.command,
            workingDirectory,
            reason: "Command rejected",
            isReadonly: false,
          }),
        },
      });
      yield new ShellStreamClass({
        event: {
          case: "exit",
          value: new ShellStreamExit({
            code: 1,
            cwd: workingDirectory,
            aborted: false,
          }),
        },
      });
      return;
    }

    const timeoutSeconds = args.timeout && args.timeout > 0 ? args.timeout : undefined;

    const piResult = await requestToolExecution(this.ctx.getChannel?.() ?? null, {
      toolCallId,
      cursorExecType: "shell-stream",
      piToolName: "bash",
      piToolArgs: {
        command: args.command,
        ...(timeoutSeconds !== undefined ? { timeout: timeoutSeconds } : {}),
      },
    });

    const text = toolResultToText(piResult);
    if (text) {
      yield new ShellStreamClass({
        event: {
          case: "stdout",
          value: new ShellStreamStdout({ data: text }),
        },
      });
    }

    yield new ShellStreamClass({
      event: {
        case: "exit",
        value: new ShellStreamExit({
          code: piResult.isError ? 1 : 0,
        }),
      },
    });
  }
}
