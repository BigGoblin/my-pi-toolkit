import type {
	ExtensionAPI,
	ExtensionCommandContext,
	MessageRenderOptions,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component } from "@earendil-works/pi-tui";
import { toolResult } from "../../shared/tui/tool-render.js";
import type { TapdConfig } from "../types.js";
import { runMergeRequest } from "./merge-request-workflow.js";
import type { GitCommandKind, GitCommandProgress } from "./types.js";
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
const COMMAND_LABELS: Record<GitCommandKind, string> = {
	"git-status": "status",
	branch: "branch",
	commit: "commit",
	mr: "merge request",
};

function recentRuns(): Map<string, number> {
	const shared = globalThis as typeof globalThis & {
		[RECENT_RUNS_KEY]?: Map<string, number>;
	};
	return (shared[RECENT_RUNS_KEY] ??= new Map<string, number>());
}

interface TapdGitMessageDetails {
	command: GitCommandKind;
	status: "active" | "success" | "error";
	progress?: GitCommandProgress;
	history?: string[];
	result?: string;
}

function optionValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function cardBody(
	details: TapdGitMessageDetails,
	expanded: boolean,
): string | undefined {
	const allHistory = Array.isArray(details.history) ? details.history : [];
	const history = expanded ? allHistory : allHistory.slice(-6);
	const completed =
		details.status === "active" ? history.slice(0, -1) : history;
	const lines = [...completed];
	if (details.result) lines.push(details.result);
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function backgroundToken(
	status: TapdGitMessageDetails["status"],
): "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" {
	if (status === "active") return "toolPendingBg";
	if (status === "success") return "toolSuccessBg";
	return "toolErrorBg";
}

function cardSummary(details: TapdGitMessageDetails | undefined): string {
	if (details?.status === "success") return "completed";
	if (details?.status === "error") return "failed";
	if (details?.progress)
		return `${details.progress.step}/${details.progress.total}`;
	return "running";
}

function cardDetails(
	details: TapdGitMessageDetails | undefined,
): string[] | undefined {
	if (!details?.progress) return undefined;
	if (details.status === "active") return [details.progress.message];
	return [`已执行到 ${details.progress.step}/${details.progress.total}`];
}

function buildCard(
	details: TapdGitMessageDetails | undefined,
	content: string,
	expanded: boolean,
	theme: Theme,
): Component {
	return {
		render(width: number): string[] {
			const status = details?.status ?? "error";
			const command = details?.command;
			const box = new Box(1, 1, (text: string) =>
				theme.bg(backgroundToken(status), text),
			);
			box.addChild(
				toolResult(theme, {
					status,
					title: command ? `TAPD ${COMMAND_LABELS[command]}` : "TAPD Git",
					summary: cardSummary(details),
					details: cardDetails(details),
					body: details ? cardBody(details, expanded) : content,
				}),
			);
			return box.render(width);
		},
		invalidate(): void {},
	};
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
			buildCard(
				message.details,
				typeof message.content === "string" ? message.content : "",
				options.expanded,
				theme,
			),
	);
}

function createCard(command: GitCommandKind): TapdGitMessageDetails {
	return {
		command,
		status: "active",
		history: [],
	};
}

function finishCard(
	pi: ExtensionAPI,
	card: TapdGitMessageDetails,
	status: "success" | "error",
	result: string,
): void {
	card.status = status;
	card.result = result;
	pi.sendMessage({
		customType: MESSAGE_TYPE,
		content: `TAPD ${card.command} workflow`,
		display: true,
		details: {
			command: card.command,
			status: card.status,
			progress: card.progress,
			history: [...(card.history ?? [])],
			result: card.result,
		},
	});
	pi.sendMessage({
		customType: `${MESSAGE_TYPE}-context`,
		content: result,
		display: false,
	});
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
	const statusKey = `tapd-git-${command}`;
	const card = createCard(command);
	const reportProgress = (progress: GitCommandProgress) => {
		card.progress = progress;
		const text = `${progress.step}/${progress.total} ${progress.message}`;
		const history = (card.history ??= []);
		if (history.slice(-1)[0] !== text) history.push(text);
		ctx.ui.setStatus(statusKey, text);
	};
	try {
		let result: string;
		if (command === "git-status") {
			reportProgress({
				step: 1,
				total: 1,
				message: "正在检查 TAPD 关联和 Git 仓库状态...",
			});
			result = await describeGitStatus(ctx);
		} else if (command === "branch") {
			result = await runCreateBranch(
				pi,
				ctx,
				config,
				optionValue(args, "--base"),
				reportProgress,
			);
		} else if (command === "commit") {
			result = await runCommitPush(
				ctx,
				config,
				args.includes("--no-push"),
				reportProgress,
			);
		} else {
			result = await runMergeRequest(pi, ctx, config, {
				targetBranch: optionValue(args, "--target"),
				removeSourceBranch: !args.includes("--no-delete-source-branch"),
				draft: args.includes("--draft"),
				reportProgress,
			});
		}
		finishCard(pi, card, "success", result);
	} catch (error) {
		finishCard(
			pi,
			card,
			"error",
			error instanceof Error ? error.message : String(error),
		);
	} finally {
		ctx.ui.setStatus(statusKey, undefined);
	}
	return true;
}
