import type { ItemKey, TapdItemKind } from "../types.js";

/** TAPD 事项 key：kind_workspaceId_itemId。 */
export function linkKey(
	workspaceId: string,
	itemId: string,
	kind: TapdItemKind = "story",
): string {
	return `${kind}_${workspaceId}_${itemId}`;
}

/** 解析 linkKey；兼容旧版本 workspaceId_storyId key。 */
export function parseItemKey(key: string): ItemKey {
	const parts = key.split("_");
	if (parts.length >= 3 && (parts[0] === "story" || parts[0] === "bug")) {
		return {
			kind: parts[0],
			wsId: parts[1],
			itemId: parts.slice(2).join("_"),
		};
	}
	return {
		kind: "story",
		wsId: parts[0] ?? "",
		itemId: parts.slice(1).join("_"),
	};
}
