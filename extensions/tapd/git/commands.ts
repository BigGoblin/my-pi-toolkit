import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { TapdConfig } from "../types.js";
import { BranchProgressView } from "./branch-progress.js";
import {
	describeGitStatus,
	runCommitPush,
	runCreateBranch,
} from "./workflow.js";
import { runMergeRequest } from "./merge-request-workflow.js";

function optionValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

const LOADING_MESSAGES: Record<string, string> = {
	"git-status": "正在检查 TAPD 关联和 Git 仓库状态...",
	branch: "正在获取 TAPD keyword 并创建分支...",
	commit: "正在检查改动并生成 TAPD 提交信息...",
	mr: "正在扫描提交、创建 MR 并同步 TAPD...",
};

function showCommandResult(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({
		customType: "tapd-git-command-result",
		content,
		display: true,
	});
}

function showProgress(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({
		customType: "tapd-git-progress",
		content,
		display: true,
	});
}

export async function runTapdGitCommand(
	pi: ExtensionAPI,
	subcommand: string,
	args: string[],
	ctx: ExtensionCommandContext,
	config: TapdConfig,
): Promise<boolean> {
	const loadingMessage = LOADING_MESSAGES[subcommand];
	if (!loadingMessage) return false;
	ctx.ui.notify(loadingMessage, "info");
	let branchProgress: BranchProgressView | undefined;
	try {
		let result = "";
		if (subcommand === "git-status") {
			result = await describeGitStatus(ctx);
		} else if (subcommand === "branch") {
			branchProgress = new BranchProgressView(ctx);
			branchProgress.start();
			result = await runCreateBranch(
				ctx,
				config,
				optionValue(args, "--base"),
				(progress) => branchProgress?.update(progress),
			);
		} else if (subcommand === "commit") {
			result = await runCommitPush(
				ctx,
				config,
				args.includes("--no-push"),
				(content) => showProgress(pi, content),
			);
		} else if (subcommand === "mr") {
			result = await runMergeRequest(pi, ctx, config, {
				targetBranch: optionValue(args, "--target"),
				removeSourceBranch: !args.includes("--no-delete-source-branch"),
				draft: args.includes("--draft"),
				reportProgress: (content) => showProgress(pi, content),
			});
		}
		showCommandResult(pi, result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		branchProgress?.fail(message);
		ctx.ui.notify(message, "error");
	} finally {
		branchProgress?.clear();
	}
	return true;
}
