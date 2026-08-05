import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { UI_GLYPHS } from "../../shared/tui/visual-language.js";
import {
	cherryPick,
	commitAll,
	createBranch,
	createBranchFromHead,
	popStash,
	stashAll,
} from "./repository.js";
import type { GitCommandProgressReporter } from "./types.js";

/** 工作区有未提交改动时，创建 TAPD 分支前的迁移意图。 */
export type BranchConflictIntent =
	| "stash"
	| "commit"
	| "current-head"
	| "cancel";

/** 选择器标题所需的上下文信息。 */
export interface BranchConflictContext {
	currentBranch: string;
	targetBranch: string;
	baseRef: string;
}

/**
 * 打开迁移方式选择器。无交互 UI 时抛出可操作错误，
 * 不擅自选择会改写 Git 状态的默认方案。
 */
export async function promptBranchConflictResolution(
	ctx: ExtensionCommandContext,
	context: BranchConflictContext,
): Promise<BranchConflictIntent> {
	if (!ctx.hasUI)
		throw new Error(
			"工作区有未提交改动且当前环境无交互界面，无法选择迁移方式：" +
				"请先提交（git add --all && git commit）、stash（git stash push --include-untracked）" +
				"或清理改动后重试 /tapd branch",
		);
	const choice = await ctx.ui.select(
		`工作区有未提交改动：如何迁移到 ${context.targetBranch}？（当前分支 ${context.currentBranch}，基础分支 ${context.baseRef}）`,
		[
			`${UI_GLYPHS.action} stash 全部改动并迁移到 ${context.targetBranch}（推荐，含未跟踪文件）`,
			`${UI_GLYPHS.action} 创建 WIP commit 并 cherry-pick 到 ${context.targetBranch}`,
			`${UI_GLYPHS.action} 从当前 HEAD 创建 ${context.targetBranch}（不再基于 ${context.baseRef}）`,
			"取消",
		],
	);
	if (!choice) return "cancel";
	if (choice.startsWith(`${UI_GLYPHS.action} stash`)) return "stash";
	if (choice.startsWith(`${UI_GLYPHS.action} 创建 WIP`)) return "commit";
	if (choice.startsWith(`${UI_GLYPHS.action} 从当前 HEAD`))
		return "current-head";
	return "cancel";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** stash 迁移：stash → 创建目标分支 → pop 恢复。 */
export async function migrateViaStash(
	root: string,
	currentBranch: string,
	targetBranch: string,
	baseRef: string,
	total: number,
	reportProgress?: GitCommandProgressReporter,
): Promise<string> {
	reportProgress?.({
		step: 7,
		total,
		message: "正在 stash 工作区改动（含未跟踪文件）...",
	});
	const stashRef = await stashAll(
		root,
		`tapd branch: ${currentBranch} -> ${targetBranch}`,
	);
	reportProgress?.({
		step: 7,
		total,
		message: `改动已保存到 stash（${stashRef}），正在创建分支 ${targetBranch}...`,
	});
	try {
		await createBranch(root, targetBranch, baseRef);
	} catch (error) {
		throw new Error(
			`创建分支失败：${errorMessage(error)}\n\n` +
				`改动已保存到 stash（${stashRef}）且未自动恢复；` +
				`请解决分支创建问题后执行 git stash apply ${stashRef} 恢复改动。`,
		);
	}
	reportProgress?.({
		step: 7,
		total,
		message: `正在从 stash（${stashRef}）恢复改动到 ${targetBranch}...`,
	});
	try {
		await popStash(root, stashRef);
	} catch (error) {
		throw new Error(
			`stash pop 出现冲突：${errorMessage(error)}\n\n` +
				`当前已位于 ${targetBranch}，冲突改动保留在工作区，请解决冲突后继续；` +
				`stash 条目未被成功删除时仍可在 git stash list 找到（git stash apply ${stashRef} 可重新应用）。`,
		);
	}
	return (
		`已从 ${baseRef} 创建分支 ${targetBranch}（未设置 upstream），` +
		`原改动已从 stash（${stashRef}）恢复到新分支`
	);
}

/** WIP commit 迁移：提交全部改动 → 创建目标分支 → cherry-pick。 */
export async function migrateViaWipCommit(
	root: string,
	currentBranch: string,
	targetBranch: string,
	baseRef: string,
	total: number,
	reportProgress?: GitCommandProgressReporter,
): Promise<string> {
	let wipCommit: string;
	try {
		wipCommit = await commitAll(
			root,
			`chore: WIP before creating ${targetBranch}`,
			(phase) => {
				reportProgress?.({
					step: 7,
					total,
					message:
						phase === "stage"
							? "正在暂存工作区改动（git add --all）..."
							: "正在创建 WIP commit；Git hooks 可能需要一些时间...",
				});
			},
		);
	} catch (error) {
		throw new Error(
			`创建 WIP commit 失败：${errorMessage(error)}\n\n` +
				"未创建目标分支；暂存区与工作区改动保留原状，请处理失败原因后重试。",
		);
	}
	reportProgress?.({
		step: 7,
		total,
		message: `WIP commit ${wipCommit} 已创建，正在创建分支 ${targetBranch}...`,
	});
	try {
		await createBranch(root, targetBranch, baseRef);
	} catch (error) {
		throw new Error(
			`创建分支失败：${errorMessage(error)}\n\n` +
				`WIP commit ${wipCommit} 已保留在分支 ${currentBranch}，未自动回滚；` +
				"如需撤销可自行执行 git reset --soft HEAD~1。",
		);
	}
	reportProgress?.({
		step: 7,
		total,
		message: `正在 cherry-pick ${wipCommit} 到 ${targetBranch}...`,
	});
	try {
		await cherryPick(root, wipCommit);
	} catch (error) {
		throw new Error(
			`cherry-pick 出现冲突：${errorMessage(error)}\n\n` +
				`当前位于 ${targetBranch}，处于 cherry-pick 冲突状态；` +
				"请解决冲突后执行 git cherry-pick --continue，或放弃迁移执行 git cherry-pick --abort。",
		);
	}
	return (
		`已从 ${baseRef} 创建分支 ${targetBranch}（未设置 upstream），` +
		`WIP commit ${wipCommit} 已 cherry-pick 到新分支（原分支保留该 commit）`
	);
}

/** current-head 迁移：从当前 HEAD 创建目标分支，保留未提交改动。 */
export async function migrateFromCurrentHead(
	root: string,
	targetBranch: string,
	baseRef: string,
	total: number,
	reportProgress?: GitCommandProgressReporter,
): Promise<string> {
	reportProgress?.({
		step: 7,
		total,
		message: `正在从当前 HEAD 创建分支 ${targetBranch}（保留未提交改动）...`,
	});
	await createBranchFromHead(root, targetBranch);
	return (
		`已从当前 HEAD 创建分支 ${targetBranch}（未设置 upstream，未基于 ${baseRef}），` +
		"未提交改动已保留在新分支"
	);
}
