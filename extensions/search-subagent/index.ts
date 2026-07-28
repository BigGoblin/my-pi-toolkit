import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
// The repository LSP currently resolves TypeBox with an older TypeScript module resolver.
// Runtime resolution is verified by Pi, which uses this package for extension schemas.
// @ts-expect-error -- TypeBox's .d.mts exports require a newer resolver than the workspace LSP.
import { Type } from "typebox";

import { resolveSearchConfig } from "./config.js";

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
const SEARCH_PROMPT = `You are the search subagent. Perform broad, read-only codebase reconnaissance.

Rules:
- You may only inspect files with read, grep, find, and ls.
- Never modify files, run shell commands, or claim changes were made.
- Search broadly enough to answer the task, but avoid dumping large file contents.
- The runtime enforces the project's .gitignore. If a path is blocked as ignored, do not retry it or bypass the guard.
- Stay inside the paths and directories named by the delegated task. Only widen scope when required to trace a direct relationship, and explain why.
- Base conclusions on inspected evidence. Include concise file paths and 1-based line numbers whenever available.
- Return a compact report with: findings, relevant files, relationships/call flow, and remaining uncertainty.
- Do not ask the parent agent to perform routine searches that you can complete yourself.`;

interface SearchDetails {
	task: string;
	model: string;
	modelSource: "project" | "user" | "current";
	output: string;
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
	exitCode: number;
	stderr: string;
	truncated: boolean;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const executable = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(executable)) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

function previewToolCall(name: string, args: Record<string, unknown>): string {
	if (name === "read") return `read ${String(args.path ?? "...")}`;
	if (name === "grep")
		return `grep /${String(args.pattern ?? "")}/ in ${String(args.path ?? ".")}`;
	if (name === "find")
		return `find ${String(args.pattern ?? "*")} in ${String(args.path ?? ".")}`;
	if (name === "ls") return `ls ${String(args.path ?? ".")}`;
	return name;
}

function finalAssistantText(messages: unknown[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as {
			role?: string;
			content?: Array<{ type?: string; text?: string }>;
		};
		if (message.role !== "assistant" || !Array.isArray(message.content))
			continue;
		const texts = message.content
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text as string);
		if (texts.length > 0) return texts.join("\n");
	}
	return "";
}

