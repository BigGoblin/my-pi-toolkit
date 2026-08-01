import {
	createBashToolDefinition,
	type AgentToolResult,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { compactText } from "../shared/tui/tool-format.js";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import {
	elapsed,
	errorSummary,
	expansionHint,
	tailLines,
	textContent,
	toolStatus,
	truncationSummary,
} from "./render-utils.js";

interface BashRenderState {
	startedAt?: number;
	endedAt?: number;
}

interface BashRenderContext {
	executionStarted: boolean;
	args: BashToolInput;
	isError: boolean;
	state: BashRenderState;
}

function commandSummary(command: string | undefined): string {
	return compactText(command || "command", 100);
}

function exitSummary(output: string): string {
	const match = output.match(/Command exited with code (\d+)/);
	return match ? `exit ${match[1]}` : errorSummary(output);
}

export function createStyledBashDefinition(
	cwd: string,
	options?: BashToolOptions,
): ReturnType<typeof createBashToolDefinition> {
	const base = createBashToolDefinition(cwd, options);
	return {
		...base,
		renderShell: "default",
		renderCall(args: BashToolInput, theme: Theme, context: BashRenderContext) {
			if (context.executionStarted && context.state.startedAt === undefined) {
				context.state.startedAt = Date.now();
				context.state.endedAt = undefined;
			}
			const duration = context.state.startedAt
				? elapsed(context.state.startedAt)
				: undefined;
			return toolCall(
				theme,
				"Bash",
				commandSummary(args.command),
				duration ? `running · ${duration}` : "preparing…",
			);
		},
		renderResult(
			result: AgentToolResult<BashToolDetails | undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: BashRenderContext,
		) {
			const output = textContent(result);
			context.state.startedAt ??= Date.now();
			if (!options.isPartial || context.isError) {
				context.state.endedAt ??= Date.now();
			}
			const duration = elapsed(context.state.startedAt, context.state.endedAt);
			const warning = truncationSummary(result.details?.truncation);
			const details = [
				context.isError ? `${exitSummary(output)} · ${duration}` : duration,
				...(warning ? [warning] : []),
				...(result.details?.fullOutputPath
					? [`full output: ${result.details.fullOutputPath}`]
					: []),
			];
			let body: string | undefined;
			if (output) {
				body = options.expanded ? output : tailLines(output, 4);
			}
			return toolResult(theme, {
				status: toolStatus(options.isPartial, context.isError),
				title: "Bash",
				summary: commandSummary(context.args.command),
				details,
				body,
				hint:
					output && !options.isPartial
						? expansionHint(options.expanded)
						: undefined,
			});
		},
	};
}
