import { type Client, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

import type { AgentClientMessage, AgentServerMessage } from "./__generated__/agent/v1/agent_pb";
import { AgentService as AgentServiceDesc } from "./__generated__/agent/v1/agent_service_connect.js";

export interface RpcClient {
  run(
    input: AsyncIterable<AgentClientMessage>,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): AsyncIterable<AgentServerMessage>;
}

interface AgentServiceOptions {
  accessToken: string;
  clientType: string;
  clientVersion: string;
}

function getAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Wraps an AsyncIterable to catch and swallow ConnectError parse failures
 * that happen after the stream has already ended. These indicate a protocol
 * trailer or cleanup parse issue that shouldn't crash the session.
 */
function wrapParseErrorSafe(
  stream: AsyncIterable<AgentServerMessage>,
): AsyncIterable<AgentServerMessage> {
  const wrappedIterator = stream[Symbol.asyncIterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          try {
            const result = await wrappedIterator.next();
            return result;
          } catch (error) {
            // Swallow ConnectError parse failures (trailer parse noise)
            if (
              error instanceof Error &&
              error.message.includes("parse binary") &&
              error.message.includes("illegal tag")
            ) {
              console.error("PI_CURSOR_AGENT_SWALLOWED_PARSE_ERROR", error.message);
              // Stream ended with a parse error in the trailer — treat as end of stream
              return { done: true, value: undefined as never };
            }
            throw error;
          }
        },
        async return() {
          if (wrappedIterator.return) {
            return wrappedIterator.return();
          }
          return { done: true, value: undefined as never };
        },
        async throw(error) {
          if (wrappedIterator.throw) {
            return wrappedIterator.throw(error);
          }
          throw error;
        },
      };
    },
  };
}

export function wrapAbortSafeStream(
  stream: AsyncIterable<AgentServerMessage>,
  signal: AbortSignal,
): AsyncIterable<AgentServerMessage> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = stream[Symbol.asyncIterator]();
      let done = false;

      const closeIterator = async () => {
        if (done) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- return value typed as never in done state
          return { done: true, value: undefined as never };
        }

        done = true;
        return (
          (await iterator.return?.()) ?? {
            done: true,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- return value typed as never in done state
            value: undefined as never,
          }
        );
      };

      return {
        async next() {
          if (done) {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- value typed as never in done state
            return { done: true, value: undefined as never };
          }

          let cleanup = () => {};
          try {
            const aborted = new Promise<never>((_, reject) => {
              const onAbort = () => {
                reject(getAbortError(signal.reason));
              };

              if (signal.aborted) {
                onAbort();
                return;
              }

              signal.addEventListener("abort", onAbort, { once: true });
              cleanup = () => {
                signal.removeEventListener("abort", onAbort);
              };
            });

            const result = await Promise.race([iterator.next(), aborted]);
            if (result.done) {
              done = true;
            }
            return result;
          } catch (error) {
            await closeIterator();
            throw error;
          } finally {
            cleanup();
          }
        },
        async return() {
          return closeIterator();
        },
        async throw(error) {
          done = true;
          if (iterator.throw) {
            return iterator.throw(error);
          }
          throw error;
        },
      };
    },
  };
}

class AgentService {
  private readonly client: Client<typeof AgentServiceDesc>;

  constructor(baseUrl: string, options: AgentServiceOptions) {
    const authInterceptor: Interceptor = (next) => async (req) => {
      req.header.set("authorization", `Bearer ${options.accessToken}`);
      req.header.set("x-cursor-client-type", options.clientType);
      req.header.set("x-cursor-client-version", options.clientVersion);
      req.header.set("x-ghost-mode", "true");
      req.header.set("x-request-id", crypto.randomUUID());
      return next(req);
    };

    const transport = createConnectTransport({
      baseUrl,
      httpVersion: "2",
      interceptors: [authInterceptor],
    });

    this.client = createClient(AgentServiceDesc, transport);
  }

  get rpcClient(): RpcClient {
    const client = this.client;

    return {
      run(
        input: AsyncIterable<AgentClientMessage>,
        options?: { signal?: AbortSignal; headers?: Record<string, string> },
      ): AsyncIterable<AgentServerMessage> {
        const response = client["run"](input, {
          ...(options?.headers ? { headers: options.headers } : {}),
        });

        // Wrap with parse-error safety first, then abort safety
        const safeResponse = wrapParseErrorSafe(response);

        if (!options?.signal) {
          return safeResponse;
        }

        return wrapAbortSafeStream(safeResponse, options.signal);
      },
    };
  }
}

export default AgentService;
