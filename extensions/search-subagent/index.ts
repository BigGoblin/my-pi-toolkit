import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
// @ts-expect-error -- TypeBox's .d.mts exports require a newer resolver than the workspace LSP.
import { Type } from "typebox";
import { registerSearchCommand } from "./command.js";
import { resolveSearchConfig } from "./config.js";
import { runSearchSubagent } from "./runner.js";
import type { SearchDetails } from "./types.js";

function previewToolCall(name: string, args: Record<string, unknown>): string {
	if (name === "read") return `read ${String(args.path ?? "...")}`;
	if (name === "grep")
		return `grep /${String(args.pattern ?? "")}/ in ${String(args.path ?? ".")}`;
	if (name === "find")
		return `find ${String(args.pattern ?? "*")} in ${String(args.path ?? ".")}`;
	if (name === "ls") return `ls ${String(args.path ?? ".")}`;
	return name;
}

function runningText(details: SearchDetails): string {
	const recent = details.toolCalls
		.slice(-6)
		.map((call) => `→ ${previewToolCall(call.name, call.arguments)}`);
	return ["Search 子 Agent 正在检索…", ...recent].join("\n");
}

export default function searchSubagentExtension(pi: ExtensionAPI) {
	registerSearchCommand(pi);
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
			onUpdate:
				| ((partial: {
						content: Array<{ type: "text"; text: string }>;
						details: SearchDetails;
				  }) => void)
				| undefined,
			ctx: ExtensionContext,
		) {
			const config = resolveSearchConfig(
				ctx.cwd,
				ctx.isProjectTrusted(),
				ctx.model,
			);
			const result = await runSearchSubagent({
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
			return new Text(
				`${theme.fg("toolTitle", theme.bold("search "))}${theme.fg("muted", "read-only subagent")}\n  ${theme.fg("dim", preview)}`,
				0,
				0,
			);
		},

		renderResult(
			result: AgentToolResult<SearchDetails>,
			{ expanded }: ToolRenderResultOptions,
			theme: Theme,
		) {
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
				const visibleCalls = expanded
					? details.toolCalls
					: details.toolCalls.slice(-6);
				const calls = visibleCalls.map(
					(call) => `  → ${previewToolCall(call.name, call.arguments)}`,
				);
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
