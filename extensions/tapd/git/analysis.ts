import { git } from "./repository.js";
import { parseTapdKeywords } from "./context.js";
import type { LinkedCommit, TapdKeyword } from "./types.js";

export async function scanLinkedCommits(
	cwd: string,
	targetBranch: string,
): Promise<LinkedCommit[]> {
	const base = await git(cwd, ["merge-base", `origin/${targetBranch}`, "HEAD"]);
	const output = await git(cwd, ["log", "--format=%H%x09%s", `${base}..HEAD`]);
	if (!output) return [];
	return output.split("\n").map((line) => {
		const [hash, ...subjectParts] = line.split("\t");
		const subject = subjectParts.join("\t");
		return { hash, subject, objects: parseTapdKeywords(subject) };
	});
}

export function uniqueLinkedObjects(commits: LinkedCommit[]): TapdKeyword[] {
	const byKey = new Map<string, TapdKeyword>();
	for (const commit of commits) {
		for (const item of commit.objects) {
			byKey.set(`${item.kind}:${item.workspaceId}:${item.shortId}`, item);
		}
	}
	return Array.from(byKey.values());
}

export interface CommitTagResult {
	commit: string;
	tag?: string;
	matchType?: "points-at" | "contains";
}

export function parseIntroducedCommit(draft: string): string | null {
	const value = draft.match(/【引入commit】\s*([^\s<]+)/i)?.[1]?.trim();
	if (!value || /^(未能定位|无法定位|unknown|none)$/i.test(value)) return null;
	return /^[0-9a-f]{7,40}$/i.test(value) ? value : null;
}

const REMOTE_TAG_REFS = "refs/tapd/origin-tags";

function firstRemoteTag(
	output: string,
	fullCommit: string,
): string | undefined {
	for (const line of output.split("\n")) {
		const [name, object, peeled] = line.split("\t");
		if (name && (object === fullCommit || peeled === fullCommit)) return name;
	}
	return undefined;
}

export async function resolveCommitTag(
	cwd: string,
	commit: string,
): Promise<CommitTagResult> {
	await git(cwd, ["cat-file", "-e", `${commit}^{commit}`]);
	await git(cwd, ["merge-base", "--is-ancestor", commit, "HEAD"]);
	const fullCommit = await git(cwd, ["rev-parse", commit]);
	const remoteTags = await git(cwd, [
		"for-each-ref",
		"--sort=version:refname",
		"--format=%(refname:strip=3)%09%(objectname)%09%(*objectname)",
		REMOTE_TAG_REFS,
	]);
	const directTag = firstRemoteTag(remoteTags, fullCommit);
	if (directTag)
		return { commit: fullCommit, tag: directTag, matchType: "points-at" };
	const contains = await git(cwd, [
		"for-each-ref",
		"--contains",
		fullCommit,
		"--sort=version:refname",
		"--format=%(refname:strip=3)",
		REMOTE_TAG_REFS,
	]);
	const containingTag = contains.split("\n").find(Boolean);
	return {
		commit: fullCommit,
		tag: containingTag,
		matchType: containingTag ? "contains" : undefined,
	};
}

export async function fetchRemoteTags(cwd: string): Promise<void> {
	await git(cwd, [
		"fetch",
		"--no-tags",
		"--prune",
		"origin",
		`+refs/tags/*:${REMOTE_TAG_REFS}/*`,
	]);
}

export async function linkedObjectsForCommit(
	cwd: string,
	commit: string,
): Promise<TapdKeyword[]> {
	const subject = await git(cwd, ["show", "-s", "--format=%s", commit]);
	return parseTapdKeywords(subject);
}

export async function collectBugEvidence(
	cwd: string,
	targetBranch: string,
	commits: LinkedCommit[],
): Promise<string> {
	const base = await git(cwd, ["merge-base", `origin/${targetBranch}`, "HEAD"]);
	const [history, diff] = await Promise.all([
		git(cwd, [
			"log",
			"--format=%h %ad %an %s",
			"--date=short",
			`${base}..HEAD`,
		]),
		git(cwd, ["diff", "--stat", base, "HEAD"]),
	]);
	return [
		"候选提交：",
		history,
		"",
		"变更统计：",
		diff,
		"",
		"TAPD 关联提交：",
		...commits.map((commit) => `${commit.hash.slice(0, 12)} ${commit.subject}`),
		"",
		"请在备注中增加一行：",
		"【引入commit】真实的 commit hash；无法确认时填写“未能定位”",
	].join("\n");
}
