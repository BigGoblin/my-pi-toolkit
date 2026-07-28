import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fetchBugDetail, htmlToText } from "./api.js";
import { bugUrl } from "./model.js";
import { buildBugLocatePrompt } from "./prompts.js";
import { findSessionLink } from "./storage.js";
import type { TapdConfig } from "./types.js";

export async function sendTapdWorkflowPrompt(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	prompt: string,
	additionalInstructions?: string,
): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent 正在执行，请稍后再试", "warning");
		return;
	}

	const current = findSessionLink(ctx.sessionManager.getSessionFile?.() ?? "");
	if (current?.record.kind === "bug") {
		ctx.ui.notify("当前是 Bug 会话，请执行 /tapd bug 定位缺陷原因", "warning");
		return;
	}

	// This command is registered by the extension instance bound to the current
	// session, so use its current pi. Never retain the ReplacedSessionContext
	// from the newSession() callback for a later command invocation.
	const extra = additionalInstructions?.trim();
	pi.sendUserMessage(
		extra
			? `${prompt}\n\n## 用户补充要求与参考资料\n\n${extra}\n\n请将以上补充要求和 @ 引用文件一并纳入本次任务。`
			: prompt,
	);
}

export async function locateTapdBug(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: TapdConfig,
): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent 正在执行，请稍后再试", "warning");
		return;
	}
	const current = findSessionLink(ctx.sessionManager.getSessionFile?.() ?? "");
	if (!current) {
		ctx.ui.notify(
			"当前会话没有关联 TAPD 条目，请先从 TAPD 缺陷列表创建或切换会话",
			"warning",
		);
		return;
	}
	if (current.record.kind !== "bug") {
		ctx.ui.notify("/tapd bug 只能在 Bug 会话中执行", "warning");
		return;
	}

	ctx.ui.notify("正在获取 TAPD 完整缺陷信息...", "info");
	const bugId = current.record.itemId ?? current.record.storyId;
	const detail = await fetchBugDetail(
		current.record.workspaceId,
		bugId,
		config,
	);
	if (!detail) {
		ctx.ui.notify("获取 TAPD 缺陷详情失败，请检查权限或稍后重试", "error");
		return;
	}
	const normalizedDetail: Record<string, unknown> = { ...detail };
	if (typeof detail.description === "string") {
		normalizedDetail.description_text = htmlToText(detail.description);
	}
	pi.sendUserMessage(
		buildBugLocatePrompt({
			title: detail.title || current.record.name,
			bugId,
			url: bugUrl(current.record.workspaceId, bugId),
			projectPaths: current.session.projectPaths ?? [],
			detail: normalizedDetail,
		}),
	);
}
