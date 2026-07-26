import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Executor } from "@open-cursor/client";
import type {
  ReadArgs,
  ReadResult,
} from "@open-cursor/protocol/__generated__/agent/v1/read_exec_pb.js";
import {
  ReadError,
  ReadRejected,
  ReadResult as ReadResultClass,
  ReadSuccess,
} from "@open-cursor/protocol/__generated__/agent/v1/read_exec_pb.js";

import { toolResultToText, toolResultWasTruncated } from "../../shared/tool-result.js";
import { requestToolExecution } from "../relay.js";
import type { PiToolContext } from "../types.js";
import { decodeToolCallId } from "../types.js";

function buildReadResultFromToolResult(path: string, result: ToolResultMessage): ReadResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return new ReadResultClass({
      result: {
        case: "error",
        value: new ReadError({ path, error: text || "Read failed" }),
      },
    });
  }
  const totalLines = text ? text.split("\n").length : 0;
  return new ReadResultClass({
    result: {
      case: "success",
      value: new ReadSuccess({
        path,
        totalLines,
        fileSize: BigInt(Buffer.byteLength(text, "utf-8")),
        truncated: toolResultWasTruncated(result),
        output: { case: "content", value: text },
      }),
    },
  });
}

function buildReadRejectedResult(path: string, reason: string): ReadResult {
  return new ReadResultClass({
    result: { case: "rejected", value: new ReadRejected({ path, reason }) },
  });
}

export class LocalReadExecutor implements Executor<ReadArgs, ReadResult> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async execute(_ctx: unknown, args: ReadArgs): Promise<ReadResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("read")) {
      return buildReadRejectedResult(args.path, "Tool not available");
    }

    const piResult = await requestToolExecution(this.ctx.getChannel?.() ?? null, {
      toolCallId,
      cursorExecType: "read",
      piToolName: "read",
      piToolArgs: { path: args.path },
    });

    return buildReadResultFromToolResult(args.path, piResult);
  }
}
