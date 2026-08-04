import { performance } from "node:perf_hooks";
import type {
	CustomEntry,
	EntryRenderOptions,
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { mutedLine } from "../shared/tui/visual-language.js";

const ENTRY_TYPE = "task-duration";

interface TaskDurationEntry {
	durationMs: number;
	completedAt: number;
}

function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	}
	return `${seconds}s`;
}

export default function taskDuration(pi: ExtensionAPI): void {
	let startedAt: number | undefined;

	pi.registerEntryRenderer<TaskDurationEntry>(
		ENTRY_TYPE,
		(
			entry: CustomEntry<TaskDurationEntry>,
			_options: EntryRenderOptions,
			theme: Theme,
		) => {
			const durationMs = Number.isFinite(entry.data?.durationMs)
				? entry.data.durationMs
				: 0;
			return new Text(
				mutedLine(theme, `本次任务耗时 ${formatDuration(durationMs)}`),
				0,
				0,
			);
		},
	);

	pi.on("agent_start", (_event: unknown, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || startedAt !== undefined) return;
		startedAt = performance.now();
	});

	pi.on("agent_settled", (_event: unknown, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || startedAt === undefined) return;
		const durationMs = Math.max(0, performance.now() - startedAt);
		startedAt = undefined;
		pi.appendEntry<TaskDurationEntry>(ENTRY_TYPE, {
			durationMs,
			completedAt: Date.now(),
		});
	});

	pi.on("session_shutdown", () => {
		startedAt = undefined;
	});
}
