import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { runRpcSubagent } from "../shared/subagent/rpc-runner.js";
import { buildWorkerTask, MULTI_TASK_WORKER_PROMPT } from "./prompt.js";
import type {
	MultiTaskBatch,
	MultiTaskInputTask,
	MultiTaskWorker,
} from "./types.js";

const BATCHES_KEY = Symbol.for("my-pi-toolkit.multi-task-batches");
const globalState = globalThis as Record<PropertyKey, unknown>;
const existing = globalState[BATCHES_KEY];
const batches =
	existing instanceof Map
		? (existing as Map<string, MultiTaskBatch>)
		: new Map<string, MultiTaskBatch>();
globalState[BATCHES_KEY] = batches;

function canonicalize(path: string): string {
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

function normalizePath(cwd: string, path: string): string {
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

function pathsOverlap(left: string, right: string): boolean {
	return isWithinPath(left, right) || isWithinPath(right, left);
}

function validateTasks(cwd: string, tasks: MultiTaskInputTask[]): MultiTaskInputTask[] {
	if (tasks.length === 0) throw new Error("multi_task start 至少需要一个任务");
	if (tasks.length > 8) throw new Error("multi_task 每批最多允许 8 个任务");
	const ids = new Set<string>();
	const normalized = tasks.map((task) => {
		const id = task.id.trim();
		const description = task.task.trim();
		if (!id || !description) throw new Error("每个任务都需要非空 id 和 task");
		if (ids.has(id)) throw new Error(`任务 id 重复: ${id}`);
		ids.add(id);
		if (task.paths.length === 0)
			throw new Error(`任务 ${id} 至少需要一个授权写入路径`);
		if (task.paths.some((path) => !path.trim()))
			throw new Error(`任务 ${id} 的授权路径不能为空`);
		const paths = [
			...new Set(task.paths.map((path) => normalizePath(cwd, path))),
		];
		const workspace = canonicalize(cwd);
		for (const path of paths)
			if (!isWithinPath(path, workspace))
				throw new Error(`任务 ${id} 的授权路径必须位于当前项目内: ${path}`);
		return { id, task: description, paths };
	});
	for (let left = 0; left < normalized.length; left++) {
		for (let right = left + 1; right < normalized.length; right++) {
			for (const leftPath of normalized[left].paths) {
				const conflict = normalized[right].paths.find((rightPath) =>
					pathsOverlap(leftPath, rightPath),
				);
				if (conflict)
					throw new Error(
						`任务路径冲突: ${normalized[left].id} (${leftPath}) 与 ${normalized[right].id} (${conflict})`,
					);
			}
		}
	}
	return normalized;
}

function workerFrom(task: MultiTaskInputTask): MultiTaskWorker {
	return {
		...task,
		status: "queued",
		controller: new AbortController(),
	};
}

async function executeWorker(
	batch: MultiTaskBatch,
	worker: MultiTaskWorker,
	extensionPaths: string[],
): Promise<void> {
	if (batch.cancelRequested) {
		worker.status = "cancelled";
		return;
	}
	worker.status = "running";
	worker.startedAt = new Date().toISOString();
	try {
		const result = await runRpcSubagent({
			cwd: batch.cwd,
			title: `Multi Task · ${worker.id}`,
			model: batch.model,
			task: buildWorkerTask(worker.task, worker.paths),
			systemPrompt: MULTI_TASK_WORKER_PROMPT,
			tools: "read,grep,find,ls,edit,write",
			extensionPaths,
			parentSessionId: batch.parentSessionId,
			keepOpen: false,
			signal: worker.controller.signal,
			env: {
				PI_MULTI_TASK_ALLOWED_PATHS: JSON.stringify(worker.paths),
			},
		});
		worker.output = result.output;
		worker.runDir = result.runDir;
		worker.status = "completed";
	} catch (error) {
		worker.status = batch.cancelRequested ? "cancelled" : "failed";
		worker.error = error instanceof Error ? error.message : String(error);
	} finally {
		worker.completedAt = new Date().toISOString();
	}
}

async function executeBatch(
	batch: MultiTaskBatch,
	extensionPaths: string[],
	onSettled: (batch: MultiTaskBatch) => void,
): Promise<void> {
	let cursor = 0;
	const runNext = async () => {
		while (cursor < batch.workers.length && !batch.cancelRequested) {
			const worker = batch.workers[cursor++];
			await executeWorker(batch, worker, extensionPaths);
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(batch.maxConcurrency, batch.workers.length) },
			runNext,
		),
	);
	if (batch.cancelRequested) {
		for (const worker of batch.workers)
			if (worker.status === "queued") worker.status = "cancelled";
		batch.status = "cancelled";
	} else {
		batch.status = batch.workers.some((worker) => worker.status === "failed")
			? "failed"
			: "completed";
	}
	batch.completedAt = new Date().toISOString();
	try {
		onSettled(batch);
	} catch {
		// The parent session may already be shutting down; results remain collectable.
	}
}

export function startBatch(options: {
	cwd: string;
	model: string;
	parentSessionId: string;
	tasks: MultiTaskInputTask[];
	maxConcurrency: number;
	extensionPaths: string[];
	onSettled: (batch: MultiTaskBatch) => void;
}): MultiTaskBatch {
	const tasks = validateTasks(options.cwd, options.tasks);
	for (const task of tasks) {
		for (const path of task.paths) {
			const owner = findActivePathOwner(options.cwd, path);
			if (owner)
				throw new Error(
					`授权路径正由 worker ${owner.workerId} 使用（batch ${owner.batchId}）: ${path}`,
				);
		}
	}
	const batch: MultiTaskBatch = {
		id: randomUUID(),
		cwd: options.cwd,
		model: options.model,
		parentSessionId: options.parentSessionId,
		status: "running",
		createdAt: new Date().toISOString(),
		maxConcurrency: Math.min(6, Math.max(1, options.maxConcurrency)),
		cancelRequested: false,
		workers: tasks.map(workerFrom),
	};
	batches.set(batch.id, batch);
	void executeBatch(batch, options.extensionPaths, options.onSettled);
	return batch;
}

export function getBatch(id: string): MultiTaskBatch | undefined {
	return batches.get(id);
}

export function cancelBatch(batch: MultiTaskBatch): void {
	if (batch.status !== "running") return;
	batch.cancelRequested = true;
	for (const worker of batch.workers) {
		if (worker.status === "running") worker.controller.abort();
		if (worker.status === "queued") worker.status = "cancelled";
	}
}

export function findActivePathOwner(
	cwd: string,
	path: string,
): { batchId: string; workerId: string } | undefined {
	const candidate = normalizePath(cwd, path);
	for (const batch of batches.values()) {
		if (batch.status !== "running" || resolve(batch.cwd) !== resolve(cwd)) continue;
		for (const worker of batch.workers)
			if (
				(worker.status === "queued" || worker.status === "running") &&
				worker.paths.some((allowed) => pathsOverlap(candidate, allowed))
			)
				return { batchId: batch.id, workerId: worker.id };
	}
	return undefined;
}

export function cancelBatchesForSession(parentSessionId: string): void {
	for (const batch of batches.values())
		if (batch.parentSessionId === parentSessionId && batch.status === "running")
			cancelBatch(batch);
}
