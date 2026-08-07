import { type ChildProcess, spawn } from "node:child_process";
import {
	prefersWindowsGit,
	rememberWindowsGitProject,
	shouldRetryCommitWithWindowsGit,
	windowsGitExecutable,
} from "./git-runtime.js";
import type { GitRepositoryState } from "./types.js";
import { abortError } from "./working-cancel.js";

function killChildTree(child: ChildProcess): void {
	if (!child.pid) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		return;
	}
	child.kill("SIGTERM");
	setTimeout(() => {
		try {
			child.kill("SIGKILL");
		} catch {
			/* already exited */
		}
	}, 2_000).unref?.();
}

async function runGit(
	executable: string,
	cwd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<string> {
	if (signal?.aborted) throw abortError();
	// npm-based Git hooks can change the shared Windows console title via
	// process.title. Preserve Pi's title across the entire Git subprocess tree.
	const terminalTitle =
		process.platform === "win32" ? process.title : undefined;
	try {
		return await new Promise<string>((resolve, reject) => {
			const child = spawn(executable, args, {
				cwd,
				windowsHide: true,
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr?.on("data", (chunk: string) => {
				stderr += chunk;
			});
			const onAbort = () => killChildTree(child);
			signal?.addEventListener("abort", onAbort, { once: true });
			child.on("error", (error) => {
				signal?.removeEventListener("abort", onAbort);
				reject(error);
			});
			child.on("close", (code) => {
				signal?.removeEventListener("abort", onAbort);
				if (signal?.aborted) {
					reject(abortError());
					return;
				}
				if (code === 0) {
					resolve(stdout.trim());
					return;
				}
				const detail = (stderr || stdout).trim();
				reject(
					new Error(
						`Command failed: ${executable} ${args.join(" ")}${detail ? `\n${detail}` : ""}`,
					),
				);
			});
		});
	} finally {
		if (terminalTitle !== undefined) process.title = terminalTitle;
	}
}

export async function git(
	cwd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<string> {
	return runGit("git", cwd, args, signal);
}

async function commitWithPreferredGit(
	root: string,
	subject: string,
	skipHooks: boolean,
	signal?: AbortSignal,
): Promise<void> {
	const args = ["commit", ...(skipHooks ? ["--no-verify"] : []), "-m", subject];
	if (prefersWindowsGit(root)) {
		await runGit(windowsGitExecutable(), root, args, signal);
		return;
	}
	try {
		await git(root, args, signal);
	} catch (error) {
		if (signal?.aborted) throw error;
		if (!shouldRetryCommitWithWindowsGit(error)) throw error;
		await runGit(windowsGitExecutable(), root, args, signal);
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
	signal?: AbortSignal,
) {
	await git(
		cwd,
		["switch", "--create", branch, "--no-track", baseRef],
		signal,
	);
}

export async function createBranchFromHead(
	cwd: string,
	branch: string,
	signal?: AbortSignal,
) {
	await git(cwd, ["switch", "--create", branch, "--no-track"], signal);
}

export async function stashAll(cwd: string, message: string): Promise<string> {
	await git(cwd, ["stash", "push", "--include-untracked", "-m", message]);
	// 新建的 stash 始终是 stash@{0}；pop/apply 需要 stash 引用而非裸 hash。
	return "stash@{0}";
}

export async function popStash(cwd: string, stashRef: string) {
	await git(cwd, ["stash", "pop", stashRef]);
}

export async function cherryPick(cwd: string, commit: string) {
	await git(cwd, ["cherry-pick", commit]);
}

export async function commitAll(
	cwd: string,
	subject: string,
	onPhase?: (phase: "stage" | "commit") => void,
	skipHooks = false,
	signal?: AbortSignal,
): Promise<string> {
	onPhase?.("stage");
	await git(cwd, ["add", "--all"], signal);
	onPhase?.("commit");
	await commitWithPreferredGit(cwd, subject, skipHooks, signal);
	return git(cwd, ["rev-parse", "--short", "HEAD"], signal);
}

export async function pushCurrentBranch(
	cwd: string,
	hasUpstream: boolean,
	signal?: AbortSignal,
) {
	await git(
		cwd,
		hasUpstream ? ["push"] : ["push", "-u", "origin", "HEAD"],
		signal,
	);
}
