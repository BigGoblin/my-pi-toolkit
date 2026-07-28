import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitRepositoryState } from "./types.js";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
	const result = await execFileAsync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	});
	return result.stdout.trim();
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
	await git(cwd, ["commit", "-m", subject]);
	return git(cwd, ["rev-parse", "--short", "HEAD"]);
}

export async function pushCurrentBranch(cwd: string, hasUpstream: boolean) {
	await git(cwd, hasUpstream ? ["push"] : ["push", "-u", "origin", "HEAD"]);
}
