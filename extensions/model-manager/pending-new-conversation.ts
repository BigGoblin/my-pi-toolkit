import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * 标记「该会话由 switchSession 恢复，但语义上是新对话」。
 *
 * 扩展之间不能共享模块级状态（Pi 用 jiti 加载扩展且 moduleCache: false，
 * 每个扩展入口各有一份模块图），因此标记写在会话 custom entry 里。
 */
export const NEW_CONVERSATION_DEFAULTS_ENTRY = "model-manager-new-conversation";

/** 会话是否请求按新对话应用默认模型，且尚未产生助手回复。 */
export function wantsNewConversationDefaults(
	entries: readonly SessionEntry[],
): boolean {
	let requested = false;
	for (const entry of entries) {
		if (
			entry.type === "custom" &&
			entry.customType === NEW_CONVERSATION_DEFAULTS_ENTRY
		) {
			requested = true;
			continue;
		}
		if (entry.type === "message" && entry.message.role === "assistant")
			return false;
	}
	return requested;
}
