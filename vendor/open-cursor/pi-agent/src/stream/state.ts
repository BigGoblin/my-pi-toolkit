import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_META_ENTRY_TYPE = "pi-cursor-agent:tool-call-meta";
const ASSISTANT_CONTENT_ENTRY_TYPE = "pi-cursor-agent:assistant-content";

export interface StoredToolCallMeta {
  toolCallId: string;
  cursorExecType: string;
  piToolName: string;
  piToolArgs: Record<string, unknown>;
  assistantTimestamp: number;
}

export interface StoredAssistantContent {
  timestamp: number;
  blocks: unknown[];
}

export interface CursorStateStore {
  rememberToolCallMeta(entry: StoredToolCallMeta): void;
  getToolCallMeta(toolCallId: string): StoredToolCallMeta | undefined;

  rememberAssistantContent(entry: StoredAssistantContent): void;
  getAssistantContent(timestamp: number): StoredAssistantContent | undefined;

  resetFromContext(ctx: ExtensionContext): void;
}

const isStoredToolCallMeta = (value: unknown): value is StoredToolCallMeta => {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<StoredToolCallMeta>;
  return (
    typeof e.toolCallId === "string" &&
    e.toolCallId.length > 0 &&
    typeof e.cursorExecType === "string" &&
    typeof e.piToolName === "string" &&
    !!e.piToolArgs &&
    typeof e.piToolArgs === "object" &&
    !Array.isArray(e.piToolArgs) &&
    typeof e.assistantTimestamp === "number"
  );
};

const isStoredAssistantContent = (value: unknown): value is StoredAssistantContent => {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<StoredAssistantContent>;
  return typeof e.timestamp === "number" && Array.isArray(e.blocks);
};

/** In-memory layer over a base state. Reads cascade; writes are not persisted. */
export function createOverlayState(base: CursorStateStore): CursorStateStore {
  const toolCallMetaById = new Map<string, StoredToolCallMeta>();
  const assistantContentByTimestamp = new Map<number, StoredAssistantContent>();

  return {
    rememberToolCallMeta(entry) {
      toolCallMetaById.set(entry.toolCallId, entry);
    },
    getToolCallMeta(toolCallId) {
      return toolCallMetaById.get(toolCallId) ?? base.getToolCallMeta(toolCallId);
    },
    rememberAssistantContent(entry) {
      assistantContentByTimestamp.set(entry.timestamp, entry);
    },
    getAssistantContent(timestamp) {
      return assistantContentByTimestamp.get(timestamp) ?? base.getAssistantContent(timestamp);
    },
    resetFromContext() {},
  };
}

export function createStateStore(
  appendEntry: (customType: string, data?: unknown) => void,
): CursorStateStore {
  const toolCallMetaById = new Map<string, StoredToolCallMeta>();
  const assistantContentByTimestamp = new Map<number, StoredAssistantContent>();

  return {
    rememberToolCallMeta(entry) {
      toolCallMetaById.set(entry.toolCallId, entry);
      appendEntry(TOOL_CALL_META_ENTRY_TYPE, entry);
    },

    getToolCallMeta(toolCallId) {
      return toolCallMetaById.get(toolCallId);
    },

    rememberAssistantContent(entry) {
      assistantContentByTimestamp.set(entry.timestamp, entry);
      appendEntry(ASSISTANT_CONTENT_ENTRY_TYPE, entry);
    },

    getAssistantContent(timestamp) {
      return assistantContentByTimestamp.get(timestamp);
    },

    resetFromContext(ctx) {
      toolCallMetaById.clear();
      assistantContentByTimestamp.clear();

      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "custom") continue;

        if (entry.customType === TOOL_CALL_META_ENTRY_TYPE && isStoredToolCallMeta(entry.data)) {
          toolCallMetaById.set(entry.data.toolCallId, entry.data);
          continue;
        }

        if (
          entry.customType === ASSISTANT_CONTENT_ENTRY_TYPE &&
          isStoredAssistantContent(entry.data)
        ) {
          assistantContentByTimestamp.set(entry.data.timestamp, entry.data);
        }
      }
    },
  };
}
