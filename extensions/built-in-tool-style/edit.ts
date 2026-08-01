import {
	createEditToolDefinition,
	type AgentToolResult,
	type EditToolDetails,
	type EditToolInput,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { formatCount } from "../shared/tui/tool-format.js";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import {
	colorDiff,
	displayPath,
	errorSummary,
	expansionHint,
	textContent,
} from "./render-utils.js";

interface EditRenderContext {
	cwd: string;
	executionStarted: boolean;
	args: EditToolInput;
	isError: boolean;
}

function diffSummary(diff: string | undefined, replacements: number): string {
	if (!diff) return formatCount(replacements, "replacement");
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return `+${added} -${removed} · ${formatCount(replacements, "replacement")}`;
}

export function createStyledEditDefinition(
	cwd: string,
): ReturnType<typeof createEditToolDefinition> {
	const base = createEditToolDefinition(cwd);
	return {
		...base,
		renderShell: "default",
		renderCall(args: EditToolInput, theme: Theme, context: EditRenderContext) {
			const count = Array.isArray(args.edits) ? args.edits.length : 0;
			return toolCall(
				theme,
				"Edit",
				displayPath(args.path, context.cwd),
				formatCount(count, "replacement"),
			);
		},
		renderResult(
			result: AgentToolResult<EditToolDetails | undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: EditRenderContext,
		) {
			const output = textContent(result);
			const diff = result.details?.diff;
			const count = Array.isArray(context.args.edits)
				? context.args.edits.length
				: 0;
			return toolResult(theme, {
				status: context.isError ? "error" : "success",
				title: "Edit",
				summary: displayPath(context.args.path, context.cwd),
				details: [
					context.isError ? errorSummary(output) : diffSummary(diff, count),
				],
				body: options.expanded && diff ? colorDiff(diff, theme) : undefined,
				hint: diff ? expansionHint(options.expanded) : undefined,
			});
		},
	};
}
