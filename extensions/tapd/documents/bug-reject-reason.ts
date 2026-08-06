import type {
	SessionEntry,
	SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			parts.push(part);
			continue;
		}
		if (!part || typeof part !== "object") continue;
		const item = part as { type?: string; text?: string };
		if (item.type === "text" && typeof item.text === "string") {
			parts.push(item.text);
		}
	}
	return parts.join("\n");
}

/** 从最近一条含「## 原因」的 assistant 回复中提取原因正文。 */
export function extractLocateReason(
	entries: readonly SessionEntry[],
): string {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry.type !== "message") continue;
		const message = (entry as SessionMessageEntry).message as {
			role?: string;
			content?: unknown;
		};
		if (message?.role !== "assistant") continue;
		const text = messageText(message.content);
		const match = text.match(
			/^##\s*原因\s*\n+([\s\S]*?)(?=\n##\s|\n#\s|$)/m,
		);
		if (!match) continue;
		return match[1].trim();
	}
	return "";
}
