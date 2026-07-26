import { Code, ConnectError } from "@connectrpc/connect";
import { ExecServerControlMessage } from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";
import type {
  ExecClientControlMessage,
  ExecClientMessage,
  ExecServerControlMessage as ExecServerControlMessageType,
  ExecServerMessage,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";

import { WriteIterableClosedError } from "../map-writable.js";
import type { Writable } from "../map-writable.js";

export interface ControlledExecManager {
  handle(
    ctx: unknown,
    message: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage | ExecClientControlMessage>;
  handleControlMessage(message: ExecServerControlMessageType): void;
}

export class ConnectionLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionLostError";
  }
}

export class ExecController {
  private readonly serverStream: AsyncIterable<ExecServerMessage | ExecServerControlMessageType>;
  private readonly clientStream: Writable<ExecClientMessage | ExecClientControlMessage>;
  private readonly controlledExecManager: ControlledExecManager;

  constructor(
    serverStream: AsyncIterable<ExecServerMessage | ExecServerControlMessageType>,
    clientStream: Writable<ExecClientMessage | ExecClientControlMessage>,
    controlledExecManager: ControlledExecManager,
  ) {
    this.serverStream = serverStream;
    this.clientStream = clientStream;
    this.controlledExecManager = controlledExecManager;
  }

  async run(ctx: unknown): Promise<void> {
    const pendingPromises: Promise<void>[] = [];
    try {
      for await (const message of this.serverStream) {
        if (message instanceof ExecServerControlMessage) {
          this.controlledExecManager.handleControlMessage(message);
          continue;
        }

        const serverMessage = message;

        const promise = (async () => {
          const stream = this.controlledExecManager.handle(ctx, serverMessage);
          for await (const result of stream) {
            await this.clientStream.write(result);
          }
        })();

        pendingPromises.push(promise);
      }

      await Promise.all(pendingPromises);
    } catch (error) {
      if (
        error instanceof ConnectError &&
        error.rawMessage === "protocol error: missing EndStreamResponse"
      ) {
        throw new ConnectionLostError(error.message);
      } else if (error instanceof ConnectError && error.code === Code.Aborted) {
        const cause = error.cause;
        const causeWithCode = cause as { code?: unknown };
        if (
          cause instanceof Error &&
          typeof causeWithCode.code === "string" &&
          causeWithCode.code.includes("ERR_STREAM_WRITE_AFTER_END")
        ) {
          throw new ConnectionLostError(error.message);
        }
      } else if (error instanceof WriteIterableClosedError) {
        throw new ConnectionLostError(error.message);
      } else if (error instanceof ConnectError && error.code === Code.Internal) {
        const cause = error.cause;
        if (cause instanceof Error && cause.message.includes("NGHTTP2_PROTOCOL_ERROR")) {
          throw new ConnectionLostError(error.message);
        }
      }
    }
  }
}
