import { Type } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { requestPlanApproval } from "./plan-approval.js";
import {
	ENTER_PLAN_TOOL,
	EXIT_PLAN_TOOL,
	readPlanFile,
	type PlanFileSeedStatus,
	type SessionPlanFile,
} from "./plan-file.js";
import {
	IMPLEMENTATION_KICKOFF,
	planFileStructure,
} from "./prompt.js";
import type { ChatMode } from "./state.js";
import {
	toolCall,
	toolResult,
	type ToolResultView,
} from "../shared/tui/tool-render.js";

const EmptyParams = Type.Object({});

interface PlanEntryResult {
	plan: SessionPlanFile;
	seed: PlanFileSeedStatus;
}

export interface PlanModeActions {
	getMode: () => ChatMode;
	getPlan: () => SessionPlanFile | undefined;
	enterPlan: (
		ctx: ExtensionContext,
		source: "tool" | "user",
	) => Promise<PlanEntryResult>;
	switchMode: (
		mode: ChatMode,
		ctx: ExtensionContext,
		options?: { viaToolApproval?: boolean; entrySource?: "tool" | "user" },
	) => void;
	markImplementationKickoff: () => void;
}

function textResult(
	text: string,
	details?: Record<string, unknown>,
	terminate = false,
) {
	return {
		content: [{ type: "text" as const, text }],
		details,
		terminate,
	};
}

type PlanExecuteArgs = [
	id: string,
	params: Record<string, never>,
	signal: AbortSignal | undefined,
	update: AgentToolUpdateCallback<unknown> | undefined,
	ctx: ExtensionContext,
];

function withContext(
	handler: (ctx: ExtensionContext) => Promise<ReturnType<typeof textResult>>,
) {
	return async (...args: PlanExecuteArgs) => handler(args[4]);
}

function seedStatusLine(result: PlanEntryResult): string {
	if (result.seed === "nonempty") {
		return `Continue the existing session Plan at ${result.plan.absolutePath}.`;
	}
	return `Write your Plan to ${result.plan.absolutePath}. The file exists and is empty.`;
}

function revisePlanMessage(feedback: string | undefined): string {
	return feedback
		? `The user wants to revise the Plan. The user said:\n${feedback}`
		: "The user did not approve the Plan. Continue planning and ask what should change.";
}

interface PlanToolDetails {
	outcome?: string;
	planFile?: string;
}

function planResultView(
	tool: "enter" | "exit",
	outcome: string | undefined,
): Pick<ToolResultView, "status" | "summary"> {
	const views: Record<string, Pick<ToolResultView, "status" | "summary">> = {
		entered: { status: "success", summary: "entered" },
		already_active: { status: "success", summary: "already active" },
		declined: { status: "error", summary: "declined" },
		revise: { status: "pending", summary: "revision requested" },
		abandoned: { status: "error", summary: "abandoned" },
		approved_deferred: { status: "pending", summary: "approved · deferred" },
		approved_implement: { status: "success", summary: "approved" },
		not_in_plan: { status: "error", summary: "not in plan mode" },
		missing_plan: { status: "error", summary: "plan unavailable" },
	};
	return (
		(outcome && views[outcome]) || {
			status: "error",
			summary: tool === "enter" ? "not entered" : "not completed",
		}
	);
}

function renderPlanResult(
	tool: "enter" | "exit",
	result: AgentToolResult<PlanToolDetails>,
	expanded: boolean,
	theme: Theme,
) {
	const details = result.details as PlanToolDetails | undefined;
	const view = planResultView(tool, details?.outcome);
	const first = result.content[0];
	const body = first?.type === "text" ? first.text : undefined;
	return toolResult(theme, {
		...view,
		title: tool === "enter" ? "Enter Plan Mode" : "Exit Plan Mode",
		details:
			expanded && details?.planFile ? [`Plan: ${details.planFile}`] : undefined,
		body: expanded ? body : undefined,
	});
}

