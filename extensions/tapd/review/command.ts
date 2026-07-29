import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_GIT_WORKFLOW_POLICY } from "../git/policy.js";

function parseReviewCommandArgs(args: string[]): {
	baseRef: string;
	instructions?: string;
} {
	let baseRef = DEFAULT_GIT_WORKFLOW_POLICY.baseRef;
	const instructions: string[] = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] !== "--base") {
			instructions.push(args[index]);
			continue;
		}
		const value = args[index + 1];
		if (!value || value.startsWith("--"))
			throw new Error("--base 需要指定基础分支，例如 --base origin/dev");
		baseRef = value;
		index++;
	}
	const extra = instructions.join(" ").trim();
	return { baseRef, instructions: extra || undefined };
}

export function requestTapdReview(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: string[],
): void {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent 正在执行，请稍后再运行 /tapd review", "warning");
		return;
	}
	let params: { baseRef: string; instructions?: string };
	try {
		params = parseReviewCommandArgs(args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(message, "error");
		return;
	}
	pi.sendUserMessage(
		[
			"请立即调用 tapd_review 工具审核当前 TAPD 需求的代码修改。",
			"不要自行替代工具完成审核，也不要在审核后自动修改代码。",
			"工具返回后，请总结最高等级问题并等待我确认。",
			"",
			"工具参数：",
			"```json",
			JSON.stringify(params, null, 2),
			"```",
		].join("\n"),
	);
}
