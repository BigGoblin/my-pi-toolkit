import {
  type Api,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type ToolCall as PiToolCall,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ConnectClient,
  type CheckpointHandler,
  type InteractionListener,
} from "@open-cursor/client";
import type {
  CoreInteractionQuery,
  CoreInteractionResponse,
  CoreInteractionUpdate,
} from "@open-cursor/client";
import { AgentService, CURSOR_API_URL, CURSOR_CLIENT_VERSION } from "@open-cursor/protocol";
import type { ConversationStateStructure } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import {
  AskQuestionRejected,
  AskQuestionResult,
} from "@open-cursor/protocol/__generated__/agent/v1/ask_question_tool_pb.js";

import {
  deleteLiveSession,
  getLiveSession,
  LiveEventChannel,
  type LiveSession,
  setLiveSession,
  type ToolExecRequest,
} from "../bridge/live-session.js";
import { buildRunRequest, getContextTools } from "../bridge/request/builder.js";
import { preparePiContext } from "../bridge/request/context/index.js";
import { rejectPendingForSession } from "../bridge/tools/relay.js";
import { LocalResourceProvider, type PiToolContext } from "../bridge/tools/resource-provider.js";
import { toCursorId } from "../models/mapping.js";
import {
  CURSOR_STATE_ENTRY_TYPE,
  ensureSessionStore,
  evictSessionStore,
  persistSessionStore,
} from "../session/store.js";
import { trace } from "../trace.js";
import {
  finalizeAllContent,
  pushContentEvent,
  serializeContentBlocks,
  type CursorAssistantMessage,
  type LiveContentState,
} from "./content-builder.js";
import {
  finalizeCursorUsage,
  observeContextTokens,
  peekContextTokens,
  readCheckpointUsedTokens,
} from "./context-usage.js";
import { type CursorStateStore, createOverlayState } from "./state.js";

function createCheckpointHandler(
  handler: (checkpoint: ConversationStateStructure) => void,
): CheckpointHandler {
  return {
    handleCheckpoint(_ctx: unknown, checkpoint: ConversationStateStructure): Promise<void> {
      handler(checkpoint);
      return Promise.resolve();
    },
  };
}

function debug(message: string, data?: Record<string, unknown>): void {
  trace(message, data);
}

function debugError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        cause instanceof Error ? cause.message : cause === undefined ? "" : JSON.stringify(cause),
    };
  }
  return { message: String(error) };
}

const QUERY_REJECTION_REASON = "Not supported";

function createInteractionListenerAdapter(
  onUpdate: (update: CoreInteractionUpdate) => void,
): InteractionListener {
  return {
    async sendUpdate(_ctx: unknown, update: CoreInteractionUpdate): Promise<void> {
      onUpdate(update);
    },
    async query(_ctx: unknown, query: CoreInteractionQuery): Promise<CoreInteractionResponse> {
      switch (query.type) {
        case "ask-question-request":
          return {
            result: new AskQuestionResult({
              result: {
                case: "rejected",
                value: new AskQuestionRejected({
                  reason: QUERY_REJECTION_REASON,
                }),
              },
            }),
          };
        case "web-search-request":
        case "web-fetch-request":
        case "switch-mode-request":
        case "pr-management-request":
        case "mcp-auth-request":
        case "generate-image-request":
        case "replace-env-request":
          return { approved: false, reason: QUERY_REJECTION_REASON };
        case "create-plan-request":
          return {
            result: {
              planUri: "",
              result: {
                case: "error",
                value: { error: QUERY_REJECTION_REASON },
              },
            },
          } as CoreInteractionResponse;
        case "setup-vm-environment-request":
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- intentional empty response cast
          return {} as CoreInteractionResponse;
        default:
          return { approved: false, reason: QUERY_REJECTION_REASON };
      }
    },
  };
}

