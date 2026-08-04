import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * 会话文件级工具：项目路径输入历史。
 * TAPD 会话关联已迁移到 session custom entry（见 session-state.ts），
 * 不再维护 tapd-links.json。
 */
const PATHS_HISTORY_PATH = join(getAgentDir(), "tapd-project-paths.json");
const MAX_PATH_HISTORY = 30;

export function loadPathHistory(): string[] {
	try {
		if (!existsSync(PATHS_HISTORY_PATH)) return [];
		const raw = JSON.parse(readFileSync(PATHS_HISTORY_PATH, "utf-8"));
		if (!Array.isArray(raw)) return [];
		return raw.filter(
			(path): path is string =>
				typeof path === "string" && path.trim().length > 0,
		);
	} catch {
		return [];
	}
}

export function rememberProjectPaths(paths: string[]): void {
	const cleaned = Array.from(
		new Set(paths.map((path) => path.trim()).filter(Boolean)),
	);
	if (cleaned.length === 0) return;
	const history = loadPathHistory().filter((path) => !cleaned.includes(path));
	try {
		writeFileSync(
			PATHS_HISTORY_PATH,
			JSON.stringify(
				[...cleaned, ...history].slice(0, MAX_PATH_HISTORY),
				null,
				2,
			),
			"utf-8",
		);
	} catch {}
}

export function removeProjectPathFromHistory(path: string): void {
	const history = loadPathHistory().filter((item) => item !== path);
	try {
		writeFileSync(
			PATHS_HISTORY_PATH,
			JSON.stringify(history, null, 2),
			"utf-8",
		);
	} catch {}
}
