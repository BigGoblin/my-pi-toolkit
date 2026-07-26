import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Executor } from "@open-cursor/client";
import type {
  DeleteArgs,
  DeleteResult,
} from "@open-cursor/protocol/__generated__/agent/v1/delete_exec_pb.js";
import {
  DeleteError,
  DeleteRejected,
  DeleteResult as DeleteResultClass,
  DeleteSuccess,
} from "@open-cursor/protocol/__generated__/agent/v1/delete_exec_pb.js";

import { toolResultToText } from "../../shared/tool-result.js";
import { requestToolExecution, shellQuote } from "../relay.js";
import { decodeToolCallId, type PiToolContext } from "../types.js";

function buildDeleteResultFromToolResult(path: string, result: ToolResultMessage): DeleteResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return new DeleteResultClass({
      result: {
        case: "error",
        value: new DeleteError({ path, error: text || "Delete failed" }),
      },
    });
  }
  return new DeleteResultClass({
    result: {
      case: "success",
      value: new DeleteSuccess({
        path,
        deletedFile: path,
        fileSize: BigInt(0),
        prevContent: "",
      }),
    },
  });
}

function buildDeleteRejectedResult(path: string, reason: string): DeleteResult {
  return new DeleteResultClass({
    result: { case: "rejected", value: new DeleteRejected({ path, reason }) },
  });
}

export class LocalDeleteExecutor implements Executor<DeleteArgs, DeleteResult> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async execute(_ctx: unknown, args: DeleteArgs): Promise<DeleteResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("write")) {
      return buildDeleteRejectedResult(args.path, "Tool not available");
    }

    // Delete via bash rm — pi doesn't have a delete tool
    const piResult = await requestToolExecution(this.ctx.getChannel?.() ?? null, {
      toolCallId,
      cursorExecType: "delete",
      piToolName: "bash",
      piToolArgs: { command: `rm ${shellQuote(args.path)}` },
    });

    return buildDeleteResultFromToolResult(args.path, piResult);
  }
}
