import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { runTerminalSubagent } from "../shared/subagent/terminal-runner.js";
import { SEARCH_PROMPT } from "./prompt.js";
import type {
	SearchDetails,
	SearchRunConfig,
	SearchRunResult,
} from "./types.js";

const READ_ONLY_TOOLS = "read,grep,find,ls";
const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const CURSOR_PROVIDER_EXTENSION = path.resolve(
	EXTENSION_DIR,
	"../cursor-models/index.ts",
);
const GITIGNORE_GUARD_EXTENSION = path.resolve(
	EXTENSION_DIR,
	"gitignore-guard.ts",
);
const MAX_RESULT_BYTES = 50 * 1024;
const MAX_RESULT_LINES = 2000;

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (
		currentScript &&
		!currentScript.startsWith("/$bunfs/root/") &&
		fs.existsSync(currentScript)
	)
		return { command: process.execPath, args: [currentScript, ...args] };
	const executable = path.basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(executable)
		? { command: "pi", args }
		: { command: process.execPath, args };
}

function finalAssistantText(messages: unknown[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as {
			role?: string;
			content?: Array<{ type?: string; text?: string }>;
		};
		if (message.role !== "assistant" || !Array.isArray(message.content))
			continue;
		const texts = message.content.flatMap((part) =>
			part.type === "text" && typeof part.text === "string" ? [part.text] : [],
		);
		if (texts.length > 0) return texts.join("\n");
	}
	return "";
}

function truncateResult(output: string): {
	content: string;
	truncated: boolean;
} {
	const truncation = truncateHead(output, {
		maxBytes: MAX_RESULT_BYTES,
		maxLines: MAX_RESULT_LINES,
	});
	return {
		content: truncation.truncated
			? `${truncation.content}\n\n[Search 子 Agent 输出已截断；完整输出保存在工具 details 中。]`
			: truncation.content,
		truncated: truncation.truncated,
	};
}

function makeDetails(
	task: string,
	config: SearchRunConfig,
	output: string,
	toolCalls: SearchDetails["toolCalls"],
	exitCode: number,
	stderr: string,
	truncated = false,
	runDir?: string,
): SearchDetails {
	return {
		task,
		model: config.model,
		modelSource: config.source,
		output,
		toolCalls: [...toolCalls],
		exitCode,
		stderr,
		truncated,
		runDir,
	};
}

export async function runSearchSubagent(options: {
	cwd: string;
	task: string;
	config: SearchRunConfig;
	parentSessionId?: string;
	signal?: AbortSignal;
	onUpdate?: (details: SearchDetails) => void;
}): Promise<SearchRunResult> {
	const terminal = await runTerminalSubagent({
		cwd: options.cwd,
		title: "Search Subagent",
		model: options.config.model,
		task: `Search task: ${options.task}`,
		systemPrompt: SEARCH_PROMPT,
		tools: READ_ONLY_TOOLS,
		extensionPaths: [CURSOR_PROVIDER_EXTENSION, GITIGNORE_GUARD_EXTENSION],
		disableContextFiles: true,
		presentation: options.config.presentation,
		parentSessionId: options.parentSessionId,
		signal: options.signal,
		onUpdate: ({ toolCalls }) =>
			options.onUpdate?.(
				makeDetails(options.task, options.config, "", toolCalls, -1, ""),
			),
	});
	if (terminal) {
		const visible = truncateResult(terminal.output);
		return {
			content: visible.content,
			details: makeDetails(
				options.task,
				options.config,
				terminal.output,
				terminal.toolCalls,
				0,
				"",
				visible.truncated,
				terminal.runDir,
			),
		};
	}

	const args = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--extension",
		CURSOR_PROVIDER_EXTENSION,
		"--extension",
		GITIGNORE_GUARD_EXTENSION,
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--tools",
		READ_ONLY_TOOLS,
		"--model",
		options.config.model,
		"--system-prompt",
		SEARCH_PROMPT,
		`Search task: ${options.task}`,
	];
	const invocation = getPiInvocation(args);
	const messages: unknown[] = [];
	const toolCalls: SearchDetails["toolCalls"] = [];
	let stderr = "";
	let buffer = "";
	let aborted = false;

	const exitCode = await new Promise<number>((resolveExit, reject) => {
		// Arguments are passed as an array with shell disabled; no user text is executed by a shell.
		// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
		const child = spawn(invocation.command, invocation.args, {
			cwd: options.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: {
				type?: string;
				message?: {
					role?: string;
					content?: Array<{
						type?: string;
						name?: string;
						arguments?: Record<string, unknown>;
					}>;
				};
			};
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type !== "message_end" || !event.message) return;
			messages.push(event.message);
			if (event.message.role === "assistant") {
				for (const part of event.message.content ?? []) {
					if (part.type === "toolCall" && part.name)
						toolCalls.push({
							name: part.name,
							arguments: part.arguments ?? {},
						});
				}
			}
			options.onUpdate?.(
				makeDetails(
					options.task,
					options.config,
					finalAssistantText(messages),
					toolCalls,
					-1,
					stderr,
				),
			);
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
		child.on("error", reject);
		child.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			resolveExit(code ?? 1);
		});
		const stop = () => {
			aborted = true;
			child.kill("SIGTERM");
			const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
			timer.unref();
		};
		if (options.signal?.aborted) stop();
		else options.signal?.addEventListener("abort", stop, { once: true });
	});
	if (aborted) throw new Error("Search 子 Agent 已取消");
	const output = finalAssistantText(messages);
	if (exitCode !== 0 || !output)
		throw new Error(
			`Search 子 Agent 运行失败（exit ${exitCode}，model ${options.config.model}）: ${stderr.trim() || "未返回结果"}`,
		);
	const visible = truncateResult(output);
	return {
		content: visible.content,
		details: makeDetails(
			options.task,
			options.config,
			output,
			toolCalls,
			exitCode,
			stderr,
			visible.truncated,
		),
	};
}
