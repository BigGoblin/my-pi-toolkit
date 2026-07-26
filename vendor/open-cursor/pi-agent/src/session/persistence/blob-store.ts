import {
  type SessionMetadata,
  type BlobStore,
  type MetadataStore,
  toHex,
} from "@open-cursor/client";

export class JsonBlobStoreWithMetadata implements BlobStore, MetadataStore {
  readonly blobs: Map<string, Uint8Array>;
  readonly metadata: SessionMetadata;

  constructor(blobs: Map<string, Uint8Array>, metadata: SessionMetadata) {
    this.blobs = blobs;
    this.metadata = metadata;
  }

  public get<K extends keyof SessionMetadata>(key: K): SessionMetadata[K] {
    return this.metadata[key];
  }

  public set<K extends keyof SessionMetadata>(key: K, value: SessionMetadata[K]): void {
    this.metadata[key] = value;
  }

  public subscribe(_: keyof SessionMetadata, __: () => void): () => void {
    return () => {};
  }

  public async getBlob(_: unknown, blobId: Uint8Array): Promise<Uint8Array | undefined> {
    return this.blobs.get(toHex(blobId));
  }

  public setBlob(_ctx: unknown, blobId: Uint8Array, blobData: Uint8Array): Promise<void> {
    this.blobs.set(toHex(blobId), blobData);
    return Promise.resolve();
  }
}
