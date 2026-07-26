import type { Usage } from "@earendil-works/pi-ai";
import type { ConversationStateStructure } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";

/** Carry absolute context tokens across LiveSession teardown (same Cursor conversation). */
const byConversation = new Map<string, number>();

/** Latest checkpoint value (may drop after compaction — do not Math.max). */
export function observeContextTokens(conversationId: string, usedTokens: number): void {
  if (!conversationId || usedTokens <= 0) return;
  byConversation.set(conversationId, usedTokens);
}

export function peekContextTokens(conversationId: string): number {
  if (!conversationId) return 0;
  return byConversation.get(conversationId) ?? 0;
}

export function clearContextTokens(conversationId: string): void {
  byConversation.delete(conversationId);
}

export function readCheckpointUsedTokens(
  checkpoint: ConversationStateStructure | undefined | null,
): number {
  return checkpoint?.tokenDetails?.usedTokens ?? 0;
}

/**
 * Prefer Cursor conversationState.tokenDetails.usedTokens (absolute context size).
 * Turn deltas alone only cover the current reply and reset %left after each turn.
 */
export function applyAbsoluteContextUsage(usage: Usage, absoluteTokens: number): void {
  if (absoluteTokens <= 0) return;
  usage.totalTokens = absoluteTokens;
  // Keep reported output; derive input so calculateContextTokens stays consistent.
  usage.input = Math.max(0, absoluteTokens - usage.output);
}

export function finalizeCursorUsage(
  usage: Usage,
  conversationId: string,
  liveContextTokens: number,
): void {
  // Prefer live session value (latest checkpoint); fall back to carry-forward.
  const absolute =
    liveContextTokens > 0 ? liveContextTokens : peekContextTokens(conversationId);
  if (absolute > 0) {
    applyAbsoluteContextUsage(usage, absolute);
    observeContextTokens(conversationId, absolute);
    return;
  }
  if (usage.totalTokens === 0) {
    usage.totalTokens =
      usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  }
}
