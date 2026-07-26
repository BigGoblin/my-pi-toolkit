import type { ThinkingLevel } from "@earendil-works/pi-ai";

/**
 * Mapping from canonical model IDs to Cursor model IDs.
 *
 * - Canonical IDs generally follow pi-mono's models.generated.ts.
 * - Cursor-specific canonical IDs are added when Cursor exposes a distinct family
 *   that does not have a clean 1:1 canonical ID in pi-mono.
 * - `default` is the visible/default Cursor model ID for the family.
 * - ThinkingLevel keys override the default when thinking is enabled.
 * - Extra keys like `none` are allowed purely to hide raw Cursor variants from
 *   the model list; `toCursorId()` only uses `default` and ThinkingLevel keys.
 * - Models not listed here pass through with their Cursor ID as-is.
 */
const MODEL_MAP: Record<string, Record<string, string>> = {
  // Composer
  "composer-1.5": { default: "composer-1.5" },
  "composer-2": { default: "composer-2" },
  "composer-2-fast": { default: "composer-2-fast" },
  "composer-2.5": { default: "composer-2.5" },
  "composer-2.5-fast": { default: "composer-2.5-fast" },

  // Claude — binary: off / thinking
  "claude-sonnet-4-0": {
    default: "claude-4-sonnet",
    minimal: "claude-4-sonnet-thinking",
    low: "claude-4-sonnet-thinking",
    medium: "claude-4-sonnet-thinking",
    high: "claude-4-sonnet-thinking",
    xhigh: "claude-4-sonnet-thinking",
  },
  "claude-sonnet-4-5": {
    default: "claude-4.5-sonnet",
    minimal: "claude-4.5-sonnet-thinking",
    low: "claude-4.5-sonnet-thinking",
    medium: "claude-4.5-sonnet-thinking",
    high: "claude-4.5-sonnet-thinking",
    xhigh: "claude-4.5-sonnet-thinking",
  },
  "claude-sonnet-4-1m": {
    default: "claude-4-sonnet-1m",
    minimal: "claude-4-sonnet-1m-thinking",
    low: "claude-4-sonnet-1m-thinking",
    medium: "claude-4-sonnet-1m-thinking",
    high: "claude-4-sonnet-1m-thinking",
    xhigh: "claude-4-sonnet-1m-thinking",
  },
  "claude-sonnet-4-6": {
    default: "claude-4.6-sonnet-medium",
    minimal: "claude-4.6-sonnet-medium-thinking",
    low: "claude-4.6-sonnet-medium-thinking",
    medium: "claude-4.6-sonnet-medium-thinking",
    high: "claude-4.6-sonnet-medium-thinking",
    xhigh: "claude-4.6-sonnet-medium-thinking",
  },
  "claude-opus-4-5": {
    default: "claude-4.5-opus-high",
    minimal: "claude-4.5-opus-high-thinking",
    low: "claude-4.5-opus-high-thinking",
    medium: "claude-4.5-opus-high-thinking",
    high: "claude-4.5-opus-high-thinking",
    xhigh: "claude-4.5-opus-high-thinking",
  },
  "claude-opus-4-6": {
    default: "claude-4.6-opus-high",
    minimal: "claude-4.6-opus-high-thinking",
    low: "claude-4.6-opus-high-thinking",
    medium: "claude-4.6-opus-high-thinking",
    high: "claude-4.6-opus-high-thinking",
    xhigh: "claude-4.6-opus-high-thinking",
  },
  "claude-opus-4-6-max": {
    default: "claude-4.6-opus-max",
    minimal: "claude-4.6-opus-max-thinking",
    low: "claude-4.6-opus-max-thinking",
    medium: "claude-4.6-opus-max-thinking",
    high: "claude-4.6-opus-max-thinking",
    xhigh: "claude-4.6-opus-max-thinking",
  },
  "claude-opus-4-6-fast": {
    default: "claude-4.6-opus-high",
    minimal: "claude-4.6-opus-high-thinking-fast",
    low: "claude-4.6-opus-high-thinking-fast",
    medium: "claude-4.6-opus-high-thinking-fast",
    high: "claude-4.6-opus-high-thinking-fast",
    xhigh: "claude-4.6-opus-high-thinking-fast",
  },
  "claude-opus-4-6-max-fast": {
    default: "claude-4.6-opus-max",
    minimal: "claude-4.6-opus-max-thinking-fast",
    low: "claude-4.6-opus-max-thinking-fast",
    medium: "claude-4.6-opus-max-thinking-fast",
    high: "claude-4.6-opus-max-thinking-fast",
    xhigh: "claude-4.6-opus-max-thinking-fast",
  },
  "claude-opus-4-7": {
    default: "claude-opus-4-7-thinking-high",
    minimal: "claude-opus-4-7-thinking-high",
    low: "claude-opus-4-7-thinking-high",
    medium: "claude-opus-4-7-thinking-high",
    high: "claude-opus-4-7-thinking-high",
    xhigh: "claude-opus-4-7-thinking-max",
  },
  "claude-opus-4-7-max": {
    default: "claude-opus-4-7-thinking-high",
    minimal: "claude-opus-4-7-thinking-high",
    low: "claude-opus-4-7-thinking-high",
    medium: "claude-opus-4-7-thinking-high",
    high: "claude-opus-4-7-thinking-high",
    xhigh: "claude-opus-4-7-thinking-max",
  },
  "claude-opus-4-7-fast": {
    default: "claude-opus-4-7-thinking-high-fast",
    minimal: "claude-opus-4-7-thinking-high-fast",
    low: "claude-opus-4-7-thinking-high-fast",
    medium: "claude-opus-4-7-thinking-high-fast",
    high: "claude-opus-4-7-thinking-high-fast",
    xhigh: "claude-opus-4-7-thinking-max-fast",
  },
  "claude-opus-4-7-max-fast": {
    default: "claude-opus-4-7-thinking-high-fast",
    minimal: "claude-opus-4-7-thinking-high-fast",
    low: "claude-opus-4-7-thinking-high-fast",
    medium: "claude-opus-4-7-thinking-high-fast",
    high: "claude-opus-4-7-thinking-high-fast",
    xhigh: "claude-opus-4-7-thinking-max-fast",
  },
  "claude-opus-4-8": {
    default: "claude-opus-4-8-thinking-high",
    minimal: "claude-opus-4-8-thinking-medium",
    low: "claude-opus-4-8-thinking-medium",
    medium: "claude-opus-4-8-thinking-medium",
    high: "claude-opus-4-8-thinking-high",
    xhigh: "claude-opus-4-8-thinking-max",
  },
  "claude-opus-4-8-max": {
    default: "claude-opus-4-8-max-thinking-high",
    minimal: "claude-opus-4-8-max-thinking-medium",
    low: "claude-opus-4-8-max-thinking-medium",
    medium: "claude-opus-4-8-max-thinking-medium",
    high: "claude-opus-4-8-max-thinking-high",
    xhigh: "claude-opus-4-8-max-thinking-max",
  },
  "claude-opus-4-8-fast": {
    default: "claude-opus-4-8-thinking-high-fast",
    minimal: "claude-opus-4-8-thinking-medium-fast",
    low: "claude-opus-4-8-thinking-medium-fast",
    medium: "claude-opus-4-8-thinking-medium-fast",
    high: "claude-opus-4-8-thinking-high-fast",
    xhigh: "claude-opus-4-8-thinking-xhigh-fast",
  },
  "claude-opus-4-8-max-fast": {
    default: "claude-opus-4-8-max-thinking-high-fast",
    minimal: "claude-opus-4-8-max-thinking-medium-fast",
    low: "claude-opus-4-8-max-thinking-medium-fast",
    medium: "claude-opus-4-8-max-thinking-medium-fast",
    high: "claude-opus-4-8-max-thinking-high-fast",
    xhigh: "claude-opus-4-8-max-thinking-max-fast",
  },
  "claude-fable-5": {
    default: "claude-fable-5-high",
    none: "claude-fable-5-high",
    minimal: "claude-fable-5-thinking-low",
    low: "claude-fable-5-thinking-medium",
    medium: "claude-fable-5-thinking-high",
    high: "claude-fable-5-thinking-xhigh",
    xhigh: "claude-fable-5-thinking-max",
  },

  "gpt-5.5": {
    default: "gpt-5.5-medium",
    minimal: "gpt-5.5-medium",
    low: "gpt-5.5-medium",
    medium: "gpt-5.5-medium",
    high: "gpt-5.5-high",
    xhigh: "gpt-5.5-xhigh",
  },
  "gpt-5.5-pro": {
    default: "gpt-5.5-pro-medium",
    minimal: "gpt-5.5-pro-medium",
    low: "gpt-5.5-pro-medium",
    medium: "gpt-5.5-pro-medium",
    high: "gpt-5.5-pro-high",
    xhigh: "gpt-5.5-pro-xhigh",
  },
  "gpt-5.5-fast": {
    default: "gpt-5.5-fast",
    minimal: "gpt-5.5-fast",
    low: "gpt-5.5-fast",
    medium: "gpt-5.5-fast",
    high: "gpt-5.5-high-fast",
    xhigh: "gpt-5.5-xhigh-fast",
  },

  // GPT families
  "gpt-5-mini": {
    default: "gpt-5-mini",
  },
  "gpt-5.1": {
    default: "gpt-5.1",
    minimal: "gpt-5.1-low",
    low: "gpt-5.1-low",
    high: "gpt-5.1-high",
    xhigh: "gpt-5.1-high",
  },
  "gpt-5.1-codex-mini": {
    default: "gpt-5.1-codex-mini",
    minimal: "gpt-5.1-codex-mini-low",
    low: "gpt-5.1-codex-mini-low",
    high: "gpt-5.1-codex-mini-high",
    xhigh: "gpt-5.1-codex-mini-high",
  },
  "gpt-5.1-codex-max": {
    default: "gpt-5.1-codex-max-medium",
    minimal: "gpt-5.1-codex-max-low",
    low: "gpt-5.1-codex-max-low",
    medium: "gpt-5.1-codex-max-medium",
    high: "gpt-5.1-codex-max-high",
    xhigh: "gpt-5.1-codex-max-xhigh",
  },
  "gpt-5.1-codex-max-fast": {
    default: "gpt-5.1-codex-max-medium-fast",
    minimal: "gpt-5.1-codex-max-low-fast",
    low: "gpt-5.1-codex-max-low-fast",
    medium: "gpt-5.1-codex-max-medium-fast",
    high: "gpt-5.1-codex-max-high-fast",
    xhigh: "gpt-5.1-codex-max-xhigh-fast",
  },
  "gpt-5.2": {
    default: "gpt-5.2",
    minimal: "gpt-5.2-low",
    low: "gpt-5.2-low",
    high: "gpt-5.2-high",
    xhigh: "gpt-5.2-xhigh",
  },
  "gpt-5.2-fast": {
    default: "gpt-5.2-fast",
    minimal: "gpt-5.2-low-fast",
    low: "gpt-5.2-low-fast",
    high: "gpt-5.2-high-fast",
    xhigh: "gpt-5.2-xhigh-fast",
  },
  "gpt-5.2-codex": {
    default: "gpt-5.2-codex",
    minimal: "gpt-5.2-codex-low",
    low: "gpt-5.2-codex-low",
    high: "gpt-5.2-codex-high",
    xhigh: "gpt-5.2-codex-xhigh",
  },
  "gpt-5.2-codex-fast": {
    default: "gpt-5.2-codex-fast",
    minimal: "gpt-5.2-codex-low-fast",
    low: "gpt-5.2-codex-low-fast",
    high: "gpt-5.2-codex-high-fast",
    xhigh: "gpt-5.2-codex-xhigh-fast",
  },
  "gpt-5.3-codex": {
    default: "gpt-5.3-codex",
    minimal: "gpt-5.3-codex-low",
    low: "gpt-5.3-codex-low",
    high: "gpt-5.3-codex-high",
    xhigh: "gpt-5.3-codex-xhigh",
  },
  "gpt-5.3-codex-fast": {
    default: "gpt-5.3-codex-fast",
    minimal: "gpt-5.3-codex-low-fast",
    low: "gpt-5.3-codex-low-fast",
    high: "gpt-5.3-codex-high-fast",
    xhigh: "gpt-5.3-codex-xhigh-fast",
  },
  "gpt-5.3-codex-spark": {
    default: "gpt-5.3-codex-spark-preview",
    minimal: "gpt-5.3-codex-spark-preview-low",
    low: "gpt-5.3-codex-spark-preview-low",
    high: "gpt-5.3-codex-spark-preview-high",
    xhigh: "gpt-5.3-codex-spark-preview-xhigh",
  },
  "gpt-5.4": {
    default: "gpt-5.4-medium",
    minimal: "gpt-5.4-low",
    low: "gpt-5.4-low",
    medium: "gpt-5.4-medium",
    high: "gpt-5.4-high",
    xhigh: "gpt-5.4-xhigh",
  },
  "gpt-5.4-fast": {
    default: "gpt-5.4-medium-fast",
    minimal: "gpt-5.4-medium-fast",
    low: "gpt-5.4-medium-fast",
    medium: "gpt-5.4-medium-fast",
    high: "gpt-5.4-high-fast",
    xhigh: "gpt-5.4-xhigh-fast",
  },
  "gpt-5.4-mini": {
    default: "gpt-5.4-mini-medium",
    none: "gpt-5.4-mini-none",
    minimal: "gpt-5.4-mini-low",
    low: "gpt-5.4-mini-low",
    medium: "gpt-5.4-mini-medium",
    high: "gpt-5.4-mini-high",
    xhigh: "gpt-5.4-mini-xhigh",
  },
  "gpt-5.4-nano": {
    default: "gpt-5.4-nano-medium",
    none: "gpt-5.4-nano-none",
    minimal: "gpt-5.4-nano-low",
    low: "gpt-5.4-nano-low",
    medium: "gpt-5.4-nano-medium",
    high: "gpt-5.4-nano-high",
    xhigh: "gpt-5.4-nano-xhigh",
  },

  "gpt-5.4-pro": {
    default: "gpt-5.4-pro-medium",
    minimal: "gpt-5.4-pro-low",
    low: "gpt-5.4-pro-low",
    medium: "gpt-5.4-pro-medium",
    high: "gpt-5.4-pro-high",
    xhigh: "gpt-5.4-pro-xhigh",
  },
  "gpt-5.4-pro-fast": {
    default: "gpt-5.4-pro-medium-fast",
    minimal: "gpt-5.4-pro-medium-fast",
    low: "gpt-5.4-pro-medium-fast",
    medium: "gpt-5.4-pro-medium-fast",
    high: "gpt-5.4-pro-high-fast",
    xhigh: "gpt-5.4-pro-xhigh-fast",
  },

  // Gemini
  "gemini-3-pro-preview": { default: "gemini-3-pro" },
  "gemini-3-flash-preview": { default: "gemini-3-flash" },
  "gemini-3.1-pro-preview": { default: "gemini-3.1-pro" },
  "gemini-3.5-pro-preview": { default: "gemini-3.5-pro" },
  "gemini-3.5-flash-preview": { default: "gemini-3.5-flash" },

  // xAI
  "grok-4.20-0309-non-reasoning": {
    default: "grok-4-20",
  },
  "grok-4.20-0309-reasoning": {
    default: "grok-4-20-thinking",
  },
  "grok-4.3": {
    default: "grok-4.3",
  },
  "grok-build-0.1": {
    default: "grok-build-0.1",
  },

  // Moonshot
  "kimi-k2.5": { default: "kimi-k2.5" },
};

