import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
// @ts-expect-error -- TypeBox's .d.mts exports require a newer resolver than the workspace LSP.
import { Type } from "typebox";
import { previewLines, resultText } from "../shared/tui/tool-format.js";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import { registerRepoSearchCommand } from "./command.js";
import { resolveRepoSearchConfig } from "./config.js";
import { runRepoSearchSubagent } from "./runner.js";
import type { RepoSearchDetails } from "./types.js";

function previewToolCall(name: string, args: Record<string, unknown>): string {
	if (name === "read") return `read ${String(args.path ?? "...")}`;
	if (name === "grep")
		return `grep /${String(args.pattern ?? "")}/ in ${String(args.path ?? ".")}`;
	if (name === "find")
		return `find ${String(args.pattern ?? "*")} in ${String(args.path ?? ".")}`;
	if (name === "ls") return `ls ${String(args.path ?? ".")}`;
	return name;
}

function runningText(details: RepoSearchDetails): string {
	const recent = details.toolCalls
		.slice(-6)
		.map((call) => `→ ${previewToolCall(call.name, call.arguments)}`);
	return ["Repo Search 子 Agent 正在检索…", ...recent].join("\n");
}

export default function repoSearchSubagentExtension(pi: ExtensionAPI) {
	registerRepoSearchCommand(pi);
	pi.registerTool({
		name: "repo_search",
		label: "Repo Search Subagent",
		description:
			"Explore files and code inside the current local repository only through an isolated read-only subagent. Use for broad multi-file architecture discovery, locating dispersed implementations, and tracing call relationships. This tool cannot access the internet or research external libraries and APIs. The child has only read, grep, find, and ls.",
		promptSnippet:
			"Explore files and code across the current local repository with a read-only subagent",
		promptGuidelines: [
			"Use repo_search only for broad exploration of files and code inside the current local repository.",
			"Use repo_search automatically only when local repository exploration is likely to span at least 5 files, multiple directories, dispersed implementations, or repository-wide call flows and architecture.",
			"Never use repo_search for third-party library discovery, external API research, official documentation, GitHub project research, or general internet research. Use Context7 or an available web-search tool instead.",
			"Do not use repo_search for a known single file or a small targeted local lookup that read, grep, find, or ls can answer directly.",
			"The user may explicitly request the repo search subagent; honor that request only for read-only exploration of the current repository.",
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
			onUpdate:
				| ((partial: {
						content: Array<{ type: "text"; text: string }>;
						details: RepoSearchDetails;
				  }) => void)
				| undefined,
			ctx: ExtensionContext,
		) {
			const config = resolveRepoSearchConfig(
				ctx.cwd,
				ctx.isProjectTrusted(),
				ctx.model,
			);
			const result = await runRepoSearchSubagent({
				cwd: ctx.cwd,
				task: params.task,
				config,
				parentSessionId: ctx.sessionManager.getSessionId(),
				signal,
				onUpdate: (details) =>
					onUpdate?.({
						content: [{ type: "text", text: runningText(details) }],
						details,
					}),
			});
			return {
				content: [{ type: "text" as const, text: result.content }],
				details: result.details,
			};
		},

		renderCall(args: { task?: string }, theme: Theme) {
			const task = args.task || "...";
			const preview = task.length > 100 ? `${task.slice(0, 100)}...` : task;
			return toolCall(theme, "repo_search", "read-only subagent", preview);
		},

		renderResult(
			result: AgentToolResult<RepoSearchDetails>,
			{ expanded }: ToolRenderResultOptions,
			theme: Theme,
		) {
			const details = result.details as RepoSearchDetails | undefined;
			if (!details) {
				return toolResult(theme, {
					status: "success",
					title: "repo_search",
					body: resultText(result.content, "(no output)"),
				});
			}

			if (details.exitCode === -1) {
				const visibleCalls = expanded
					? details.toolCalls
					: details.toolCalls.slice(-6);
				return toolResult(theme, {
					status: "active",
					title: "searching",
					summary: details.model,
					details: visibleCalls.map(
						(call) => `→ ${previewToolCall(call.name, call.arguments)}`,
					),
				});
			}

			const status = details.exitCode === 0 ? "success" : "error";
			if (expanded) {
				return toolResult(theme, {
					status,
					title: "repo_search",
					summary: `${details.model} (${details.modelSource})`,
					details: details.toolCalls.map(
						(call) => `→ ${previewToolCall(call.name, call.arguments)}`,
					),
					body: details.output,
				});
			}

			const preview = previewLines(details.output, 12);
			return toolResult(theme, {
				status,
				title: "repo_search",
				summary: details.model,
				body: preview.text,
				hint: preview.truncated ? "(Ctrl+O to expand)" : undefined,
			});
		},
	});
}
