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
import type { ChatMode } from "./state.js";

const EmptyParams = Type.Object({});

const PREVIEW_MAX = 2400;

export interface PlanModeActions {
	getMode: () => ChatMode;
	/** Switch mode without idle guard (safe during tool execution). */
	switchMode: (mode: ChatMode, ctx: ExtensionContext) => void;
}

function textResult(text: string, details?: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function seedLabel(status: "created" | "empty" | "nonempty"): string {
	if (status === "created") return "Created an empty plan file.";
	if (status === "empty") return "The plan file exists and is empty.";
	return "The plan file exists and already has content — read it before editing.";
}

function truncatePreview(content: string): string {
	if (content.length <= PREVIEW_MAX) return content;
	return `${content.slice(0, PREVIEW_MAX)}\n\n… (truncated; full plan in ${PLAN_FILE_RELATIVE})`;
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
					`Already in plan mode. Explore the codebase, write the plan to ${PLAN_FILE_RELATIVE}, then call exit_plan_mode when ready.`,
					{ outcome: "already_active" },
				);
			}

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Enter plan mode?",
					`The agent wants to plan before coding.\nOnly ${PLAN_FILE_RELATIVE} will be writable until you approve the plan.`,
				);
				if (!ok) {
					return textResult(
						"User declined to enter plan mode. Continue in the current mode, or ask clarifying questions.",
						{ outcome: "declined" },
					);
				}
			}

			actions.switchMode("plan", ctx);
			const seed = await seedPlanFile(ctx.cwd);

			return textResult(
				[
					"You have entered plan mode. Focus on exploring the codebase and creating an implementation plan.",
					"",
					`## Plan File: ${PLAN_FILE_RELATIVE}`,
					seedLabel(seed),
					"",
					"Workflow:",
					"1. Explore with read-only tools (read, grep, find, ls, repo_search, …).",
					"2. Ask clarifying questions if requirements are ambiguous.",
					"3. Design the approach; do not implement project code.",
					`4. Write the plan to ${PLAN_FILE_RELATIVE} (Context / Approach / Critical files / Verification).`,
					"5. When ready, call exit_plan_mode to present the plan for approval.",
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
					"Not in plan mode. Call enter_plan_mode first, or ask the user to press Alt+M / run /plan.",
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
				actions.switchMode("build", ctx);
				return textResult(
					[
						"The user approved the plan. You can now make edits and implement it.",
						"",
						`Implement the plan in ${PLAN_FILE_RELATIVE}.`,
						planContent
							? `\n## Plan:\n\n${planContent}`
							: "\n(No plan content was found — clarify with the user if needed, then proceed.)",
					].join("\n"),
					{ outcome, planFile: PLAN_FILE_RELATIVE },
				);
			}

			if (outcome === "abandoned") {
				actions.switchMode("build", ctx);
				return textResult(
					"The user abandoned the plan and left plan mode. Do not implement the plan unless they ask again.",
					{ outcome },
				);
			}

			const feedbackBlock = feedback
				? `\n\nUser feedback:\n${feedback}`
				: "\n\nNo additional feedback was provided — revise the plan and call exit_plan_mode again when ready.";
			return textResult(
				`The user requested changes. Stay in plan mode, update ${PLAN_FILE_RELATIVE}, then call exit_plan_mode again.${feedbackBlock}`,
				{ outcome: "cancelled", feedback },
			);
		},
	});
}
