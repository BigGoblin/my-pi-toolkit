import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PiToolContext {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  getActiveTools(): Set<string>;
  getCtx(): ExtensionContext | null;
  getChannel?(): import("../live-session.js").LiveEventChannel | null;
}

const TOOL_CALL_ID_MAX_LENGTH = 64;

export function decodeToolCallId(toolCallId: string | undefined): string {
  if (!toolCallId || toolCallId.length === 0) return crypto.randomUUID();
  if (toolCallId.length <= TOOL_CALL_ID_MAX_LENGTH) return toolCallId;
  return toolCallId.slice(0, TOOL_CALL_ID_MAX_LENGTH);
}
