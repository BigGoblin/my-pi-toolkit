/** Thinking suffixes that Cursor encodes into flat model IDs (longest first). */
export const LEVEL_SUFFIXES = [
  "extra-high",
  "xhigh",
  "minimal",
  "medium",
  "none",
  "high",
  "low",
  "max",
] as const;

export type LevelSuffix = (typeof LEVEL_SUFFIXES)[number];

/** Map Cursor level suffix → pi ThinkingLevel key. */
export const LEVEL_TO_PI: Record<LevelSuffix, string> = {
  none: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  "extra-high": "xhigh",
  xhigh: "xhigh",
  max: "max",
};

/** Map pi ThinkingLevel → preferred Cursor level suffix for a family. */
export const PI_TO_LEVEL: Record<string, LevelSuffix> = {
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

export interface ParsedModelId {
  family: string;
  level: LevelSuffix | null;
  fast: boolean;
}

export function parseModelId(modelId: string): ParsedModelId {
  let id = modelId;
  let fast = false;
  if (id.endsWith("-fast")) {
    fast = true;
    id = id.slice(0, -"-fast".length);
  }

  for (const level of LEVEL_SUFFIXES) {
    const suffix = `-${level}`;
    if (id.endsWith(suffix)) {
      return {
        family: id.slice(0, -suffix.length),
        level,
        fast,
      };
    }
  }

  return { family: id, level: null, fast };
}

/** Normalize a Cursor level to the suffix actually present in a family. */
export function pickLevelSuffix(
  desired: LevelSuffix | null,
  available: ReadonlySet<string>,
): LevelSuffix | null {
  if (desired && available.has(desired)) return desired;
  if (desired === "xhigh" && available.has("extra-high")) return "extra-high";
  if (desired === "extra-high" && available.has("xhigh")) return "xhigh";
  return null;
}
