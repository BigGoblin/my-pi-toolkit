import type { Executor } from "@open-cursor/client";
import type {
  ExecuteHookArgs,
  ExecuteHookResult,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";
import {
  ExecuteHookResponse,
  ExecuteHookResult as ExecuteHookResultClass,
  PreCompactRequestResponse,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";
import {
  SubagentStartRequestResponse,
  SubagentStopRequestResponse,
} from "@open-cursor/protocol/__generated__/agent/v1/subagents_pb.js";

export class LocalHookExecutor implements Executor<ExecuteHookArgs, ExecuteHookResult> {
  async execute(_ctx: unknown, args: ExecuteHookArgs): Promise<ExecuteHookResult> {
    const request = args.request;

    if (!request) {
      return new ExecuteHookResultClass({});
    }

    // Proto oneof — known cases handled; default for forward-compat with new server hook types
    switch (request.request.case) {
      case "preCompact":
        return new ExecuteHookResultClass({
          response: new ExecuteHookResponse({
            response: {
              case: "preCompact",
              value: new PreCompactRequestResponse(),
            },
          }),
        });

      case "subagentStart":
        return new ExecuteHookResultClass({
          response: new ExecuteHookResponse({
            response: {
              case: "subagentStart",
              value: new SubagentStartRequestResponse(),
            },
          }),
        });

      case "subagentStop":
        return new ExecuteHookResultClass({
          response: new ExecuteHookResponse({
            response: {
              case: "subagentStop",
              value: new SubagentStopRequestResponse(),
            },
          }),
        });

      default:
        return new ExecuteHookResultClass({});
    }
  }
}
