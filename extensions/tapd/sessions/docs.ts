import { join } from "node:path";

/** 需求文档目录名安全化。 */
export function safeRequirementDirName(name: string): string {
	const safe = name
		.trim()
		.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
		.replace(/[. ]+$/g, "")
		.slice(0, 120)
		.trim();
	return safe || "未命名需求";
}

export function getTapdDocPath(
	cwd: string,
	itemId: string,
	fileName: string,
): string {
	return join(cwd, ".pi", "docs", safeRequirementDirName(itemId), fileName);
}

export function getUnderstandingDocPath(cwd: string, itemId: string): string {
	return getTapdDocPath(cwd, itemId, "understanding.md");
}

export function getDesignDocPath(cwd: string, itemId: string): string {
	return getTapdDocPath(cwd, itemId, "design.md");
}

export function getCollaborationDocPath(cwd: string, itemId: string): string {
	return getTapdDocPath(cwd, itemId, "collaboration.md");
}
