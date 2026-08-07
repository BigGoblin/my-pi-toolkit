import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { TapdConfig } from "../types.js";
import { scanLinkedCommits, uniqueLinkedObjects } from "./analysis.js";
import { selectIntroducedCommitCandidate } from "./bug-analysis.js";
import { updateBugFromDraft } from "./bug-workflow.js";
import {
	createOrUpdateMergeRequest,
	parseGitLabProject,
} from "./gitlab-api.js";
import { DEFAULT_GIT_WORKFLOW_POLICY } from "./policy.js";
import { git, readRepositoryState } from "./repository.js";
import {
	collectManualBugRootCauseDraft,
	deleteBugRootCauseDraft,
	loadBugRootCauseDraft,
	type BugRootCauseDraft,
} from "./root-cause-draft.js";
import {
	updateStoryForDraftMergeRequest,
	updateStoryForMergeRequest,
} from "./story-workflow.js";
import { fetchTaskEstimatedEffort, updateTapdStatus } from "./tapd-api.js";
import type { GitCommandProgressReporter } from "./types.js";
import type { GitWorkingCancel } from "./working-cancel.js";

interface MergeRequestOptions {
	targetBranch?: string;
	removeSourceBranch?: boolean;
	draft?: boolean;
	reportProgress?: GitCommandProgressReporter;
	cancel?: GitWorkingCancel;
}

