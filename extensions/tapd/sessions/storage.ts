import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
	ItemKey,
	SessionLink,
	TapdItemKind,
	TapdLinkRecord,
} from "../types.js";

const LINKS_PATH = join(getAgentDir(), "tapd-links.json");
const PATHS_HISTORY_PATH = join(getAgentDir(), "tapd-project-paths.json");
const MAX_PATH_HISTORY = 30;

export function loadLinks(): Record<string, TapdLinkRecord> {
	try {
		if (existsSync(LINKS_PATH))
			return JSON.parse(readFileSync(LINKS_PATH, "utf-8"));
	} catch {}
	return {};
}

export function saveLinks(links: Record<string, TapdLinkRecord>): void {
	try {
		writeFileSync(LINKS_PATH, JSON.stringify(links, null, 2), "utf-8");
	} catch {}
}

export function linkKey(
	workspaceId: string,
	itemId: string,
	kind: TapdItemKind = "story",
): string {
	return `${kind}_${workspaceId}_${itemId}`;
}

export function parseItemKey(key: string): ItemKey {
	const parts = key.split("_");
	if (parts.length >= 3 && (parts[0] === "story" || parts[0] === "bug")) {
		return { kind: parts[0], wsId: parts[1], itemId: parts.slice(2).join("_") };
	}
	// 兼容旧版本的 workspaceId_storyId key。
	return {
		kind: "story",
		wsId: parts[0] ?? "",
		itemId: parts.slice(1).join("_"),
	};
}

export function getOrCreateLink(
	links: Record<string, TapdLinkRecord>,
	workspaceId: string,
	itemId: string,
	name: string,
	kind: TapdItemKind = "story",
): TapdLinkRecord {
	const key = linkKey(workspaceId, itemId, kind);
	if (!links[key] && kind === "story") {
		const legacyKey = `${workspaceId}_${itemId}`;
		if (links[legacyKey]) {
			links[key] = { ...links[legacyKey], kind: "story", itemId };
			delete links[legacyKey];
		}
	}
	if (!links[key])
		links[key] = {
			workspaceId,
			storyId: itemId,
			itemId,
			kind,
			name,
			sessions: [],
		};
	return links[key];
}

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

export function getCollaborationDocPath(cwd: string, itemId: string): string {
	return getTapdDocPath(cwd, itemId, "collaboration.md");
}

export function loadPathHistory(): string[] {
	try {
		if (!existsSync(PATHS_HISTORY_PATH)) return [];
		const raw = JSON.parse(readFileSync(PATHS_HISTORY_PATH, "utf-8"));
		if (!Array.isArray(raw)) return [];
		return raw.filter(
			(path): path is string =>
				typeof path === "string" && path.trim().length > 0,
		);
	} catch {
		return [];
	}
}

export function rememberProjectPaths(paths: string[]): void {
	const cleaned = Array.from(
		new Set(paths.map((path) => path.trim()).filter(Boolean)),
	);
	if (cleaned.length === 0) return;
	const history = loadPathHistory().filter((path) => !cleaned.includes(path));
	try {
		writeFileSync(
			PATHS_HISTORY_PATH,
			JSON.stringify(
				[...cleaned, ...history].slice(0, MAX_PATH_HISTORY),
				null,
				2,
			),
			"utf-8",
		);
	} catch {}
}

export function removeProjectPathFromHistory(path: string): void {
	const history = loadPathHistory().filter((item) => item !== path);
	try {
		writeFileSync(
			PATHS_HISTORY_PATH,
			JSON.stringify(history, null, 2),
			"utf-8",
		);
	} catch {}
}

export function readSessionTitle(file: string): string | null {
	try {
		if (!existsSync(file)) return null;
		for (const line of readFileSync(file, "utf-8").split("\n").reverse()) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session_info" && entry.name) return entry.name;
			} catch {
				// Ignore malformed JSONL entries while scanning older session files.
			}
		}
		return null;
	} catch {
		return null;
	}
}

export function findSessionLink(
	sessionFile: string,
	links: Record<string, TapdLinkRecord> = loadLinks(),
): {
	links: Record<string, TapdLinkRecord>;
	key: string;
	record: TapdLinkRecord;
	session: SessionLink;
} | null {
	if (!sessionFile) return null;
	for (const [key, record] of Object.entries(links)) {
		const session = record.sessions.find(
			(item) => item.sessionFile === sessionFile,
		);
		if (session) return { links, key, record, session };
	}
	return null;
}
