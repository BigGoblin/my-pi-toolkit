import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import type {
	MultiTaskInputTask,
	NormalizedMultiTaskTask,
} from "./types.js";

export function canonicalize(path: string): string {
	const absolute = resolve(path);
	let cursor = absolute;
	const suffix: string[] = [];
	while (!existsSync(cursor)) {
		const parent = dirname(cursor);
		if (parent === cursor) return absolute;
		suffix.unshift(basename(cursor));
		cursor = parent;
	}
	return resolve(realpathSync(cursor), ...suffix);
}

export function normalizeTaskPath(cwd: string, path: string): string {
	return canonicalize(resolve(cwd, path.replace(/^@/, "")));
}

function comparablePath(value: string): string {
	return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithinPath(path: string, root: string): boolean {
	const candidate = comparablePath(path);
	const boundary = comparablePath(root);
	return candidate === boundary || candidate.startsWith(`${boundary}${sep}`);
}

export function pathsOverlap(left: string, right: string): boolean {
	return isWithinPath(left, right) || isWithinPath(right, left);
}

export function validateTasks(
	cwd: string,
	tasks: MultiTaskInputTask[],
): NormalizedMultiTaskTask[] {
	if (tasks.length === 0) throw new Error("multi_task start 至少需要一个任务");
	if (tasks.length > 8) throw new Error("multi_task 每批最多允许 8 个任务");
	const ids = new Set<string>();
	const workspace = canonicalize(cwd);
	const normalized = tasks.map((task): NormalizedMultiTaskTask => {
		const id = task.id.trim();
		const description = task.task.trim();
		const kind = task.kind ?? "implementation";
		if (!id || !description) throw new Error("每个任务都需要非空 id 和 task");
		if (ids.has(id)) throw new Error(`任务 id 重复: ${id}`);
		ids.add(id);
		if (kind !== "implementation" && kind !== "research")
			throw new Error(`任务 ${id} 的 kind 无效: ${String(kind)}`);
		if (task.paths.length === 0)
			throw new Error(
				kind === "research"
					? `研究任务 ${id} 至少需要一个检索范围`
					: `任务 ${id} 至少需要一个授权写入路径`,
			);
		if (task.paths.some((path) => !path.trim()))
			throw new Error(`任务 ${id} 的路径不能为空`);
		const paths = Array.from(
			new Set(task.paths.map((path) => normalizeTaskPath(cwd, path))),
		);
		for (const path of paths)
			if (!isWithinPath(path, workspace))
				throw new Error(`任务 ${id} 的路径必须位于当前项目内: ${path}`);
		return { id, task: description, paths, kind };
	});
	for (let left = 0; left < normalized.length; left++) {
		for (let right = left + 1; right < normalized.length; right++) {
			const leftTask = normalized[left];
			const rightTask = normalized[right];
			if (leftTask.kind === "research" && rightTask.kind === "research") continue;
			for (const leftPath of leftTask.paths) {
				const conflict = rightTask.paths.find((rightPath) =>
					pathsOverlap(leftPath, rightPath),
				);
				if (conflict)
					throw new Error(
						`任务路径冲突: ${leftTask.id} (${leftPath}) 与 ${rightTask.id} (${conflict})`,
					);
			}
		}
	}
	return normalized;
}
