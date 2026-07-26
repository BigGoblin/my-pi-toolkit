export interface ToolExecRequest {
  toolCallId: string;
  cursorExecType: string;
  piToolName: string;
  piToolArgs: Record<string, unknown>;
}

export type ChannelEvent =
  | { kind: "content"; data: ContentEvent }
  | { kind: "tool-exec-request"; request: ToolExecRequest }
  | { kind: "token-delta"; tokens: number }
  | { kind: "cursor-done" };

export interface ContentEvent {
  kind: "thinking-delta" | "text-delta" | "thinking-completed";
  text: string;
}

export class LiveEventChannel {
  readonly sessionId: string;
  private events: ChannelEvent[] = [];
  private cursor = 0;
  private done = false;
  private waiters: Array<() => void> = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  push(event: ChannelEvent): void {
    this.events.push(event);
    this.notifyWaiters();
  }

  markDone(): void {
    this.done = true;
    this.notifyWaiters();
  }

  async next(): Promise<ChannelEvent | null> {
    while (this.cursor >= this.events.length) {
      if (this.done) return null;
      await new Promise<void>((r) => {
        this.waiters.push(r);
      });
    }
    return this.events[this.cursor++] ?? null;
  }

  private notifyWaiters(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }
}

export interface LiveSession {
  channel: LiveEventChannel;
  cursorRunPromise: Promise<void>;
  flushSessionState: () => Promise<void>;
  abort: (reason?: string) => void;
  startTime: number;
  firstTokenTime?: number;
  /** Cursor conversation id (agentStore.getId()). */
  conversationId?: string;
  /**
   * Absolute context tokens from ConversationStateStructure.tokenDetails.usedTokens.
   * Mutable bag so the checkpoint handler can update before LiveSession is assigned.
   */
  contextUsage?: { tokens: number };
  /** Latest usedTokens from the in-memory conversation state (post-checkpoint). */
  readStoreContextTokens?: () => number;
}

let liveSessions = new Map<string, LiveSession>();

export function setLiveSession(sessionId: string, session: LiveSession): void {
  liveSessions.set(sessionId, session);
}

export function getLiveSession(sessionId: string): LiveSession | undefined {
  return liveSessions.get(sessionId);
}

export function deleteLiveSession(sessionId: string): void {
  liveSessions.delete(sessionId);
}

export function retainOnlyLiveSession(sessionId: string | null): void {
  const retained = sessionId ? liveSessions.get(sessionId) : undefined;
  for (const [id, session] of liveSessions) {
    if (id !== sessionId) {
      session.abort("Session ended");
    }
  }
  liveSessions =
    sessionId && retained
      ? new Map<string, LiveSession>([[sessionId, retained]])
      : new Map<string, LiveSession>();
}
