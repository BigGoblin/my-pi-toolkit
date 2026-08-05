import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
// @ts-expect-error -- TypeBox's .d.mts exports require a newer resolver than the workspace LSP.
import { Type } from "typebox";
import { previewLines, resultText } from "../../shared/tui/tool-format.js";
import {
	toolCall,
	toolHeader,
	toolResult,
} from "../../shared/tui/tool-render.js";
import { loadConfig } from "../core/config.js";
import { DEFAULT_GIT_WORKFLOW_POLICY } from "../git/policy.js";
import type { TapdConfig } from "../types.js";
import { collectTapdReviewContext } from "./context.js";
import { buildReviewTask } from "./prompt.js";
import { runReviewSubagent } from "./subagent.js";
import type {
	TapdReviewMetadata,
	TapdReviewScope,
	TapdReviewToolDetails,
} from "./types.js";

interface ReviewToolParams {
	scope?: TapdReviewScope;
	baseRef?: string;
	instructions?: string;
}

function resolveReviewModel(
	config: TapdConfig,
	currentModel: { provider: string; id: string } | undefined,
): string {
	const configured = (config.review as { model?: unknown } | undefined)?.model;
	if (configured !== undefined) {
		if (typeof configured !== "string" || !configured.trim())
			throw new Error("tapd.json 中 review.model 必须是非空模型名称");
		return configured.trim();
	}
	if (!currentModel)
		throw new Error(
			"未配置 Review 子代理模型，且主 Agent 当前没有可继承的模型",
		);
	return `${currentModel.provider}/${currentModel.id}`;
}

function previewToolCall(name: string, args: Record<string, unknown>): string {
	const path = String(args.path ?? args.file_path ?? ".");
	if (name === "grep") return `grep /${String(args.pattern ?? "")}/ in ${path}`;
	if (name === "find") return `find ${String(args.pattern ?? "*")} in ${path}`;
	return `${name} ${path}`;
}

function reportRisk(report: string): string {
	return (
		report.match(/总体风险[：:]\s*(LOW|MEDIUM|HIGH|BLOCKED)/)?.[1] ?? "UNKNOWN"
	);
}

