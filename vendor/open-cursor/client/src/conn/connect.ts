import { createHash } from "node:crypto";

import { createWritableIterable } from "@connectrpc/connect/protocol";
import type { RpcClient } from "@open-cursor/protocol";
import {
  AgentClientMessage,
  AgentRunRequest,
  ClientHeartbeat,
  ConversationAction,
  ResumeAction,
} from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import type {
  ConversationStateStructure,
  InteractionResponse,
  ModelDetails,
} from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import {
  ExecClientControlMessage,
  ExecClientMessage as ExecClientMessageClass,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";
import type { ExecClientMessage as ExecClientMessageType } from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";
import type { KvClientMessage } from "@open-cursor/protocol/__generated__/agent/v1/kv_pb.js";
import type { McpTools } from "@open-cursor/protocol/__generated__/agent/v1/mcp_pb.js";

import { ExecManager } from "../exec/manager.js";
import type { ResourceAccessor } from "../exec/registry-accessor.js";
import { type BlobStore, KvManager } from "../kv/index.js";
import { MapWritable } from "../map-writable.js";
import { trace } from "../trace.js";
import { CheckpointController, type CheckpointHandler } from "./checkpoint-controller.js";
import { ExecController, ConnectionLostError } from "./exec-controller.js";
import { InteractionController, type InteractionListener } from "./interaction-controller.js";
import { type SplitChannels, type StallDetector, splitStream } from "./split-stream.js";

// Re-export for convenience
export type { RpcClient };

export interface ConnectRunOptions {
  interactionListener: InteractionListener;
  resources: ResourceAccessor;
  blobStore: BlobStore;
  checkpointHandler: CheckpointHandler;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  onConnectionStateChange?: (state: { state: "reconnecting" | "connected" }) => void;
}

const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_RETRY_ATTEMPTS = 5;

function debug(message: string, data?: Record<string, unknown>): void {
  trace(message, data);
}

function createNoopStallDetector(): StallDetector {
  return {
    onServerSentHeartbeat() {},
    reset() {},
    onStreamEnded() {},
  };
}

function isRetriableError(error: unknown): boolean {
  if (error instanceof ConnectionLostError) return true;
  if (error instanceof Error && error.message.includes("NGHTTP2")) return true;
  return false;
}

function summarizeClientMessage(message: AgentClientMessage): Record<string, unknown> {
  const bytes = message.toBinary();
  const summary: Record<string, unknown> = {
    case: message.message.case,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  if (process.env["PI_CURSOR_AGENT_TRACE_CLIENT_PAYLOADS"] === "1") {
    summary["base64"] = Buffer.from(bytes).toString("base64");
  }

  switch (message.message.case) {
    case "runRequest":
      summary["action"] = message.message.value.action?.action.case;
      summary["conversationId"] = message.message.value.conversationId;
      summary["model"] = message.message.value.modelDetails?.modelName;
      summary["hasConversationState"] = message.message.value.conversationState !== undefined;
      {
        const normalized = AgentClientMessage.fromBinary(bytes);
        if (normalized.message.case === "runRequest") {
          normalized.message.value.conversationId = "";
          const normalizedBytes = normalized.toBinary();
          summary["sha256WithoutConversationId"] = createHash("sha256")
            .update(normalizedBytes)
            .digest("hex");
        }
      }
      break;
    case "execClientMessage":
      summary["id"] = message.message.value.id;
      summary["execCase"] = message.message.value.message.case;
      break;
    case "execClientControlMessage":
      summary["execControlCase"] = message.message.value.message.case;
      break;
    case "kvClientMessage":
      summary["kvCase"] = message.message.value.message.case;
      break;
    case "interactionResponse":
      summary["interactionCase"] = message.message.value.result.case;
      break;
    default:
      break;
  }

  return summary;
}

function traceClientMessage(message: AgentClientMessage): void {
  debug("agent client message write", summarizeClientMessage(message));
}

/* oxlint-disable promise/no-multiple-resolved -- setTimeout and abort are mutually exclusive (once: true + clearTimeout) */
async function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.min(1_000 * 2 ** attempt, 30_000);
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
/* oxlint-enable promise/no-multiple-resolved */

export class ConnectClient {
  private readonly client: RpcClient;

  constructor(client: RpcClient) {
    this.client = client;
  }

  /**
   * Public entry point with centralized retry and resume logic.
   *
   * Retry behavior:
   * - Transport/stall errors: retry indefinitely with exponential backoff
   * - Server errors (high load): retry up to MAX_SERVER_ERROR_RETRIES times
   * - Non-retriable errors: surface immediately
   *
   * Checkpoint behavior:
   * - If a NEW checkpoint was received before failure, resume from checkpoint
   * - If NO checkpoint was received, resend the original action (prevents message loss)
   */
  async run(initialRequest: AgentClientMessage, options: ConnectRunOptions): Promise<void> {
    const runRequest = initialRequest.message.value as AgentRunRequest;

    // Retry state
    let currentState = runRequest.conversationState;
    let currentAction = runRequest.action;
    if (!currentAction) {
      throw new Error("runRequest.action is required");
    }
    const modelDetails = runRequest.modelDetails;
    const mcpTools = runRequest.mcpTools;
    const conversationId = runRequest.conversationId;
    let attempt = 0;
    const receivedNewCheckpoint = { value: false };

    // Helper: switch to ResumeAction if we received a checkpoint
    const maybeResumeFromCheckpoint = () => {
      if (!receivedNewCheckpoint.value) return;
      const checkpoint = options.checkpointHandler.getLatestCheckpoint?.();
      if (!checkpoint) return;
      currentState = checkpoint;
      currentAction = new ConversationAction({
        action: { case: "resumeAction", value: new ResumeAction() },
      });
    };

    // Wrap checkpoint handler to track when we receive new checkpoints
    const trackingCheckpointHandler: CheckpointHandler = {
      async handleCheckpoint(ctx: unknown, checkpoint: ConversationStateStructure): Promise<void> {
        receivedNewCheckpoint.value = true;
        return options.checkpointHandler.handleCheckpoint(ctx, checkpoint);
      },
      getLatestCheckpoint: () => options.checkpointHandler.getLatestCheckpoint?.(),
    };

    // Main retry loop
    while (true) {
      if (options.signal?.aborted) {
        throw new Error("Request cancelled");
      }

      // Reset per-attempt flags
      receivedNewCheckpoint.value = false;

      try {
        const request = this.buildRequest(
          currentState,
          currentAction,
          modelDetails,
          mcpTools,
          conversationId,
        );

        await this.runInternal(request, {
          ...options,
          checkpointHandler: trackingCheckpointHandler,
        });
        return;
      } catch (error) {
        if (!isRetriableError(error) || attempt >= MAX_RETRY_ATTEMPTS) {
          throw error;
        }

        // Retry: notify UI, maybe resume from checkpoint, backoff
        options.onConnectionStateChange?.({ state: "reconnecting" });
        maybeResumeFromCheckpoint();

        attempt++;
        await backoff(attempt, options.signal);
      }
    }
  }

  private buildRequest(
    conversationState: ConversationStateStructure | undefined,
    action: ConversationAction,
    modelDetails: ModelDetails | undefined,
    mcpTools: McpTools | undefined,
    conversationId: string | undefined,
  ): AgentClientMessage {
    return new AgentClientMessage({
      message: {
        case: "runRequest",
        value: new AgentRunRequest({
          ...(conversationState ? { conversationState } : {}),
          action,
          ...(modelDetails ? { modelDetails } : {}),
          ...(mcpTools ? { mcpTools } : {}),
          ...(conversationId ? { conversationId } : {}),
        }),
      },
    });
  }

  /**
   * Internal implementation that may throw any error type.
   * All errors are caught and converted at the public `run` boundary.
   */
  private async runInternal(
    initialRequest: AgentClientMessage,
    options: ConnectRunOptions,
  ): Promise<void> {
    const controlledExecManager = ExecManager.fromResources(options.resources);

    const stallDetector = createNoopStallDetector();

    const baseRequestStream = createWritableIterable<AgentClientMessage>();

    traceClientMessage(initialRequest);
    void baseRequestStream.write(initialRequest);

    const runOptions: {
      signal?: AbortSignal;
      headers?: Record<string, string>;
    } = {};
    if (options.signal) runOptions.signal = options.signal;
    if (options.headers) runOptions.headers = options.headers;

    const response = this.client.run(baseRequestStream, runOptions);

    const channels: SplitChannels = splitStream(response, stallDetector, () =>
      options.onConnectionStateChange?.({ state: "connected" }),
    );

    // Heartbeat sender using setTimeout (not setInterval)
    let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;

    const scheduleHeartbeat = () => {
      heartbeatTimeout = setTimeout(() => {
        baseRequestStream
          .write(
            new AgentClientMessage({
              message: {
                case: "clientHeartbeat",
                value: new ClientHeartbeat(),
              },
            }),
          )
          .then(scheduleHeartbeat)
          .catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);
    };

    const clearHeartbeat = () => {
      if (heartbeatTimeout !== undefined) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = undefined;
      }
    };

    scheduleHeartbeat();

    try {
      const execOutputStream = new MapWritable<
        ExecClientMessageType | ExecClientControlMessage,
        AgentClientMessage
      >(baseRequestStream, (message) => {
        if (message instanceof ExecClientMessageClass) {
          debug("exec message mapped to agent request", {
            id: message.id,
            case: message.message.case,
          });
          const mapped = new AgentClientMessage({
            message: { case: "execClientMessage", value: message },
          });
          traceClientMessage(mapped);
          return mapped;
        }
        if (message instanceof ExecClientControlMessage) {
          debug("exec control mapped to agent request", { case: message.message.case });
          const mapped = new AgentClientMessage({
            message: { case: "execClientControlMessage", value: message },
          });
          traceClientMessage(mapped);
          return mapped;
        }
        throw new Error("Unknown exec message type");
      });

      const kvOutputStream = new MapWritable<KvClientMessage, AgentClientMessage>(
        baseRequestStream,
        (message) => {
          const mapped = new AgentClientMessage({
            message: { case: "kvClientMessage", value: message },
          });
          traceClientMessage(mapped);
          return mapped;
        },
      );

      const queryResponseStream = new MapWritable<InteractionResponse, AgentClientMessage>(
        baseRequestStream,
        (interactionResponse) => {
          const mapped = new AgentClientMessage({
            message: { case: "interactionResponse", value: interactionResponse },
          });
          traceClientMessage(mapped);
          return mapped;
        },
      );

      const interactionController = new InteractionController(
        channels.interactionStream,
        options.interactionListener,
        queryResponseStream,
      );

      const execController = new ExecController(
        channels.execStream,
        execOutputStream,
        controlledExecManager,
      );

      const kvManager = new KvManager(channels.kvStream, kvOutputStream, options.blobStore);

      const checkpointController = new CheckpointController(
        channels.checkpointStream,
        options.checkpointHandler,
        null,
      );

      const ctx = null;

      const results = await Promise.allSettled([
        channels.done.finally(() => {
          clearHeartbeat();
          execOutputStream.close();
        }),
        execController.run(ctx),
        interactionController.run(ctx),
        checkpointController.run(),
        kvManager.run(ctx),
      ]);

      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
      }
    } finally {
      clearHeartbeat();
      baseRequestStream.close();
    }
  }
}
