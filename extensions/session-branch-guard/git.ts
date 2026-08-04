import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DirtySummary, GitContext } from "./types.js";

/** 平台无关的仓库路径规范化（Windows 处理盘符/大小写）。 */
export function normalizeRepoPath(path: string): string {
	const normalized = resolve(path);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** 读取当前工作区 Git 上下文；非 Git 目录返回 isRepo=false。 */
export async function readGitContext(
	pi: ExtensionAPI,
	cwd: string,
): Promise<GitContext> {
	const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
		cwd,
	});
	if (rootResult.code !== 0) return { isRepo: false };
	const repoRoot = rootResult.stdout.trim();
	if (!repoRoot) return { isRepo: false };

	const [branchResult, headResult] = await Promise.all([
		pi.exec("git", ["branch", "--show-current"], { cwd: repoRoot }),
		pi.exec("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }),
	]);
	const branch =
		branchResult.code === 0 && branchResult.stdout.trim()
			? branchResult.stdout.trim()
			: undefined;
	const head =
		headResult.code === 0 && headResult.stdout.trim()
			? headResult.stdout.trim()
			: undefined;
	return { isRepo: true, repoRoot, branch, head };
}

/** 统计 dirty 状态，区分 staged/unstaged/untracked，不泄露文件路径。 */
export async function readDirtySummary(
	pi: ExtensionAPI,
	repoRoot: string,
): Promise<DirtySummary> {
	const result = await pi.exec(
		"git",
		["status", "--porcelain", "--untracked-files=normal"],
		{ cwd: repoRoot },
	);
	const empty: DirtySummary = {
		staged: 0,
		unstaged: 0,
		untracked: 0,
		total: 0,
	};
	if (result.code !== 0) return empty;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of result.stdout.split("\n")) {
		if (!line.trim()) continue;
		if (line.startsWith("??")) {
			untracked += 1;
			continue;
		}
		if (line[0] !== " " && line[0] !== "?") staged += 1;
		if (line[1] !== " " && line[1] !== "?") unstaged += 1;
	}
	return { staged, unstaged, untracked, total: staged + unstaged + untracked };
}

/** 检查本地分支是否存在。 */
export async function branchExists(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
): Promise<boolean> {
	const result = await pi.exec(
		"git",
		["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
		{ cwd: repoRoot },
	);
	return result.code === 0;
}

/** 普通 switch，绝不使用 --force / reset / clean。 */
export async function switchBranch(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
): Promise<{ ok: boolean; error?: string }> {
	const result = await pi.exec("git", ["switch", branch], { cwd: repoRoot });
	if (result.code !== 0)
		return {
			ok: false,
			error: result.stderr.trim() || `git switch ${branch} 失败`,
		};
	return { ok: true };
}

/** stash 全部改动（含 untracked），成功后返回 stash 短哈希。 */
export async function stashWorkspace(
	pi: ExtensionAPI,
	repoRoot: string,
	message: string,
): Promise<{ ok: boolean; ref?: string; error?: string }> {
	const result = await pi.exec(
		"git",
		["stash", "push", "--include-untracked", "-m", message],
		{ cwd: repoRoot },
	);
	if (result.code !== 0)
		return {
			ok: false,
			error: result.stderr.trim() || "git stash 失败",
		};
	const refResult = await pi.exec("git", ["rev-parse", "--short", "stash"], {
		cwd: repoRoot,
	});
	return {
		ok: true,
		ref: refResult.code === 0 ? refResult.stdout.trim() : undefined,
	};
}

/** 截断 git stderr 用于展示，避免长输出撑破 UI。 */
export function summarizeError(error: string, maxLength = 300): string {
	const cleaned = error.replace(/\s+/g, " ").trim();
	if (cleaned.length <= maxLength) return cleaned;
	return `${cleaned.slice(0, maxLength)}…`;
}
