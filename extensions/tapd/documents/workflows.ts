import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { ENSURE_ASK_FOR_DOCS_ENTRY } from "../../chat-mode/ensure-ask-for-docs.js";
import { fetchBugDetail, htmlToText } from "../core/api.js";
import { bugUrl } from "../todo/model.js";
import { buildBugLocatePrompt } from "./prompts.js";
import { readTapdSessionState } from "../sessions/session-state.js";
import type { TapdConfig } from "../types.js";

const DOCS_WORKFLOW_MODE_RULES = [
	"",
	"## 模式约束",
	"不要调用 enter_plan_mode，也不要写入或编辑 session 的 plan.md。",
	"只将文档写入上文指定的 .pi/docs 路径（及同目录约定文档）；不要修改业务代码。",
].join("\n");

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

	const state = readTapdSessionState(ctx.sessionManager.getEntries());
	if (state?.kind === "bug") {
		ctx.ui.notify("当前是 Bug 会话，请执行 /tapd bug 定位缺陷原因", "warning");
		return;
	}

	// 请求 chat-mode 在本轮 agent 启动前切到 Ask（可写 .pi/docs，避免 Plan 拦 design.md）。
	pi.appendEntry(ENSURE_ASK_FOR_DOCS_ENTRY, { version: 1 });

	// This command is registered by the extension instance bound to the current
	// session, so use its current pi. Never retain the ReplacedSessionContext
	// from the newSession() callback for a later command invocation.
	const extra = additionalInstructions?.trim();
	const body = `${prompt}${DOCS_WORKFLOW_MODE_RULES}`;
	pi.sendUserMessage(
		extra
			? `${body}\n\n## 用户补充要求与参考资料\n\n${extra}\n\n请将以上补充要求和 @ 引用文件一并纳入本次任务。`
			: body,
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
	const state = readTapdSessionState(ctx.sessionManager.getEntries());
	if (!state) {
		ctx.ui.notify(
			"当前会话没有关联 TAPD 条目，请先从 TAPD 缺陷列表创建或切换会话",
			"warning",
		);
		return;
	}
	if (state.kind !== "bug") {
		ctx.ui.notify("/tapd bug 只能在 Bug 会话中执行", "warning");
		return;
	}

	ctx.ui.notify("正在获取 TAPD 完整缺陷信息...", "info");
	const detail = await fetchBugDetail(state.workspaceId, state.itemId, config);
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
			title: detail.title || state.itemName,
			bugId: state.itemId,
			url: bugUrl(state.workspaceId, state.itemId),
			projectPaths: state.projectPaths ?? [],
			detail: normalizedDetail,
		}),
	);
}
