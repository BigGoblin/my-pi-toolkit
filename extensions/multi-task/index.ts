import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
	truncateHead,
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { statusGlyph } from "../shared/tui/visual-language.js";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
// @ts-expect-error -- TypeBox's .d.mts exports require a newer resolver than the workspace LSP.
import { Type } from "typebox";
import {
	cancelBatch,
	cancelBatchesForSession,
	findActivePathOwner,
	getBatch,
	startBatch,
} from "./manager.js";
import type {
	MultiTaskBatch,
	MultiTaskBatchView,
	MultiTaskDetails,
	MultiTaskInput,
} from "./types.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PATH_GUARD_EXTENSION = resolve(EXTENSION_DIR, "path-guard.ts");
const PI_LENS_EXTENSION = resolve(EXTENSION_DIR, "../pi-lens/index.js");
const CURSOR_PROVIDER_EXTENSION = resolve(
	EXTENSION_DIR,
	"../cursor-models/index.ts",
);
const WORKER_EXTENSIONS = [
	CURSOR_PROVIDER_EXTENSION,
	PI_LENS_EXTENSION,
	PATH_GUARD_EXTENSION,
];
const MAX_RESULT_BYTES = 50 * 1024;
const MAX_RESULT_LINES = 2000;

type MultiTaskToolUpdate = {
	content: Array<{ type: "text"; text: string }>;
	details: MultiTaskDetails;
};

function snapshot(
	batch: MultiTaskBatch,
	includeOutput: boolean,
): MultiTaskBatchView {
	return {
		id: batch.id,
		model: batch.model,
		status: batch.status,
		createdAt: batch.createdAt,
		completedAt: batch.completedAt,
		maxConcurrency: batch.maxConcurrency,
		workers: batch.workers.map((worker) => ({
			id: worker.id,
			task: worker.task,
			paths: worker.paths,
			status: worker.status,
			startedAt: worker.startedAt,
			completedAt: worker.completedAt,
			progress: worker.progress,
			toolCalls: worker.toolCalls,
			...(includeOutput
				? { output: worker.output, runDir: worker.runDir }
				: {}),
			error: worker.error,
		})),
	};
}

function requireBatch(batchId: string | undefined): MultiTaskBatch {
	if (!batchId?.trim()) throw new Error("该操作需要 batchId");
	const batch = getBatch(batchId.trim());
	if (!batch) throw new Error(`未找到 Multi Task 批次: ${batchId}`);
	return batch;
}

function summarize(batch: MultiTaskBatchView): string {
	const counts = new Map<string, number>();
	for (const worker of batch.workers)
		counts.set(worker.status, (counts.get(worker.status) ?? 0) + 1);
	const statuses = Array.from(counts.entries())
		.map(([status, count]) => `${status}=${count}`)
		.join(", ");
	return `Batch ${batch.id}: ${batch.status} (${statuses})`;
}

function progressText(batch: MultiTaskBatchView): string {
	const workers = batch.workers.map((worker) => {
		const lastCall = worker.toolCalls.slice(-1)[0];
		const activity = lastCall
			? `→ ${previewToolCall(lastCall.name, lastCall.arguments)}`
			: worker.progress ?? worker.status;
		return `${worker.id}: ${worker.status} ${activity}`;
	});
	return [summarize(batch), ...workers].join("\n");
}

function workerStatusVisual(
	status: MultiTaskBatchView["workers"][number]["status"],
): "active" | "success" | "error" | "pending" {
	if (status === "running") return "active";
	if (status === "completed") return "success";
	if (status === "queued") return "pending";
	return "error";
}

type ClipValue = (value: unknown, width?: number) => string;
type ToolPreviewer = (args: Record<string, unknown>, clip: ClipValue) => string;

const TOOL_PREVIEWERS: Record<string, ToolPreviewer> = {
	read: (args, clip) => `read ${clip(args.path ?? "...")}`,
	write: (args, clip) => `write ${clip(args.path ?? "...")}`,
	edit: (args, clip) => `edit ${clip(args.path ?? "...")}`,
	grep: (args, clip) =>
		`grep /${clip(args.pattern ?? "", 36)}/ in ${clip(args.path ?? ".")}`,
	find: (args, clip) =>
		`find ${clip(args.pattern ?? "*", 36)} in ${clip(args.path ?? ".")}`,
	ls: (args, clip) => `ls ${clip(args.path ?? ".")}`,
};

function previewToolCall(
	name: string,
	args: Record<string, unknown>,
): string {
	const clip: ClipValue = (value, width = 56) =>
		truncateToWidth(String(value ?? ""), width, "…");
	return TOOL_PREVIEWERS[name]?.(args, clip) ?? clip(name, 72);
}

