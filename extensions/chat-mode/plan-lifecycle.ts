/** Grok-inspired, session-scoped Plan Mode lifecycle and reminder tracker. */

export type PlanModeState = "inactive" | "pending" | "active";

export interface PlanLifecycleSnapshot {
	version?: 1;
	state?: PlanModeState;
	wasPreviouslyActive: boolean;
	reminderCount: number;
	pendingExitReminder: boolean;
}

let state: PlanModeState = "inactive";
let wasPreviouslyActive = false;
let reminderCount = 0;
let pendingExitReminder = false;

export function getPlanLifecycleSnapshot(): PlanLifecycleSnapshot {
	return {
		version: 1,
		state,
		wasPreviouslyActive,
		reminderCount,
		pendingExitReminder,
	};
}

export function restorePlanLifecycle(
	snapshot: Partial<PlanLifecycleSnapshot> | undefined,
): void {
	state =
		snapshot?.state === "pending" || snapshot?.state === "active"
			? snapshot.state
			: "inactive";
	wasPreviouslyActive = snapshot?.wasPreviouslyActive ?? false;
	reminderCount = snapshot?.reminderCount ?? 0;
	pendingExitReminder = snapshot?.pendingExitReminder ?? false;
}

export function resetPlanLifecycle(): void {
	state = "inactive";
	wasPreviouslyActive = false;
	reminderCount = 0;
	pendingExitReminder = false;
}

/** User entry is pending until the next prompt receives its activation reminder. */
export function enterPlanFromUser(): void {
	state = "pending";
	pendingExitReminder = false;
	reminderCount = 0;
}

/** Tool entry is immediately active because the tool result is the entry signal. */
export function enterPlanFromTool(): void {
	state = "active";
	wasPreviouslyActive = true;
	pendingExitReminder = false;
	reminderCount = 0;
}

export function leavePlan(viaToolResult: boolean): void {
	if (state === "inactive") return;
	state = "inactive";
	wasPreviouslyActive = true;
	reminderCount = 0;
	pendingExitReminder = !viaToolResult;
}

export type PlanReminderKind = "full" | "sparse" | "reentry" | "exit";

export function takePlanReminder(inPlan: boolean): PlanReminderKind | undefined {
	if (pendingExitReminder && !inPlan) {
		pendingExitReminder = false;
		return "exit";
	}
	if (!inPlan) return undefined;

	if (state === "pending") {
		const kind: PlanReminderKind = wasPreviouslyActive ? "reentry" : "full";
		state = "active";
		wasPreviouslyActive = true;
		reminderCount = 1;
		return kind;
	}

	if (state === "inactive") {
		// Compatibility for legacy snapshots that persisted mode without state.
		state = "active";
		wasPreviouslyActive = true;
		reminderCount = 1;
		return "full";
	}

	const kind: PlanReminderKind = reminderCount % 2 === 0 ? "full" : "sparse";
	reminderCount += 1;
	return kind;
}

export function resetPlanRemindersAfterCompaction(): void {
	if (state === "active") reminderCount = 0;
}
