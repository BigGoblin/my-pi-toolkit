import {
	createReadToolDefinition,
	getLanguageFromPath,
	highlightCode,
	type AgentToolResult,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import {
	contentLineCount,
	displayPath,
	errorSummary,
	expansionHint,
	textContent,
	truncationSummary,
} from "./render-utils.js";

interface ReadRenderContext {
	cwd: string;
	executionStarted: boolean;
	args: ReadToolInput;
	isError: boolean;
}

export function createStyledReadDefinition(
	cwd: string,
	options?: ReadToolOptions,
): ReturnType<typeof createReadToolDefinition> {
	const base = createReadToolDefinition(cwd, options);
	return {
		...base,
		renderShell: "default",
		renderCall(args: ReadToolInput, theme: Theme, context: ReadRenderContext) {
			const file = displayPath(args.path, context.cwd);
			const range =
				args.offset !== undefined || args.limit !== undefined
					? `:${args.offset ?? 1}-${
							(args.offset ?? 1) + Math.max(0, (args.limit ?? 1) - 1)
						}`
					: "";
			return toolCall(
				theme,
				"Read",
				`${file}${range}`,
				context.executionStarted ? "reading…" : "preparing…",
			);
		},
		renderResult(
			result: AgentToolResult<ReadToolDetails | undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: ReadRenderContext,
		) {
			const text = textContent(result);
			const hasImage = result.content.some(
				(item: { type: string }) => item.type === "image",
			);
			const warning = truncationSummary(result.details?.truncation);
			let detail = `${contentLineCount(text)} lines`;
			if (hasImage) detail = "image";
			if (context.isError) detail = errorSummary(text);
			const body =
				options.expanded && text
					? highlightCode(text, getLanguageFromPath(context.args.path)).join(
							"\n",
						)
					: undefined;
			return toolResult(theme, {
				status: context.isError ? "error" : "success",
				title: "Read",
				summary: displayPath(context.args.path, context.cwd),
				details: [detail, ...(warning ? [warning] : [])],
				body,
				hint: text ? expansionHint(options.expanded) : undefined,
			});
		},
	};
}
