import { createWritableIterable } from "@connectrpc/connect/protocol";
import {
  ExecClientControlMessage,
  ExecClientHeartbeat,
  type ExecClientMessage,
  ExecClientStreamClose,
  ExecClientThrow,
  type ExecServerControlMessage,
  type ExecServerMessage,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";

import type { ControlledExecManager } from "../conn/exec-controller.js";
import { WriteIterableClosedError } from "../map-writable.js";
import { trace } from "../trace.js";
import type { ResourceAccessor } from "./registry-accessor.js";

const EXEC_HEARTBEAT_INTERVAL_MS = 3_000;

function debug(message: string, data?: Record<string, unknown>): void {
  trace(message, data);
}

export interface SimpleExecHandler {
  handle(
    ctx: unknown,
    serverMessage: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage> | undefined;
}

export class ExecManager implements ControlledExecManager {
  private readonly handlers: SimpleExecHandler[] = [];
  private readonly runningExecs: Map<string, () => void> = new Map();

  register(handler: SimpleExecHandler): void {
    this.handlers.push(handler);
  }

  handleControlMessage(serverMessage: ExecServerControlMessage): void {
    if (serverMessage.message.case === "abort") {
      const id = String(serverMessage.message.value.id);
      const execCtxCancel = this.runningExecs.get(id);
      if (execCtxCancel) {
        execCtxCancel();
      }
    }
  }

  handle(
    ctx: unknown,
    serverMessage: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage | ExecClientControlMessage> {
    const execCtxCancel = () => {};
    this.runningExecs.set(String(serverMessage.id), execCtxCancel);
    debug("exec server message", {
      id: serverMessage.id,
      execId: serverMessage.execId,
      case: serverMessage.message.case,
    });

    for (const handler of this.handlers) {
      const result = handler.handle(ctx, serverMessage);
      if (result === undefined) {
        continue;
      }

      const resultStream = result;
      const outputStream = createWritableIterable<ExecClientMessage | ExecClientControlMessage>();

      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleHeartbeat = () => {
        heartbeatTimer = setTimeout(() => {
          outputStream
            .write(
              new ExecClientControlMessage({
                message: {
                  case: "heartbeat",
                  value: new ExecClientHeartbeat({ id: serverMessage.id }),
                },
              }),
            )
            .then(scheduleHeartbeat)
            .catch(() => {});
        }, EXEC_HEARTBEAT_INTERVAL_MS);
      };
      scheduleHeartbeat();

      const run = async () => {
        try {
          for await (const message of resultStream) {
            debug("exec client result write", {
              id: serverMessage.id,
              case: message.message.case,
            });
            await outputStream.write(message);
          }
          debug("exec client stream close write", { id: serverMessage.id });
          await outputStream.write(
            new ExecClientControlMessage({
              message: {
                case: "streamClose",
                value: new ExecClientStreamClose({
                  id: serverMessage.id,
                }),
              },
            }),
          );
        } catch (error) {
          if (error instanceof WriteIterableClosedError) {
            return;
          }
          await outputStream
            .write(
              new ExecClientControlMessage({
                message: {
                  case: "throw",
                  value: new ExecClientThrow({
                    id: serverMessage.id,
                    error: error instanceof Error ? error.message : "Unknown error",
                    stackTrace: error instanceof Error ? (error.stack ?? "") : "",
                  }),
                },
              }),
            )
            .catch(() => {});
        } finally {
          clearTimeout(heartbeatTimer);
          outputStream.close();
          this.runningExecs.delete(String(serverMessage.id));
        }
      };

      void run();
      return outputStream;
    }

    // No handler found - send error back through stream instead of throwing,
    // so the server doesn't hang waiting for a response that never comes
    this.runningExecs.delete(String(serverMessage.id));

    const errorMessage = `No handler found for server message of type ${serverMessage.message.case}`;

    return (async function* () {
      yield new ExecClientControlMessage({
        message: {
          case: "throw",
          value: new ExecClientThrow({
            id: serverMessage.id,
            error: errorMessage,
          }),
        },
      });
      yield new ExecClientControlMessage({
        message: {
          case: "streamClose",
          value: new ExecClientStreamClose({
            id: serverMessage.id,
          }),
        },
      });
    })();
  }

  static fromResources(resources: ResourceAccessor): ExecManager {
    const execManager = new ExecManager();
    for (const [resource, implementation] of resources.entries()) {
      resource.registerControlledImplementation(implementation, execManager);
    }
    return execManager;
  }
}