export function registerTapdReviewTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "tapd_review",
		label: "TAPD Code Review",
		description:
			"Use an isolated read-only reviewer subagent to compare the current TAPD story implementation with understanding.md and design.md. Can review only uncommitted changes or all branch and working-tree changes, and returns a severity-ranked report.",
		promptSnippet:
			"Review the current TAPD story implementation against its requirement and design",
		promptGuidelines: [
			"Use tapd_review when the user runs /tapd review or explicitly asks for the TAPD requirement implementation to be reviewed.",
			"After tapd_review returns, summarize the highest-severity findings and wait for confirmation before modifying code.",
		],
		parameters: Type.Object({
			scope: Type.Optional(
				Type.Unsafe<TapdReviewScope>({
					type: "string",
					enum: ["uncommitted", "branch"],
					description:
						"Review uncommitted changes only, or all changes since the base branch. Defaults to branch.",
				}),
			),
			baseRef: Type.Optional(
				Type.String({
					description: "Git base ref. Defaults to origin/dev.",
				}),
			),
			instructions: Type.Optional(
				Type.String({ description: "Additional review focus from the user" }),
			),
		}),

		async execute(
			_toolCallId: string,
			params: ReviewToolParams,
			signal: AbortSignal | undefined,
			onUpdate:
				| ((partial: {
						content: Array<{ type: "text"; text: string }>;
						details: TapdReviewToolDetails;
				  }) => void)
				| undefined,
			ctx: ExtensionContext,
		) {
			const config = loadConfig();
			if (!config) throw new Error("请先配置 ~/.pi/agent/tapd.json");
			const model = resolveReviewModel(config, ctx.model);
			const scope = params.scope ?? "branch";
			const baseRef =
				params.baseRef?.trim() || DEFAULT_GIT_WORKFLOW_POLICY.baseRef;
			const toolCalls: Array<{
				name: string;
				arguments: Record<string, unknown>;
			}> = [];
			const emit = (phase: string) => {
				const recent = toolCalls
					.slice(-6)
					.map((call) => `→ ${previewToolCall(call.name, call.arguments)}`);
				onUpdate?.({
					content: [{ type: "text", text: [phase, ...recent].join("\n") }],
					details: {
						running: true,
						phase,
						model,
						toolCalls: [...toolCalls],
					},
				});
			};

			let reviewContext:
				| Awaited<ReturnType<typeof collectTapdReviewContext>>
				| undefined;
			try {
				reviewContext = await collectTapdReviewContext(
					ctx,
					scope,
					baseRef,
					(_stage, _state, message) => emit(message),
				);
				if (signal?.aborted) throw new Error("TAPD Review 已取消");
				emit(`Review 子代理运行中：${model}`);
				const result = await runReviewSubagent({
					cwd: reviewContext.repositoryRoot,
					model,
					task: buildReviewTask(reviewContext, params.instructions),
					presentation: config.review?.presentation,
					parentSessionId: ctx.sessionManager.getSessionId(),
					artifactFiles: [reviewContext.contextFile],
					signal,
					onToolCall: (name, args) => {
						toolCalls.push({ name, arguments: args });
						emit("Review 子代理正在检查代码");
					},
				});
				const metadata: TapdReviewMetadata = {
					storyId: reviewContext.storyId,
					scope: reviewContext.scope,
					baseRef: reviewContext.baseRef,
					mergeBase: reviewContext.mergeBase,
					comparisonRef: reviewContext.comparisonRef,
					branch: reviewContext.branch,
					model: result.model,
					changedFiles: reviewContext.changedFiles,
					generatedAt: new Date().toISOString(),
				};
				const details: TapdReviewToolDetails = {
					running: false,
					phase: "审核完成",
					model,
					toolCalls,
					report: result.report,
					metadata,
				};
				return {
					content: [{ type: "text" as const, text: result.report }],
					details,
				};
			} finally {
				await reviewContext?.cleanup();
			}
		},

		renderCall(args: ReviewToolParams, theme: Theme) {
			const range =
				args.scope === "uncommitted"
					? "未提交修改"
					: args.baseRef || DEFAULT_GIT_WORKFLOW_POLICY.baseRef;
			return toolCall(theme, "tapd_review", range);
		},

		renderResult(
			result: AgentToolResult<TapdReviewToolDetails>,
			{ expanded }: ToolRenderResultOptions,
			theme: Theme,
		) {
			const details = result.details as TapdReviewToolDetails | undefined;
			if (!details) {
				return toolResult(theme, {
					status: "error",
					title: "TAPD review",
					summary: resultText(result.content, "(no report)"),
				});
			}
			if (details.running) {
				const visibleCalls = expanded
					? details.toolCalls
					: details.toolCalls.slice(-6);
				const calls = visibleCalls.map(
					(call) => `→ ${previewToolCall(call.name, call.arguments)}`,
				);
				return toolResult(theme, {
					status: "active",
					title: "reviewing",
					summary: details.model,
					details: [details.phase],
					body: calls.length > 0 ? calls.join("\n") : undefined,
				});
			}
			const report = details.report ?? "(no report)";
			const view = {
				status: "success" as const,
				title: "TAPD review",
				summary: `risk:${reportRisk(report)} · ${details.model}`,
			};
			if (!expanded) {
				const preview = previewLines(report, 14);
				return toolResult(theme, {
					...view,
					body: preview.text,
					hint: preview.truncated ? "Ctrl+O to expand full report" : undefined,
				});
			}
			const container = new Container();
			container.addChild(new Text(toolHeader(theme, view), 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(report, 0, 0, getMarkdownTheme()));
			return container;
		},
	});
}
