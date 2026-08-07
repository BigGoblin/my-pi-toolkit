import type {
	ExtensionAPI,
	ExtensionCommandContext,
	MessageRenderOptions,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { TapdConfig } from "../types.js";
import {
	buildGitCard,
	publishCard,
	truncateDisplayResult,
	type TapdGitMessageDetails,
} from "./card-live.js";
import { runMergeRequest } from "./merge-request-workflow.js";
import type { GitCommandKind, GitCommandProgress } from "./types.js";
import {
	GitWorkingCancel,
	abortError,
	isAbortError,
} from "./working-cancel.js";
import {
	describeGitStatus,
	runCommitPush,
	runCreateBranch,
} from "./workflow.js";

const MESSAGE_TYPE = "tapd-git-command";
const RECENT_RUNS_KEY = Symbol.for("my-pi-toolkit.tapd.git.recent-runs");
const GIT_COMMANDS = new Set<GitCommandKind>([
	"git-status",
	"branch",
	"commit",
	"mr",
]);

function recentRuns(): Map<string, number> {
	const shared = globalThis as typeof globalThis & {
		[RECENT_RUNS_KEY]?: Map<string, number>;
	};
	return (shared[RECENT_RUNS_KEY] ??= new Map<string, number>());
}

function optionValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

interface TapdGitCustomMessage {
	content: unknown;
	details?: TapdGitMessageDetails;
}

export function registerTapdGitMessageRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<TapdGitMessageDetails>(
		MESSAGE_TYPE,
		(
			message: TapdGitCustomMessage,
			options: MessageRenderOptions,
			theme: Theme,
		) =>
			buildGitCard(
				message.details,
				typeof message.content === "string" ? message.content : "",
				options.expanded,
				theme,
			),
	);
}

function startCard(
	pi: ExtensionAPI,
	command: GitCommandKind,
): TapdGitMessageDetails {
	const details: TapdGitMessageDetails = {
		command,
		status: "active",
		runId: `${command}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		history: [],
	};
	pi.sendMessage({
		customType: MESSAGE_TYPE,
		content: `TAPD ${command} workflow`,
		display: true,
		details: {
			command: details.command,
			status: details.status,
			runId: details.runId,
			history: [],
		},
	});
	return details;
}

function finishCard(
	pi: ExtensionAPI,
	card: TapdGitMessageDetails,
	status: "success" | "error" | "cancelled",
	result: string,
): void {
	card.status = status;
	card.result = truncateDisplayResult(result);
	publishCard(card);
	pi.sendMessage({
		customType: `${MESSAGE_TYPE}-context`,
		content: result,
		display: false,
		details: {
			command: card.command,
			status: card.status,
			runId: card.runId,
			progress: card.progress,
			history: [...(card.history ?? [])],
			result: card.result,
		},
	});
}

function outcomeStatus(result: string): "success" | "cancelled" {
	return result.startsWith("已取消") ? "cancelled" : "success";
}

export async function runTapdGitCommand(
	pi: ExtensionAPI,
	subcommand: string,
	args: string[],
	ctx: ExtensionCommandContext,
	config: TapdConfig,
): Promise<boolean> {
	if (!GIT_COMMANDS.has(subcommand as GitCommandKind)) return false;
	const command = subcommand as GitCommandKind;
	const runKey = `${ctx.cwd}\u0000${command}\u0000${args.join("\u0000")}`;
	const runs = recentRuns();
	const now = Date.now();
	if (now - (runs.get(runKey) ?? 0) < 2_000) return true;
	runs.set(runKey, now);
	const card = startCard(pi, command);
	publishCard(card);
	const cancel = ctx.hasUI
		? new GitWorkingCancel(ctx, `tapd-git-${command}`)
		: undefined;
	const reportProgress = (progress: GitCommandProgress) => {
		card.progress = progress;
		const text = `${progress.step}/${progress.total} ${progress.message}`;
		const history = (card.history ??= []);
		if (history.slice(-1)[0] !== text) history.push(text);
		publishCard(card);
		cancel?.setMessage(`Working... ${progress.message}`);
	};
	try {
		let result: string;
		if (command === "git-status") {
			reportProgress({
				step: 1,
				total: 1,
				message: "正在检查 TAPD 关联和 Git 仓库状态...",
			});
			cancel?.throwIfAborted();
			result = await describeGitStatus(ctx);
		} else if (command === "branch") {
			result = await runCreateBranch(
				pi,
				ctx,
				config,
				optionValue(args, "--base"),
				reportProgress,
				cancel,
			);
		} else if (command === "commit") {
			result = await runCommitPush(
				ctx,
				config,
				args.includes("--no-push"),
				reportProgress,
				cancel,
			);
		} else {
			result = await runMergeRequest(pi, ctx, config, {
				targetBranch: optionValue(args, "--target"),
				removeSourceBranch: !args.includes("--no-delete-source-branch"),
				draft: args.includes("--draft"),
				reportProgress,
				cancel,
			});
		}
		if (cancel?.signal.aborted) throw abortError();
		finishCard(pi, card, outcomeStatus(result), result);
	} catch (error) {
		if (isAbortError(error) || cancel?.signal.aborted) {
			finishCard(pi, card, "cancelled", "已取消：用户按 Esc 中止");
		} else {
			finishCard(
				pi,
				card,
				"error",
				error instanceof Error ? error.message : String(error),
			);
		}
	} finally {
		cancel?.dispose();
	}
	return true;
}
