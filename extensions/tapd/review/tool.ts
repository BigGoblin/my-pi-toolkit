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
import { loadConfig } from "../core/config.js";
import { DEFAULT_GIT_WORKFLOW_POLICY } from "../git/policy.js";
import type { TapdConfig } from "../types.js";
import { collectTapdReviewContext } from "./context.js";
import { buildReviewTask } from "./prompt.js";
import { runReviewSubagent } from "./subagent.js";
import type { TapdReviewMetadata, TapdReviewToolDetails } from "./types.js";

interface ReviewToolParams {
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
			"Use an isolated read-only reviewer subagent to compare the current TAPD story implementation with understanding.md and design.md. Reviews committed, staged, unstaged, and untracked changes and returns a severity-ranked report.",
		promptSnippet:
			"Review the current TAPD story implementation against its requirement and design",
		promptGuidelines: [
			"Use tapd_review when the user runs /tapd review or explicitly asks for the TAPD requirement implementation to be reviewed.",
			"After tapd_review returns, summarize the highest-severity findings and wait for confirmation before modifying code.",
		],
		parameters: Type.Object({
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
					baseRef: reviewContext.baseRef,
					mergeBase: reviewContext.mergeBase,
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
			const baseRef = args.baseRef || DEFAULT_GIT_WORKFLOW_POLICY.baseRef;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("tapd_review "))}${theme.fg("muted", baseRef)}`,
				0,
				0,
			);
		},

		renderResult(
			result: AgentToolResult<TapdReviewToolDetails>,
			{ expanded }: ToolRenderResultOptions,
			theme: Theme,
		) {
			const details = result.details as TapdReviewToolDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(
					first?.type === "text" ? first.text : "(no report)",
					0,
					0,
				);
			}
			if (details.running) {
				const visibleCalls = expanded
					? details.toolCalls
					: details.toolCalls.slice(-6);
				const calls = visibleCalls.map(
					(call) => `  → ${previewToolCall(call.name, call.arguments)}`,
				);
				return new Text(
					`${theme.fg("warning", "⏳")} ${theme.fg("toolTitle", "reviewing")} ${theme.fg("muted", details.model)}\n${theme.fg("text", details.phase)}${calls.length ? `\n${theme.fg("dim", calls.join("\n"))}` : ""}`,
					0,
					0,
				);
			}
			const report = details.report ?? "(no report)";
			const header = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", theme.bold("TAPD review"))} ${theme.fg("muted", `risk:${reportRisk(report)} · ${details.model}`)}`;
			if (!expanded) {
				const summary = report.split("\n").slice(0, 14).join("\n");
				return new Text(
					`${header}\n${summary}\n${theme.fg("muted", "(Ctrl+O to expand full report)")}`,
					0,
					0,
				);
			}
			const container = new Container();
			container.addChild(new Text(header, 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(report, 0, 0, getMarkdownTheme()));
			return container;
		},
	});
}
