export type MultiTaskAction = "start" | "status" | "collect" | "cancel";
export type BatchStatus = "running" | "completed" | "failed" | "cancelled";
export type WorkerStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface MultiTaskInputTask {
	id: string;
	task: string;
	paths: string[];
}

export interface MultiTaskInput {
	action: MultiTaskAction;
	batchId?: string;
	tasks?: MultiTaskInputTask[];
	maxConcurrency?: number;
	model?: string;
}

export interface MultiTaskWorker {
	id: string;
	task: string;
	paths: string[];
	status: WorkerStatus;
	startedAt?: string;
	completedAt?: string;
	output?: string;
	error?: string;
	runDir?: string;
	controller: AbortController;
}

export interface MultiTaskBatch {
	id: string;
	cwd: string;
	model: string;
	parentSessionId: string;
	status: BatchStatus;
	createdAt: string;
	completedAt?: string;
	maxConcurrency: number;
	cancelRequested: boolean;
	workers: MultiTaskWorker[];
}

export interface MultiTaskWorkerView {
	id: string;
	task: string;
	paths: string[];
	status: WorkerStatus;
	startedAt?: string;
	completedAt?: string;
	output?: string;
	error?: string;
	runDir?: string;
}

export interface MultiTaskBatchView {
	id: string;
	model: string;
	status: BatchStatus;
	createdAt: string;
	completedAt?: string;
	maxConcurrency: number;
	workers: MultiTaskWorkerView[];
}

export interface MultiTaskDetails {
	action: MultiTaskAction;
	batch: MultiTaskBatchView;
}
