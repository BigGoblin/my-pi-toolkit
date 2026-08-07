import type { SubagentTranscriptEntry } from "./registry.js";
import {
	assistantText,
	type RpcAssistantMessageEvent,
} from "./rpc-protocol.js";

type AssistantEntry = Extract<SubagentTranscriptEntry, { kind: "assistant" }>;
type MutableAssistantMessage = {
	role?: unknown;
	content?: Array<Record<string, unknown>>;
};

export class RpcAssistantStream {
	private current?: AssistantEntry;
	private readonly entries: SubagentTranscriptEntry[];
	private readonly notify: () => void;

	constructor(entries: SubagentTranscriptEntry[], notify: () => void) {
		this.entries = entries;
		this.notify = notify;
	}

	reset(): void {
		this.current = undefined;
	}

	start(message: unknown): void {
		if (!isAssistantMessage(message)) return;
		this.current = { kind: "assistant", message, streaming: true };
		this.entries.push(this.current);
		this.notify();
	}

	update(message: unknown): void {
		if (!isAssistantMessage(message)) return;
		if (!this.current) {
			this.start(message);
			return;
		}
		this.current.message = message;
		this.notify();
	}

	apply(event: RpcAssistantMessageEvent | undefined): void {
		if (!event || !this.current) return;
		const message = this.current.message as MutableAssistantMessage;
		if (!Array.isArray(message.content)) message.content = [];
		const index = event.contentIndex;
		if (typeof index !== "number" || index < 0) return;
		if (event.type === "text_start")
			message.content[index] = { type: "text", text: "" };
		else if (event.type === "thinking_start")
			message.content[index] = { type: "thinking", thinking: "" };
		else if (event.type === "text_delta")
			appendDelta(message.content, index, "text", event.delta);
		else if (event.type === "thinking_delta")
			appendDelta(message.content, index, "thinking", event.delta);
		else if (event.type === "text_end" && typeof event.content === "string")
			message.content[index] = { type: "text", text: event.content };
		else if (event.type === "thinking_end" && typeof event.content === "string")
			message.content[index] = {
				type: "thinking",
				thinking: event.content,
			};
		this.notify();
	}

	finish(message: unknown): string | undefined {
		if (!isAssistantMessage(message)) return undefined;
		if (this.current) {
			this.current.message = message;
			this.current.streaming = false;
		} else this.entries.push({ kind: "assistant", message });
		this.current = undefined;
		return assistantText(message);
	}
}

function appendDelta(
	content: Array<Record<string, unknown>>,
	index: number,
	field: "text" | "thinking",
	delta: unknown,
): void {
	if (typeof delta !== "string") return;
	const part = content[index];
	const current = typeof part?.[field] === "string" ? part[field] : "";
	content[index] = {
		type: field === "text" ? "text" : "thinking",
		[field]: `${current}${delta}`,
	};
}

function isAssistantMessage(message: unknown): boolean {
	return (message as MutableAssistantMessage | undefined)?.role === "assistant";
}
