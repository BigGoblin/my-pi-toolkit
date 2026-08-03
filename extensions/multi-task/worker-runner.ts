import { runRepoSearchSubagent } from "../repo-search-subagent/runner.js";
import type { RepoSearchRunConfig } from "../repo-search-subagent/types.js";
import { runRpcSubagent } from "../shared/subagent/rpc-runner.js";
import type { TerminalSubagentUpdate } from "../shared/subagent/terminal-runner.js";
import { buildWorkerTask, MULTI_TASK_WORKER_PROMPT } from "./prompt.js";
import type { MultiTaskBatch, MultiTaskWorker } from "./types.js";

const IMPLEMENTATION_TOOLS =
	"read,grep,find,ls,edit,write,lsp_diagnostics,lens_diagnostics";
const MAX_VISIBLE_TOOL_CALLS = 8;

function researchTask(worker: MultiTaskWorker): string {
	return [
		worker.task,
		"",
		"Repository search scopes:",
		...worker.paths.map((path) => `- ${path}`),
	].join("\n");
}

async function runImplementation(
	batch: MultiTaskBatch,
	worker: MultiTaskWorker,
	extensionPaths: string[],
	emitProgress: () => void,
): Promise<void> {
	const result = await runRpcSubagent({
		cwd: batch.cwd,
		title: `Multi Task · ${worker.id}`,
		model: worker.model,
		task: buildWorkerTask(worker.task, worker.paths),
		systemPrompt: MULTI_TASK_WORKER_PROMPT,
		tools: IMPLEMENTATION_TOOLS,
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
			emitProgress();
		},
	});
	worker.output = result.output;
	worker.runDir = result.runDir;
}

async function runResearch(
	batch: MultiTaskBatch,
	worker: MultiTaskWorker,
	config: RepoSearchRunConfig,
	emitProgress: () => void,
): Promise<void> {
	const result = await runRepoSearchSubagent({
		cwd: batch.cwd,
		task: researchTask(worker),
		config: { ...config, presentation: "manual" },
		keepOpen: false,
		parentSessionId: batch.parentSessionId,
		signal: worker.controller.signal,
		onUpdate: (details) => {
			worker.progress = "searching";
			worker.toolCalls = details.toolCalls.slice(-MAX_VISIBLE_TOOL_CALLS);
			emitProgress();
		},
	});
	worker.output = result.details.output;
	worker.runDir = result.details.runDir;
}

export async function executeWorker(options: {
	batch: MultiTaskBatch;
	worker: MultiTaskWorker;
	extensionPaths: string[];
	researchConfig?: RepoSearchRunConfig;
	emitProgress: () => void;
}): Promise<void> {
	const { batch, worker, extensionPaths, researchConfig, emitProgress } = options;
	if (batch.cancelRequested) {
		worker.status = "cancelled";
		worker.progress = "cancelled";
		emitProgress();
		return;
	}
	worker.status = "running";
	worker.startedAt = new Date().toISOString();
	emitProgress();
	try {
		if (worker.kind === "research") {
			if (!researchConfig) throw new Error("research worker 缺少 Repo Search 配置");
			await runResearch(batch, worker, researchConfig, emitProgress);
		} else {
			await runImplementation(batch, worker, extensionPaths, emitProgress);
		}
		worker.status = "completed";
		worker.progress = "completed";
	} catch (error) {
		worker.status = batch.cancelRequested ? "cancelled" : "failed";
		worker.progress = worker.status;
		worker.error = error instanceof Error ? error.message : String(error);
	} finally {
		worker.completedAt = new Date().toISOString();
		emitProgress();
	}
}
