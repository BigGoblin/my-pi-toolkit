import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { SubagentPresentation } from "../../shared/subagent/config.js";
import { runTerminalSubagent } from "../../shared/subagent/terminal-runner.js";
import { REVIEW_SYSTEM_PROMPT } from "./prompt.js";
import type { ReviewSubagentResult } from "./types.js";

const MAX_REPORT_BYTES = 50 * 1024;
const MAX_REPORT_LINES = 2000;
const READ_ONLY_TOOLS = "read,grep,find,ls";
const CURSOR_PROVIDER_EXTENSION = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../cursor-models/index.ts",
);

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const bunVirtual = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !bunVirtual && existsSync(currentScript))
		return { command: process.execPath, args: [currentScript, ...args] };
	const executable = basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(executable))
		return { command: process.execPath, args };
	return { command: "pi", args };
}

interface ReviewEventMessage {
	role?: string;
	content?: Array<{
		type?: string;
		text?: string;
		name?: string;
		arguments?: unknown;
	}>;
}

interface ReviewJsonEvent {
	type?: string;
	message?: ReviewEventMessage;
}

function finalAssistantText(messages: unknown[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as ReviewEventMessage;
		if (message.role !== "assistant" || !Array.isArray(message.content))
			continue;
		const text = message.content
			.flatMap((part) =>
				part.type === "text" && typeof part.text === "string"
					? [part.text]
					: [],
			)
			.join("\n");
		if (text) return text;
	}
	return "";
}

function parseEvent(line: string): ReviewJsonEvent | undefined {
	if (!line.trim()) return undefined;
	try {
		return JSON.parse(line) as ReviewJsonEvent;
	} catch {
		return undefined;
	}
}

function messageToolCalls(
	message: ReviewEventMessage,
): Array<{ name: string; arguments: Record<string, unknown> }> {
	if (message.role !== "assistant" || !Array.isArray(message.content))
		return [];
	return message.content.flatMap((part) => {
		if (part.type !== "toolCall" || typeof part.name !== "string") return [];
		const argumentsValue = part.arguments;
		const argumentsRecord =
			argumentsValue &&
			typeof argumentsValue === "object" &&
			!Array.isArray(argumentsValue)
				? (argumentsValue as Record<string, unknown>)
				: {};
		return [{ name: part.name, arguments: argumentsRecord }];
	});
}

function truncateReport(output: string): string {
	const truncation = truncateHead(output, {
		maxBytes: MAX_REPORT_BYTES,
		maxLines: MAX_REPORT_LINES,
	});
	return truncation.truncated
		? `${truncation.content}\n\n> 报告超过 50KB，已截断后续内容。`
		: truncation.content;
}

export async function runReviewSubagent(options: {
	cwd: string;
	model: string;
	task: string;
	presentation?: SubagentPresentation;
	parentSessionId?: string;
	artifactFiles?: string[];
	signal?: AbortSignal;
	onToolCall?: (name: string, args: Record<string, unknown>) => void;
}): Promise<ReviewSubagentResult> {
	let reportedTerminalCalls = 0;
	const terminal = await runTerminalSubagent({
		cwd: options.cwd,
		title: "TAPD Review Subagent",
		model: options.model,
		task: options.task,
		systemPrompt: REVIEW_SYSTEM_PROMPT,
		tools: READ_ONLY_TOOLS,
		extensionPaths: existsSync(CURSOR_PROVIDER_EXTENSION)
			? [CURSOR_PROVIDER_EXTENSION]
			: [],
		artifactFiles: options.artifactFiles,
		// TAPD Review must use the persistent RPC path so the shared subagent
		// registry, footer count, overlay, and /subagents all observe the run.
		presentation: "manual",
		parentSessionId: options.parentSessionId,
		signal: options.signal,
		onUpdate: ({ toolCalls }) => {
			for (const call of toolCalls.slice(reportedTerminalCalls))
				options.onToolCall?.(call.name, call.arguments);
			reportedTerminalCalls = toolCalls.length;
		},
	});
	if (terminal)
		return {
			report: truncateReport(terminal.output),
			model: terminal.model ?? options.model,
			toolCalls: terminal.toolCalls,
		};

	const args = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		...(existsSync(CURSOR_PROVIDER_EXTENSION)
			? ["--extension", CURSOR_PROVIDER_EXTENSION]
			: []),
		"--no-skills",
		"--no-prompt-templates",
		"--tools",
		READ_ONLY_TOOLS,
		"--model",
		options.model,
		"--system-prompt",
		REVIEW_SYSTEM_PROMPT,
		options.task,
	];
	const invocation = getPiInvocation(args);
	const messages: unknown[] = [];
	const toolCalls: Array<{
		name: string;
		arguments: Record<string, unknown>;
	}> = [];
	let stderr = "";
	let buffer = "";
	let aborted = false;

	const exitCode = await new Promise<number>((resolve, reject) => {
		// Arguments are passed as an array with shell disabled; no user text is executed by a shell.
		// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
		const child = spawn(invocation.command, invocation.args, {
			cwd: options.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const stop = () => {
			if (aborted) return;
			aborted = true;
			child.kill("SIGTERM");
			killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
			killTimer.unref?.();
		};
		const cleanup = () => {
			if (killTimer) clearTimeout(killTimer);
			options.signal?.removeEventListener("abort", stop);
		};
		if (options.signal?.aborted) stop();
		else options.signal?.addEventListener("abort", stop, { once: true });
		const processLine = (line: string) => {
			const event = parseEvent(line);
			if (event?.type !== "message_end" || !event.message) return;
			messages.push(event.message);
			for (const call of messageToolCalls(event.message)) {
				toolCalls.push(call);
				options.onToolCall?.(call.name, call.arguments);
			}
		};
		child.stdout.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line);
		});
		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		child.on("close", (code) => {
			cleanup();
			if (buffer.trim()) processLine(buffer);
			resolve(code ?? 1);
		});
	});

	if (aborted) throw new Error("TAPD Review 子代理已取消");
	const output = finalAssistantText(messages);
	if (exitCode !== 0 || !output)
		throw new Error(
			`Review 子代理运行失败（exit ${exitCode}，model ${options.model}）：${stderr.trim() || "未返回报告"}`,
		);
	return { report: truncateReport(output), model: options.model, toolCalls };
}
