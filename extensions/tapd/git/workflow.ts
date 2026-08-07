import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { TapdConfig } from "../types.js";
import { currentTapdObject, parseKeyword } from "./context.js";
import { branchPrefix, DEFAULT_GIT_WORKFLOW_POLICY } from "./policy.js";
import {
	createBranch,
	git,
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
import type { GitWorkingCancel } from "./working-cancel.js";

export { runCommitPush } from "./commit-workflow.js";

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
	cancel?: GitWorkingCancel,
): Promise<string> {
	const total = 8;
	const signal = cancel?.signal;
	reportProgress?.({ step: 1, total, message: "正在读取关联 TAPD 事项" });
	cancel?.throwIfAborted();
	const object = currentTapdObject(ctx);
	reportProgress?.({
		step: 2,
		total,
		message: "正在定位 Git 仓库并检查工作区",
	});
	const repository = await readRepositoryState(ctx.cwd);
	const root = repository.root;
	cancel?.throwIfAborted();
	reportProgress?.({ step: 3, total, message: `正在检查基础分支 ${baseRef}` });
	if (!(await refExists(root, baseRef)))
		throw new Error(`基础分支不存在: ${baseRef}`);
	reportProgress?.({ step: 4, total, message: "正在从 TAPD 获取 keyword" });
	const keyword = parseKeyword(
		await fetchCommitKeyword(config, object),
		object,
	);
	cancel?.throwIfAborted();

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
		await createBranch(root, branch, baseRef, signal);
		result = `已从 ${baseRef} 创建分支 ${branch}（未设置 upstream）`;
	} else {
		reportProgress?.({
			step: 6,
			total,
			message: "工作区有未提交改动，等待选择迁移方式...",
		});
		cancel?.suspend();
		let intent: Awaited<ReturnType<typeof promptBranchConflictResolution>>;
		try {
			intent = await promptBranchConflictResolution(ctx, {
				currentBranch,
				targetBranch: branch,
				baseRef,
			});
		} finally {
			cancel?.resume("Working...");
		}
		cancel?.throwIfAborted();
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

	cancel?.throwIfAborted();
	reportProgress?.({ step: 8, total, message: "正在同步会话绑定分支..." });
	const head = await git(root, ["rev-parse", "--short", "HEAD"], signal);
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
