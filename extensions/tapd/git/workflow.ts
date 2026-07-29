import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
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
	pushCurrentBranch,
	readRepositoryRoot,
	readRepositoryState,
	refExists,
} from "./repository.js";
import { fetchCommitKeyword } from "./tapd-api.js";
import type { BranchProgressReporter } from "./types.js";

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
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	baseRef = DEFAULT_GIT_WORKFLOW_POLICY.baseRef,
	reportProgress?: BranchProgressReporter,
): Promise<string> {
	reportProgress?.({
		stage: "tapd-object",
		state: "running",
		message: "正在读取关联 TAPD 事项",
	});
	const object = currentTapdObject(ctx);
	reportProgress?.({
		stage: "tapd-object",
		state: "done",
		message: `已识别 ${object.kind}/${object.objectId}`,
	});

	reportProgress?.({
		stage: "repository",
		state: "running",
		message: "正在定位 Git 仓库",
	});
	const root = await readRepositoryRoot(ctx.cwd);
	reportProgress?.({
		stage: "repository",
		state: "done",
		message: `仓库：${root}`,
	});

	reportProgress?.({
		stage: "base-ref",
		state: "running",
		message: `正在检查基础分支 ${baseRef}`,
	});
	if (!(await refExists(root, baseRef)))
		throw new Error(`基础分支不存在: ${baseRef}`);
	reportProgress?.({
		stage: "base-ref",
		state: "done",
		message: `基础分支可用：${baseRef}`,
	});

	reportProgress?.({
		stage: "keyword",
		state: "running",
		message: "正在从 TAPD 获取 keyword",
	});
	const keyword = parseKeyword(
		await fetchCommitKeyword(config, object),
		object,
	);
	reportProgress?.({
		stage: "keyword",
		state: "done",
		message: `已获取 keyword：${keyword.keyword}`,
	});

	const branch = `${branchPrefix(keyword.kind)}/${keyword.shortId}`;
	reportProgress?.({
		stage: "branch-check",
		state: "running",
		message: `正在检查目标分支 ${branch}`,
	});
	if (await refExists(root, `refs/heads/${branch}`))
		throw new Error(`本地分支已存在: ${branch}`);
	reportProgress?.({
		stage: "branch-check",
		state: "done",
		message: `目标分支可创建：${branch}`,
	});

	reportProgress?.({
		stage: "create-branch",
		state: "running",
		message: `正在创建分支 ${branch}`,
	});
	await createBranch(root, branch, baseRef);
	reportProgress?.({
		stage: "create-branch",
		state: "done",
		message: `已创建分支 ${branch}`,
	});
	return `已从 ${baseRef} 创建分支 ${branch}（未设置 upstream）`;
}

export async function runCommitPush(
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	noPush: boolean,
	reportProgress?: (content: string) => void,
): Promise<string> {
	const total = noPush ? 5 : 6;
	reportProgress?.(`[1/${total}] 正在检查 Git 仓库和待提交文件...`);
	const object = currentTapdObject(ctx);
	const repository = await readRepositoryState(ctx.cwd);
	if (!repository.dirty) throw new Error("检查仓库失败：没有可提交的改动");
	reportProgress?.(`[2/${total}] 正在从 TAPD 获取 commit keyword...`);
	const keyword = parseKeyword(
		await fetchCommitKeyword(config, object),
		object,
	);
	const subject = `${commitPrefix(keyword.kind)}: ${keyword.keyword}`;
	reportProgress?.(`[3/${total}] 等待确认提交信息...`);
	const confirmed = await ctx.ui.confirm(
		"提交预览",
		`${subject}\n\n${noPush ? "只提交，不推送" : "提交后推送当前分支"}`,
	);
	if (!confirmed) throw new Error("用户取消提交");
	const hash = await commitAll(repository.root, subject, (phase) => {
		reportProgress?.(
			phase === "stage"
				? `[4/${total}] 正在暂存工作区改动（git add --all）...`
				: `[5/${total}] 正在创建 commit；Git hooks 可能需要一些时间...`,
		);
	});
	if (!noPush) {
		reportProgress?.(
			`[6/${total}] 正在推送 ${repository.branch} 到 origin；可能等待网络或 SSH 验证...`,
		);
		await pushCurrentBranch(repository.root, Boolean(repository.upstream));
	}
	return `${hash} ${subject}\n${noPush ? "未推送" : `已推送 ${repository.branch}`}`;
}
