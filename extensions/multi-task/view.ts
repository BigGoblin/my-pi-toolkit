import {
	truncateHead,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { statusGlyph } from "../shared/tui/visual-language.js";
import type {
	MultiTaskBatch,
	MultiTaskBatchView,
} from "./types.js";

const MAX_RESULT_BYTES = 50 * 1024;
const MAX_RESULT_LINES = 2000;

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

function workerStatusVisual(
	status: MultiTaskBatchView["workers"][number]["status"],
): "active" | "success" | "error" | "pending" {
	if (status === "running") return "active";
	if (status === "completed") return "success";
	if (status === "queued") return "pending";
	return "error";
}

export function snapshot(
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
			kind: worker.kind,
			model: worker.model,
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

export function summarize(batch: MultiTaskBatchView): string {
	const counts = new Map<string, number>();
	for (const worker of batch.workers)
		counts.set(worker.status, (counts.get(worker.status) ?? 0) + 1);
	const statuses = Array.from(counts.entries())
		.map(([status, count]) => `${status}=${count}`)
		.join(", ");
	return `Batch ${batch.id}: ${batch.status} (${statuses})`;
}

export function progressText(batch: MultiTaskBatchView): string {
	const workers = batch.workers.map((worker) => {
		const lastCall = worker.toolCalls.slice(-1)[0];
		const activity = lastCall
			? `→ ${previewToolCall(lastCall.name, lastCall.arguments)}`
			: worker.progress ?? worker.status;
		return `${worker.id} [${worker.kind}]: ${worker.status} ${activity}`;
	});
	return [summarize(batch), ...workers].join("\n");
}

export function progressDetails(
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
			`${statusGlyph(theme, workerStatusVisual(worker.status))} ${truncateToWidth(`${worker.id} · ${worker.kind} · ${worker.status} · ${activity}`, 120, "…")}`,
		);
		if (expanded) {
			details.push(
				`  └ ${truncateToWidth(`${worker.model} · ${worker.paths.length} scope${worker.paths.length === 1 ? "" : "s"}`, 116, "…")}`,
			);
			for (const call of worker.toolCalls.slice(-4, -1))
				details.push(
					`  └ ${truncateToWidth(`${worker.id}: ${previewToolCall(call.name, call.arguments)}`, 116, "…")}`,
				);
		}
	}
	return details;
}

export function collectText(batch: MultiTaskBatchView): string {
	const reports = batch.workers.map((worker) => {
		const result = worker.output ?? worker.error ?? "No result yet.";
		return `## ${worker.id} · ${worker.kind} · ${worker.status}\n\n${result}`;
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

export function workerSummary(
	count: number | undefined,
	batchId: string | undefined,
): string | undefined {
	if (count === undefined) return batchId;
	return `${count} worker${count === 1 ? "" : "s"}`;
}

export function batchVisualStatus(
	status: MultiTaskBatchView["status"],
): "active" | "success" | "error" {
	if (status === "running") return "active";
	return status === "completed" ? "success" : "error";
}
