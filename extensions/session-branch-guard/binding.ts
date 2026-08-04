import type {
	ExtensionAPI,
	SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { normalizeRepoPath } from "./git.js";
import {
	BINDING_ENTRY_TYPE,
	type BindingSource,
	type GitContext,
	type SessionBranchBinding,
} from "./types.js";

/** 校验 custom entry 中的 binding 数据，忽略未知版本或损坏记录。 */
export function isValidBinding(value: unknown): value is SessionBranchBinding {
	if (!value || typeof value !== "object") return false;
	const b = value as Record<string, unknown>;
	return (
		b.version === 1 &&
		typeof b.repoRoot === "string" &&
		b.repoRoot.length > 0 &&
		typeof b.gitBranch === "string" &&
		b.gitBranch.length > 0 &&
		typeof b.boundAt === "string" &&
		(b.source === "created" || b.source === "adopted" || b.source === "rebound")
	);
}

/** 从会话 entries 中取文件顺序最后一条合法 binding。 */
export function readBinding(
	entries: readonly SessionEntry[],
): SessionBranchBinding | undefined {
	let latest: SessionBranchBinding | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== BINDING_ENTRY_TYPE)
			continue;
		if (isValidBinding(entry.data)) latest = entry.data;
	}
	return latest;
}

/** 基于当前 Git 上下文创建新 binding。 */
export function createBinding(
	gitContext: GitContext,
	source: BindingSource,
): SessionBranchBinding {
	if (!gitContext.repoRoot || !gitContext.branch)
		throw new Error("无法在非 Git 仓库或 detached HEAD 上创建分支绑定");
	return {
		version: 1,
		repoRoot: normalizeRepoPath(gitContext.repoRoot),
		gitBranch: gitContext.branch,
		head: gitContext.head,
		boundAt: new Date().toISOString(),
		source,
	};
}

/** 向当前会话写入 binding。 */
export function appendBindingCurrent(
	pi: ExtensionAPI,
	binding: SessionBranchBinding,
): void {
	pi.appendEntry(BINDING_ENTRY_TYPE, binding);
}

/** 向目标（尚未激活的）会话写入 binding；写入会持久化到其 JSONL。 */
export function appendBindingTarget(
	target: SessionManager,
	binding: SessionBranchBinding,
): void {
	target.appendCustomEntry(BINDING_ENTRY_TYPE, binding);
}
