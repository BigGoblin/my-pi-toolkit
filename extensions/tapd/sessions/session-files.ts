import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

/** 读取 session 文件的显示名（最后一条 session_info）。 */
export function readSessionTitle(file: string): string | null {
	try {
		if (!existsSync(file)) return null;
		for (const line of readFileSync(file, "utf-8").split("\n").reverse()) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session_info" && entry.name) return entry.name;
			} catch {
				// Ignore malformed JSONL entries while scanning older session files.
			}
		}
		return null;
	} catch {
		return null;
	}
}

export interface DeleteSessionResult {
	ok: boolean;
	method?: "missing" | "trash" | "unlink";
	error?: string;
}

/** 删除会话文件（优先 trash，失败降级 unlink）。关联信息随 session 文件消失。 */
export function deleteSessionFile(sessionFile: string): DeleteSessionResult {
	if (!existsSync(sessionFile)) return { ok: true, method: "missing" };

	const trashArgs = sessionFile.startsWith("-")
		? ["--", sessionFile]
		: [sessionFile];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });
	if (trashResult.status === 0 || !existsSync(sessionFile))
		return { ok: true, method: "trash" };

	try {
		unlinkSync(sessionFile);
		return { ok: true, method: "unlink" };
	} catch (error) {
		const unlinkError = error instanceof Error ? error.message : String(error);
		const trashError =
			trashResult.error?.message || trashResult.stderr?.trim().split("\n")[0];
		return {
			ok: false,
			error: trashError
				? `${unlinkError}（trash: ${trashError}）`
				: unlinkError,
		};
	}
}