export default function searchSubagentExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "search",
		label: "Search Subagent",
		description:
			"Delegate broad, read-only repository reconnaissance to an isolated search subagent. Use for searches spanning many files or directories, architecture discovery, locating dispersed implementations, and tracing relationships. The child has only read, grep, find, and ls.",
		promptSnippet:
			"Delegate broad multi-file repository searches to the read-only search subagent",
		promptGuidelines: [
			"Use search automatically when investigation is likely to span at least 5 files, multiple directories, dispersed implementations, or a repository-wide call-flow/architecture search.",
			"Do not use search for a known single file or a small targeted lookup that read, grep, find, or ls can answer directly.",
			"The user may explicitly request the search subagent; honor that request for read-only repository investigation.",
		],
		parameters: Type.Object({
			task: Type.String({
				description:
					"A self-contained repository search task, including what evidence and relationships to report",
			}),
		}),

		async execute(
			_toolCallId: string,
			params: { task: string },
			signal: AbortSignal | undefined,
			onUpdate: ((partial: any) => void) | undefined,
			ctx: ExtensionContext,
		) {
			const config = resolveSearchConfig(
				ctx.cwd,
				ctx.isProjectTrusted(),
				ctx.model,
			);
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
				config.model,
				"--system-prompt",
				SEARCH_PROMPT,
				`Search task: ${params.task}`,
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

			const details = (
				output: string,
				exitCode: number,
				truncated = false,
			): SearchDetails => ({
				task: params.task,
				model: config.model,
				modelSource: config.source,
				output,
				toolCalls: [...toolCalls],
				exitCode,
				stderr,
				truncated,
			});

			const emitUpdate = (status?: string) => {
				const recent = toolCalls
					.slice(-6)
					.map((call) => `→ ${previewToolCall(call.name, call.arguments)}`);
				const text = [status ?? "Search 子 Agent 正在检索…", ...recent].join(
					"\n",
				);
				onUpdate?.({
					content: [{ type: "text", text }],
					details: details(finalAssistantText(messages), -1),
				});
			};

			const exitCode = await new Promise<number>((resolve, reject) => {
				const child = spawn(invocation.command, invocation.args, {
					cwd: ctx.cwd,
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
				});

				const processLine = (line: string) => {
					if (!line.trim()) return;
					let event: any;
					try {
						event = JSON.parse(line);
					} catch {
						return;
					}

					if (event.type === "message_end" && event.message) {
						messages.push(event.message);
						if (
							event.message.role === "assistant" &&
							Array.isArray(event.message.content)
						) {
							for (const part of event.message.content) {
								if (part.type === "toolCall" && typeof part.name === "string") {
									toolCalls.push({
										name: part.name,
										arguments:
											part.arguments && typeof part.arguments === "object"
												? part.arguments
												: {},
									});
								}
							}
						}
						emitUpdate();
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
				child.on("error", reject);
				child.on("close", (code) => {
					if (buffer.trim()) processLine(buffer);
					resolve(code ?? 1);
				});

				const stop = () => {
					aborted = true;
					child.kill("SIGTERM");
					const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
					timer.unref();
				};
				if (signal?.aborted) stop();
				else signal?.addEventListener("abort", stop, { once: true });
			});

			if (aborted) throw new Error("Search 子 Agent 已取消");

			const output = finalAssistantText(messages);
			if (exitCode !== 0 || !output) {
				throw new Error(
					`Search 子 Agent 运行失败（exit ${exitCode}，model ${config.model}）: ${stderr.trim() || "未返回结果"}`,
				);
			}

			const truncation = truncateHead(output, {
				maxBytes: MAX_RESULT_BYTES,
				maxLines: MAX_RESULT_LINES,
			});
			let visibleOutput = truncation.content;
			if (truncation.truncated) {
				visibleOutput +=
					"\n\n[Search 子 Agent 输出已截断；完整输出保存在工具 details 中。]";
			}

			return {
				content: [{ type: "text", text: visibleOutput }],
				details: details(output, exitCode, truncation.truncated),
			};
		},

		renderCall(args: { task?: string }, theme: any) {
			const task = args.task || "...";
			const preview = task.length > 100 ? `${task.slice(0, 100)}...` : task;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("search "))}${theme.fg("muted", "read-only subagent")}\n  ${theme.fg("dim", preview)}`,
				0,
				0,
			);
		},

		renderResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
			const details = result.details as SearchDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(
					first?.type === "text" ? first.text : "(no output)",
					0,
					0,
				);
			}

			if (details.exitCode === -1) {
				const calls = details.toolCalls
					.slice(-6)
					.map((call) => `  → ${previewToolCall(call.name, call.arguments)}`);
				return new Text(
					`${theme.fg("warning", "⏳")} ${theme.fg("toolTitle", "searching")} ${theme.fg("muted", details.model)}${calls.length ? `\n${theme.fg("dim", calls.join("\n"))}` : ""}`,
					0,
					0,
				);
			}

			if (expanded) {
				const calls = details.toolCalls
					.map((call) => `→ ${previewToolCall(call.name, call.arguments)}`)
					.join("\n");
				return new Text(
					`${theme.fg("success", "✓")} ${theme.fg("toolTitle", theme.bold("search"))} ${theme.fg("muted", `${details.model} (${details.modelSource})`)}\n${calls ? `${theme.fg("dim", calls)}\n\n` : ""}${details.output}`,
					0,
					0,
				);
			}

			const summary = details.output.split("\n").slice(0, 12).join("\n");
			const suffix =
				details.output.split("\n").length > 12
					? `\n${theme.fg("muted", "(Ctrl+O to expand)")}`
					: "";
			return new Text(
				`${theme.fg("success", "✓")} ${theme.fg("toolTitle", theme.bold("search"))} ${theme.fg("muted", details.model)}\n${summary}${suffix}`,
				0,
				0,
			);
		},
	});
}
