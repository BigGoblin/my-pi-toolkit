import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	appendTapdSessionState,
	readTapdSessionState,
	type TapdSessionState,
} from "../sessions/session-state.js";

/** 读取当前会话的 TAPD 状态快照。 */
export function readSubtaskState(
	ctx: ExtensionCommandContext,
): TapdSessionState | undefined {
	return readTapdSessionState(ctx.sessionManager.getEntries());
}

/**
 * 以 append-only 方式更新当前会话的 TAPD 状态：克隆最后一条快照、
 * 应用 mutate、追加快照并返回新状态。写入失败时抛出错误。
 */
export function updateSubtaskState(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	mutate: (state: TapdSessionState) => void,
): TapdSessionState {
	const base = readSubtaskState(ctx);
	if (!base) throw new Error("当前会话没有关联 TAPD 需求状态");
	const next: TapdSessionState = {
		...base,
		subtaskPlan: base.subtaskPlan ? { ...base.subtaskPlan } : undefined,
		subtasks: base.subtasks ? [...base.subtasks] : undefined,
		updatedAt: new Date().toISOString(),
	};
	mutate(next);
	appendTapdSessionState(pi, next);
	return next;
}
