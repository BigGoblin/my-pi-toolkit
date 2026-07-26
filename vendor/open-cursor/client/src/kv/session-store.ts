import { ConversationStateStructure } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";

import { getBlobId } from "./blob-store.js";
import type { BlobStore } from "./kv-manager.js";
import { ProtoSerde } from "./serde.js";

export const SessionModes = ["default", "auto-run", "plan", "background", "search"] as const;

export type SessionMode = (typeof SessionModes)[number];

export interface SessionMetadata {
  agentId: string;
  latestRootBlobId: Uint8Array;
  name: string;
  createdAt: number;
  mode: SessionMode;
  lastUsedModel?: string;
}

export function getDefaultSessionMetadata(agentId?: string): SessionMetadata {
  return {
    agentId: agentId ?? crypto.randomUUID(),
    latestRootBlobId: new Uint8Array(),
    name: "New Agent",
    mode: "default",
    createdAt: Date.now(),
    // lastUsedModel intentionally omitted (optional property)
  };
}

export interface MetadataStore {
  get<K extends keyof SessionMetadata>(key: K): SessionMetadata[K];
  set<K extends keyof SessionMetadata>(key: K, value: SessionMetadata[K]): void;
  subscribe(key: keyof SessionMetadata, listener: () => void): () => void;
}

export class SessionStore {
  private readonly blobStore: BlobStore;
  private readonly metadataStore: MetadataStore;
  conversationStateStructure: ConversationStateStructure;

  private readonly serde = new ProtoSerde(ConversationStateStructure);

  constructor(blobStore: BlobStore, metadataStore: MetadataStore) {
    this.blobStore = blobStore;
    this.metadataStore = metadataStore;
    this.conversationStateStructure = new ConversationStateStructure();
  }

  setMetadata<K extends keyof SessionMetadata>(key: K, value: SessionMetadata[K]): void {
    this.metadataStore.set(key, value);
  }

  getMetadata<K extends keyof SessionMetadata>(key: K): SessionMetadata[K] {
    return this.metadataStore.get(key);
  }

  getId(): string {
    return this.getMetadata("agentId");
  }

  getBlobStore(): BlobStore {
    return this.blobStore;
  }

  getConversationStateStructure(): ConversationStateStructure {
    return this.conversationStateStructure;
  }

  getLatestCheckpoint(): ConversationStateStructure {
    return this.getConversationStateStructure();
  }

  async handleCheckpoint(ctx: unknown, checkpoint: ConversationStateStructure): Promise<void> {
    this.conversationStateStructure = checkpoint;
    const bytes = this.serde.serialize(checkpoint);
    const blobId = getBlobId(bytes);
    await this.blobStore.setBlob(ctx, blobId, bytes);
    this.setMetadata("latestRootBlobId", blobId);
  }

  async resetFromDb(ctx: unknown): Promise<void> {
    try {
      const rootBlobId = this.getMetadata("latestRootBlobId");
      if (!rootBlobId || rootBlobId.length === 0) {
        this.conversationStateStructure = new ConversationStateStructure();
        return;
      }
      const bytes = await this.blobStore.getBlob(ctx, rootBlobId);
      if (!bytes) {
        this.conversationStateStructure = new ConversationStateStructure();
        return;
      }
      this.conversationStateStructure = this.serde.deserialize(bytes);
    } catch {
      this.conversationStateStructure = new ConversationStateStructure();
    }
  }
}