function progressDetails(
	batch: MultiTaskBatchView,
	theme: Theme,
	expanded: boolean,
): string[] {
	const details: string[] = [];
	for (const worker of batch.workers) {
		const lastCall = worker.toolCalls.slice(-1)[0];
		const activity = lastCall
			? previewToolCall(lastCall.name, lastCall.arguments)
			: worker.progress ?? worker.status;
		details.push(
			`${statusGlyph(theme, workerStatusVisual(worker.status))} ${truncateToWidth(`${worker.id} · ${worker.status} · ${activity}`, 120, "…")}`,
		);
		if (expanded) {
			for (const call of worker.toolCalls.slice(-4, -1))
				details.push(
					`  └ ${truncateToWidth(`${worker.id}: ${previewToolCall(call.name, call.arguments)}`, 116, "…")}`,
				);
		}
	}
	return details;
}

function collectText(batch: MultiTaskBatchView): string {
	const reports = batch.workers.map((worker) => {
		const result = worker.output ?? worker.error ?? "No result yet.";
		return `## ${worker.id} · ${worker.status}\n\n${result}`;
	});
	const output = `${summarize(batch)}\n\n${reports.join("\n\n")}`;
	const truncated = truncateHead(output, {
		maxBytes: MAX_RESULT_BYTES,
		maxLines: MAX_RESULT_LINES,
	});
	return truncated.truncated
		? `${truncated.content}\n\n[Multi Task 输出已截断；完整 worker 输出保存在工具 details 中。]`
		: truncated.content;
}

function workerSummary(
	count: number | undefined,
	batchId: string | undefined,
): string | undefined {
	if (count === undefined) return batchId;
	return `${count} worker${count === 1 ? "" : "s"}`;
}

function batchVisualStatus(
	status: MultiTaskBatchView["status"],
): "active" | "success" | "error" {
	if (status === "running") return "active";
	return status === "completed" ? "success" : "error";
}

function currentModel(params: MultiTaskInput, ctx: ExtensionContext): string {
	if (params.model?.trim()) return params.model.trim();
	if (ctx.model) return `${ctx.model.provider}/${ctx.model.id}`;
	throw new Error("未指定 worker 模型，且主 Agent 当前没有可继承的模型");
}

interface MultiTaskExecutionOptions {
	params: MultiTaskInput;
	signal: AbortSignal | undefined;
	onUpdate: ((partial: MultiTaskToolUpdate) => void) | undefined;
	ctx: ExtensionContext;
	pi: ExtensionAPI;
}

type MultiTaskToolExecuteArgs = [
	string,
	MultiTaskInput,
	AbortSignal | undefined,
	((partial: MultiTaskToolUpdate) => void) | undefined,
	ExtensionContext,
];

async function runBatch(
	options: MultiTaskExecutionOptions,
): Promise<MultiTaskBatch> {
	const { params, ctx, signal, onUpdate } = options;
	if (!params.tasks) throw new Error("multi_task run 需要 tasks");
	const handle = startBatch({
		cwd: ctx.cwd,
		model: currentModel(params, ctx),
		parentSessionId: ctx.sessionManager.getSessionId(),
		tasks: params.tasks,
		maxConcurrency: params.maxConcurrency ?? 3,
		extensionPaths: WORKER_EXTENSIONS,
		signal,
		onProgress: (current) => {
			const view = snapshot(current, false);
			onUpdate?.({
				content: [{ type: "text", text: progressText(view) }],
				details: { action: "run", batch: view },
			});
		},
	});
	const batch = await handle.completion;
	if (signal?.aborted) throw new Error("Multi Task 已取消");
	return batch;
}

function startBackgroundBatch(
	options: MultiTaskExecutionOptions,
): MultiTaskBatch {
	const { params, ctx, pi } = options;
	if (!params.tasks) throw new Error("multi_task start 需要 tasks");
	const handle = startBatch({
		cwd: ctx.cwd,
		model: currentModel(params, ctx),
		parentSessionId: ctx.sessionManager.getSessionId(),
		tasks: params.tasks,
		maxConcurrency: params.maxConcurrency ?? 3,
		extensionPaths: WORKER_EXTENSIONS,
		onSettled: (settled) =>
			pi.sendMessage(
				{
					customType: "multi-task-complete",
					content: `Multi Task batch ${settled.id} finished with status ${settled.status}. Do not poll this background batch; call multi_task collect with this batchId after this completion notice, integrate the results, then run project-level verification.`,
					display: true,
					details: { batchId: settled.id, status: settled.status },
				},
				{ deliverAs: "followUp", triggerTurn: true },
			),
	});
	return handle.batch;
}

function responseText(
	action: MultiTaskInput["action"],
	view: MultiTaskBatchView,
	includeOutput: boolean,
): string {
	if (includeOutput) return collectText(view);
	if (action === "start")
		return `${summarize(view)}\n\n后台批次已启动；等待完成通知，不要轮询 status。`;
	if (action === "status") return progressText(view);
	return summarize(view);
}

