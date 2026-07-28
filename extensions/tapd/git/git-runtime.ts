import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, release } from "node:os";
import { dirname, join, resolve } from "node:path";

interface GitRuntimeState {
	windowsGitProjects?: string[];
}

const STATE_PATH = join(homedir(), ".pi", "agent", "tapd-git-runtime.json");
const CRLF_SHEBANG_ERROR =
	/\/usr\/bin\/env:.*(?:sh|bash)(?:\\r|\r).*No such file or directory/is;

export function canUseWindowsGitFallback(): boolean {
	if (process.platform !== "linux") return false;
	return Boolean(process.env.WSL_INTEROP) || /microsoft/i.test(release());
}

function projectKey(root: string): string {
	return resolve(root);
}

function loadState(): GitRuntimeState {
	if (!existsSync(STATE_PATH)) return {};
	try {
		return JSON.parse(readFileSync(STATE_PATH, "utf8")) as GitRuntimeState;
	} catch {
		return {};
	}
}

function saveState(state: GitRuntimeState): void {
	mkdirSync(dirname(STATE_PATH), { recursive: true });
	writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function shouldRetryCommitWithWindowsGit(error: unknown): boolean {
	if (!canUseWindowsGitFallback()) return false;
	const value = error as { message?: string; stderr?: string };
	return CRLF_SHEBANG_ERROR.test(
		`${value?.message ?? ""}\n${value?.stderr ?? ""}`,
	);
}

export function prefersWindowsGit(root: string): boolean {
	if (!canUseWindowsGitFallback()) return false;
	return loadState().windowsGitProjects?.includes(projectKey(root)) ?? false;
}

export function rememberWindowsGitProject(root: string): void {
	const state = loadState();
	const projects = new Set(state.windowsGitProjects ?? []);
	projects.add(projectKey(root));
	saveState({ ...state, windowsGitProjects: Array.from(projects).sort() });
}

export function windowsGitExecutable(): string {
	return process.env.TAPD_WINDOWS_GIT_PATH?.trim() || "git.exe";
}
