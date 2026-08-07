import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { UI_GLYPHS } from "../../shared/tui/visual-language.js";
import type { TapdConfig } from "../types.js";
import { currentTapdObject, parseKeyword } from "./context.js";
import { commitPrefix } from "./policy.js";
import {
	commitAll,
	pushCurrentBranch,
	readRepositoryState,
} from "./repository.js";
import { fetchCommitKeyword } from "./tapd-api.js";
import type { GitCommandProgressReporter } from "./types.js";
import type { GitWorkingCancel } from "./working-cancel.js";
import { isAbortError } from "./working-cancel.js";

const HOOK_SUMMARY_CHARS = 800;

function summarizeHookError(message: string): string {
	const lines = message.split("\n");
	const failed = lines.filter((line) =>
		/FAILED|error|Error|✖|✗|ELIFECYCLE/i.test(line),
	);
	const picked = (
		failed.length > 0 ? failed.slice(-12) : lines.slice(-15)
	).join("\n");
	if (picked.length <= HOOK_SUMMARY_CHARS)
		return picked || message.slice(0, HOOK_SUMMARY_CHARS);
	return `${picked.slice(0, HOOK_SUMMARY_CHARS)}…`;
}

type CommitAttempt =
	| { kind: "hash"; hash: string }
	| { kind: "cancelled"; message: string };

async function commitWithHookBypassOption(
	ctx: ExtensionCommandContext,
	root: string,
	subject: string,
	total: number,
	reportProgress?: GitCommandProgressReporter,
	cancel?: GitWorkingCancel,
): Promise<CommitAttempt> {
	const signal = cancel?.signal;
	let commitStarted = false;
	try {
		const hash = await commitAll(
			root,
			subject,
			(phase) => {
				if (phase === "commit") commitStarted = true;
				reportProgress?.({
					step: phase === "stage" ? 4 : 5,
					total,
					message:
						phase === "stage"
							? "正在暂存工作区改动（git add --all）..."
							: "正在创建 commit；Git hooks 可能需要一些时间...",
				});
			},
			false,
			signal,
		);
		return { kind: "hash", hash };
	} catch (error) {
		if (isAbortError(error) || signal?.aborted) throw error;
		if (!commitStarted) throw error;
		const message = error instanceof Error ? error.message : String(error);
		const summary = summarizeHookError(message);
		reportProgress?.({
			step: 5,
			total,
			message: "Commit 失败，等待选择是否跳过 Git hooks...",
			detail: summary,
		});
		if (!ctx.hasUI) {
			throw new Error(
				`pre-commit 失败且当前环境无交互界面，无法选择是否跳过 hooks：\n${summary}`,
			);
		}
		cancel?.suspend();
		let choice: string | undefined;
		try {
			choice = await ctx.ui.select("pre-commit 失败：如何处理？", [
				`${UI_GLYPHS.action} 使用 --no-verify 跳过 hooks 后重试（会绕过提交校验）`,
				"取消",
			]);
		} finally {
			cancel?.resume("Working...");
		}
		cancel?.throwIfAborted();
		if (!choice || choice === "取消") {
			reportProgress?.({
				step: 5,
				total,
				message: "用户取消跳过 hooks",
				detail: summary,
			});
			return {
				kind: "cancelled",
				message: `已取消：pre-commit 失败，未跳过 hooks\n${summary}`,
			};
		}
		const hash = await commitAll(
			root,
			subject,
			(phase) => {
				reportProgress?.({
					step: phase === "stage" ? 4 : 5,
					total,
					message:
						phase === "stage"
							? "正在重新暂存 Git hook 可能产生的改动..."
							: "正在使用 --no-verify 重新创建 commit...",
				});
			},
			true,
			signal,
		);
		return { kind: "hash", hash };
	}
}

export async function runCommitPush(
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	noPush: boolean,
	reportProgress?: GitCommandProgressReporter,
	cancel?: GitWorkingCancel,
): Promise<string> {
	const total = noPush ? 5 : 6;
	const signal = cancel?.signal;
	reportProgress?.({
		step: 1,
		total,
		message: "正在检查 Git 仓库和待提交文件...",
	});
	cancel?.throwIfAborted();
	const object = currentTapdObject(ctx);
	const repository = await readRepositoryState(ctx.cwd);
	if (!repository.dirty) throw new Error("检查仓库失败：没有可提交的改动");
	reportProgress?.({
		step: 2,
		total,
		message: "正在从 TAPD 获取 commit keyword...",
	});
	const keyword = parseKeyword(
		await fetchCommitKeyword(config, object),
		object,
	);
	cancel?.throwIfAborted();
	const subject = `${commitPrefix(keyword.kind)}: ${keyword.keyword}`;
	reportProgress?.({ step: 3, total, message: "等待确认提交信息..." });
	cancel?.suspend();
	let confirmed: boolean;
	try {
		confirmed = await ctx.ui.confirm(
			"提交预览",
			`${subject}\n\n${noPush ? "只提交，不推送" : "提交后推送当前分支"}`,
		);
	} finally {
		cancel?.resume("Working...");
	}
	cancel?.throwIfAborted();
	if (!confirmed) return "已取消：未创建 commit";
	const attempt = await commitWithHookBypassOption(
		ctx,
		repository.root,
		subject,
		total,
		reportProgress,
		cancel,
	);
	if (attempt.kind === "cancelled") return attempt.message;
	if (!noPush) {
		reportProgress?.({
			step: 6,
			total,
			message: `正在推送 ${repository.branch} 到 origin；可能等待网络或 SSH 验证...`,
		});
		await pushCurrentBranch(
			repository.root,
			Boolean(repository.upstream),
			signal,
		);
	}
	return `${attempt.hash} ${subject}\n${noPush ? "未推送" : `已推送 ${repository.branch}`}`;
}
