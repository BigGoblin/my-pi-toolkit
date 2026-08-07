import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component } from "@earendil-works/pi-tui";
import { toolResult } from "../../shared/tui/tool-render.js";
import type { VisualStatus } from "../../shared/tui/visual-language.js";
import type { GitCommandKind, GitCommandProgress } from "./types.js";

const FINAL_BY_RUN_KEY = Symbol.for("my-pi-toolkit.tapd.git.final-by-run");
const MAX_RESULT_LINES = 20;

export type CardStatus = "active" | "success" | "error" | "cancelled";

export interface TapdGitMessageDetails {
	command: GitCommandKind;
	status: CardStatus;
	runId?: string;
	progress?: GitCommandProgress;
	history?: string[];
	result?: string;
}

export const COMMAND_LABELS: Record<GitCommandKind, string> = {
	"git-status": "status",
	branch: "branch",
	commit: "commit",
	mr: "merge request",
};

function store(): Map<string, TapdGitMessageDetails> {
	const shared = globalThis as typeof globalThis & {
		[FINAL_BY_RUN_KEY]?: Map<string, TapdGitMessageDetails>;
	};
	return (shared[FINAL_BY_RUN_KEY] ??= new Map<string, TapdGitMessageDetails>());
}

export function resolveLiveDetails(
	details: TapdGitMessageDetails | undefined,
): TapdGitMessageDetails | undefined {
	if (!details?.runId) return details;
	return store().get(details.runId) ?? details;
}

export function publishCard(card: TapdGitMessageDetails): void {
	if (!card.runId) return;
	store().set(card.runId, {
		command: card.command,
		status: card.status,
		runId: card.runId,
		progress: card.progress,
		history: [...(card.history ?? [])],
		result: card.result,
	});
}

export function truncateDisplayResult(result: string): string {
	const lines = result.split("\n");
	if (lines.length <= MAX_RESULT_LINES) return result;
	return [
		...lines.slice(0, MAX_RESULT_LINES),
		`…（已截断 ${lines.length - MAX_RESULT_LINES} 行，完整日志见 context）`,
	].join("\n");
}

function cardBody(
	details: TapdGitMessageDetails,
	expanded: boolean,
): string | undefined {
	const allHistory = Array.isArray(details.history) ? details.history : [];
	const history = expanded ? allHistory : allHistory.slice(-6);
	const lines = [...history];
	// 仅在等待处理时展示 hook 摘要；跳过 hooks 成功后 progress.detail 会清空，不留在终态卡。
	if (details.status === "active" && details.progress?.detail) {
		lines.push(`pre-commit 失败：\n${details.progress.detail}`);
	}
	if (details.result) lines.push(details.result);
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function backgroundToken(
	status: CardStatus,
): "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" {
	if (status === "active") return "toolPendingBg";
	if (status === "success") return "toolSuccessBg";
	return "toolErrorBg";
}

function visualStatus(status: CardStatus): VisualStatus {
	return status === "cancelled" ? "error" : status;
}

function cardSummary(details: TapdGitMessageDetails | undefined): string {
	if (details?.status === "success") return "completed";
	if (details?.status === "error") return "failed";
	if (details?.status === "cancelled") return "cancelled";
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

export function buildGitCard(
	details: TapdGitMessageDetails | undefined,
	content: string,
	expanded: boolean,
	theme: Theme,
): Component {
	return {
		render(width: number): string[] {
			const resolved = resolveLiveDetails(details);
			const status = resolved?.status ?? "error";
			const command = resolved?.command;
			const box = new Box(1, 1, (text: string) =>
				theme.bg(backgroundToken(status), text),
			);
			box.addChild(
				toolResult(theme, {
					status: visualStatus(status),
					title: command ? `TAPD ${COMMAND_LABELS[command]}` : "TAPD Git",
					summary: cardSummary(resolved),
					details: cardDetails(resolved),
					body: resolved ? cardBody(resolved, expanded) : content,
				}),
			);
			return box.render(width);
		},
		invalidate(): void {},
	};
}
