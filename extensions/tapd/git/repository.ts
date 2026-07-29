import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	prefersWindowsGit,
	rememberWindowsGitProject,
	shouldRetryCommitWithWindowsGit,
	windowsGitExecutable,
} from "./git-runtime.js";
import type { GitRepositoryState } from "./types.js";

const execFileAsync = promisify(execFile);

async function runGit(
	executable: string,
	cwd: string,
	args: string[],
): Promise<string> {
	// npm-based Git hooks can change the shared Windows console title via
	// process.title. Preserve Pi's title across the entire Git subprocess tree.
	const terminalTitle =
		process.platform === "win32" ? process.title : undefined;
	try {
		const result = await execFileAsync(executable, args, {
			cwd,
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		});
		return result.stdout.trim();
	} finally {
		if (terminalTitle !== undefined) process.title = terminalTitle;
	}
}

export async function git(cwd: string, args: string[]): Promise<string> {
	return runGit("git", cwd, args);
}

async function commitWithPreferredGit(
	root: string,
	subject: string,
): Promise<void> {
	const args = ["commit", "-m", subject];
	if (prefersWindowsGit(root)) {
		await runGit(windowsGitExecutable(), root, args);
		return;
	}
	try {
		await git(root, args);
	} catch (error) {
		if (!shouldRetryCommitWithWindowsGit(error)) throw error;
		await runGit(windowsGitExecutable(), root, args);
		rememberWindowsGitProject(root);
	}
}

async function optionalGit(
	cwd: string,
	args: string[],
): Promise<string | undefined> {
	try {
		return (await git(cwd, args)) || undefined;
	} catch {
		return undefined;
	}
}

export async function readRepositoryRoot(cwd: string): Promise<string> {
	return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function readRepositoryState(
	cwd: string,
	includeUntracked = true,
): Promise<GitRepositoryState> {
	const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
	const [branch, originUrl, upstream, head, status] = await Promise.all([
		git(root, ["branch", "--show-current"]),
		git(root, ["remote", "get-url", "origin"]),
		optionalGit(root, [
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			"@{upstream}",
		]),
		optionalGit(root, ["rev-parse", "--short", "HEAD"]),
		git(root, [
			"status",
			"--porcelain",
			`--untracked-files=${includeUntracked ? "normal" : "no"}`,
		]),
	]);
	return {
		root,
		branch,
		originUrl,
		upstream,
		dirty: Boolean(status),
		head,
	};
}

export async function refExists(cwd: string, ref: string): Promise<boolean> {
	try {
		await git(cwd, ["rev-parse", "--verify", ref]);
		return true;
	} catch {
		return false;
	}
}

export async function createBranch(
	cwd: string,
	branch: string,
	baseRef: string,
) {
	await git(cwd, ["switch", "--create", branch, "--no-track", baseRef]);
}

export async function commitAll(
	cwd: string,
	subject: string,
	onPhase?: (phase: "stage" | "commit") => void,
): Promise<string> {
	onPhase?.("stage");
	await git(cwd, ["add", "--all"]);
	onPhase?.("commit");
	await commitWithPreferredGit(cwd, subject);
	return git(cwd, ["rev-parse", "--short", "HEAD"]);
}

export async function pushCurrentBranch(cwd: string, hasUpstream: boolean) {
	await git(cwd, hasUpstream ? ["push"] : ["push", "-u", "origin", "HEAD"]);
}
