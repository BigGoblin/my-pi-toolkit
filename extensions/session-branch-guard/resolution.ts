import type {
	ExtensionAPI,
	ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { appendBindingTarget, createBinding } from "./binding.js";
import {
	branchExists,
	normalizeRepoPath,
	readDirtySummary,
	stashWorkspace,
	summarizeError,
	switchBranch,
} from "./git.js";
import type {
	GitContext,
	ResolutionOutcome,
	SessionBranchBinding,
} from "./types.js";
import { confirmRebind, promptDirtySwitch, promptTopLevel } from "./ui.js";

export interface RebindWriter {
	/** 将 rebind 后的 binding 写入目标位置（当前会话或目标会话）。 */
	write(binding: SessionBranchBinding): void;
}

/** 目标会话写入器（session_before_switch 场景）。 */
export function targetRebindWriter(target: SessionManager): RebindWriter {
	return { write: (binding) => appendBindingTarget(target, binding) };
}

function stashMessage(currentBranch: string, targetBranch: string): string {
	return `pi session: switch ${currentBranch} -> ${targetBranch}`;
}

async function attemptSwitch(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	gitContext: GitContext,
	targetBranch: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!gitContext.repoRoot) return { ok: false, error: "缺少仓库根路径" };
	const repoRoot = gitContext.repoRoot;
	const dirty = await readDirtySummary(pi, repoRoot);
	if (dirty.total === 0) {
		const result = await switchBranch(pi, repoRoot, targetBranch);
		if (!result.ok) {
			ctx.ui.notify(`切换失败：${summarizeError(result.error ?? "")}`, "error");
			return { ok: false, error: result.error ?? "git switch 失败" };
		}
		ctx.ui.notify(`已切回会话分支 ${targetBranch}`, "success");
		return { ok: true };
	}

	// dirty：先让用户选择 stash / 直接尝试 / 取消
	const intent = await promptDirtySwitch(
		ctx,
		targetBranch,
		gitContext.branch ?? "",
		dirty,
	);
	if (intent === "cancel") return { ok: false, error: "已取消" };

	if (intent === "stash") {
		const stash = await stashWorkspace(
			pi,
			repoRoot,
			stashMessage(gitContext.branch ?? "", targetBranch),
		);
		if (!stash.ok) {
			const error = summarizeError(stash.error ?? "");
			ctx.ui.notify(`stash 失败，未切换分支：${error}`, "error");
			return { ok: false, error };
		}
		const afterStash = await readDirtySummary(pi, repoRoot);
		if (afterStash.total > 0) {
			ctx.ui.notify(
				`stash 后仍有 ${afterStash.total} 处改动残留，已中止切换；改动保留在 stash (${stash.ref ?? "见 git stash list"})`,
				"error",
			);
			return { ok: false, error: "stash 后工作区仍有残留改动" };
		}
		const result = await switchBranch(pi, repoRoot, targetBranch);
		if (!result.ok) {
			ctx.ui.notify(
				`stash 已保存 (${stash.ref ?? "见 git stash list"})，但切换分支失败：${summarizeError(result.error ?? "")}。当前仍停留在原分支，可用 git stash list / git stash apply 恢复`,
				"error",
			);
			return { ok: false, error: result.error ?? "git switch 失败" };
		}
		ctx.ui.notify(
			`已切回 ${targetBranch}；原改动已 stash (${stash.ref ?? "见 git stash list"})，恢复请执行 git stash apply ${stash.ref ?? "<ref>"}`,
			"success",
		);
		return { ok: true };
	}

	// direct：普通 switch，让 Git 决定能否携带改动
	const result = await switchBranch(pi, repoRoot, targetBranch);
	if (!result.ok) {
		ctx.ui.notify(
			`直接切换失败（改动可能冲突）：${summarizeError(result.error ?? "")}。未对工作区做任何处理`,
			"error",
		);
		return { ok: false, error: result.error ?? "git switch 失败" };
	}
	ctx.ui.notify(
		`已切回会话分支 ${targetBranch}（原改动保留在工作区）`,
		"success",
	);
	return { ok: true };
}

/**
 * 分支不一致时的完整解决状态机：
 * 1. 顶层三选一（切回 / 留在当前并 rebind / 取消）；
 * 2. 切回且 dirty 时第二层三选一（stash / 直接尝试 / 取消）；
 * 3. rebind 需要二次确认。
 * 失败时返回结构化错误，不推进会话切换。
 */
export async function resolveBranchMismatch(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	binding: SessionBranchBinding,
	gitContext: GitContext,
	writer: RebindWriter,
): Promise<ResolutionOutcome> {
	if (!gitContext.isRepo || !gitContext.repoRoot) {
		const error = "当前目录不是 Git 仓库，无法解决分支不匹配";
		ctx.ui.notify(error, "error");
		return { kind: "failed", error };
	}
	if (!gitContext.branch) {
		const error = "当前处于 detached HEAD，请先手动切换到一个分支，再继续";
		ctx.ui.notify(error, "warning");
		return { kind: "failed", error };
	}
	if (
		normalizeRepoPath(gitContext.repoRoot) !==
		normalizeRepoPath(binding.repoRoot)
	) {
		const error = "会话绑定的是另一个仓库，无法在当前目录恢复";
		ctx.ui.notify(error, "warning");
		return { kind: "failed", error };
	}

	const dirty = await readDirtySummary(pi, gitContext.repoRoot);
	const intent = await promptTopLevel(ctx, binding, gitContext.branch, dirty);
	if (intent === "cancel") return { kind: "cancelled" };

	if (intent === "rebind") {
		const ok = await confirmRebind(ctx, binding, gitContext.branch);
		if (!ok) return { kind: "cancelled" };
		const rebound = createBinding(gitContext, "rebound");
		try {
			writer.write(rebound);
		} catch (error) {
			const message = `重新绑定持久化失败：${error instanceof Error ? error.message : String(error)}`;
			ctx.ui.notify(message, "error");
			return { kind: "failed", error: message };
		}
		ctx.ui.notify(`会话已重新绑定到当前分支 ${gitContext.branch}`, "success");
		return { kind: "rebound", branch: gitContext.branch };
	}

	// switch 路径
	const exists = await branchExists(pi, gitContext.repoRoot, binding.gitBranch);
	if (!exists) {
		ctx.ui.notify(
			`会话绑定分支 ${binding.gitBranch} 已不存在（可能被删除或重命名），请改用 /session-branch rebind 绑定当前分支`,
			"warning",
		);
		return { kind: "failed", error: `分支不存在: ${binding.gitBranch}` };
	}
	const switched = await attemptSwitch(pi, ctx, gitContext, binding.gitBranch);
	if (!switched.ok) return { kind: "failed", error: switched.error };
	return { kind: "switched", toBranch: binding.gitBranch };
}
