import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TapdItem, TapdLinkRecord } from "../types.js";
import { getDesignDocPath, linkKey, loadLinks } from "../sessions/storage.js";

function linkedDesignPaths(
	item: TapdItem,
	links: Record<string, TapdLinkRecord>,
): string[] {
	const record =
		links[linkKey(item.workspaceId, item.id, "story")] ??
		links[`${item.workspaceId}_${item.id}`];
	if (!record) return [];
	return record.sessions.flatMap((session) =>
		session.understandingFile
			? [join(dirname(session.understandingFile), "design.md")]
			: [],
	);
}

/** Return stable TAPD item keys for stories with a local design document. */
export function collectDesignedStoryKeys(
	forest: TapdItem[],
	cwd: string,
	links: Record<string, TapdLinkRecord> = loadLinks(),
): Set<string> {
	const designed = new Set<string>();
	const visit = (items: TapdItem[]) => {
		for (const item of items) {
			if (item.kind === "story") {
				const key = linkKey(item.workspaceId, item.id, item.kind);
				const candidates = [
					getDesignDocPath(cwd, `story-${item.id}`),
					...linkedDesignPaths(item, links),
				];
				if (candidates.some((path) => existsSync(path))) designed.add(key);
			}
			visit(item.children);
		}
	};
	visit(forest);
	return designed;
}
