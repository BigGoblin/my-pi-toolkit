import type {
	ExtensionAPI,
	SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { CreatedSubtask, SubtaskPlan, TapdItemKind } from "../types.js";

/** TAPD 会话关联 custom entry 类型。 */
export const TAPD_SESSION_STATE_TYPE = "tapd-session-link";

/** 会话级 TAPD 状态快照（每次修改追加完整快照，读取最后一条）。 */
export interface TapdSessionState {
	version: 1;
	workspaceId: string;
	itemId: string;
	kind: TapdItemKind;
	itemName: string;
	createdAt: string;
	title?: string;
	projectPaths?: string[];
	understandingFile?: string;
	subtaskPlan?: SubtaskPlan;
	subtasks?: CreatedSubtask[];
	updatedAt: string;
}

/** 校验 custom entry 中的 TAPD 状态，忽略未知版本或损坏记录。 */
export function isValidTapdSessionState(
	value: unknown,
): value is TapdSessionState {
	if (!value || typeof value !== "object") return false;
	const s = value as Record<string, unknown>;
	return (
		s.version === 1 &&
		typeof s.workspaceId === "string" &&
		typeof s.itemId === "string" &&
		(s.kind === "story" || s.kind === "bug") &&
		typeof s.itemName === "string" &&
		typeof s.createdAt === "string" &&
		typeof s.updatedAt === "string"
	);
}

/** 从会话 entries 中取最后一条合法 TAPD 状态。 */
export function readTapdSessionState(
	entries: readonly SessionEntry[],
): TapdSessionState | undefined {
	let latest: TapdSessionState | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== TAPD_SESSION_STATE_TYPE)
			continue;
		if (isValidTapdSessionState(entry.data)) latest = entry.data;
	}
	return latest;
}

/** 向当前会话写入 TAPD 状态快照。 */
export function appendTapdSessionState(
	pi: ExtensionAPI,
	state: TapdSessionState,
): void {
	pi.appendEntry(TAPD_SESSION_STATE_TYPE, state);
}

/** 向指定 SessionManager（例如 legacy 迁移的目标会话）写入状态快照。 */
export function appendTapdSessionStateTo(
	sm: SessionManager,
	state: TapdSessionState,
): void {
	sm.appendCustomEntry(TAPD_SESSION_STATE_TYPE, state);
}