// Derived indexes (built once at module load)
const cursorDefaultToCanonical = new Map<string, string>();
const allMappedCursorIds = new Set<string>();

for (const [canonicalId, variants] of Object.entries(MODEL_MAP)) {
  const defaultId = variants["default"];
  if (defaultId) cursorDefaultToCanonical.set(defaultId, canonicalId);
  for (const cursorId of Object.values(variants)) {
    if (cursorId) allMappedCursorIds.add(cursorId);
  }
}

/**
 * Convert a Cursor model ID to its canonical ID.
 * Returns `null` for variant models (they should be hidden from the model list).
 * Returns the Cursor ID as-is for unknown models.
 */
export function toCanonicalId(cursorId: string): string | null {
  const canonical = cursorDefaultToCanonical.get(cursorId);
  if (canonical) return canonical;
  if (allMappedCursorIds.has(cursorId)) return null;
  return cursorId;
}

/**
 * Resolve a canonical model ID + thinking level to the Cursor model ID.
 * Returns the ID as-is for unknown models.
 */
export function toCursorId(canonicalId: string, reasoning?: ThinkingLevel): string {
  const family = MODEL_MAP[canonicalId];
  if (!family) return canonicalId;
  const defaultId = family["default"] ?? canonicalId;
  if (!reasoning) return defaultId;
  return family[reasoning] ?? defaultId;
}