async function consumeUntilBoundary(
  channel: LiveEventChannel,
  output: CursorAssistantMessage,
  stream: AssistantMessageEventStream,
  usageState: { sawTokenDelta: boolean },
  setFirstTokenTime: () => void,
): Promise<{
  reason: "toolUse" | "stop";
  tools: ToolExecRequest[];
}> {
  const contentState: LiveContentState = {
    currentText: null,
    currentThinking: null,
  };

  while (true) {
    const event = await channel.next();

    if (event === null) {
      finalizeAllContent(contentState, output, stream);
      return { reason: "stop", tools: [] };
    }

    switch (event.kind) {
      case "content": {
        setFirstTokenTime();
        debug("content event", { kind: event.data.kind, length: event.data.text.length });
        pushContentEvent(event.data, contentState, output, stream);
        break;
      }

      case "tool-exec-request": {
        finalizeAllContent(contentState, output, stream);
        return { reason: "toolUse", tools: [event.request] };
      }

      case "token-delta": {
        usageState.sawTokenDelta = true;
        output.usage.output += event.tokens;
        // Do not set totalTokens from turn deltas — absolute context comes from checkpoints.
        break;
      }

      case "cursor-done": {
        finalizeAllContent(contentState, output, stream);
        return { reason: "stop", tools: [] };
      }
    }
  }
}

function emitToolCalls(
  tools: ToolExecRequest[],
  output: CursorAssistantMessage,
  stream: AssistantMessageEventStream,
  state: CursorStateStore,
): void {
  for (const request of tools) {
    state.rememberToolCallMeta({
      toolCallId: request.toolCallId,
      cursorExecType: request.cursorExecType,
      piToolName: request.piToolName,
      piToolArgs: request.piToolArgs,
      assistantTimestamp: output.timestamp,
    });

    const block: PiToolCall = {
      type: "toolCall",
      id: request.toolCallId,
      name: request.piToolName,
      arguments: request.piToolArgs,
    };
    output.content.push(block);
    const idx = output.content.length - 1;
    stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
    stream.push({
      type: "toolcall_end",
      contentIndex: idx,
      toolCall: block,
      partial: output,
    });
  }
}

