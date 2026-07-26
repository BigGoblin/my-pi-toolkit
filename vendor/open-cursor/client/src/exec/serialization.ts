import { ExecClientMessage } from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";
import type {
  ExecClientMessage as ExecClientMessageType,
  ExecServerMessage,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- generic params for type-safe args/result mapping
export function createServerDeserializer<TArgs>(argsCase: string) {
  return (msg: ExecServerMessage): { id: number; args: TArgs } | undefined => {
    if (msg.message.case !== argsCase) return undefined;
    return { id: msg.id, args: msg.message.value as TArgs };
  };
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- generic params for type-safe args/result mapping
export function createClientSerializer<TResult>(resultCase: string) {
  return (id: number, result: TResult): ExecClientMessageType => {
    return new ExecClientMessage({
      id,
      message: {
        case: resultCase,
        value: result,
      } as unknown as ExecClientMessageType["message"],
    });
  };
}
