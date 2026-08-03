import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { RepoSearchRunConfig } from "../repo-search-subagent/types.js";
import {
	normalizeTaskPath,
	pathsOverlap,
	validateTasks,
} from "./task-policy.js";
import type {
	MultiTaskBatch,
	MultiTaskBatchHandle,
	MultiTaskInputTask,
	MultiTaskWorker,
	NormalizedMultiTaskTask,
} from "./types.js";
import { executeWorker } from "./worker-runner.js";

const BATCHES_KEY = Symbol.for("my-pi-toolkit.multi-task-batches");
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
		worker.kind ??= "implementation";
		worker.model ??= batch.model;
	});
});

interface ProgressEmitter {
	emit(): void;
	flush(): void;
}

const progressEmitters = new Map<string, ProgressEmitter>();

function workerFrom(
	task: NormalizedMultiTaskTask,
	implementationModel: string,
	researchConfig: RepoSearchRunConfig | undefined,
): MultiTaskWorker {
	return {
		...task,
		model:
			task.kind === "research"
				? (researchConfig?.model ?? implementationModel)
				: implementationModel,
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

async function executeBatch(options: {
	batch: MultiTaskBatch;
	extensionPaths: string[];
	researchConfig: RepoSearchRunConfig | undefined;
	onSettled: ((batch: MultiTaskBatch) => void) | undefined;
	progress: ProgressEmitter;
}): Promise<void> {
	const { batch, extensionPaths, researchConfig, onSettled, progress } = options;
	let cursor = 0;
	const runNext = async (): Promise<void> => {
		if (cursor >= batch.workers.length || batch.cancelRequested) return;
		const worker = batch.workers[cursor++];
		await executeWorker({
			batch,
			worker,
			extensionPaths,
			researchConfig,
			emitProgress: progress.emit,
		});
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
	researchConfig?: RepoSearchRunConfig;
	onProgress?: (batch: MultiTaskBatch) => void;
	onSettled?: (batch: MultiTaskBatch) => void;
	signal?: AbortSignal;
}): MultiTaskBatchHandle {
	const tasks = validateTasks(options.cwd, options.tasks);
	if (tasks.some((task) => task.kind === "research") && !options.researchConfig)
		throw new Error("research 任务需要 Repo Search 配置");
	for (const task of tasks) {
		for (const path of task.paths) {
			const owner = findActiveTaskConflict(options.cwd, path, task.kind);
			if (owner)
				throw new Error(
					`任务路径正由 worker ${owner.workerId} 使用（batch ${owner.batchId}）: ${path}`,
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
		workers: tasks.map((task) =>
			workerFrom(task, options.model, options.researchConfig),
		),
	};
	batches.set(batch.id, batch);
	const progress = createProgressEmitter(batch, options.onProgress);
	progressEmitters.set(batch.id, progress);
	const abort = () => cancelBatch(batch);
	if (options.signal?.aborted) abort();
	else options.signal?.addEventListener("abort", abort, { once: true });
	progress.flush();
	const completion = executeBatch({
		batch,
		extensionPaths: options.extensionPaths,
		researchConfig: options.researchConfig,
		onSettled: options.onSettled,
		progress,
	}).finally(() => {
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
		worker.kind ??= "implementation";
		worker.model ??= batch.model;
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

function activePathOwner(
	cwd: string,
	path: string,
	includeResearch: boolean,
): { batchId: string; workerId: string } | undefined {
	const candidate = normalizeTaskPath(cwd, path);
	let owner: { batchId: string; workerId: string } | undefined;
	batches.forEach((batch) => {
		if (owner || batch.status !== "running" || resolve(batch.cwd) !== resolve(cwd))
			return;
		const worker = batch.workers.find(
			(candidateWorker) =>
				(includeResearch || candidateWorker.kind === "implementation") &&
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

function findActiveTaskConflict(
	cwd: string,
	path: string,
	kind: NormalizedMultiTaskTask["kind"],
): { batchId: string; workerId: string } | undefined {
	return activePathOwner(cwd, path, kind === "implementation");
}

export function findActivePathOwner(
	cwd: string,
	path: string,
): { batchId: string; workerId: string } | undefined {
	return activePathOwner(cwd, path, false);
}

export function cancelBatchesForSession(parentSessionId: string): void {
	batches.forEach((batch) => {
		if (batch.parentSessionId === parentSessionId && batch.status === "running")
			cancelBatch(batch);
	});
}
