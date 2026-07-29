import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	getDesignDocPath,
	getUnderstandingDocPath,
	findSessionLink,
} from "../sessions/storage.js";
import { git, readRepositoryRoot, refExists } from "../git/repository.js";
import type { TapdReviewContext } from "./types.js";

async function requireDocument(path: string, command: string): Promise<void> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch {
		throw new Error(`未找到 ${path}，请先执行 ${command}`);
	}
	if (!content.trim()) throw new Error(`${path} 为空，请先完善文档`);
}

function lines(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export async function collectTapdReviewContext(
	ctx: ExtensionContext,
	baseRef: string,
	onPhase?: (
		phase: "documents" | "git",
		state: "running" | "done",
		message: string,
	) => void,
): Promise<TapdReviewContext> {
	onPhase?.("documents", "running", "正在读取需求与设计文档");
	const current = findSessionLink(ctx.sessionManager.getSessionFile?.() ?? "");
	if (!current)
		throw new Error("当前会话没有关联 TAPD 需求，请先从待办创建或切换会话");
	if (current.record.kind === "bug")
		throw new Error("/tapd review 仅支持需求会话，不支持 Bug 会话");

	const storyId = current.record.storyId;
	const documentId = `story-${storyId}`;
	const understandingFile =
		current.session.understandingFile ??
		getUnderstandingDocPath(ctx.cwd, documentId);
	const designFile = current.session.understandingFile
		? join(dirname(current.session.understandingFile), "design.md")
		: getDesignDocPath(ctx.cwd, documentId);
	await requireDocument(understandingFile, "/tapd analyze");
	await requireDocument(designFile, "/tapd design");
	onPhase?.("documents", "done", "已读取需求与设计文档");

	onPhase?.("git", "running", "正在收集 Git 修改");
	const repositoryRoot = await readRepositoryRoot(ctx.cwd);
	if (!(await refExists(repositoryRoot, baseRef)))
		throw new Error(`审核基础分支不存在: ${baseRef}`);
	const mergeBase = await git(repositoryRoot, ["merge-base", baseRef, "HEAD"]);
	const [branch, status, stat, patch, trackedNames, untrackedNames] =
		await Promise.all([
			git(repositoryRoot, ["branch", "--show-current"]),
			git(repositoryRoot, [
				"status",
				"--porcelain",
				"--untracked-files=normal",
			]),
			git(repositoryRoot, ["diff", "--stat", mergeBase, "--"]),
			git(repositoryRoot, [
				"diff",
				"--no-color",
				"--find-renames",
				mergeBase,
				"--",
			]),
			git(repositoryRoot, ["diff", "--name-only", mergeBase, "--"]),
			git(repositoryRoot, ["ls-files", "--others", "--exclude-standard"]),
		]);
	const untrackedFiles = lines(untrackedNames);
	const changedFiles = Array.from(
		new Set([...lines(trackedNames), ...untrackedFiles]),
	);
	if (changedFiles.length === 0)
		throw new Error(`相对 ${baseRef} 没有可审核的代码修改`);

	const tempDir = await mkdtemp(join(tmpdir(), "tapd-review-"));
	const contextFile = join(tempDir, "review-context.md");
	const contextText = [
		"# TAPD Review Git Context",
		"",
		`- Repository: ${repositoryRoot}`,
		`- Branch: ${branch || "(detached)"}`,
		`- Base ref: ${baseRef}`,
		`- Merge base: ${mergeBase}`,
		"",
		"## Git status",
		"```text",
		status || "(clean working tree)",
		"```",
		"",
		"## Diff stat",
		"```text",
		stat || "(no tracked diff)",
		"```",
		"",
		"## Changed files",
		...changedFiles.map((file) => `- ${file}`),
		"",
		"## Untracked files",
		...(untrackedFiles.length > 0
			? untrackedFiles.map((file) => `- ${file}`)
			: ["(none)"]),
		"",
		"## Tracked patch",
		"```diff",
		patch || "(no tracked diff)",
		"```",
	].join("\n");
	try {
		await writeFile(contextFile, contextText, {
			encoding: "utf8",
			mode: 0o600,
		});
	} catch (error) {
		await rm(tempDir, { recursive: true, force: true });
		throw error;
	}

	onPhase?.("git", "done", `已收集 ${changedFiles.length} 个修改文件`);
	return {
		storyId,
		storyName: current.record.name,
		understandingFile,
		designFile,
		repositoryRoot,
		branch: branch || "(detached)",
		baseRef,
		mergeBase,
		changedFiles,
		contextFile,
		cleanup: () => rm(tempDir, { recursive: true, force: true }),
	};
}
