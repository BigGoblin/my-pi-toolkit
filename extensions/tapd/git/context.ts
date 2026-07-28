import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { findSessionLink } from "../sessions/storage.js";
import type { LinkedTapdObject, TapdGitKind, TapdKeyword } from "./types.js";

export function currentTapdObject(
	ctx: ExtensionCommandContext,
): LinkedTapdObject {
	const sessionFile = ctx.sessionManager.getSessionFile();
	const linked = findSessionLink(sessionFile ?? "");
	if (!linked)
		throw new Error(
			"当前 Pi 会话没有关联 TAPD 事项，请先从 /tapd 创建或进入关联会话",
		);
	return {
		workspaceId: linked.record.workspaceId,
		objectId: linked.record.itemId ?? linked.record.storyId,
		kind: linked.record.kind ?? "story",
		name: linked.record.name,
	};
}

export function parseTapdKeywords(subject: string): TapdKeyword[] {
	const matches = Array.from(
		subject.matchAll(/--(story|task|bug)=(\d+)@tapd-(\d+)/g),
	);
	return matches.map((match) => ({
		kind: match[1] as TapdGitKind,
		shortId: match[2],
		objectId: match[2],
		workspaceId: match[3],
		keyword: subject,
		author: subject.match(/--user=([^\s]+)/)?.[1],
	}));
}

export function parseKeyword(
	keyword: string,
	fallback: LinkedTapdObject,
): TapdKeyword {
	const parsed = parseTapdKeywords(keyword)[0];
	if (!parsed)
		throw new Error("TAPD 未返回可识别的 --story/--task/--bug 提交关键字");
	return { ...parsed, objectId: fallback.objectId, name: fallback.name };
}
