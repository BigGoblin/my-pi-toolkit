import { existsSync, readFileSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import {
	abortAllLiveSubagents,
	listLiveSubagents,
	type LiveSubagentRun,
} from "../shared/subagent/registry.js";
import { SUBAGENT_RUNS_ROOT } from "../shared/subagent/run-paths.js";
import {
	openHistoricalSubagentOverlay,
	openSubagentOverlay,
} from "./overlay.js";
import { selectSubagentAction } from "./picker.js";

interface RunSummary {
	dir: string;
	title: string;
	model: string;
	state: "starting" | "running" | "completed" | "failed" | "exited";
	startedAt?: string;
	parentSessionId?: string;
	live?: LiveSubagentRun;
}

function readJson(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function readHistoricalLines(dir: string): string[] {
	const transcriptPath = join(dir, "transcript.jsonl");
	if (existsSync(transcriptPath))
		return readFileSync(transcriptPath, "utf8")
			.split("\n")
			.filter(Boolean)
			.flatMap((record) => {
				try {
					const value = JSON.parse(record) as { line?: unknown };
					return typeof value.line === "string" ? [value.line] : [];
				} catch {
					return [];
				}
			});
	const result = readJson(join(dir, "result.json"));
	if (typeof result?.output === "string") return [result.output];
	return ["该子 Agent 已退出，且没有可用的过程或结果记录。"];
}

function runState(completed: boolean, exited: boolean): RunSummary["state"] {
	if (exited) return "exited";
	if (completed) return "completed";
	return "running";
}

function runIcon(state: RunSummary["state"]): string {
	if (state === "starting" || state === "running") return "⏳";
	if (state === "completed") return "✓";
	if (state === "failed") return "✗";
	return "○";
}

async function listRuns(): Promise<RunSummary[]> {
	const liveRuns = listLiveSubagents();
	const liveIds = new Set(liveRuns.map((run) => run.id));
	const liveSummaries: RunSummary[] = liveRuns.map((run) => ({
		dir: join(SUBAGENT_RUNS_ROOT, run.id),
		title: run.title,
		model: run.model,
		state: run.status,
		startedAt: run.startedAt,
		parentSessionId: run.parentSessionId,
		live: run,
	}));
	if (!existsSync(SUBAGENT_RUNS_ROOT)) return liveSummaries;
	let names: string[];
	try {
		names = await readdir(SUBAGENT_RUNS_ROOT);
	} catch {
		return liveSummaries;
	}
	const runs: RunSummary[] = [];
	for (const name of names) {
		if (liveIds.has(name)) continue;
		const dir = join(SUBAGENT_RUNS_ROOT, name);
		const launch = readJson(join(dir, "launch.json"));
		if (!launch) continue;
		const ready = readJson(join(dir, "ready.json"));
		const completed = existsSync(join(dir, "result.json"));
		const exited = existsSync(join(dir, "exited.json"));
		runs.push({
			dir,
			title: typeof launch.title === "string" ? launch.title : basename(dir),
			model: typeof launch.model === "string" ? launch.model : "unknown",
			state: runState(completed, exited),
			startedAt:
				typeof ready?.startedAt === "string" ? ready.startedAt : undefined,
			parentSessionId:
				typeof launch.parentSessionId === "string"
					? launch.parentSessionId
					: undefined,
		});
	}
	runs.push(...liveSummaries);
	return runs.sort((left, right) =>
		(right.startedAt ?? "").localeCompare(left.startedAt ?? ""),
	);
}

async function showSubagents(ctx: ExtensionContext): Promise<void> {
	const runs = await listRuns();
	if (runs.length === 0) {
		ctx.ui.notify("没有交互式子 Agent 记录", "info");
		return;
	}
	const selection = await selectSubagentAction(
		ctx,
		runs.map((run) => ({
			id: run.dir,
			label: `${runIcon(run.state)} ${run.title} · ${run.state} · ${run.startedAt ?? "未就绪"}`,
			parentSessionId: run.parentSessionId,
			actions: run.live
				? ["进入子 Agent", "显示任务目录", "请求取消", "终止子 Agent"]
				: ["查看详情", "显示任务目录", "请求取消", "清理任务记录"],
		})),
	);
	if (!selection) return;
	const run = runs.find((item) => item.dir === selection.id);
	if (!run) return;
	const { action } = selection;
	if (action === "进入子 Agent" && run.live) {
		await openSubagentOverlay(ctx, run.live);
		return;
	}
	if (action === "查看详情") {
		await openHistoricalSubagentOverlay(ctx, {
			title: run.title,
			model: run.model,
			status: run.state,
			lines: readHistoricalLines(run.dir),
		});
		return;
	}
	if (action === "显示任务目录") {
		ctx.ui.notify(run.dir, "info");
		return;
	}
	if (action === "请求取消") {
		if (run.live) run.live.abort();
		else await writeFile(join(run.dir, "cancel"), "cancel", "utf8");
		ctx.ui.notify(`已请求取消 ${run.title}`, "warning");
		return;
	}
	if (action === "终止子 Agent" && run.live) {
		run.live.dispose();
		ctx.ui.notify(`已终止 ${run.title}`, "warning");
		return;
	}
	if (action === "清理任务记录") {
		if (run.state === "running") {
			const confirmed = await ctx.ui.confirm(
				"取消运行中的子 Agent",
				"运行中的任务必须先取消，退出后才能清理记录。继续吗？",
			);
			if (!confirmed) return;
			await writeFile(join(run.dir, "cancel"), "cancel", "utf8");
			ctx.ui.notify("已请求取消；子 Agent 退出后可再次清理", "warning");
			return;
		}
		await rm(run.dir, { recursive: true, force: true });
		ctx.ui.notify(`已清理 ${run.title}`, "info");
	}
}

async function enterLatestSubagent(ctx: ExtensionContext): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const latest = listLiveSubagents().find(
		(run) => run.parentSessionId === sessionId,
	);
	if (!latest) {
		await showSubagents(ctx);
		return;
	}
	await openSubagentOverlay(ctx, latest);
}

export default function subagentConsole(pi: ExtensionAPI): void {
	pi.on("session_shutdown", (_event: SessionShutdownEvent) => {
		abortAllLiveSubagents();
	});
	pi.registerCommand("subagents", {
		description: "查看、取消或清理交互式子 Agent",
		handler: async (_args: string, ctx: ExtensionCommandContext) =>
			showSubagents(ctx),
	});
	pi.registerShortcut("alt+a", {
		description: "进入最近的交互式子 Agent",
		handler: enterLatestSubagent,
	});
}
