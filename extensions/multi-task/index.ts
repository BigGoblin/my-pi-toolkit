import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import { resolveRepoSearchConfig } from "../repo-search-subagent/config.js";
import type { RepoSearchRunConfig } from "../repo-search-subagent/types.js";
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
import {
	batchVisualStatus,
	collectText,
	progressDetails,
	progressText,
	snapshot,
	summarize,
	workerSummary,
} from "./view.js";
import { IMPLEMENTATION_WORKER_EXTENSIONS } from "./worker-extensions.js";
type MultiTaskToolUpdate = {
	content: Array<{ type: "text"; text: string }>;
	details: MultiTaskDetails;
};

function requireBatch(batchId: string | undefined): MultiTaskBatch {
	if (!batchId?.trim()) throw new Error("该操作需要 batchId");
	const batch = getBatch(batchId.trim());
	if (!batch) throw new Error(`未找到 Multi Task 批次: ${batchId}`);
	return batch;
}

function currentModel(params: MultiTaskInput, ctx: ExtensionContext): string {
	if (params.model?.trim()) return params.model.trim();
	if (ctx.model) return `${ctx.model.provider}/${ctx.model.id}`;
	throw new Error("未指定 worker 模型，且主 Agent 当前没有可继承的模型");
}

function researchConfig(
	params: MultiTaskInput,
	ctx: ExtensionContext,
): RepoSearchRunConfig | undefined {
	if (!params.tasks?.some((task) => task.kind === "research")) return undefined;
	return resolveRepoSearchConfig(ctx.cwd, ctx.isProjectTrusted(), ctx.model);
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
		extensionPaths: IMPLEMENTATION_WORKER_EXTENSIONS,
		researchConfig: researchConfig(params, ctx),
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
		extensionPaths: IMPLEMENTATION_WORKER_EXTENSIONS,
		researchConfig: researchConfig(params, ctx),
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
			"Run or manage independent worker agents in one batch. Tasks default to implementation workers; kind=research runs a direct, read-only Repo Search worker at the same level. The default run action streams aggregated progress without polling; start is advanced fire-and-forget. Actions: run, start, status, collect, cancel.",
		promptSnippet:
			"Run independent implementation and read-only repository research tasks concurrently",
		promptGuidelines: [
			"Use multi_task run by default when independent tasks can be completed in one coordinated batch; it streams progress in the existing tool card and returns final reports without status/collect polling.",
			"Set multi_task task.kind to research only for pure read-only exploration spanning multiple files or directories; research runs directly as a Repo Search worker, not as a nested subagent.",
			"Keep multi_task task.kind as implementation when the task must modify files, even if it needs preliminary repository searches; implementation is the default for backward compatibility.",
			"Use multi_task start only when the main agent has other independent work to do while workers run; do not poll status repeatedly, wait for the completion follow-up.",
			"Do not use multi_task for tasks that modify shared files, depend on one another, or require unresolved architecture decisions.",
			"Every multi_task implementation worker loads Pi Lens and must run bounded diagnostics after editing; integrate all worker reports and run project-level verification before declaring the work complete.",
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
						paths: Type.Array(Type.String(), {
							minItems: 1,
							description:
								"Authorized write paths for implementation or read scopes for research",
						}),
						kind: Type.Optional(
							Type.Unsafe<"implementation" | "research">({
								type: "string",
								enum: ["implementation", "research"],
								description:
									"implementation (default) edits authorized paths; research runs a direct read-only Repo Search worker",
							}),
						),
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
