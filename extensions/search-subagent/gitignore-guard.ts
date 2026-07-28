import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const PATH_TOOLS = new Set(["read", "grep", "find", "ls"]);

async function findGitRoot(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", [
			"-C",
			cwd,
			"rev-parse",
			"--show-toplevel",
		]);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function isIgnored(
	gitRoot: string,
	targetPath: string,
): Promise<boolean> {
	const absolutePath = path.resolve(gitRoot, targetPath);
	const relativePath = path.relative(gitRoot, absolutePath);
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath))
		return false;

	try {
		await execFileAsync("git", [
			"-C",
			gitRoot,
			"check-ignore",
			"--quiet",
			"--no-index",
			"--",
			relativePath,
		]);
		return true;
	} catch (error) {
		const code = (error as { code?: number | string }).code;
		if (code === 1) return false;
		throw error;
	}
}

export default function gitignoreGuard(pi: ExtensionAPI) {
	let cachedCwd = "";
	let cachedGitRoot: string | undefined;

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		if (!PATH_TOOLS.has(event.toolName)) return;

		if (cachedCwd !== ctx.cwd) {
			cachedCwd = ctx.cwd;
			cachedGitRoot = await findGitRoot(ctx.cwd);
		}
		if (!cachedGitRoot) return;

		const input = event.input as { path?: unknown };
		const requestedPath = typeof input.path === "string" ? input.path : ".";
		const absolutePath = path.resolve(ctx.cwd, requestedPath.replace(/^@/, ""));
		if (!(await isIgnored(cachedGitRoot, absolutePath))) return;

		return {
			block: true,
			reason: `Search 子 Agent 不允许访问被项目 .gitignore 排除的路径: ${requestedPath}`,
		};
	});
}
