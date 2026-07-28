import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { TapdBugDetail } from "../core/api.js";
import type { IntroducedCommitCandidate } from "./bug-analysis.js";
import { git } from "./repository.js";

export interface BugRootCauseDraft {
	head: string;
	bugId: string;
	cause: string;
	introducedCommit: string;
	commitInfo: string;
	fix: string;
}

async function draftPath(cwd: string, bugId: string): Promise<string> {
	const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
	const dir = path.join(root, ".pi", "tapd-root-cause");
	await mkdir(dir, { recursive: true });
	return path.join(dir, `${bugId}.json`);
}

export async function deleteBugRootCauseDraft(
	cwd: string,
	bugId: string,
): Promise<void> {
	await rm(await draftPath(cwd, bugId), { force: true });
}

export async function loadBugRootCauseDraft(
	cwd: string,
	bugId: string,
	head: string,
): Promise<BugRootCauseDraft | null> {
	try {
		const content = await readFile(await draftPath(cwd, bugId), "utf8");
		const draft = JSON.parse(content) as Partial<BugRootCauseDraft>;
		if (
			draft.head !== head ||
			draft.bugId !== bugId ||
			typeof draft.cause !== "string" ||
			typeof draft.introducedCommit !== "string" ||
			typeof draft.commitInfo !== "string" ||
			typeof draft.fix !== "string"
		)
			return null;
		return draft as BugRootCauseDraft;
	} catch {
		return null;
	}
}

export async function buildBugRootCausePrompt(
	cwd: string,
	bugId: string,
	head: string,
	targetBranch: string,
	bug: TapdBugDetail | null,
	candidate: IntroducedCommitCandidate | undefined,
): Promise<string> {
	const outputPath = await draftPath(cwd, bugId);
	const base = await git(cwd, ["merge-base", `origin/${targetBranch}`, "HEAD"]);
	const [stat, patch] = await Promise.all([
		git(cwd, ["diff", "--stat", base, "HEAD"]),
		git(cwd, ["diff", "--no-color", "--unified=3", base, "HEAD"]),
	]);
	const introduced = candidate?.hash ?? "未能定位";
	const commitInfo = candidate
		? `${candidate.shortHash} ${candidate.date} ${candidate.author} ${candidate.subject}`
		: "未能定位";
	return [
		`请在创建 Bug ${bugId} 的 MR 前分析产生原因和修复方式。`,
		"只分析，不修改项目代码、不提交、不推送、不调用 TAPD 或 GitLab。",
		"必须基于 TAPD 信息、当前修复 diff、代码和 Git 历史；不要猜测。",
		"分析完成后必须使用 write 工具将 JSON 写入以下绝对路径：",
		outputPath,
		"",
		"JSON 必须严格使用以下结构：",
		JSON.stringify(
			{
				head,
				bugId,
				cause: "基于证据的产生原因",
				introducedCommit: introduced,
				commitInfo,
				fix: "基于当前 diff 的修复方式",
			},
			null,
			2,
		),
		"",
		"如果原因无法确认，cause 明确写“未能确认：...”并列出缺失证据；不得杜撰。",
		"introducedCommit 必须保持上方给定值，不得自行替换。",
		"写入文件后，在对话中汇报分析结论，并提醒用户再次执行 /tapd mr。",
		"",
		"## TAPD Bug",
		JSON.stringify(bug ?? { id: bugId }, null, 2),
		"",
		"## 已确认的引入 commit",
		`${introduced} ${commitInfo}`,
		"",
		"## 修复 diff 统计",
		stat,
		"",
		"## 修复 patch",
		patch.slice(0, 30000),
	].join("\n");
}

export function renderBugRootCauseDraft(draft: BugRootCauseDraft): string {
	return [
		`【产生原因】${draft.cause}`,
		"",
		`【引入commit】${draft.introducedCommit}`,
		"",
		`【commit信息】${draft.commitInfo}`,
		"",
		`【修复】${draft.fix}`,
	].join("\n");
}
