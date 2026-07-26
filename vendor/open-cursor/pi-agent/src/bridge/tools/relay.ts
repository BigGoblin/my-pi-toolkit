import type { ToolResultMessage } from "@earendil-works/pi-ai";

import { trace } from "../../trace.js";
import type { LiveEventChannel, ToolExecRequest } from "../live-session.js";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

interface PendingResult {
  sessionId: string;
  resolve: (result: ToolResultMessage) => void;
  reject: (error: Error) => void;
}

const pendingResults = new Map<string, PendingResult>();

function debug(message: string, data?: Record<string, unknown>): void {
  trace(message, data);
}

export function requestToolExecution(
  channel: LiveEventChannel | null,
  request: ToolExecRequest,
): Promise<ToolResultMessage> {
  return new Promise<ToolResultMessage>((resolve, reject) => {
    const sessionId = channel?.sessionId ?? "";
    debug("tool request queued", {
      sessionId,
      toolCallId: request.toolCallId,
      cursorExecType: request.cursorExecType,
      piToolName: request.piToolName,
    });
    pendingResults.set(request.toolCallId, { sessionId, resolve, reject });

    if (channel) {
      channel.push({ kind: "tool-exec-request", request });
    } else {
      pendingResults.delete(request.toolCallId);
      reject(new Error("Tool bridge not available — no active stream"));
    }
  });
}

export function resolveToolResult(result: ToolResultMessage): boolean {
  const pending = pendingResults.get(result.toolCallId);
  if (!pending) {
    debug("tool result had no pending request", { toolCallId: result.toolCallId });
    return false;
  }
  debug("tool result resolved", {
    sessionId: pending.sessionId,
    toolCallId: result.toolCallId,
    isError: result.isError,
  });
  pendingResults.delete(result.toolCallId);
  pending.resolve(result);
  return true;
}

export function rejectPendingForSession(sessionId: string, reason: string): void {
  for (const [id, pending] of pendingResults) {
    if (pending.sessionId === sessionId) {
      pending.reject(new Error(reason));
      pendingResults.delete(id);
    }
  }
}

export function rejectPendingExceptSession(sessionId: string | null, reason: string): void {
  for (const [id, pending] of pendingResults) {
    if (sessionId === null || pending.sessionId !== sessionId) {
      pending.reject(new Error(reason));
      pendingResults.delete(id);
    }
  }
}
