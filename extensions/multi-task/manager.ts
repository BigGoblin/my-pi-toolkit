import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { runRpcSubagent } from "../shared/subagent/rpc-runner.js";
import type { TerminalSubagentUpdate } from "../shared/subagent/terminal-runner.js";
import { buildWorkerTask, MULTI_TASK_WORKER_PROMPT } from "./prompt.js";
import type {
	MultiTaskBatch,
	MultiTaskBatchHandle,
	MultiTaskInputTask,
	MultiTaskWorker,
} from "./types.js";

const BATCHES_KEY = Symbol.for("my-pi-toolkit.multi-task-batches");
const MAX_VISIBLE_TOOL_CALLS = 8;
const PROGRESS_DEBOUNCE_MS = 150;
const globalState = globalThis as Record<PropertyKey, unknown>;
const existing = globalState[BATCHES_KEY];
const batches =
	existing instanceof Map
		? (existing as Map<string, MultiTaskBatch>)
		: new Map<string, MultiTaskBatch>();
globalState[BATCHES_KEY] = batches;
batches.forEach((batch) => {
	batch.workers.forEach((worker) => {
		worker.toolCalls ??= [];
	});
});

interface ProgressEmitter {
	emit(): void;
	flush(): void;
}

const progressEmitters = new Map<string, ProgressEmitter>();

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
		const paths = Array.from(
			new Set(task.paths.map((path) => normalizePath(cwd, path))),
		);
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
		toolCalls: [],
		controller: new AbortController(),
	};
}

function progressKey(batch: MultiTaskBatch): string {
	return batch.workers
		.map((worker) => {
			const lastCall = worker.toolCalls.slice(-1)[0];
			return [
				worker.id,
				worker.status,
				worker.progress ?? "",
				worker.toolCalls.length,
				lastCall?.name ?? "",
			].join(":");
		})
		.join("|");
}

function createProgressEmitter(
	batch: MultiTaskBatch,
	onProgress: ((batch: MultiTaskBatch) => void) | undefined,
): ProgressEmitter {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastKey: string | undefined;
	let pending = false;

	const flush = () => {
		pending = false;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (!onProgress) return;
		const key = progressKey(batch);
		if (key === lastKey) return;
		lastKey = key;
		try {
			onProgress(batch);
		} catch {
			// UI progress must never interrupt worker execution.
		}
	};

	return {
		emit() {
			if (!onProgress) return;
			pending = true;
			if (timer !== undefined) return;
			timer = setTimeout(() => {
				timer = undefined;
				if (pending) flush();
			}, PROGRESS_DEBOUNCE_MS);
		},
		flush,
	};
}

async function executeWorker(
	batch: MultiTaskBatch,
	worker: MultiTaskWorker,
	extensionPaths: string[],
	progress: ProgressEmitter,
): Promise<void> {
	if (batch.cancelRequested) {
		worker.status = "cancelled";
		worker.progress = "cancelled";
		progress.emit();
		return;
	}
	worker.status = "running";
	worker.startedAt = new Date().toISOString();
	progress.emit();
	try {
		const result = await runRpcSubagent({
			cwd: batch.cwd,
			title: `Multi Task · ${worker.id}`,
			model: batch.model,
			task: buildWorkerTask(worker.task, worker.paths),
			systemPrompt: MULTI_TASK_WORKER_PROMPT,
			tools: "read,grep,find,ls,edit,write,lsp_diagnostics,lens_diagnostics",
			extensionPaths,
			parentSessionId: batch.parentSessionId,
			keepOpen: false,
			signal: worker.controller.signal,
			env: {
				PI_MULTI_TASK_ALLOWED_PATHS: JSON.stringify(worker.paths),
			},
			onUpdate: (update: TerminalSubagentUpdate) => {
				worker.progress = update.status;
				worker.toolCalls = update.toolCalls.slice(-MAX_VISIBLE_TOOL_CALLS);
				progress.emit();
			},
		});
		worker.output = result.output;
		worker.runDir = result.runDir;
		worker.status = "completed";
		worker.progress = "completed";
	} catch (error) {
		worker.status = batch.cancelRequested ? "cancelled" : "failed";
		worker.progress = worker.status;
		worker.error = error instanceof Error ? error.message : String(error);
	} finally {
		worker.completedAt = new Date().toISOString();
		progress.emit();
	}
}

async function executeBatch(
	batch: MultiTaskBatch,
	extensionPaths: string[],
	onSettled: ((batch: MultiTaskBatch) => void) | undefined,
	progress: ProgressEmitter,
): Promise<void> {
	let cursor = 0;
	const runNext = async (): Promise<void> => {
		if (cursor >= batch.workers.length || batch.cancelRequested) return;
		const worker = batch.workers[cursor++];
		await executeWorker(batch, worker, extensionPaths, progress);
		return runNext();
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(batch.maxConcurrency, batch.workers.length) },
			runNext,
		),
	);
	if (batch.cancelRequested) {
		for (const worker of batch.workers)
			if (worker.status === "queued") {
				worker.status = "cancelled";
				worker.progress = "cancelled";
			}
		batch.status = "cancelled";
	} else {
		batch.status = batch.workers.some((worker) => worker.status === "failed")
			? "failed"
			: "completed";
	}
	batch.completedAt = new Date().toISOString();
	progress.flush();
	try {
		onSettled?.(batch);
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
	onProgress?: (batch: MultiTaskBatch) => void;
	onSettled?: (batch: MultiTaskBatch) => void;
	signal?: AbortSignal;
}): MultiTaskBatchHandle {
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
	const progress = createProgressEmitter(batch, options.onProgress);
	progressEmitters.set(batch.id, progress);
	const abort = () => cancelBatch(batch);
	if (options.signal?.aborted) abort();
	else options.signal?.addEventListener("abort", abort, { once: true });
	progress.flush();
	const completion = executeBatch(
		batch,
		options.extensionPaths,
		options.onSettled,
		progress,
	).finally(() => {
		options.signal?.removeEventListener("abort", abort);
		progress.flush();
		progressEmitters.delete(batch.id);
	});
	return { batch, completion: completion.then(() => batch) };
}

export function getBatch(id: string): MultiTaskBatch | undefined {
	const batch = batches.get(id);
	if (!batch) return undefined;
	batch.workers.forEach((worker) => {
		worker.toolCalls ??= [];
	});
	return batch;
}

export function cancelBatch(batch: MultiTaskBatch): void {
	if (batch.status !== "running") return;
	batch.cancelRequested = true;
	for (const worker of batch.workers) {
		if (worker.status === "running") worker.controller.abort();
		if (worker.status === "queued") worker.status = "cancelled";
	}
	progressEmitters.get(batch.id)?.emit();
}

export function findActivePathOwner(
	cwd: string,
	path: string,
): { batchId: string; workerId: string } | undefined {
	const candidate = normalizePath(cwd, path);
	let owner: { batchId: string; workerId: string } | undefined;
	batches.forEach((batch) => {
		if (owner || batch.status !== "running" || resolve(batch.cwd) !== resolve(cwd))
			return;
		const worker = batch.workers.find(
			(candidateWorker) =>
				(candidateWorker.status === "queued" ||
					candidateWorker.status === "running") &&
				candidateWorker.paths.some((allowed) =>
					pathsOverlap(candidate, allowed),
				),
		);
		if (worker) owner = { batchId: batch.id, workerId: worker.id };
	});
	return owner;
}

export function cancelBatchesForSession(parentSessionId: string): void {
	batches.forEach((batch) => {
		if (batch.parentSessionId === parentSessionId && batch.status === "running")
			cancelBatch(batch);
	});
}