export function registerPlanTools(
	pi: ExtensionAPI,
	actions: PlanModeActions,
): void {
	pi.registerTool<typeof EmptyParams>({
		name: ENTER_PLAN_TOOL,
		label: "Enter Plan Mode",
		description:
			"Enter a read-only planning phase using this session's fixed plan.md. Reentry always resumes the same file.",
		promptSnippet: "Enter plan mode and write this session's plan.md",
		promptGuidelines: [
			"Call enter_plan_mode when the approach is ambiguous or the user asks for a plan — do not start implementing first.",
			"In plan mode, only edit the session Plan path returned by enter_plan_mode; finish by calling exit_plan_mode.",
		],
		parameters: EmptyParams,
		executionMode: "sequential",
		execute: withContext(async (ctx) => {
			if (actions.getMode() === "plan") {
				const plan = actions.getPlan();
				return textResult(
					plan
						? `Already in plan mode. Continue ${plan.absolutePath}, then call ${EXIT_PLAN_TOOL}.`
						: "Already in plan mode, but the session Plan path is unavailable.",
					{ outcome: "already_active", planFile: plan?.absolutePath },
				);
			}

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"进入 Plan 模式？",
					"模型希望先规划再写代码。Plan 模式只允许写入本会话固定的 plan.md。",
				);
				if (!ok) {
					return textResult("User declined to enter plan mode.", {
						outcome: "declined",
					});
				}
			}

			const result = await actions.enterPlan(ctx, "tool");
			return textResult(
				[
					"You have entered plan mode. Explore the codebase and create an implementation plan.",
					"",
					seedStatusLine(result),
					"",
					"1. Understand existing patterns and constraints",
					"2. Resolve important ambiguities with the user",
					"3. Design a concrete implementation and verification strategy",
					"4. Write the complete plan to the session Plan file",
					`5. Call ${EXIT_PLAN_TOOL} to present it for approval`,
					"",
					planFileStructure(result.plan.absolutePath),
				].join("\n"),
				{
					outcome: "entered",
					planFile: result.plan.absolutePath,
					seed: result.seed,
				},
			);
		}),
		renderCall(_args: Record<string, never>, theme: Theme) {
			return toolCall(theme, "Enter Plan Mode", "requesting access");
		},
		renderResult(
			result: AgentToolResult<PlanToolDetails>,
			{ expanded }: ToolRenderResultOptions,
			theme: Theme,
		) {
			return renderPlanResult("enter", result, expanded, theme);
		},
	});

	pi.registerTool<typeof EmptyParams>({
		name: EXIT_PLAN_TOOL,
		label: "Exit Plan Mode",
		description:
			"Read this session's plan.md from disk, render it as Markdown, and present approval options.",
		promptSnippet: "Present the session Plan for approval and leave plan mode",
		promptGuidelines: [
			"Call exit_plan_mode only after writing a complete Plan to the session Plan path.",
			"Do not implement while still in plan mode; a deferred approval also means stop until the user asks to implement.",
		],
		parameters: EmptyParams,
		executionMode: "sequential",
		execute: withContext(async (ctx) => {
			if (actions.getMode() !== "plan") {
				return textResult(`Not in plan mode. Call ${ENTER_PLAN_TOOL} first.`, {
					outcome: "not_in_plan",
				});
			}
			const plan = actions.getPlan();
			if (!plan) {
				return textResult("The session Plan path is unavailable.", {
					outcome: "missing_plan",
				});
			}

			const planContent = await readPlanFile(plan);
			const approval = await requestPlanApproval(
				ctx,
				plan.absolutePath,
				planContent,
			);
			if (approval.decision === "revise") {
				return textResult(revisePlanMessage(approval.feedback), {
					outcome: "revise",
					feedback: approval.feedback,
					planFile: plan.absolutePath,
				});
			}

			actions.switchMode("build", ctx, { viaToolApproval: true });
			if (approval.decision === "abandon") {
				return textResult(
					`The user abandoned this Plan. The session file remains at ${plan.absolutePath}; do not implement it.`,
					{ outcome: "abandoned", planFile: plan.absolutePath },
					true,
				);
			}
			if (approval.decision === "defer") {
				return textResult(
					`The Plan was approved at ${plan.absolutePath}, but the user chose not to implement it now. Stop and wait for an explicit implementation request.`,
					{ outcome: "approved_deferred", planFile: plan.absolutePath },
					true,
				);
			}

			actions.markImplementationKickoff();
			const body = planContent ? `\n\n## Plan:\n${planContent}` : "";
			return textResult(
				`${IMPLEMENTATION_KICKOFF}\n\nThe Plan is saved at ${plan.absolutePath}.${body}`,
				{ outcome: "approved_implement", planFile: plan.absolutePath },
			);
		}),
		renderCall(_args: Record<string, never>, theme: Theme) {
			return toolCall(theme, "Exit Plan Mode", "presenting plan");
		},
		renderResult(
			result: AgentToolResult<PlanToolDetails>,
			{ expanded }: ToolRenderResultOptions,
			theme: Theme,
		) {
			return renderPlanResult("exit", result, expanded, theme);
		},
	});
}
