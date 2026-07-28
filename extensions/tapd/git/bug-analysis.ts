import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { git } from "./repository.js";

export interface IntroducedCommitCandidate {
	hash: string;
	shortHash: string;
	date: string;
	author: string;
	subject: string;
	lineCount: number;
	files: string[];
}

interface ChangedRange {
	path: string;
	start: number;
	count: number;
}

function changedOldRanges(diff: string): ChangedRange[] {
	const ranges: ChangedRange[] = [];
	let oldPath = "";
	for (const line of diff.split("\n")) {
		if (line.startsWith("--- a/")) {
			oldPath = line.slice(6);
			continue;
		}
		if (line === "--- /dev/null") {
			oldPath = "";
			continue;
		}
		const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
		if (!oldPath || !hunk) continue;
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		if (count > 0)
			ranges.push({ path: oldPath, start: Number(hunk[1]), count });
	}
	return ranges;
}

function blamedCommits(output: string): string[] {
	const hashes: string[] = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^\^?([0-9a-f]{40}) \d+ \d+(?: \d+)?$/i);
		if (match && !/^0+$/.test(match[1])) hashes.push(match[1]);
	}
	return hashes;
}

export async function analyzeIntroducedCommitCandidates(
	cwd: string,
	targetBranch: string,
): Promise<IntroducedCommitCandidate[]> {
	const base = await git(cwd, ["merge-base", `origin/${targetBranch}`, "HEAD"]);
	const diff = await git(cwd, [
		"diff",
		"--unified=0",
		"--no-color",
		"--no-ext-diff",
		base,
		"HEAD",
	]);
	const ranges = changedOldRanges(diff).slice(0, 40);
	const scores = new Map<string, { lineCount: number; files: Set<string> }>();
	let remainingLines = 400;
	for (const range of ranges) {
		if (remainingLines <= 0) break;
		const count = Math.min(range.count, remainingLines, 100);
		remainingLines -= count;
		try {
			const blame = await git(cwd, [
				"blame",
				"--porcelain",
				base,
				"-L",
				`${range.start},+${count}`,
				"--",
				range.path,
			]);
			for (const hash of blamedCommits(blame)) {
				const score = scores.get(hash) ?? {
					lineCount: 0,
					files: new Set<string>(),
				};
				score.lineCount += 1;
				score.files.add(range.path);
				scores.set(hash, score);
			}
		} catch {
			// Binary files, unusual paths, and unavailable history are skipped.
		}
	}
	const ranked = Array.from(scores.entries())
		.sort(
			(a, b) =>
				b[1].lineCount - a[1].lineCount || b[1].files.size - a[1].files.size,
		)
		.slice(0, 8);
	return Promise.all(
		ranked.map(async ([hash, score]) => {
			const metadata = await git(cwd, [
				"show",
				"-s",
				"--format=%h%x09%ad%x09%an%x09%s",
				"--date=short",
				hash,
			]);
			const [shortHash, date, author, ...subject] = metadata.split("\t");
			return {
				hash,
				shortHash,
				date,
				author,
				subject: subject.join("\t"),
				lineCount: score.lineCount,
				files: Array.from(score.files),
			};
		}),
	);
}

export function candidateLabel(candidate: IntroducedCommitCandidate): string {
	return `${candidate.shortHash} · 命中 ${candidate.lineCount} 行/${candidate.files.length} 文件 · ${candidate.subject}`;
}

async function candidateFromHash(
	cwd: string,
	hash: string,
): Promise<IntroducedCommitCandidate> {
	await git(cwd, ["cat-file", "-e", `${hash}^{commit}`]);
	await git(cwd, ["merge-base", "--is-ancestor", hash, "HEAD"]);
	const fullHash = await git(cwd, ["rev-parse", hash]);
	const metadata = await git(cwd, [
		"show",
		"-s",
		"--format=%h%x09%ad%x09%an%x09%s",
		"--date=short",
		fullHash,
	]);
	const [shortHash, date, author, ...subject] = metadata.split("\t");
	return {
		hash: fullHash,
		shortHash,
		date,
		author,
		subject: subject.join("\t"),
		lineCount: 0,
		files: [],
	};
}

export async function selectIntroducedCommitCandidate(
	ctx: ExtensionCommandContext,
	cwd: string,
	targetBranch: string,
	bugId: string,
): Promise<IntroducedCommitCandidate | undefined> {
	ctx.ui.notify(
		`正在根据修复 diff 和 git blame 分析 Bug ${bugId} 的引入 commit 候选...`,
		"info",
	);
	const candidates = await analyzeIntroducedCommitCandidates(cwd, targetBranch);
	if (candidates.length === 0) {
		ctx.ui.notify(
			"没有找到可靠的 git blame 候选，将使用合入版本“其他(历史缺陷)”",
			"warning",
		);
		return undefined;
	}
	const manualInput = "手动输入 commit hash...";
	const selected = await ctx.ui.select(
		`Bug ${bugId}: 请选择经 Git 证据确认的引入 commit`,
		[
			...candidates.map(candidateLabel),
			manualInput,
			"未能定位（合入版本选择其他(历史缺陷)）",
		],
	);
	const candidate = candidates.find(
		(item) => candidateLabel(item) === selected,
	);
	if (candidate || selected !== manualInput) return candidate;
	const hash = await ctx.ui.input(
		`Bug ${bugId}: 输入已通过 Git 证据确认的 commit hash`,
		"7 到 40 位十六进制 commit hash",
	);
	if (!hash) return undefined;
	if (!/^[0-9a-f]{7,40}$/i.test(hash.trim())) {
		throw new Error("手动输入的引入 commit 格式无效");
	}
	try {
		return await candidateFromHash(cwd, hash.trim());
	} catch {
		throw new Error("手动输入的引入 commit 不存在，或不属于当前 HEAD 的历史");
	}
}
