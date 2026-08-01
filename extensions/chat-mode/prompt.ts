import { EXIT_PLAN_TOOL } from "./plan-file.js";
import type { PlanReminderKind } from "./plan-lifecycle.js";

export const ASK_MODE_PROMPT = `[ASK MODE]

You are in question-and-answer mode.

- Answer, explain, inspect, diagnose, and research.
- Do not modify project files outside the project-local .pi directory.
- Do not attempt to bypass this restriction through shell commands or other tools.
- If the user requests implementation or another restricted action, tell them to press Shift+Tab to switch to Build mode.
- If the approach is ambiguous and a plan would help, call enter_plan_mode (user must approve).`;

export function planFileStructure(planPath: string): string {
	return `Prefer this structure in ${planPath}:

## Context
Why the change is needed.

## Approach
The recommended approach (not every alternative).

## Critical files
Paths that must change, plus existing helpers to reuse.

## Verification
How to test the change end to end.`;
}

/** Reminder text adapted from Grok Build's PlanModeTracker templates. */
export function planReminderText(
	kind: PlanReminderKind,
	planPath: string,
	planHasContent: boolean,
): string {
	if (kind === "exit") {
		return "You have exited plan mode. You can now make edits, run tools, and take actions.";
	}
	if (kind === "sparse") {
		return "Plan mode is still active. Do not make any edits or writes to the system except for the active plan file.";
	}
	if (kind === "reentry") {
		return [
			"## Returning to Plan Mode",
			"",
			`You are returning to the active draft at ${planPath}. Continue this plan rather than creating or editing another plan file.`,
			"",
			`Your turn should only end with either clarifying questions for the user or ${EXIT_PLAN_TOOL} to present your plan to the user.`,
		].join("\n");
	}

	const planFileBlock = planHasContent
		? `A plan file exists at ${planPath}. You can read it and make edits using the edit tool.`
		: `No plan written yet. Write your plan to ${planPath} using the write or edit tool.`;

	return [
		"Plan mode is active. Do not make any edits or writes to the system.",
		"",
		"## Plan File:",
		planFileBlock,
		"",
		"Build your plan by writing to or editing this file. It is the only file you are allowed to edit.",
		"",
		planFileStructure(planPath),
		"",
		`Your turn should only end with either clarifying questions for the user or ${EXIT_PLAN_TOOL} to present your plan to the user.`,
	].join("\n");
}