export async function runMergeRequest(
	_pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	options: MergeRequestOptions = {},
): Promise<string> {
	const {
		targetBranch = DEFAULT_GIT_WORKFLOW_POLICY.targetBranch,
		removeSourceBranch = DEFAULT_GIT_WORKFLOW_POLICY.removeSourceBranch,
		draft = false,
		reportProgress,
		cancel,
	} = options;
	cancel?.throwIfAborted();
	reportProgress?.({
		step: 1,
		total: 5,
		message: "正在检查 Git 仓库、当前分支和 upstream...",
	});
	const repository = await readRepositoryState(ctx.cwd);
	if (repository.dirty) throw new Error("创建 MR 前请先提交工作区改动");
	if (!repository.branch || !repository.upstream)
		throw new Error("当前分支尚未推送并设置 upstream");
	cancel?.throwIfAborted();
	reportProgress?.({
		step: 2,
		total: 5,
		message: `正在扫描当前分支相对 origin/${targetBranch} 的提交和 TAPD keyword...`,
	});
	const commits = await scanLinkedCommits(repository.root, targetBranch);
	cancel?.throwIfAborted();
	if (commits.length === 0)
		throw new Error(`当前分支相对 origin/${targetBranch} 没有提交`);
	const objects = uniqueLinkedObjects(commits);
	if (objects.length === 0)
		throw new Error("提交范围内没有 TAPD keyword，无法执行关联工作流");

	const bugDrafts = new Map<string, BugRootCauseDraft>();
	const bugObjects = objects.filter((item) => item.kind === "bug");
	if (!draft && bugObjects.length > 0) {
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
			reportProgress?.({
				step: 2,
				total: 5,
				message: `Bug ${bug.shortId}: 正在选择引入 commit，随后请手动填写根因...`,
			});
			const candidate = await selectIntroducedCommitCandidate(
				ctx,
				repository.root,
				targetBranch,
				bug.shortId,
			);
			const manualDraft = await collectManualBugRootCauseDraft(
				ctx,
				bug.shortId,
				head,
				candidate,
			);
			if (!manualDraft) throw new Error(`Bug ${bug.shortId}: 用户取消根因填写`);
			bugDrafts.set(bug.shortId, manualDraft);
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
	const title = commits.slice(-1)[0]?.subject;
	if (!title) throw new Error("无法从提交记录生成 MR 标题");
	reportProgress?.({
		step: 3,
		total: 5,
		message: draft
			? "已生成草稿 MR 预览，等待确认..."
			: "已生成 MR 与 TAPD 更新预览，等待确认...",
	});
	const confirmed = await ctx.ui.confirm(
		draft ? "草稿 MR 预览" : "MR 与 TAPD 更新预览",
		[
			`${repository.branch} → ${targetBranch}`,
			`状态: ${draft ? "Draft" : "Ready"}`,
			`标题: ${title}`,
			`Labels: ${labels.join(", ")}`,
			`TAPD: ${objects.map((item) => `${item.kind}/${item.shortId}`).join(", ")}`,
			draft
				? "TAPD: 流转当前用户的开发子需求；功能需求和测试需求暂不流转，任务和 Bug 也不流转"
				: "TAPD: 流转当前用户负责的功能/开发需求，并将测试需求更新为已通过",
		].join("\n"),
	);
	if (!confirmed) throw new Error("用户取消 MR 工作流");
	reportProgress?.({
		step: 4,
		total: 5,
		message: "正在调用 GitLab API 创建或更新 Merge Request...",
	});
	const mr = await createOrUpdateMergeRequest(
		parseGitLabProject(repository.originUrl, config.gitlab),
		token,
		{
			sourceBranch: repository.branch,
			targetBranch,
			title,
			labels,
			removeSourceBranch,
			draft,
		},
	);

	const updates: string[] = [];
	for (let index = 0; index < objects.length; index += 1) {
		const item = objects[index];
		const itemProgress = (action: string) =>
			reportProgress?.({
				step: 5,
				total: 5,
				message: `${item.kind}/${item.shortId}: ${action}`,
				detail: `TAPD ${index + 1}/${objects.length}`,
			});
		if (draft) {
			if (item.kind === "story") {
				updates.push(
					...(await updateStoryForDraftMergeRequest(
						config,
						item,
						itemProgress,
					)),
				);
			} else {
				updates.push(`${item.kind}/${item.shortId} 跳过（草稿 MR 不流转）`);
			}
			continue;
		}

		itemProgress("正在准备 TAPD 流转...");
		const transition = DEFAULT_GIT_WORKFLOW_POLICY.transitions[item.kind];
		if (item.kind === "story") {
			updates.push(
				...(await updateStoryForMergeRequest(config, item, itemProgress)),
			);
			continue;
		}
		if (item.kind === "task") {
			itemProgress("正在读取预估工时...");
			const effort = await fetchTaskEstimatedEffort(config, item);
			itemProgress(
				effort
					? `正在更新状态为 ${transition.status}，并同步完成工时 ${effort}...`
					: `正在更新状态为 ${transition.status}（无有效预估工时）...`,
			);
			await updateTapdStatus(
				config,
				item,
				transition.status,
				transition.currentOwner,
				effort ? { effort_completed: effort } : {},
			);
			updates.push(
				effort
					? `${item.kind}/${item.shortId} → ${transition.status}，完成工时 ${effort}`
					: `${item.kind}/${item.shortId} → ${transition.status}，未同步完成工时（无有效预估工时）`,
			);
			continue;
		}
		const rootCauseDraft = bugDrafts.get(item.shortId);
		if (!rootCauseDraft)
			throw new Error(`Bug ${item.shortId} 缺少根因备注，请重新执行 /tapd mr`);
		itemProgress("正在根据手动填写的根因更新 TAPD...");
		const bugUpdates = await updateBugFromDraft(
			ctx,
			config,
			item,
			rootCauseDraft,
			repository.root,
			transition.status,
			transition.currentOwner,
			itemProgress,
		);
		updates.push(...bugUpdates);
		await deleteBugRootCauseDraft(repository.root, item.shortId);
		itemProgress("TAPD 流转完成，已清理本地根因草稿");
	}
	return [
		`MR: ${mr.web_url}`,
		`状态: ${draft ? "Draft" : "Ready"}`,
		`标题: ${mr.title}`,
		`Labels: ${labels.join(", ")}`,
		...updates,
	].join("\n");
}