async function executeMultiTask(
	options: MultiTaskExecutionOptions,
): Promise<{
	content: Array<{ type: "text"; text: string }>;
	details: MultiTaskDetails;
}> {
	const { params } = options;
	let batch: MultiTaskBatch;
	let includeOutput = false;
	if (params.action === "run") {
		batch = await runBatch(options);
		includeOutput = true;
	} else if (params.action === "start") {
		batch = startBackgroundBatch(options);
	} else if (params.action === "status") {
		batch = requireBatch(params.batchId);
	} else if (params.action === "collect") {
		batch = requireBatch(params.batchId);
		includeOutput = true;
	} else if (params.action === "cancel") {
		batch = requireBatch(params.batchId);
		cancelBatch(batch);
	} else {
		throw new Error(`不支持的 Multi Task 操作: ${String(params.action)}`);
	}
	const view = snapshot(batch, includeOutput);
	return {
		content: [{ type: "text", text: responseText(params.action, view, includeOutput) }],
		details: { action: params.action, batch: view },
	};
}

function createMultiTaskTool(pi: ExtensionAPI) {
	return {
		name: "multi_task",
		label: "Multi Task",
		description:
			"Run or manage isolated worker agents for independent, non-overlapping file tasks. The default run action keeps one tool call open and streams aggregated worker progress without polling; start is the advanced fire-and-forget mode. Actions: run, start, status, collect, cancel.",
		promptSnippet:
			"Run independent, non-overlapping file tasks concurrently in background worker agents",
		promptGuidelines: [
			"Use multi_task run by default when independent tasks can be completed in one coordinated batch; it streams progress in the existing tool card and returns final reports without status/collect polling.",
			"Use multi_task start only when the main agent has other independent work to do while workers run; do not poll status repeatedly, wait for the completion follow-up.",
			"Do not use multi_task for tasks that modify shared files, depend on one another, or require unresolved architecture decisions.",
			"Every multi_task worker loads Pi Lens and must run bounded diagnostics after editing; integrate worker reports and run project-level verification before declaring the work complete.",
		],
		parameters: Type.Object({
			action: Type.Unsafe<MultiTaskInput["action"]>({
				type: "string",
				enum: ["run", "start", "status", "collect", "cancel"],
			}),
			batchId: Type.Optional(Type.String()),
			tasks: Type.Optional(
				Type.Array(
					Type.Object({
						id: Type.String(),
						task: Type.String(),
						paths: Type.Array(Type.String(), { minItems: 1 }),
					}),
					{ maxItems: 8 },
				),
			),
			maxConcurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 6 })),
			model: Type.Optional(Type.String()),
		}),
		async execute(...args: MultiTaskToolExecuteArgs) {
			const [, params, signal, onUpdate, ctx] = args;
			return executeMultiTask({ params, signal, onUpdate, ctx, pi });
		},
		renderCall(args: MultiTaskInput, theme: Theme) {
			const count = args.tasks?.length;
			return toolCall(
				theme,
				"multi_task",
				args.action,
				workerSummary(count, args.batchId),
			);
		},
		renderResult(
			result: AgentToolResult<MultiTaskDetails>,
			{ expanded, isPartial }: ToolRenderResultOptions,
			theme: Theme,
		) {
			const batch = result.details?.batch;
			if (!batch) {
				return toolResult(theme, {
					status: "error",
					title: "multi_task",
					summary: "no batch details",
				});
			}
			let hasOutput = false;
			for (const worker of batch.workers) {
				if (worker.output || worker.error) {
					hasOutput = true;
					break;
				}
			}
			return toolResult(theme, {
				status: batchVisualStatus(batch.status),
				title: isPartial ? "multi_task · running" : "multi_task",
				summary: summarize(batch),
				details: progressDetails(batch, theme, expanded),
				body: expanded && hasOutput ? collectText(batch) : undefined,
				hint:
					!expanded && hasOutput ? "(Ctrl+O to expand worker reports)" : undefined,
			});
		},
	};
}

export default function multiTaskExtension(pi: ExtensionAPI): void {
	pi.registerTool(createMultiTaskTool(pi));

	pi.on("tool_call", (event: unknown, ctx: ExtensionContext) => {
		const toolEvent = event as { toolName: string; input: unknown };
		if (toolEvent.toolName !== "edit" && toolEvent.toolName !== "write") return;
		const path = (toolEvent.input as { path?: unknown }).path;
		if (typeof path !== "string") return;
		const owner = findActivePathOwner(ctx.cwd, path.replace(/^@/, ""));
		if (!owner) return;
		return {
			block: true,
			reason: `路径正由 Multi Task worker ${owner.workerId} 使用（batch ${owner.batchId}）`,
		};
	});

	pi.on("session_shutdown", (_event: unknown, ctx: ExtensionContext) => {
		cancelBatchesForSession(ctx.sessionManager.getSessionId());
	});
}
