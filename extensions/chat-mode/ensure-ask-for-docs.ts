import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * TAPD analyze/design/collaboration 等文档工作流请求切到 Ask。
 *
 * 扩展之间不能共享模块级状态（jiti moduleCache: false），因此用会话
 * custom entry 协调；chat-mode 在 before_agent_start 消费。
 */
export const ENSURE_ASK_FOR_DOCS_ENTRY = "chat-mode-ensure-ask-for-docs";

/** 是否存在尚未被助手回复消费的「切到 Ask 写文档」请求。 */
export function wantsAskModeForDocs(
	entries: readonly SessionEntry[],
): boolean {
	let requested = false;
	for (const entry of entries) {
		if (
			entry.type === "custom" &&
			entry.customType === ENSURE_ASK_FOR_DOCS_ENTRY
		) {
			requested = true;
			continue;
		}
		if (entry.type === "message" && entry.message.role === "assistant") {
			requested = false;
		}
	}
	return requested;
}
