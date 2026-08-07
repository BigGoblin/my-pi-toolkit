import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
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

function sectionValue(text: string, label: string, nextLabel?: string): string {
	const next = nextLabel ? `(?=\\n【${nextLabel}】|$)` : "$";
	const match = text.match(
		new RegExp(`【${label}】\\s*([\\s\\S]*?)${next}`, "i"),
	);
	return match?.[1]?.trim() ?? "";
}

export function parseBugRootCauseEditor(
	text: string,
	bugId: string,
	head: string,
): BugRootCauseDraft {
	const cause = sectionValue(text, "产生原因", "引入commit");
	const introducedCommit = sectionValue(text, "引入commit", "commit信息");
	const commitInfo = sectionValue(text, "commit信息", "修复");
	const fix = sectionValue(text, "修复");
	if (!introducedCommit)
		throw new Error(`Bug ${bugId}: 请保留【引入commit】，或填写“未能定位”`);
	if (!commitInfo) throw new Error(`Bug ${bugId}: 请保留【commit信息】`);
	return {
		head,
		bugId,
		cause,
		introducedCommit: introducedCommit.split(/\s+/)[0] ?? introducedCommit,
		commitInfo,
		fix,
	};
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

export async function collectManualBugRootCauseDraft(
	ctx: ExtensionCommandContext,
	bugId: string,
	head: string,
	candidate: IntroducedCommitCandidate | undefined,
): Promise<BugRootCauseDraft | null> {
	const introduced = candidate?.hash ?? "未能定位";
	const commitInfo = candidate
		? `${candidate.shortHash} ${candidate.date} ${candidate.author} ${candidate.subject}`
		: "未能定位到引入该 bug 的 commit";
	const template = renderBugRootCauseDraft({
		head,
		bugId,
		cause: "",
		introducedCommit: introduced,
		commitInfo,
		fix: "",
	});
	const edited = await ctx.ui.editor(
		`Bug ${bugId}: 请手动填写产生原因和修复方式`,
		`${template}\n`,
	);
	if (!edited) return null;
	return parseBugRootCauseEditor(edited, bugId, head);
}
