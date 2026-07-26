/** Collapse Cursor flat model IDs into family + thinking (+ optional fast). */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
  LEVEL_TO_PI,
  PI_TO_LEVEL,
  type LevelSuffix,
  parseModelId,
  pickLevelSuffix,
} from "./parse.js";

export interface CachedModelDetails {
  modelId: string;
  displayName?: string;
  displayNameShort?: string;
}

export interface ModelFamily {
  id: string;
  displayName: string;
  /** level suffix | "default" → cursor model id (non-fast) */
  levels: Map<string, string>;
  /** level suffix | "default" → cursor model id (fast) */
  fastLevels: Map<string, string>;
  /** Preferred default level suffix, or null for bare family id */
  defaultLevel: LevelSuffix | null;
  hasFast: boolean;
}

interface CacheFile {
  models?: CachedModelDetails[];
}

const DEFAULT_COST = { input: 1.25, output: 6, cacheRead: 0.25, cacheWrite: 1.25 };
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Per-family context window (tokens). Cursor cache has no window metadata. */
function contextWindowForFamily(familyId: string): number {
  if (familyId === "cursor-grok-4.5") return 256_000;
  if (familyId.startsWith("composer")) return 200_000;
  return DEFAULT_CONTEXT_WINDOW;
}

const LEVEL_PREFERENCE: Array<LevelSuffix | null> = [
  null,
  "medium",
  "high",
  "low",
  "xhigh",
  "extra-high",
  "max",
  "minimal",
  "none",
];

export function modelsCachePath(): string {
  return join(getAgentDir(), "cache", "pi-cursor-agent", "models.json");
}

export function readCachedModels(): CachedModelDetails[] {
  const path = modelsCachePath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
    return Array.isArray(raw.models) ? raw.models : [];
  } catch {
    return [];
  }
}

function stripLevelWords(name: string): string {
  return name
    .replace(/\s+Fast$/i, "")
    .replace(/\s+(None|Minimal|Low|Medium|High|Extra High|Max)\s*$/i, "")
    .trim();
}

function chooseDefaultLevel(levels: Map<string, string>): LevelSuffix | null {
  for (const pref of LEVEL_PREFERENCE) {
    if (pref === null) {
      if (levels.has("default")) return null;
      continue;
    }
    if (levels.has(pref)) return pref;
  }
  for (const key of levels.keys()) {
    if (key === "default") return null;
    return key as LevelSuffix;
  }
  return null;
}

export function buildFamilies(raw: CachedModelDetails[]): Map<string, ModelFamily> {
  const byFamily = new Map<
    string,
    {
      displayCandidates: string[];
      levels: Map<string, string>;
      fastLevels: Map<string, string>;
    }
  >();

  for (const model of raw) {
    const parsed = parseModelId(model.modelId);
    let entry = byFamily.get(parsed.family);
    if (!entry) {
      entry = { displayCandidates: [], levels: new Map(), fastLevels: new Map() };
      byFamily.set(parsed.family, entry);
    }
    const key = parsed.level ?? "default";
    if (parsed.fast) entry.fastLevels.set(key, model.modelId);
    else entry.levels.set(key, model.modelId);
    const label = model.displayName ?? model.displayNameShort;
    if (label) entry.displayCandidates.push(label);
  }

  const families = new Map<string, ModelFamily>();
  for (const [id, entry] of byFamily) {
    const hasFast = entry.fastLevels.size > 0;
    const variantCount = new Set([...entry.levels.keys(), ...entry.fastLevels.keys()]).size;
    const collapsible = variantCount > 1 || (entry.levels.size > 0 && hasFast);

    if (!collapsible) {
      const only =
        [...entry.levels.values()][0] ?? [...entry.fastLevels.values()][0] ?? id;
      families.set(id, {
        id,
        displayName: stripLevelWords(entry.displayCandidates[0] ?? id),
        levels: new Map([["default", only]]),
        fastLevels: new Map(),
        defaultLevel: null,
        hasFast: false,
      });
      continue;
    }

    if (entry.levels.size === 0) {
      for (const [k, v] of entry.fastLevels) {
        entry.levels.set(k, v.replace(/-fast$/, ""));
      }
    }

    const defaultLevel = chooseDefaultLevel(entry.levels);
    const preferredLabel =
      entry.displayCandidates.find(
        (n) => !/fast/i.test(n) && !/\b(low|high|medium|none|max|minimal|extra)\b/i.test(n),
      ) ??
      entry.displayCandidates[0] ??
      id;

    families.set(id, {
      id,
      displayName: stripLevelWords(preferredLabel),
      levels: entry.levels,
      fastLevels: entry.fastLevels,
      defaultLevel,
      hasFast,
    });
  }

  return families;
}

export function buildThinkingLevelMap(
  family: ModelFamily,
): NonNullable<ProviderModelConfig["thinkingLevelMap"]> {
  const available = new Set(family.levels.keys());
  const map: NonNullable<ProviderModelConfig["thinkingLevelMap"]> = {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: null,
    max: null,
  };

  if (available.size === 1 && available.has("default")) {
    return map;
  }

  for (const suffix of available) {
    if (suffix === "default") continue;
    const piKey = LEVEL_TO_PI[suffix as LevelSuffix];
    if (!piKey || !(piKey in map)) continue;
    (map as Record<string, string | null>)[piKey] = piKey;
  }

  return map;
}

export function toProviderModels(families: Map<string, ModelFamily>): ProviderModelConfig[] {
  const models: ProviderModelConfig[] = [];
  for (const family of families.values()) {
    const thinkingLevelMap = buildThinkingLevelMap(family);
    const hasThinking = Object.values(thinkingLevelMap).some((v) => v !== null);
    models.push({
      id: family.id,
      name: `${family.displayName} (Cursor)`,
      reasoning: hasThinking,
      thinkingLevelMap: hasThinking ? thinkingLevelMap : undefined,
      input: ["text", "image"],
      cost: DEFAULT_COST,
      contextWindow: contextWindowForFamily(family.id),
      maxTokens: 30000,
    });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

export function resolveCursorModelId(
  familyId: string,
  thinking: string | undefined,
  fast: boolean,
  families: Map<string, ModelFamily>,
): string {
  const family = families.get(familyId);
  if (!family) return familyId;

  const desiredSuffix =
    thinking && thinking !== "off" ? (PI_TO_LEVEL[thinking] ?? null) : family.defaultLevel;

  const pool = new Set([
    ...family.levels.keys(),
    ...(fast ? family.fastLevels.keys() : []),
  ]);
  const level =
    pickLevelSuffix(desiredSuffix, pool) ??
    pickLevelSuffix(family.defaultLevel, pool) ??
    family.defaultLevel;
  const key = level ?? "default";

  if (fast) {
    const fastId = family.fastLevels.get(key) ?? family.fastLevels.get("default");
    if (fastId) return fastId;
    const base = family.levels.get(key) ?? family.levels.get("default") ?? familyId;
    return base.endsWith("-fast") ? base : `${base}-fast`;
  }

  return family.levels.get(key) ?? family.levels.get("default") ?? familyId;
}

export function findFamilyForRawId(
  rawId: string,
  families: Map<string, ModelFamily>,
): { family: ModelFamily; level: LevelSuffix | null; fast: boolean } | null {
  const parsed = parseModelId(rawId);
  const family = families.get(parsed.family);
  if (!family) return null;
  return { family, level: parsed.level, fast: parsed.fast };
}