export function streamCursorAgent(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | null,
  state: CursorStateStore,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  void (async () => {
    const sessionId = options?.sessionId ?? "default";
    debug("stream entered", { sessionId, model: model.id, messageCount: context.messages.length });

    const output: CursorAssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    let session: LiveSession | undefined;

    try {
      session = getLiveSession(sessionId);
      debug(session ? "live session reused" : "live session missing; creating", { sessionId });

      if (!session) {
        const apiKey = options?.apiKey;
        if (!apiKey) {
          throw new Error(
            "Cursor API key (access token) is required. Run /login cursor or set CURSOR_ACCESS_TOKEN.",
          );
        }

        const agentStore = await ensureSessionStore(sessionId);
        const cwd = getCtx()?.cwd ?? process.cwd();
        const requestContextTools = getContextTools(context);

        const channel = new LiveEventChannel(sessionId);
        const sessionAbortController = new AbortController();
        const sessionSignal = options?.signal
          ? AbortSignal.any([options.signal, sessionAbortController.signal])
          : sessionAbortController.signal;

        const piToolCtx: PiToolContext = {
          cwd,
          signal: sessionSignal,
          getActiveTools: () => new Set(pi.getActiveTools()),
          getCtx,
          getChannel: () => channel,
        };

        const piContext = await preparePiContext(context.systemPrompt ?? "");

        const resources = new LocalResourceProvider({
          ctx: piToolCtx,
          requestContextTools,
          cursorRules: piContext.rules,
        });

        const blobStore = agentStore.getBlobStore();
        const cursorModelId = toCursorId(model.id, options?.reasoning);
        const overlayState = createOverlayState(state);
        const { initialRequest, conversationState } = buildRunRequest({
          model: { ...model, id: cursorModelId },
          context,
          conversationId: agentStore.getId(),
          blobStore,
          conversationState: agentStore.getConversationStateStructure(),
          mcpToolDefinitions: requestContextTools,
          state: overlayState,
          systemPromptOverride: piContext.cleanedPrompt,
        });
        agentStore.conversationStateStructure = conversationState;

        let lastFlushedRootBlobId: string | undefined;
        const flushSessionState = async () => {
          const snapshot = await persistSessionStore(sessionId);
          if (!snapshot || snapshot.latestRootBlobId === lastFlushedRootBlobId) return;
          lastFlushedRootBlobId = snapshot.latestRootBlobId;
          pi.appendEntry(CURSOR_STATE_ENTRY_TYPE, snapshot);
        };

        const handleInteractionUpdate = (update: CoreInteractionUpdate) => {
          // Only forward text/thinking/token deltas to the channel; other interaction
          // types (plan, web search, MCP auth, etc.) are handled by the interaction listener
          switch (update.type) {
            case "text-delta":
              channel.push({
                kind: "content",
                data: { kind: "text-delta", text: update.text },
              });
              return;
            case "thinking-delta":
              channel.push({
                kind: "content",
                data: { kind: "thinking-delta", text: update.text },
              });
              return;
            case "thinking-completed":
              channel.push({
                kind: "content",
                data: { kind: "thinking-completed", text: "" },
              });
              return;
            case "token-delta":
              channel.push({ kind: "token-delta", tokens: update.tokens });
              return;
            case "heartbeat":
            case "partial-tool-call":
            case "shell-output-delta":
            case "step-completed":
            case "step-started":
            case "summary":
            case "summary-completed":
            case "summary-started":
            case "tool-call-completed":
            case "tool-call-delta":
            case "tool-call-started":
            case "user-message-appended":
              return;
            case "turn-ended":
              if (update.inputTokens !== undefined) output.usage.input += update.inputTokens;
              if (update.outputTokens !== undefined) output.usage.output += update.outputTokens;
              if (update.cacheReadTokens !== undefined)
                output.usage.cacheRead += update.cacheReadTokens;
              if (update.cacheWriteTokens !== undefined)
                output.usage.cacheWrite += update.cacheWriteTokens;
              // Do not set totalTokens from turn deltas — absolute context comes from checkpoints.
              return;
          }
        };

        const conversationId = agentStore.getId();
        const fromStore = readCheckpointUsedTokens(agentStore.getConversationStateStructure());
        const seededContextTokens =
          fromStore > 0 ? fromStore : peekContextTokens(conversationId);
        const contextUsage = { tokens: seededContextTokens };
        if (seededContextTokens > 0) {
          observeContextTokens(conversationId, seededContextTokens);
        }

        const baseUrl = model.baseUrl || CURSOR_API_URL;
        const agentService = new AgentService(baseUrl, {
          accessToken: apiKey,
          clientVersion: CURSOR_CLIENT_VERSION,
          clientType: "cli",
        });
        const connectClient = new ConnectClient(agentService.rpcClient);
        const interactionListener = createInteractionListenerAdapter(handleInteractionUpdate);
        const checkpointHandler = createCheckpointHandler(
          (checkpoint: ConversationStateStructure) => {
            void agentStore.handleCheckpoint(null, checkpoint);
            const used = readCheckpointUsedTokens(checkpoint);
            if (used > 0) {
              contextUsage.tokens = used;
              observeContextTokens(conversationId, used);
              debug("checkpoint context tokens", { sessionId, usedTokens: used });
            }
          },
        );
        checkpointHandler.getLatestCheckpoint = () => agentStore.getConversationStateStructure();

        const runOptions: Parameters<typeof connectClient.run>[1] = {
          interactionListener,
          resources,
          blobStore,
          checkpointHandler,
          signal: sessionSignal,
        };

        const cursorRunPromise = connectClient
          .run(initialRequest, runOptions)
          .then(() => {
            debug("cursor run finished", { sessionId });
            channel.push({ kind: "cursor-done" });
            return undefined;
          })
          .catch((error: unknown) => {
            debug("cursor run caught error", { sessionId, ...debugError(error) });
            channel.push({ kind: "cursor-done" });
          })
          .finally(() => {
            channel.markDone();
          });

        session = {
          channel,
          cursorRunPromise,
          flushSessionState,
          abort: (reason) => {
            sessionAbortController.abort(reason ? new Error(reason) : new Error("Session ended"));
          },
          startTime: Date.now(),
          conversationId,
          contextUsage,
          readStoreContextTokens: () =>
            readCheckpointUsedTokens(agentStore.getConversationStateStructure()),
        };
        setLiveSession(sessionId, session);
      }

      if (!session) {
        throw new Error(`Failed to initialize live session: ${sessionId}`);
      }
      const liveSession = session;

      const usageState = { sawTokenDelta: false };
      let firstTokenTimeCaptured = false;

      stream.push({ type: "start", partial: output });

      const result = await consumeUntilBoundary(
        liveSession.channel,
        output,
        stream,
        usageState,
        () => {
          if (!firstTokenTimeCaptured) {
            firstTokenTimeCaptured = true;
            liveSession.firstTokenTime ??= Date.now();
          }
        },
      );

      output.duration = Date.now() - liveSession.startTime;
      if (liveSession.firstTokenTime) {
        output.ttft = liveSession.firstTokenTime - liveSession.startTime;
      }
      output.usage.cost = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      };

      // Prefer absolute usedTokens from Cursor checkpoints over turn input+output deltas.
      if (liveSession?.readStoreContextTokens && liveSession?.contextUsage && liveSession?.conversationId) {
        const storeTokens = liveSession.readStoreContextTokens();
        if (storeTokens > 0) {
          liveSession.contextUsage.tokens = storeTokens;
        }
        finalizeCursorUsage(
          output.usage,
          liveSession.conversationId,
          liveSession.contextUsage.tokens,
        );
      }
      debug("finalized context usage", {
        sessionId,
        totalTokens: output.usage.totalTokens,
        input: output.usage.input,
        output: output.usage.output,
        contextTokens: liveSession.contextUsage.tokens,
      });

      if (result.reason === "toolUse" && result.tools.length > 0) {
        debug("stream boundary toolUse", {
          sessionId,
          tools: result.tools.map((tool) => ({
            toolCallId: tool.toolCallId,
            cursorExecType: tool.cursorExecType,
            piToolName: tool.piToolName,
          })),
        });
        emitToolCalls(result.tools, output, stream, state);
        output.stopReason = "toolUse";

        state.rememberAssistantContent({
          timestamp: output.timestamp,
          blocks: serializeContentBlocks(output.content),
        });
        try {
          await session.flushSessionState();
        } catch {}

        stream.push({
          type: "done",
          reason: "toolUse",
          message: { ...output },
        });
      } else {
        debug("stream boundary stop", { sessionId });
        output.stopReason = "stop";

        state.rememberAssistantContent({
          timestamp: output.timestamp,
          blocks: serializeContentBlocks(output.content),
        });
        let flushed = false;
        try {
          await session.flushSessionState();
          flushed = true;
        } catch {}
        deleteLiveSession(sessionId);
        await session.cursorRunPromise.catch(() => {});
        await evictSessionStore(sessionId, { persist: !flushed }).catch(() => {});
        stream.push({ type: "done", reason: "stop", message: output });
      }
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      let flushed = false;
      try {
        if (session) {
          await session.flushSessionState();
          flushed = true;
          await session.cursorRunPromise.catch(() => {});
        }
      } catch {}
      deleteLiveSession(sessionId);
      rejectPendingForSession(sessionId, `Stream error: ${output.errorMessage}`);
      await evictSessionStore(sessionId, { persist: !flushed }).catch(() => {});
      stream.push({
        type: "error",
        reason: output.stopReason === "aborted" ? "aborted" : "error",
        error: { ...output },
      });
      stream.end();
    }
  })();

  return stream;
}
