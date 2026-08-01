import { Type } from "@earendil-works/pi-ai";
import type {
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { requestPlanApproval } from "./plan-approval.js";
import {
	ENTER_PLAN_TOOL,
	EXIT_PLAN_TOOL,
	readPlanFile,
	type PlanFileSeedStatus,
	type SessionPlanFile,
} from "./plan-file.js";
import { planFileStructure } from "./prompt.js";
import type { ChatMode } from "./state.js";

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
}

function textResult(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
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
				);
			}
			if (approval.decision === "defer") {
				return textResult(
					`The Plan was approved at ${plan.absolutePath}, but the user chose not to implement it now. Stop and wait for an explicit implementation request.`,
					{ outcome: "approved_deferred", planFile: plan.absolutePath },
				);
			}

			const body = planContent ? `\n\n## Plan:\n${planContent}` : "";
			return textResult(
				`The Plan was approved for implementation. It is saved at ${plan.absolutePath}. You can now start coding.${body}`,
				{ outcome: "approved_implement", planFile: plan.absolutePath },
			);
		}),
	});
}
