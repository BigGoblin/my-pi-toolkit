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
import { Text } from "@earendil-works/pi-tui";
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
const CURSOR_PROVIDER_EXTENSION = resolve(
	EXTENSION_DIR,
	"../cursor-models/index.ts",
);
const MAX_RESULT_BYTES = 50 * 1024;
const MAX_RESULT_LINES = 2000;

function snapshot(batch: MultiTaskBatch, includeOutput: boolean): MultiTaskBatchView {
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
			...(includeOutput ? { output: worker.output, runDir: worker.runDir } : {}),
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

function currentModel(
	params: MultiTaskInput,
	ctx: ExtensionContext,
): string {
	if (params.model?.trim()) return params.model.trim();
	if (ctx.model) return `${ctx.model.provider}/${ctx.model.id}`;
	throw new Error("未指定 worker 模型，且主 Agent 当前没有可继承的模型");
}

export default function multiTaskExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "multi_task",
		label: "Multi Task",
		description:
			"Start and manage a background pool of isolated worker agents for independent, non-overlapping file tasks. Actions: start, status, collect, cancel.",
		promptSnippet:
			"Run independent, non-overlapping file tasks concurrently in background worker agents",
		promptGuidelines: [
			"Use multi_task only when tasks are independent, have explicit non-overlapping write paths, and the main agent can continue without their immediate results.",
			"Do not use multi_task for tasks that modify shared files, depend on one another, or require unresolved architecture decisions.",
			"After a multi_task batch completes, collect its results and run project-level verification before declaring the work complete.",
		],
		parameters: Type.Object({
			action: Type.Unsafe<MultiTaskInput["action"]>({
				type: "string",
				enum: ["start", "status", "collect", "cancel"],
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
			maxConcurrency: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 6 }),
			),
			model: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params: MultiTaskInput, _signal, _onUpdate, ctx) {
			let batch: MultiTaskBatch;
			let includeOutput = false;
			switch (params.action) {
				case "start": {
					if (!params.tasks) throw new Error("multi_task start 需要 tasks");
					batch = startBatch({
						cwd: ctx.cwd,
						model: currentModel(params, ctx),
						parentSessionId: ctx.sessionManager.getSessionId(),
						tasks: params.tasks,
						maxConcurrency: params.maxConcurrency ?? 3,
						extensionPaths: [
							CURSOR_PROVIDER_EXTENSION,
							PATH_GUARD_EXTENSION,
						],
						onSettled: (settled) =>
							pi.sendMessage(
								{
									customType: "multi-task-complete",
									content: `Multi Task batch ${settled.id} finished with status ${settled.status}. Call multi_task collect with this batchId, integrate the results, then run project-level verification.`,
									display: true,
									details: { batchId: settled.id, status: settled.status },
								},
								{ deliverAs: "followUp", triggerTurn: true },
							),
					});
					break;
				}
				case "status":
					batch = requireBatch(params.batchId);
					break;
				case "collect":
					batch = requireBatch(params.batchId);
					includeOutput = true;
					break;
				case "cancel":
					batch = requireBatch(params.batchId);
					cancelBatch(batch);
					break;
			}
			const view = snapshot(batch, includeOutput);
			const text = includeOutput ? collectText(view) : summarize(view);
			return {
				content: [{ type: "text" as const, text }],
				details: { action: params.action, batch: view } as MultiTaskDetails,
			};
		},
		renderCall(args: MultiTaskInput, theme: Theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("multi_task "))}${theme.fg("muted", args.action)}`,
				0,
				0,
			);
		},
		renderResult(
			result: AgentToolResult<MultiTaskDetails>,
			_options: ToolRenderResultOptions,
			theme: Theme,
		) {
			const batch = result.details?.batch;
			if (!batch) return new Text("Multi Task returned no batch details", 0, 0);
			const icon = batch.status === "running" ? "⏳" : batch.status === "completed" ? "✓" : "✗";
			return new Text(
				`${theme.fg(batch.status === "completed" ? "success" : batch.status === "running" ? "warning" : "error", icon)} ${theme.fg("toolTitle", "multi_task")} ${theme.fg("muted", summarize(batch))}`,
				0,
				0,
			);
		},
	});

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const path = (event.input as { path?: unknown }).path;
		if (typeof path !== "string") return;
		const owner = findActivePathOwner(ctx.cwd, path.replace(/^@/, ""));
		if (!owner) return;
		return {
			block: true,
			reason: `路径正由 Multi Task worker ${owner.workerId} 使用（batch ${owner.batchId}）`,
		};
	});

	pi.on("session_shutdown", (_event, ctx) => {
		cancelBatchesForSession(ctx.sessionManager.getSessionId());
	});
}
