import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { AuthManager } from "@open-cursor/client";
import {
  AiService,
  Auth,
  CURSOR_API_URL,
  CURSOR_CLIENT_VERSION,
  CURSOR_WEBSITE_URL,
} from "@open-cursor/protocol";

import { resolveToolResult } from "./bridge/tools/relay.js";
import { getCachedModels, updateCachedModelsIfStale } from "./models/catalog.js";
import { retainOnlyActiveSessionMemory, terminateSession } from "./session/lifecycle.js";
import { restoreSessionStoreFromBranch } from "./session/store.js";
import { createStateStore } from "./stream/state.js";
import { streamCursorAgent } from "./stream/stream.js";

const auth = new AuthManager(new Auth(CURSOR_API_URL), CURSOR_WEBSITE_URL);

const createAiService = (accessToken: string) => {
  return new AiService(CURSOR_API_URL, {
    accessToken,
    clientVersion: CURSOR_CLIENT_VERSION,
    clientType: "cli",
  });
};

const updateCachedModelsInBackground = (accessToken: string) => {
  const ai = createAiService(accessToken);
  void updateCachedModelsIfStale(ai).catch(() => {}); // ignore
};

const updateCachedModelsFromContextInBackground = (ctx: ExtensionContext) => {
  void (async () => {
    const accessToken = await ctx.modelRegistry.getApiKeyForProvider("cursor-agent");
    if (!accessToken) {
      return;
    }

    await updateCachedModelsIfStale(createAiService(accessToken));
  })().catch(() => {}); // ignore
};

const login = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> => {
  const credentials = await auth.login(callbacks);
  updateCachedModelsInBackground(credentials.access);
  return credentials;
};

const refreshToken = async (credentials: OAuthCredentials): Promise<OAuthCredentials> => {
  const refreshed = await auth.refresh(credentials);
  updateCachedModelsInBackground(refreshed.access);
  return refreshed;
};

export default (pi: ExtensionAPI) => {
  let lastCtx: ExtensionContext | null = null;
  let currentSessionId: string | null = null;
  const getCtx = () => lastCtx;

  const state = createStateStore((type, data) => {
    pi.appendEntry(type, data);
  });

  const cleanupPreviousSession = async (newSessionId: string) => {
    const previousSessionId = currentSessionId;
    currentSessionId = newSessionId;
    if (previousSessionId && previousSessionId !== newSessionId) {
      await terminateSession(previousSessionId, "Session ended");
    }
  };

  const refreshBranchState = async (ctx: ExtensionContext) => {
    lastCtx = ctx;
    const sessionId = ctx.sessionManager.getSessionId();
    await cleanupPreviousSession(sessionId);
    state.resetFromContext(ctx);
    try {
      await restoreSessionStoreFromBranch(sessionId, ctx.sessionManager.getBranch());
    } catch {}
    retainOnlyActiveSessionMemory(sessionId);
  };

  pi.on("before_agent_start", async (_, ctx) => {
    lastCtx = ctx;
  });

  pi.on("agent_start", async (_, ctx) => {
    lastCtx = ctx;
  });

  pi.on("model_select", async (event, ctx) => {
    lastCtx = ctx;
    if (event.model.provider === "cursor-agent") {
      updateCachedModelsFromContextInBackground(ctx);
    }
  });

  pi.on("session_start", async (_, ctx) => {
    await refreshBranchState(ctx);
    updateCachedModelsFromContextInBackground(ctx);
  });

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- session_switch event not in pi types
  pi.on("session_switch" as never, async (_: unknown, ctx: ExtensionContext) => {
    await refreshBranchState(ctx);
    updateCachedModelsFromContextInBackground(ctx);
  });

  pi.on("session_tree", async (_, ctx) => {
    await refreshBranchState(ctx);
  });

  pi.on(
    "tool_execution_end",
    async (event: {
      toolCallId: string;
      toolName: string;
      result?: { content?: unknown[]; details?: unknown };
      isError?: boolean;
    }) => {
      resolveToolResult({
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: (event.result?.content ?? []) as (TextContent | ImageContent)[],
        details: event.result?.details,
        isError: event.isError ?? false,
        timestamp: Date.now(),
      });
    },
  );

  // Normalize Cursor context-overflow errors so pi's auto-compaction recognizes them.
  // Without this, pi sees an unrecognized error message and skips compaction+retry.
  const CURSOR_OVERFLOW_PATTERN =
    /(context.length.exceeded|prompt.too.long|token.limit.exceeded|maximum.context.length)/i;

  pi.on("message_end", (event, _ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    if (message.stopReason !== "error") return;
    if (message.provider !== "cursor-agent") return;

    const errorMessage = message.errorMessage ?? "";
    if (errorMessage.includes("context_length_exceeded")) return;
    if (!CURSOR_OVERFLOW_PATTERN.test(errorMessage)) return;

    return {
      message: {
        ...message,
        errorMessage: `context_length_exceeded: ${errorMessage}`,
      },
    };
  });

  pi.registerProvider("cursor-agent", {
    baseUrl: CURSOR_API_URL,
    apiKey: "CURSOR_ACCESS_TOKEN",
    api: "cursor-agent",
    streamSimple: (model, context, options) =>
      streamCursorAgent(pi, getCtx, state, model, context, options),
    models: getCachedModels() as ProviderModelConfig[],
    oauth: {
      name: "Cursor",
      login,
      refreshToken,
      getApiKey: (cred) => cred.access,
    },
  });
};
