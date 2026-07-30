import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface RpcEvent {
	type?: string;
	message?: unknown;
	toolCallId?: string;
	toolName?: string;
	args?: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
	error?: string;
}

export function assistantText(message: unknown): string {
	const value = message as {
		role?: string;
		content?: Array<{ type?: string; text?: string }>;
	};
	if (value.role !== "assistant" || !Array.isArray(value.content)) return "";
	return value.content
		.flatMap((part) =>
			part.type === "text" && typeof part.text === "string" ? [part.text] : [],
		)
		.join("\n");
}

export function sendRpc(
	child: ChildProcessWithoutNullStreams,
	command: Record<string, unknown>,
): void {
	if (!child.stdin.destroyed)
		child.stdin.write(`${JSON.stringify(command)}\n`, "utf8");
}

export function parseRpcEvent(record: string): RpcEvent | undefined {
	if (!record.trim()) return undefined;
	try {
		return JSON.parse(record) as RpcEvent;
	} catch {
		return undefined;
	}
}

export function writeRunJson(
	runDir: string,
	name: string,
	value: unknown,
): void {
	writeFileSync(join(runDir, name), JSON.stringify(value, null, 2), {
		encoding: "utf8",
		mode: 0o600,
	});
}
