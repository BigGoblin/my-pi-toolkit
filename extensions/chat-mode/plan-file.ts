import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const ENTER_PLAN_TOOL = "enter_plan_mode";
export const EXIT_PLAN_TOOL = "exit_plan_mode";

export type PlanFileSeedStatus = "created" | "empty" | "nonempty";

export interface SessionPlanFile {
	absolutePath: string;
	sessionDir: string;
}

function isWithin(root: string, target: string): boolean {
	const child = relative(root, target);
	return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function assertSessionId(sessionId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)) {
		throw new Error(`Invalid session id: ${sessionId}`);
	}
}

export function sessionPlanFile(
	sessionDir: string,
	sessionId: string,
): SessionPlanFile {
	assertSessionId(sessionId);
	return {
		absolutePath: resolve(sessionDir, sessionId, "plan.md"),
		sessionDir: resolve(sessionDir),
	};
}

async function ensureSafeParent(plan: SessionPlanFile): Promise<void> {
	await mkdir(plan.sessionDir, { recursive: true });
	const canonicalSessionDir = await realpath(plan.sessionDir);
	const parent = dirname(plan.absolutePath);
	await mkdir(parent, { recursive: true });
	const canonicalParent = await realpath(parent);
	if (!isWithin(canonicalSessionDir, canonicalParent)) {
		throw new Error(`Unsafe Plan directory: ${parent}`);
	}
}

async function rejectSymlink(path: string): Promise<void> {
	try {
		const stats = await lstat(path);
		if (stats.isSymbolicLink()) {
			throw new Error(`Plan file must not be a symbolic link: ${path}`);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

/** Grok behavior: seed the session plan if missing, never truncate it. */
export async function seedPlanFile(
	plan: SessionPlanFile,
): Promise<PlanFileSeedStatus> {
	await ensureSafeParent(plan);
	await rejectSymlink(plan.absolutePath);
	try {
		const existing = await readFile(plan.absolutePath, "utf8");
		return existing.trim().length === 0 ? "empty" : "nonempty";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await writeFile(plan.absolutePath, "", { encoding: "utf8", flag: "wx" });
	return "created";
}

export async function readPlanFile(
	plan: SessionPlanFile,
): Promise<string | undefined> {
	await ensureSafeParent(plan);
	await rejectSymlink(plan.absolutePath);
	try {
		const text = await readFile(plan.absolutePath, "utf8");
		return text.trim().length === 0 ? undefined : text;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
