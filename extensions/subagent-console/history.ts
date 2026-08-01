import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SubagentTranscriptEntry } from "../shared/subagent/registry.js";

interface ContentBlock {
	type?: unknown;
	text?: unknown;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
}

interface StoredMessage {
	role?: unknown;
	content?: unknown;
	toolCallId?: unknown;
	toolName?: unknown;
	details?: unknown;
	isError?: unknown;
}

function latestSessionPath(runDir: string): string | undefined {
	const sessionsDir = join(runDir, "sessions");
	if (!existsSync(sessionsDir)) return undefined;
	try {
		const names = readdirSync(sessionsDir)
			.filter((name) => name.endsWith(".jsonl"))
			.sort((left, right) => right.localeCompare(left));
		return names[0] ? join(sessionsDir, names[0]) : undefined;
	} catch {
		return undefined;
	}
}

function contentBlocks(content: unknown): ContentBlock[] {
	return Array.isArray(content)
		? content.filter(
				(value): value is ContentBlock =>
					Boolean(value) && typeof value === "object",
			)
		: [];
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	return contentBlocks(content)
		.flatMap((block) =>
			block.type === "text" && typeof block.text === "string"
				? [block.text]
				: [],
		)
		.join("\n");
}

function toolArguments(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function appendAssistant(
	entries: SubagentTranscriptEntry[],
	tools: Map<string, Extract<SubagentTranscriptEntry, { kind: "tool" }>>,
	message: StoredMessage,
): void {
	entries.push({ kind: "assistant", message });
	for (const block of contentBlocks(message.content)) {
		if (
			block.type !== "toolCall" ||
			typeof block.id !== "string" ||
			typeof block.name !== "string"
		)
			continue;
		const tool: Extract<SubagentTranscriptEntry, { kind: "tool" }> = {
			kind: "tool",
			id: block.id,
			name: block.name,
			args: toolArguments(block.arguments),
		};
		entries.push(tool);
		tools.set(tool.id, tool);
	}
}

function appendToolResult(
	entries: SubagentTranscriptEntry[],
	tools: Map<string, Extract<SubagentTranscriptEntry, { kind: "tool" }>>,
	message: StoredMessage,
): void {
	if (typeof message.toolCallId !== "string") return;
	let tool = tools.get(message.toolCallId);
	if (!tool) {
		tool = {
			kind: "tool",
			id: message.toolCallId,
			name: typeof message.toolName === "string" ? message.toolName : "unknown",
			args: {},
		};
		entries.push(tool);
		tools.set(tool.id, tool);
	}
	tool.result = {
		content: Array.isArray(message.content) ? message.content : [],
		details: message.details,
	};
	tool.isError = message.isError === true;
}

export function readHistoricalEntries(
	runDir: string,
): SubagentTranscriptEntry[] {
	const sessionPath = latestSessionPath(runDir);
	if (!sessionPath) return [];
	try {
		const manager = SessionManager.open(sessionPath);
		const entries: SubagentTranscriptEntry[] = [];
		const tools = new Map<
			string,
			Extract<SubagentTranscriptEntry, { kind: "tool" }>
		>();
		for (const entry of manager.getBranch()) {
			if (entry.type !== "message") continue;
			const message = entry.message as StoredMessage;
			if (message.role === "user") {
				const text = messageText(message.content);
				if (text) entries.push({ kind: "user", text });
			} else if (message.role === "assistant") {
				appendAssistant(entries, tools, message);
			} else if (message.role === "toolResult") {
				appendToolResult(entries, tools, message);
			}
		}
		return entries;
	} catch {
		return [];
	}
}
