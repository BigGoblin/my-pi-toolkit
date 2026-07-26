import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type SessionStore, fromHex, toHex } from "@open-cursor/client";
import { ConversationStateStructure } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";

import { PI_CURSOR_AGENT_CACHE_DIR } from "../paths.js";
import {
  applySnapshotToStore,
  dropStoreEntry as deleteStore,
  openStoreEntry,
  flushStoreEntry as persistStore,
} from "./persistence/registry.js";

export const CURSOR_STATE_ENTRY_TYPE = "pi-cursor-agent:state";

interface SessionStoreSnapshot {
  version: 1;
  agentId: string;
  latestRootBlobId: string;
  conversationState?: string;
}

const isSessionStoreSnapshot = (value: unknown): value is SessionStoreSnapshot => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const snapshot = value as Partial<SessionStoreSnapshot>;
  return (
    snapshot.version === 1 &&
    typeof snapshot.agentId === "string" &&
    typeof snapshot.latestRootBlobId === "string"
  );
};

const findSnapshot = (entries: SessionEntry[]): SessionStoreSnapshot | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type !== "custom" || e.customType !== CURSOR_STATE_ENTRY_TYPE) {
      continue;
    }

    if (isSessionStoreSnapshot(e.data)) {
      return e.data;
    }
  }
  return null;
};

export const ensureSessionStore = async (sessionId: string): Promise<SessionStore> => {
  const entry = await openStoreEntry(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
  return entry.store;
};

export const persistSessionStore = async (
  sessionId: string,
): Promise<SessionStoreSnapshot | null> => {
  const entry = await persistStore(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
  if (!entry) {
    return null;
  }

  const {
    store,
    jsonStore: { metadata },
  } = entry;
  const snapshot: SessionStoreSnapshot = {
    version: 1,
    agentId: metadata.agentId,
    latestRootBlobId: toHex(metadata.latestRootBlobId),
  };

  try {
    const bytes = store.getConversationStateStructure().toBinary();
    if (bytes.length > 0) {
      snapshot.conversationState = Buffer.from(bytes).toString("base64");
    }
  } catch {}

  return snapshot;
};

export const evictSessionStore = async (
  sessionId: string,
  options?: { persist?: boolean },
): Promise<void> => {
  try {
    if (options?.persist !== false) {
      await persistStore(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
    }
  } finally {
    deleteStore(sessionId);
  }
};

export const restoreSessionStoreFromBranch = async (
  sessionId: string,
  entries: SessionEntry[],
): Promise<void> => {
  const snapshot = findSnapshot(entries);
  if (!snapshot) {
    return;
  }

  const storeEntry = await openStoreEntry(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
  const rootBlobId = snapshot.latestRootBlobId
    ? fromHex(snapshot.latestRootBlobId)
    : new Uint8Array();

  if (rootBlobId.length > 0) {
    await applySnapshotToStore(storeEntry, snapshot.agentId, rootBlobId);
    return;
  }

  if (snapshot.conversationState) {
    storeEntry.jsonStore.metadata.agentId = snapshot.agentId;
    try {
      storeEntry.store.conversationStateStructure = ConversationStateStructure.fromBinary(
        Buffer.from(snapshot.conversationState, "base64"),
      );
    } catch {}
  }
};
