import { setTimeout } from "node:timers/promises";

import {
  deleteLiveSession,
  getLiveSession,
  retainOnlyLiveSession,
} from "../bridge/live-session.js";
import { rejectPendingExceptSession, rejectPendingForSession } from "../bridge/tools/relay.js";
import { retainOnlySessionStore } from "./persistence/registry.js";
import { evictSessionStore } from "./store.js";

const TERMINATION_WAIT_MS = 2_000;

export async function terminateSession(sessionId: string, reason: string): Promise<void> {
  const live = getLiveSession(sessionId);

  if (live) {
    live.abort(reason);
  }

  rejectPendingForSession(sessionId, reason);

  if (live) {
    await Promise.race([live.cursorRunPromise.catch(() => {}), setTimeout(TERMINATION_WAIT_MS)]);
  }

  let flushed = false;
  if (live) {
    try {
      await live.flushSessionState();
      flushed = true;
    } catch {}
  }

  deleteLiveSession(sessionId);
  await evictSessionStore(sessionId, { persist: !flushed }).catch(() => {});
}

export function retainOnlyActiveSessionMemory(
  sessionId: string | null,
  reason = "Session ended",
): void {
  rejectPendingExceptSession(sessionId, reason);
  retainOnlyLiveSession(sessionId);
  retainOnlySessionStore(sessionId);
}
