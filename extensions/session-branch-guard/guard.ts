import { normalizeRepoPath } from "./git.js";
import type {
	GitContext,
	MismatchKind,
	SessionBranchBinding,
} from "./types.js";

/**
 * 纯比较：binding 与当前 Git 上下文是否一致。
 * - 无 binding：视为一致（由生命周期负责创建/adopt）。
 * - 非 Git 目录：视为一致（功能静默禁用）。
 * - repoRoot 不同：repo-differs（branch 同名不能单独判等）。
 * - 当前 detached HEAD：detached。
 * - branch 不同：branch-differs。
 */
export function compareBinding(
	binding: SessionBranchBinding | undefined,
	gitContext: GitContext,
): MismatchKind {
	if (!binding) return "same";
	if (!gitContext.isRepo || !gitContext.repoRoot) return "same";
	if (
		normalizeRepoPath(gitContext.repoRoot) !==
		normalizeRepoPath(binding.repoRoot)
	)
		return "repo-differs";
	if (!gitContext.branch) return "detached";
	if (gitContext.branch !== binding.gitBranch) return "branch-differs";
	return "same";
}
