import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { loadLinks, saveLinks } from "./storage.js";
import type { SessionLink, TapdLinkRecord } from "./types.js";

const PENDING_SESSION_GRACE_MS = 10 * 60 * 1000;

export interface CleanupPreview {
	removedSessions: number;
	removedRecords: number;
	skippedPendingSessions: number;
	retainedSessions: number;
}

function isExpiredPendingSession(session: SessionLink, now: number): boolean {
	if (session.sessionFile) return false;
	const createdAt = Date.parse(session.createdAt);
	return (
		!Number.isFinite(createdAt) || now - createdAt > PENDING_SESSION_GRACE_MS
	);
}

function shouldRemoveSession(session: SessionLink, now: number): boolean {
	if (session.sessionFile) return !existsSync(session.sessionFile);
	return isExpiredPendingSession(session, now);
}

function calculateCleanup(
	links: Record<string, TapdLinkRecord>,
	now: number,
): { links: Record<string, TapdLinkRecord>; preview: CleanupPreview } {
	const cleaned: Record<string, TapdLinkRecord> = {};
	const preview: CleanupPreview = {
		removedSessions: 0,
		removedRecords: 0,
		skippedPendingSessions: 0,
		retainedSessions: 0,
	};

	for (const [key, record] of Object.entries(links)) {
		const sessions = record.sessions.filter((session) => {
			if (shouldRemoveSession(session, now)) {
				preview.removedSessions += 1;
				return false;
			}
			if (!session.sessionFile) preview.skippedPendingSessions += 1;
			preview.retainedSessions += 1;
			return true;
		});
		if (sessions.length === 0) {
			preview.removedRecords += 1;
			continue;
		}
		cleaned[key] = { ...record, sessions };
	}
	return { links: cleaned, preview };
}

export function scanStaleSessionLinks(): CleanupPreview {
	return calculateCleanup(loadLinks(), Date.now()).preview;
}

export function cleanupStaleSessionLinks(): CleanupPreview {
	const result = calculateCleanup(loadLinks(), Date.now());
	if (result.preview.removedSessions > 0 || result.preview.removedRecords > 0)
		saveLinks(result.links);
	return result.preview;
}

export function removeSessionLink(linkId: string): boolean {
	const links = loadLinks();
	let removed = false;
	for (const key of Object.keys(links)) {
		const sessions = links[key].sessions.filter((session) => {
			if (session.id !== linkId) return true;
			removed = true;
			return false;
		});
		if (sessions.length === 0) delete links[key];
		else links[key] = { ...links[key], sessions };
	}
	if (removed) saveLinks(links);
	return removed;
}

export interface DeleteLinkedSessionResult {
	ok: boolean;
	method?: "missing" | "trash" | "unlink";
	error?: string;
}

export function deleteLinkedSession(
	session: SessionLink,
): DeleteLinkedSessionResult {
	const sessionFile = session.sessionFile;
	if (!sessionFile || !existsSync(sessionFile)) {
		removeSessionLink(session.id);
		return { ok: true, method: "missing" };
	}

	const trashArgs = sessionFile.startsWith("-")
		? ["--", sessionFile]
		: [sessionFile];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });
	if (trashResult.status === 0 || !existsSync(sessionFile)) {
		removeSessionLink(session.id);
		return { ok: true, method: "trash" };
	}

	try {
		unlinkSync(sessionFile);
		removeSessionLink(session.id);
		return { ok: true, method: "unlink" };
	} catch (error) {
		const unlinkError = error instanceof Error ? error.message : String(error);
		const trashError =
			trashResult.error?.message || trashResult.stderr?.trim().split("\n")[0];
		return {
			ok: false,
			error: trashError
				? `${unlinkError}（trash: ${trashError}）`
				: unlinkError,
		};
	}
}
