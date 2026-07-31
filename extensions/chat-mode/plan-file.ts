import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PLAN_FILE_RELATIVE } from "./paths.js";

export const ENTER_PLAN_TOOL = "enter_plan_mode";
export const EXIT_PLAN_TOOL = "exit_plan_mode";

export type PlanFileSeedStatus = "created" | "empty" | "nonempty";

export function planFileAbsolutePath(cwd: string): string {
	return resolve(cwd, PLAN_FILE_RELATIVE);
}

/** Seed `.pi/plan.md` if missing; never truncate existing content. */
export async function seedPlanFile(cwd: string): Promise<PlanFileSeedStatus> {
	const path = planFileAbsolutePath(cwd);
	try {
		const existing = await readFile(path, "utf8");
		return existing.trim().length === 0 ? "empty" : "nonempty";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") throw error;
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "", "utf8");
	return "created";
}

/** Read plan body; undefined when missing or whitespace-only. */
export async function readPlanFile(cwd: string): Promise<string | undefined> {
	try {
		const text = await readFile(planFileAbsolutePath(cwd), "utf8");
		return text.trim().length === 0 ? undefined : text;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return undefined;
		throw error;
	}
}
