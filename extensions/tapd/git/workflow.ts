import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { fetchBugDetail } from "../core/api.js";
import type { TapdConfig } from "../types.js";
import { currentTapdObject, parseKeyword } from "./context.js";
import {
	collectBugEvidence,
	scanLinkedCommits,
	uniqueLinkedObjects,
} from "./analysis.js";
import { updateBugFromDraft } from "./bug-workflow.js";
import { selectIntroducedCommitCandidate } from "./bug-analysis.js";
import {
	createOrUpdateMergeRequest,
	parseGitLabProject,
} from "./gitlab-api.js";
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
	readRepositoryRoot,
	readRepositoryState,
	refExists,
} from "./repository.js";
import {
	buildBugRootCausePrompt,
	deleteBugRootCauseDraft,
	loadBugRootCauseDraft,
} from "./root-cause-draft.js";
import { fetchCommitKeyword, updateTapdStatus } from "./tapd-api.js";

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
): Promise<string> {
	const object = currentTapdObject(ctx);
	const root = await readRepositoryRoot(ctx.cwd);
	if (!(await refExists(root, baseRef)))
		throw new Error(`基础分支不存在: ${baseRef}`);
	const keyword = parseKeyword(
		await fetchCommitKeyword(config, object),
		object,
	);
	const branch = `${branchPrefix(keyword.kind)}/${keyword.shortId}`;
	if (await refExists(root, `refs/heads/${branch}`))
		throw new Error(`本地分支已存在: ${branch}`);
	await createBranch(root, branch, baseRef);
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

export async function runMergeRequest(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	targetBranch = DEFAULT_GIT_WORKFLOW_POLICY.targetBranch,
	removeSourceBranch = DEFAULT_GIT_WORKFLOW_POLICY.removeSourceBranch,
	reportProgress?: (content: string) => void,
): Promise<string> {
	reportProgress?.("[1/5] 正在检查 Git 仓库、当前分支和 upstream...");
	const repository = await readRepositoryState(ctx.cwd);
	if (repository.dirty) throw new Error("创建 MR 前请先提交工作区改动");
	if (!repository.branch || !repository.upstream)
		throw new Error("当前分支尚未推送并设置 upstream");
	reportProgress?.(
		`[2/5] 正在扫描当前分支相对 origin/${targetBranch} 的提交和 TAPD keyword...`,
	);
	const commits = await scanLinkedCommits(repository.root, targetBranch);
	if (commits.length === 0)
		throw new Error(`当前分支相对 origin/${targetBranch} 没有提交`);
	const objects = uniqueLinkedObjects(commits);
	if (objects.length === 0)
		throw new Error("提交范围内没有 TAPD keyword，无法执行关联工作流");
	const bugDrafts = new Map<
		string,
		Awaited<ReturnType<typeof loadBugRootCauseDraft>>
	>();
	const bugObjects = objects.filter((item) => item.kind === "bug");
	if (bugObjects.length > 0) {
		const head = await git(repository.root, ["rev-parse", "HEAD"]);
		for (const bug of bugObjects) {
			const savedDraft = await loadBugRootCauseDraft(
				repository.root,
				bug.shortId,
				head,
			);
			if (savedDraft) {
				bugDrafts.set(bug.shortId, savedDraft);
				continue;
			}
			reportProgress?.(
				`[Bug 分析] ${bug.shortId}: 正在生成引入 commit 候选，随后交给 Agent 分析根因...`,
			);
			const candidate = await selectIntroducedCommitCandidate(
				ctx,
				repository.root,
				targetBranch,
				bug.shortId,
			);
			const detail = await fetchBugDetail(
				bug.workspaceId,
				bug.objectId,
				config,
			);
			const prompt = await buildBugRootCausePrompt(
				repository.root,
				bug.shortId,
				head,
				targetBranch,
				detail,
				candidate,
			);
			pi.sendUserMessage(prompt);
			return `Bug ${bug.shortId} 已交给 Agent 分析产生原因和修复方式。分析完成后请再次执行 /tapd mr；本次尚未创建 MR 或更新 TAPD。`;
		}
	}
	const token =
		config.gitlab?.token ?? process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
	if (!token)
		throw new Error(
			"请在 tapd.json 的 gitlab.token 或 GITLAB_PERSONAL_ACCESS_TOKEN 中配置 GitLab Token",
		);
	const kinds = new Set(objects.map((item) => item.kind));
	const labelKey = kinds.size > 1 ? "mixed" : objects[0].kind;
	const labels = DEFAULT_GIT_WORKFLOW_POLICY.labels[labelKey];
	reportProgress?.("[3/5] 已生成 MR 与 TAPD 更新预览，等待确认...");
	const confirmed = await ctx.ui.confirm(
		"MR 与 TAPD 更新预览",
		[
			`${repository.branch} → ${targetBranch}`,
			`标题: ${commits[commits.length - 1].subject}`,
			`Labels: ${labels.join(", ")}`,
			`TAPD: ${objects.map((item) => `${item.kind}/${item.shortId}`).join(", ")}`,
		].join("\n"),
	);
	if (!confirmed) throw new Error("用户取消 MR 工作流");
	reportProgress?.("[4/5] 正在调用 GitLab API 创建或更新 Merge Request...");
	const mr = await createOrUpdateMergeRequest(
		parseGitLabProject(repository.originUrl, config.gitlab),
		token,
		{
			sourceBranch: repository.branch,
			targetBranch,
			title: commits[commits.length - 1].subject,
			labels,
			removeSourceBranch,
		},
	);
	const updates: string[] = [];
	for (let index = 0; index < objects.length; index += 1) {
		const item = objects[index];
		const itemProgress = (action: string) =>
			reportProgress?.(
				`[5/5 · ${index + 1}/${objects.length}] ${item.kind}/${item.shortId}: ${action}`,
			);
		itemProgress("正在准备 TAPD 流转...");
		const transition = DEFAULT_GIT_WORKFLOW_POLICY.transitions[item.kind];
		if (item.kind !== "bug") {
			itemProgress(`正在更新状态为 ${transition.status}...`);
			await updateTapdStatus(
				config,
				item,
				transition.status,
				transition.currentOwner,
			);
			updates.push(`${item.kind}/${item.shortId} → ${transition.status}`);
			continue;
		}
		const rootCauseDraft = bugDrafts.get(item.shortId);
		if (!rootCauseDraft)
			throw new Error(
				`Bug ${item.shortId} 缺少 Agent 根因分析草稿，请重新执行 /tapd mr`,
			);
		itemProgress("正在加载 Agent 根因分析并汇总 Git 证据...");
		const evidence = await collectBugEvidence(
			repository.root,
			targetBranch,
			commits,
		);
		const bugUpdates = await updateBugFromDraft(
			ctx,
			config,
			item,
			rootCauseDraft,
			evidence,
			repository.root,
			transition.status,
			transition.currentOwner,
			itemProgress,
		);
		updates.push(...bugUpdates);
		if (!bugUpdates.some((update) => update.includes("用户取消"))) {
			await deleteBugRootCauseDraft(repository.root, item.shortId);
			itemProgress("TAPD 流转完成，已删除本地 Agent 根因草稿");
		}
	}
	return [
		`MR: ${mr.web_url}`,
		`标题: ${mr.title}`,
		`Labels: ${labels.join(", ")}`,
		...updates,
	].join("\n");
}
