/**
 * Collapse Cursor flat model variants into family + thinking level,
 * and expose Fast as a toggle (/fast, ctrl+shift+f).
 */
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
  buildFamilies,
  findFamilyForRawId,
  readCachedModels,
  resolveCursorModelId,
  toProviderModels,
  type ModelFamily,
} from "./collapse.js";
import { isFast, setFast, toggleFast } from "./fast-state.js";
import { createFastAwareFooter } from "./footer.js";
import { LEVEL_TO_PI } from "./parse.js";

type StreamSimple = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/**
 * Frozen upstream stream from the pre-wrap composed provider.
 * Must capture before re-register, otherwise the new stream would recurse into itself.
 */
let upstreamStream: StreamSimple | undefined;
let families = new Map<string, ModelFamily>();
let lastCtx: ExtensionContext | null = null;
let requestFooterRender: (() => void) | undefined;
let footerInstalled = false;

function refreshFamilies(): Map<string, ModelFamily> {
  families = buildFamilies(readCachedModels());
  return families;
}

function collapsedModels(): ProviderModelConfig[] {
  return toProviderModels(refreshFamilies());
}

function refreshFastUi(ctx: ExtensionContext): void {
  lastCtx = ctx;
  // Clear legacy separate status line; fast is shown inline in the model footer.
  ctx.ui.setStatus("cursor-fast", undefined);
  requestFooterRender?.();
}

function ensureFooter(ctx: ExtensionContext): void {
  if (footerInstalled) {
    refreshFastUi(ctx);
    return;
  }
  lastCtx = ctx;
  ctx.ui.setFooter(
    createFastAwareFooter(
      () => lastCtx,
      () => families,
      (requestRender) => {
        requestFooterRender = requestRender;
      },
    ),
  );
  footerInstalled = true;
  refreshFastUi(ctx);
}

function applyProvider(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const provider = ctx.modelRegistry.getProvider("cursor-agent");
  if (!provider?.streamSimple) return;

  // Capture once while provider still uses open-cursor's streamSimple.
  if (!upstreamStream) {
    const frozen = provider;
    upstreamStream = ((model, context, options) =>
      frozen.streamSimple!(model, context, options)) as StreamSimple;
  }

  const models = collapsedModels();
  if (models.length === 0) return;

  pi.registerProvider("cursor-agent", {
    baseUrl: provider.baseUrl ?? "https://api2.cursor.sh",
    api: "cursor-agent" as Api,
    models,
    streamSimple: (model, context, options) => {
      const resolvedId = resolveCursorModelId(
        model.id,
        options?.reasoning,
        isFast(),
        families,
      );
      return upstreamStream!({ ...model, id: resolvedId }, context, options);
    },
  });
}

async function migrateActiveModel(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const model = ctx.model;
  if (!model || model.provider !== "cursor-agent") return;

  const hit = findFamilyForRawId(model.id, families);
  if (!hit) return;
  if (model.id === hit.family.id) return;

  if (hit.fast) setFast(true);
  refreshFastUi(ctx);

  const canonical = ctx.modelRegistry.find("cursor-agent", hit.family.id);
  if (!canonical) return;

  await pi.setModel(canonical);
  if (hit.level) {
    const piLevel = LEVEL_TO_PI[hit.level] as ThinkingLevel | undefined;
    if (piLevel) pi.setThinkingLevel(piLevel);
  }
}

function toggleFastUi(ctx: ExtensionContext): void {
  const family = families.get(ctx.model?.id ?? "");
  if (ctx.model?.provider === "cursor-agent" && family && !family.hasFast) {
    ctx.ui.notify("当前模型没有 Fast 变体", "warning");
    return;
  }

  const next = toggleFast();
  refreshFastUi(ctx);
  ctx.ui.notify(next ? "Fast: on" : "Fast: off", "info");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("fast", {
    description: "Toggle Cursor Fast mode",
    handler: async (_args, ctx) => {
      toggleFastUi(ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+f", {
    description: "Toggle Cursor Fast mode",
    handler: async (ctx) => {
      toggleFastUi(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    applyProvider(pi, ctx);
    ensureFooter(ctx);
    await migrateActiveModel(pi, ctx);
    refreshFastUi(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    lastCtx = ctx;
    if (event.model.provider === "cursor-agent") {
      applyProvider(pi, ctx);
    }
    refreshFastUi(ctx);
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    lastCtx = ctx;
    refreshFastUi(ctx);
  });
}
