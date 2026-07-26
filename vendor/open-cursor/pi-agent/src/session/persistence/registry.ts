import { SessionStore, getDefaultSessionMetadata } from "@open-cursor/client";

import { JsonBlobStoreWithMetadata } from "./blob-store.js";
import { loadBlobsFromDisk, loadMetaFromDisk, saveBlobsToDisk, saveMetaToDisk } from "./disk.js";

interface StoreEntry {
  store: SessionStore;
  jsonStore: JsonBlobStoreWithMetadata;
}

let sessionStores = new Map<string, StoreEntry>();

export const openStoreEntry = async (baseDir: string, sessionId: string): Promise<StoreEntry> => {
  const existing = sessionStores.get(sessionId);
  if (existing) {
    return existing;
  }

  const [blobs, meta] = await Promise.all([
    loadBlobsFromDisk(baseDir, sessionId),
    loadMetaFromDisk(baseDir, sessionId),
  ]);

  const metadata = meta ?? getDefaultSessionMetadata();
  const jsonStore = new JsonBlobStoreWithMetadata(blobs, metadata);
  const store = new SessionStore(jsonStore, jsonStore);

  if (metadata.latestRootBlobId.length > 0) {
    await store.resetFromDb(null);
  }

  const entry: StoreEntry = { store, jsonStore };
  sessionStores.set(sessionId, entry);
  return entry;
};

export const flushStoreEntry = async (
  baseDir: string,
  sessionId: string,
): Promise<StoreEntry | null> => {
  const entry = sessionStores.get(sessionId);
  if (!entry) {
    return null;
  }

  await Promise.all([
    saveBlobsToDisk(baseDir, sessionId, entry.jsonStore.blobs),
    saveMetaToDisk(baseDir, sessionId, entry.jsonStore.metadata),
  ]);

  return entry;
};

export const applySnapshotToStore = async (
  entry: StoreEntry,
  agentId: string,
  latestRootBlobId: Uint8Array,
): Promise<void> => {
  entry.jsonStore.metadata.agentId = agentId;
  entry.jsonStore.metadata.latestRootBlobId = latestRootBlobId;

  if (latestRootBlobId.length > 0) {
    await entry.store.resetFromDb(null);
  }
};

export const dropStoreEntry = (sessionId: string): boolean => {
  return sessionStores.delete(sessionId);
};

export const hasSessionStore = (sessionId: string): boolean => {
  return sessionStores.has(sessionId);
};

export const retainOnlySessionStore = (sessionId: string | null): void => {
  const entry = sessionId ? sessionStores.get(sessionId) : undefined;
  sessionStores =
    sessionId && entry
      ? new Map<string, StoreEntry>([[sessionId, entry]])
      : new Map<string, StoreEntry>();
};
