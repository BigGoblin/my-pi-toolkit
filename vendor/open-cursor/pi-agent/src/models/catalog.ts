import fs from "node:fs";

import type { Model, Api } from "@earendil-works/pi-ai";
import type { AiService } from "@open-cursor/protocol";
import { CURSOR_API_URL } from "@open-cursor/protocol";
import type { ModelDetails } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";

import {
  PI_CURSOR_AGENT_MODELS_CACHE_FILE,
  PI_CURSOR_AGENT_MODELS_CACHE_TTL_MS,
  PI_CURSOR_AGENT_CACHE_DIR,
} from "../paths.js";
import { toCanonicalId } from "./mapping.js";
import { findModelOverride, type ModelOverride } from "./overrides.js";

interface CachedModelsFile {
  models: ModelDetails[];
  lastUpdatedAt?: string;
}

let updateInFlight: Promise<void> | null = null;

const toCursorModel = (id: string, model: ModelDetails, override: ModelOverride) => {
  return {
    id,
    name: `${model.displayName} (Cursor)`,
    api: "cursor-agent",
    provider: "cursor-agent",
    baseUrl: CURSOR_API_URL,
    ...override,
  };
};

const readCache = (): CachedModelsFile | undefined => {
  try {
    if (!fs.existsSync(PI_CURSOR_AGENT_MODELS_CACHE_FILE)) {
      return undefined;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns unknown, validated by caller
    return JSON.parse(
      fs.readFileSync(PI_CURSOR_AGENT_MODELS_CACHE_FILE, "utf8"),
    ) as CachedModelsFile;
  } catch {
    return undefined;
  }
};

const isCacheStale = (cache: CachedModelsFile | undefined): boolean => {
  if (!cache?.lastUpdatedAt) {
    return true;
  }

  const lastUpdatedAt = Date.parse(cache.lastUpdatedAt);
  return (
    Number.isNaN(lastUpdatedAt) || Date.now() - lastUpdatedAt >= PI_CURSOR_AGENT_MODELS_CACHE_TTL_MS
  );
};

export const getCachedModels = (): Model<Api>[] => {
  return (readCache()?.models ?? []).flatMap((model) => {
    const canonicalId = toCanonicalId(model.modelId);
    if (!canonicalId) {
      return [];
    }

    const override = findModelOverride(canonicalId);
    return [toCursorModel(canonicalId, model, override)];
  });
};

export const updateCachedModels = async (ai: AiService) => {
  const [response] = await Promise.all([
    ai.rpcClient.getUsableModels(),
    fs.promises.mkdir(PI_CURSOR_AGENT_CACHE_DIR, { recursive: true }),
  ]);

  const payload: CachedModelsFile = {
    models: response.models,
    lastUpdatedAt: new Date().toISOString(),
  };

  await fs.promises.writeFile(PI_CURSOR_AGENT_MODELS_CACHE_FILE, JSON.stringify(payload, null, 2));
};

export const updateCachedModelsIfStale = async (ai: AiService) => {
  if (updateInFlight) {
    await updateInFlight;
    return;
  }

  if (!isCacheStale(readCache())) {
    return;
  }

  updateInFlight = updateCachedModels(ai).finally(() => {
    updateInFlight = null;
  });

  await updateInFlight;
};
