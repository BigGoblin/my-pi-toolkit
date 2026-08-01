import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	type AgentToolResult,
	type FindToolDetails,
	type FindToolInput,
	type GrepToolDetails,
	type GrepToolInput,
	type LsToolDetails,
	type LsToolInput,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	compactText,
	formatCount,
	previewLines,
} from "../shared/tui/tool-format.js";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import {
	contentLineCount,
	displayPath,
	errorSummary,
	expansionHint,
	textContent,
	toolStatus,
	truncationSummary,
} from "./render-utils.js";

interface GrepRenderContext {
	cwd: string;
	executionStarted: boolean;
	args: GrepToolInput;
	isError: boolean;
}

interface FindRenderContext {
	cwd: string;
	executionStarted: boolean;
	args: FindToolInput;
	isError: boolean;
}

interface LsRenderContext {
	cwd: string;
	executionStarted: boolean;
	args: LsToolInput;
	isError: boolean;
}

function resultBody(text: string, expanded: boolean): string | undefined {
	if (!text) return undefined;
	return expanded ? text : previewLines(text, 5).text;
}

function searchHint(text: string, expanded: boolean): string | undefined {
	return text ? expansionHint(expanded) : undefined;
}

function grepCounts(text: string): string {
	const lines = text.split("\n").filter(Boolean);
	const files = new Set<string>();
	for (const line of lines) {
		const match = line.match(/^(.+?):\d+(?::\d+)?:/);
		if (match?.[1]) files.add(match[1]);
	}
	const fileSummary =
		files.size > 0 ? ` in ${formatCount(files.size, "file")}` : "";
	return `${formatCount(lines.length, "match", "matches")}${fileSummary}`;
}

function warningDetails(
	truncation: Parameters<typeof truncationSummary>[0],
	limitWarning?: string,
): string[] {
	const warning = truncationSummary(truncation);
	return [
		...(limitWarning ? [limitWarning] : []),
		...(warning ? [warning] : []),
	];
}

export function createStyledGrepDefinition(
	cwd: string,
): ReturnType<typeof createGrepToolDefinition> {
	const base = createGrepToolDefinition(cwd);
	return {
		...base,
		renderShell: "default",
		renderCall(args: GrepToolInput, theme: Theme, context: GrepRenderContext) {
			const scope = displayPath(args.path, context.cwd);
			return toolCall(
				theme,
				"Grep",
				`"${compactText(args.pattern ?? "", 60)}" in ${scope}`,
				args.glob ? `glob: ${args.glob}` : undefined,
			);
		},
		renderResult(
			result: AgentToolResult<GrepToolDetails | undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: GrepRenderContext,
		) {
			const text = textContent(result);
			const limit = result.details?.matchLimitReached;
			return toolResult(theme, {
				status: toolStatus(options.isPartial, context.isError),
				title: "Grep",
				summary: `"${compactText(context.args.pattern ?? "", 60)}" in ${displayPath(context.args.path, context.cwd)}`,
				details: [
					context.isError ? errorSummary(text) : grepCounts(text),
					...warningDetails(
						result.details?.truncation,
						limit ? `match limit reached: ${limit}` : undefined,
					),
					...(result.details?.linesTruncated
						? ["long match lines truncated"]
						: []),
				],
				body: resultBody(text, options.expanded),
				hint: searchHint(text, options.expanded),
			});
		},
	};
}

export function createStyledFindDefinition(
	cwd: string,
): ReturnType<typeof createFindToolDefinition> {
	const base = createFindToolDefinition(cwd);
	return {
		...base,
		renderShell: "default",
		renderCall(args: FindToolInput, theme: Theme, context: FindRenderContext) {
			return toolCall(
				theme,
				"Find",
				compactText(args.pattern ?? "*", 70),
				`in ${displayPath(args.path, context.cwd)}`,
			);
		},
		renderResult(
			result: AgentToolResult<FindToolDetails | undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: FindRenderContext,
		) {
			const text = textContent(result);
			const limit = result.details?.resultLimitReached;
			return toolResult(theme, {
				status: context.isError ? "error" : "success",
				title: "Find",
				summary: `${compactText(context.args.pattern ?? "*", 70)} in ${displayPath(context.args.path, context.cwd)}`,
				details: [
					context.isError
						? errorSummary(text)
						: formatCount(contentLineCount(text), "file"),
					...warningDetails(
						result.details?.truncation,
						limit ? `result limit reached: ${limit}` : undefined,
					),
				],
				body: resultBody(text, options.expanded),
				hint: searchHint(text, options.expanded),
			});
		},
	};
}

export function createStyledLsDefinition(
	cwd: string,
): ReturnType<typeof createLsToolDefinition> {
	const base = createLsToolDefinition(cwd);
	return {
		...base,
		renderShell: "default",
		renderCall(args: LsToolInput, theme: Theme, context: LsRenderContext) {
			return toolCall(theme, "List", displayPath(args.path, context.cwd));
		},
		renderResult(
			result: AgentToolResult<LsToolDetails | undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: LsRenderContext,
		) {
			const text = textContent(result);
			const limit = result.details?.entryLimitReached;
			return toolResult(theme, {
				status: context.isError ? "error" : "success",
				title: "List",
				summary: displayPath(context.args.path, context.cwd),
				details: [
					context.isError
						? errorSummary(text)
						: formatCount(contentLineCount(text), "entry", "entries"),
					...warningDetails(
						result.details?.truncation,
						limit ? `entry limit reached: ${limit}` : undefined,
					),
				],
				body: resultBody(text, options.expanded),
				hint: searchHint(text, options.expanded),
			});
		},
	};
}
