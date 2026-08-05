import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { TapdConfig } from "../types.js";
import { currentTapdObject, parseKeyword } from "./context.js";
import {
	branchPrefix,
	commitPrefix,
	DEFAULT_GIT_WORKFLOW_POLICY,
} from "./policy.js";
import {
	commitAll,
	createBranch,
	git,
	pushCurrentBranch,
	readRepositoryState,
	refExists,
} from "./repository.js";
import { fetchCommitKeyword } from "./tapd-api.js";
import { syncSessionBinding } from "./session-binding.js";
import {
	migrateFromCurrentHead,
	migrateViaStash,
	migrateViaWipCommit,
	promptBranchConflictResolution,
} from "./branch-resolution.js";
import type { GitCommandProgressReporter } from "./types.js";

export async function describeGitStatus(
	ctx: ExtensionCommandContext,
): Promise<string> {
	const [object, repository] = await Promise.all([
		Promise.resolve(currentTapdObject(ctx)),
		readRepositoryState(ctx.cwd, false),
	]);
	return [
		`TAPD: ${object.kind} ${object.objectId}${object.name ? ` - ${object.name}` : ""}`,
		`仓库: ${repository.root}`,
		`分支: ${repository.branch || "(detached)"}`,
		`upstream: ${repository.upstream ?? "未设置"}`,
		`工作区: ${repository.dirty ? "有改动" : "干净"}`,
		`origin: ${repository.originUrl}`,
	].join("\n");
}

export async function runCreateBranch(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	baseRef = DEFAULT_GIT_WORKFLOW_POLICY.baseRef,
	reportProgress?: GitCommandProgressReporter,
): Promise<string> {
	const total = 8;
	reportProgress?.({ step: 1, total, message: "正在读取关联 TAPD 事项" });
	const object = currentTapdObject(ctx);
	reportProgress?.({
		step: 2,
		total,
		message: "正在定位 Git 仓库并检查工作区",
	});
	const repository = await readRepositoryState(ctx.cwd);
	const root = repository.root;
	reportProgress?.({ step: 3, total, message: `正在检查基础分支 ${baseRef}` });
	if (!(await refExists(root, baseRef)))
		throw new Error(`基础分支不存在: ${baseRef}`);
	reportProgress?.({ step: 4, total, message: "正在从 TAPD 获取 keyword" });
	const keyword = parseKeyword(
		await fetchCommitKeyword(config, object),
		object,
	);

	const branch = `${branchPrefix(keyword.kind)}/${keyword.shortId}`;
	reportProgress?.({ step: 5, total, message: `正在检查目标分支 ${branch}` });
	if (await refExists(root, `refs/heads/${branch}`))
		throw new Error(`本地分支已存在: ${branch}`);

	const currentBranch = repository.branch || "(detached)";
	let result: string;
	if (!repository.dirty) {
		reportProgress?.({
			step: 6,
			total,
			message: "工作区干净，无需迁移改动",
		});
		reportProgress?.({ step: 7, total, message: `正在创建分支 ${branch}` });
		await createBranch(root, branch, baseRef);
		result = `已从 ${baseRef} 创建分支 ${branch}（未设置 upstream）`;
	} else {
		reportProgress?.({
			step: 6,
			total,
			message: "工作区有未提交改动，等待选择迁移方式...",
		});
		const intent = await promptBranchConflictResolution(ctx, {
			currentBranch,
			targetBranch: branch,
			baseRef,
		});
		if (intent === "cancel")
			return `已取消：未创建分支 ${branch}，工作区改动保持不变`;
		if (intent === "stash")
			result = await migrateViaStash(
				root,
				currentBranch,
				branch,
				baseRef,
				total,
				reportProgress,
			);
		else if (intent === "commit")
			result = await migrateViaWipCommit(
				root,
				currentBranch,
				branch,
				baseRef,
				total,
				reportProgress,
			);
		else
			result = await migrateFromCurrentHead(
				root,
				branch,
				baseRef,
				total,
				reportProgress,
			);
	}

	reportProgress?.({ step: 8, total, message: "正在同步会话绑定分支..." });
	const head = await git(root, ["rev-parse", "--short", "HEAD"]);
	if (await syncSessionBinding(pi, ctx, { repoRoot: root, branch, head })) {
		reportProgress?.({
			step: 8,
			total,
			message: `会话绑定已切换为 ${branch}`,
		});
		return `${result}；会话绑定已切换为 ${branch}`;
	}
	return result;
}

async function commitWithHookBypassOption(
	ctx: ExtensionCommandContext,
	root: string,
	subject: string,
	total: number,
	reportProgress?: GitCommandProgressReporter,
): Promise<string> {
	let commitStarted = false;
	try {
		return await commitAll(root, subject, (phase) => {
			if (phase === "commit") commitStarted = true;
			reportProgress?.({
				step: phase === "stage" ? 4 : 5,
				total,
				message:
					phase === "stage"
						? "正在暂存工作区改动（git add --all）..."
						: "正在创建 commit；Git hooks 可能需要一些时间...",
			});
		});
	} catch (error) {
		if (!commitStarted) throw error;
		const message = error instanceof Error ? error.message : String(error);
		reportProgress?.({
			step: 5,
			total,
			message: "Commit 失败，等待确认是否跳过 Git hooks...",
			detail: message,
		});
		const skipHooks = await ctx.ui.confirm(
			"Commit 失败",
			`${message}\n\n是否使用 git commit --no-verify 跳过 pre-commit 等 Git hooks 后重试？这会绕过提交校验。`,
		);
		if (!skipHooks) throw error;
		return commitAll(
			root,
			subject,
			(phase) => {
				reportProgress?.({
					step: phase === "stage" ? 4 : 5,
					total,
					message:
						phase === "stage"
							? "正在重新暂存 Git hook 可能产生的改动..."
							: "正在使用 --no-verify 重新创建 commit...",
				});
			},
			true,
		);
	}
}

export async function runCommitPush(
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	noPush: boolean,
	reportProgress?: GitCommandProgressReporter,
): Promise<string> {
	const total = noPush ? 5 : 6;
	reportProgress?.({
		step: 1,
		total,
		message: "正在检查 Git 仓库和待提交文件...",
	});
	const object = currentTapdObject(ctx);
	const repository = await readRepositoryState(ctx.cwd);
	if (!repository.dirty) throw new Error("检查仓库失败：没有可提交的改动");
	reportProgress?.({
		step: 2,
		total,
		message: "正在从 TAPD 获取 commit keyword...",
	});
	const keyword = parseKeyword(
		await fetchCommitKeyword(config, object),
		object,
	);
	const subject = `${commitPrefix(keyword.kind)}: ${keyword.keyword}`;
	reportProgress?.({ step: 3, total, message: "等待确认提交信息..." });
	const confirmed = await ctx.ui.confirm(
		"提交预览",
		`${subject}\n\n${noPush ? "只提交，不推送" : "提交后推送当前分支"}`,
	);
	if (!confirmed) throw new Error("用户取消提交");
	const hash = await commitWithHookBypassOption(
		ctx,
		repository.root,
		subject,
		total,
		reportProgress,
	);
	if (!noPush) {
		reportProgress?.({
			step: 6,
			total,
			message: `正在推送 ${repository.branch} 到 origin；可能等待网络或 SSH 验证...`,
		});
		await pushCurrentBranch(repository.root, Boolean(repository.upstream));
	}
	return `${hash} ${subject}\n${noPush ? "未推送" : `已推送 ${repository.branch}`}`;
}
