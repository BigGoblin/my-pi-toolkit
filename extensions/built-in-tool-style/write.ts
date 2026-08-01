import {
	createWriteToolDefinition,
	getLanguageFromPath,
	highlightCode,
	type AgentToolResult,
	type Theme,
	type ToolRenderResultOptions,
	type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import {
	contentSummary,
	displayPath,
	errorSummary,
	expansionHint,
	textContent,
} from "./render-utils.js";

interface WriteRenderContext {
	cwd: string;
	executionStarted: boolean;
	args: WriteToolInput;
	isError: boolean;
}

export function createStyledWriteDefinition(
	cwd: string,
): ReturnType<typeof createWriteToolDefinition> {
	const base = createWriteToolDefinition(cwd);
	return {
		...base,
		renderShell: "default",
		renderCall(
			args: WriteToolInput,
			theme: Theme,
			context: WriteRenderContext,
		) {
			return toolCall(
				theme,
				"Write",
				displayPath(args.path, context.cwd),
				contentSummary(args.content ?? ""),
			);
		},
		renderResult(
			result: AgentToolResult<undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: WriteRenderContext,
		) {
			const output = textContent(result);
			const content = context.args.content ?? "";
			return toolResult(theme, {
				status: context.isError ? "error" : "success",
				title: "Write",
				summary: displayPath(context.args.path, context.cwd),
				details: [
					context.isError ? errorSummary(output) : contentSummary(content),
				],
				body:
					options.expanded && content
						? highlightCode(
								content,
								getLanguageFromPath(context.args.path),
							).join("\n")
						: undefined,
				hint: content ? expansionHint(options.expanded) : undefined,
			});
		},
	};
}
