import { Type } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { PLAN_FILE_RELATIVE } from "./paths.js";
import {
	ENTER_PLAN_TOOL,
	EXIT_PLAN_TOOL,
	readPlanFile,
	seedPlanFile,
} from "./plan-file.js";
import { PLAN_FILE_STRUCTURE } from "./prompt.js";
import type { ChatMode } from "./state.js";

const EmptyParams = Type.Object({});

const PREVIEW_MAX = 2400;

export interface PlanModeActions {
	getMode: () => ChatMode;
	/**
	 * Switch mode without idle guard (safe during tool execution).
	 * @param viaToolApproval - when leaving plan via exit_plan_mode outcomes
	 */
	switchMode: (
		mode: ChatMode,
		ctx: ExtensionContext,
		options?: { viaToolApproval?: boolean },
	) => void;
}

function textResult(text: string, details?: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function seedStatusLine(
	status: "created" | "empty" | "nonempty",
): string {
	if (status === "nonempty") {
		return `Write your plan to ${PLAN_FILE_RELATIVE}. The file exists but is not empty.`;
	}
	return `Write your plan to ${PLAN_FILE_RELATIVE}. The file exists and is empty.`;
}

function truncatePreview(content: string): string {
	if (content.length <= PREVIEW_MAX) return content;
	return `${content.slice(0, PREVIEW_MAX)}\n\n… (truncated; full plan in ${PLAN_FILE_RELATIVE})`;
}

function revisePlanMessage(feedback: string | undefined): string {
	if (feedback) {
		return `The user wants to revise the plan. The user said:\n${feedback}`;
	}
	return "The user wants to revise the plan. Ask the user what changes they would like to make.";
}

export function registerPlanTools(
	pi: ExtensionAPI,
	actions: PlanModeActions,
): void {
	pi.registerTool({
		name: ENTER_PLAN_TOOL,
		label: "Enter Plan Mode",
		description:
			"Enter plan mode when a task has ambiguity about the right approach, or when the user asks for a plan. Enables a read-only planning phase where you explore the codebase and write an implementation plan to .pi/plan.md.",
		promptSnippet:
			"Enter plan mode to explore and write .pi/plan.md before coding",
		promptGuidelines: [
			"Call enter_plan_mode when the approach is ambiguous or the user asks for a plan — do not start implementing first.",
			"In plan mode, only edit .pi/plan.md; finish by calling exit_plan_mode.",
		],
		parameters: EmptyParams,
		executionMode: "sequential",

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (actions.getMode() === "plan") {
				return textResult(
					`Already in plan mode. Explore the codebase, write the plan to ${PLAN_FILE_RELATIVE}, then call ${EXIT_PLAN_TOOL} when ready.`,
					{ outcome: "already_active" },
				);
			}

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Enter plan mode?",
					`The agent wants to plan before coding.\nOnly ${PLAN_FILE_RELATIVE} will be writable until you approve the plan.`,
				);
				if (!ok) {
					return textResult("User declined to enter plan mode.", {
						outcome: "declined",
					});
				}
			}

			actions.switchMode("plan", ctx);
			const seed = await seedPlanFile(ctx.cwd);

			// Workflow steps adapted from Grok EnterPlanModeOutput::to_prompt_format
			return textResult(
				[
					"You have entered plan mode. You should now focus on exploring the codebase and creating an implementation plan.",
					"",
					seedStatusLine(seed),
					"",
					"In plan mode, you should:",
					"1. Thoroughly explore the codebase to understand existing patterns",
					"2. Identify similar features, codebase architecture, and understand trade-offs",
					"3. Ask clarifying questions if you need to clarify the approach",
					"4. Design a concrete implementation strategy",
					"5. Write your plan to the plan file above",
					`6. When ready, use ${EXIT_PLAN_TOOL} to present your plan to the user.`,
					"",
					PLAN_FILE_STRUCTURE,
				].join("\n"),
				{ outcome: "entered", planFile: PLAN_FILE_RELATIVE, seed },
			);
		},
	});

	pi.registerTool({
		name: EXIT_PLAN_TOOL,
		label: "Exit Plan Mode",
		description:
			"Exit plan mode and present the plan in .pi/plan.md for user approval. Call this after you have finished writing the plan file.",
		promptSnippet: "Present .pi/plan.md for approval and leave plan mode",
		promptGuidelines: [
			"Call exit_plan_mode only after writing a complete plan to .pi/plan.md.",
			"Do not implement code while still in plan mode — wait for approval via exit_plan_mode.",
		],
		parameters: EmptyParams,
		executionMode: "sequential",

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (actions.getMode() !== "plan") {
				return textResult(
					`Not in plan mode. Call ${ENTER_PLAN_TOOL} first, or ask the user to press Alt+M / run /plan.`,
					{ outcome: "not_in_plan" },
				);
			}

			const planContent = await readPlanFile(ctx.cwd);
			const preview = planContent
				? truncatePreview(planContent)
				: `(No plan written yet — ${PLAN_FILE_RELATIVE} is missing or empty.)`;

			let outcome: "approved" | "cancelled" | "abandoned" = "approved";
			let feedback: string | undefined;

			if (ctx.hasUI) {
				const choice = await ctx.ui.select(
					`Plan ready (${PLAN_FILE_RELATIVE}):\n\n${preview}\n\nWhat next?`,
					[
						"Approve and implement",
						"Request changes",
						"Abandon plan",
					],
				);

				if (choice?.startsWith("Approve")) {
					outcome = "approved";
				} else if (choice?.startsWith("Request")) {
					outcome = "cancelled";
					const note = await ctx.ui.editor(
						"What should change in the plan?",
						"",
					);
					feedback = note?.trim() || undefined;
				} else if (choice?.startsWith("Abandon")) {
					outcome = "abandoned";
				} else {
					outcome = "cancelled";
				}
			}

			if (outcome === "approved") {
				actions.switchMode("build", ctx, { viaToolApproval: true });
				if (planContent) {
					return textResult(
						[
							"Your plan has been approved. You can now start coding.",
							"",
							`Your plan has been saved at: ${PLAN_FILE_RELATIVE}`,
							"",
							"The user approved the plan. Implement the plan in plan.md.",
							"",
							`## Plan:\n${planContent}`,
						].join("\n"),
						{ outcome, planFile: PLAN_FILE_RELATIVE },
					);
				}
				return textResult(
					"Plan mode exit approved. No plan content was found — you can proceed.",
					{ outcome, planFile: PLAN_FILE_RELATIVE },
				);
			}

			if (outcome === "abandoned") {
				actions.switchMode("build", ctx, { viaToolApproval: true });
				return textResult(
					`The user chose to abandon the plan entirely and left plan mode. Do not call ${EXIT_PLAN_TOOL} again unless the user asks to plan again.`,
					{ outcome },
				);
			}

			if (planContent) {
				return textResult(revisePlanMessage(feedback), {
					outcome: "cancelled",
					feedback,
				});
			}
			return textResult(
				"The user does not want to exit plan mode. Continue planning and ask the user what they would like to do.",
				{ outcome: "cancelled", feedback },
			);
		},
	});
}
