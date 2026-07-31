import { PLAN_FILE_RELATIVE } from "./paths.js";
import { EXIT_PLAN_TOOL } from "./plan-file.js";
import type { PlanReminderKind } from "./plan-lifecycle.js";

export const ASK_MODE_PROMPT = `[ASK MODE]

You are in question-and-answer mode.

- Answer, explain, inspect, diagnose, and research.
- Do not modify project files outside the project-local .pi directory.
- Do not attempt to bypass this restriction through shell commands or other tools.
- If the user requests implementation or another restricted action, tell them to press Alt+M to switch to Build mode.
- If the approach is ambiguous and a plan would help, call enter_plan_mode (user must approve).`;

/** Preferred plan.md body structure (Pi addition on top of Grok reminders). */
export const PLAN_FILE_STRUCTURE = `Prefer this structure in ${PLAN_FILE_RELATIVE}:

## Context
Why the change is needed.

## Approach
The recommended approach (not every alternative).

## Critical files
Paths that must change, plus existing helpers to reuse.

## Verification
How to test the change end to end.`;

/**
 * Reminder text adapted from Grok Build plan_mode.rs templates
 * (full / sparse / reentry / exit).
 */
export function planReminderText(
	kind: PlanReminderKind,
	planHasContent: boolean,
): string {
	if (kind === "exit") {
		return "You have exited plan mode. You can now make edits, run tools, and take actions.";
	}
	if (kind === "sparse") {
		return "Plan mode is still active. Do not make any edits or writes to the system except for the plan file.";
	}
	if (kind === "reentry") {
		return [
			"## Returning to Plan Mode",
			"",
			`You are entering plan mode again after having previously exited it. A plan file exists at ${PLAN_FILE_RELATIVE} from your previous planning session.`,
			"",
			`Your turn should only end with either clarifying questions for the user or ${EXIT_PLAN_TOOL} to present your plan to the user.`,
		].join("\n");
	}

	const planFileBlock = planHasContent
		? `A plan file exists at ${PLAN_FILE_RELATIVE}. You can read it and make edits using the edit tool.`
		: `No plan written yet. Write your plan to ${PLAN_FILE_RELATIVE} using the write or edit tool.`;

	return [
		"Plan mode is active. Do not make any edits or writes to the system.",
		"",
		"## Plan File:",
		planFileBlock,
		"",
		"You should build your plan by writing to or editing this file. Note that this is the only file you are allowed to edit.",
		"",
		PLAN_FILE_STRUCTURE,
		"",
		`Your turn should only end with either clarifying questions for the user or ${EXIT_PLAN_TOOL} to present your plan to the user.`,
	].join("\n");
}
