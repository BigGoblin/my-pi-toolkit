import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TapdItem } from "../types.js";
import { getDesignDocPath } from "../sessions/docs.js";
import { linkKey } from "../sessions/keys.js";
import { getTapdCatalogSnapshot } from "../sessions/catalog.js";

/** 从已构建的 catalog 快照中收集理解文档路径派生的设计文档路径。 */
function linkedDesignPaths(item: TapdItem): string[] {
	const snapshot = getTapdCatalogSnapshot();
	const key = linkKey(item.workspaceId, item.id, "story");
	const descriptors = snapshot.get(key) ?? [];
	return descriptors.flatMap((descriptor) =>
		descriptor.understandingFile
			? [join(dirname(descriptor.understandingFile), "design.md")]
			: [],
	);
}

/** Return stable TAPD item keys for stories with a local design document. */
export function collectDesignedStoryKeys(
	forest: TapdItem[],
	cwd: string,
): Set<string> {
	const designed = new Set<string>();
	const visit = (items: TapdItem[]) => {
		for (const item of items) {
			if (item.kind === "story") {
				const key = linkKey(item.workspaceId, item.id, item.kind);
				const candidates = [
					getDesignDocPath(cwd, `story-${item.id}`),
					...linkedDesignPaths(item),
				];
				if (candidates.some((path) => existsSync(path))) designed.add(key);
			}
			visit(item.children);
		}
	};
	visit(forest);
	return designed;
}
