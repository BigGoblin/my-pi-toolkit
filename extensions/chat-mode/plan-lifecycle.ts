/**
 * Plan-mode lifecycle tracker adapted from Grok Build's PlanModeTracker
 * (xai-grok-shell/src/session/plan_mode.rs): reminder alternation, reentry,
 * and one-shot exit reminder after user-initiated leave.
 */

export interface PlanLifecycleSnapshot {
	wasPreviouslyActive: boolean;
	reminderCount: number;
	pendingExitReminder: boolean;
}

let wasPreviouslyActive = false;
let reminderCount = 0;
let pendingExitReminder = false;

export function getPlanLifecycleSnapshot(): PlanLifecycleSnapshot {
	return { wasPreviouslyActive, reminderCount, pendingExitReminder };
}

export function restorePlanLifecycle(snapshot: Partial<PlanLifecycleSnapshot> | undefined): void {
	wasPreviouslyActive = snapshot?.wasPreviouslyActive ?? false;
	reminderCount = snapshot?.reminderCount ?? 0;
	pendingExitReminder = snapshot?.pendingExitReminder ?? false;
}

export function resetPlanLifecycle(): void {
	wasPreviouslyActive = false;
	reminderCount = 0;
	pendingExitReminder = false;
}

/** Call when entering plan (user toggle, /plan, or enter_plan_mode). */
export function onEnterPlan(): void {
	pendingExitReminder = false;
	reminderCount = 0;
}

/**
 * Call when leaving plan.
 * @param viaToolApproval - true for exit_plan_mode approved/abandoned (tool
 *   result already signals the model). false for Alt+M / mode cycle (arm exit reminder).
 */
export function onLeavePlan(viaToolApproval: boolean): void {
	wasPreviouslyActive = true;
	reminderCount = 0;
	pendingExitReminder = !viaToolApproval;
}

export type PlanReminderKind = "full" | "sparse" | "reentry" | "exit";

/**
 * Pick the reminder for the upcoming agent turn.
 * Mirrors Grok inject_plan_mode_reminders ordering: exit first when armed,
 * else Active-state full/sparse/reentry with alternating count.
 */
export function takePlanReminder(inPlan: boolean): PlanReminderKind | undefined {
	if (pendingExitReminder && !inPlan) {
		pendingExitReminder = false;
		return "exit";
	}
	if (!inPlan) return undefined;

	if (wasPreviouslyActive && reminderCount === 0) {
		reminderCount = 1;
		return "reentry";
	}
	const kind: PlanReminderKind = reminderCount % 2 === 0 ? "full" : "sparse";
	reminderCount += 1;
	return kind;
}
