import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
	ExtensionCommandContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { fetchBugDetail, fetchStoryDetail, htmlToText } from "../core/api.js";
import { removeSessionLink } from "./cleanup.js";
import { bugUrl, storyUrl } from "../todo/model.js";
import {
	buildBugContextPrompt,
	buildUnderstandPrompt,
} from "../documents/prompts.js";
import {
	getOrCreateLink,
	getTapdDocPath,
	loadLinks,
	parseItemKey,
	rememberProjectPaths,
	saveLinks,
} from "./storage.js";
import type { CreateDraft, TapdConfig } from "../types.js";

export async function createTapdSession(
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	itemKey: string,
	itemName: string,
	draft: CreateDraft,
): Promise<void> {
	const parsed = parseItemKey(itemKey);
	const wsId = parsed.wsId;
	const itemId = parsed.itemId;
	const { title, projectPaths } = draft;
	rememberProjectPaths(projectPaths);

	const url =
		parsed.kind === "bug" ? bugUrl(wsId, itemId) : storyUrl(wsId, itemId);
	const detail =
		parsed.kind === "bug"
			? await fetchBugDetail(wsId, itemId, config)
			: await fetchStoryDetail(wsId, itemId, config);
	const description = detail?.description
		? htmlToText(String(detail.description))
		: "";
	const itemTitle =
		parsed.kind === "bug"
			? (detail as any)?.title || title
			: (detail as any)?.name || title;
	let understandingFile: string | undefined;
	let sessionPrompt: string;
	if (parsed.kind === "bug") {
		sessionPrompt = buildBugContextPrompt({
			title: itemTitle,
			bugId: itemId,
			url,
			description,
			projectPaths,
		});
	} else {
		// Use the TAPD story ID as the stable directory name so renaming the
		// requirement does not create a second document directory.
		understandingFile = getTapdDocPath(
			ctx.cwd,
			`story-${itemId}`,
			"understanding.md",
		);
		mkdirSync(dirname(understandingFile), { recursive: true });
		sessionPrompt = buildUnderstandPrompt({
			title: itemTitle,
			storyId: itemId,
			url,
			description,
			projectPaths,
			understandingFile,
		});
	}

	const links = loadLinks();
	const rec2 = getOrCreateLink(links, wsId, itemId, itemName, parsed.kind);
	const linkId =
		Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	rec2.sessions.push({
		id: linkId,
		createdAt: new Date().toISOString(),
		title,
		projectPaths: projectPaths.length > 0 ? projectPaths : undefined,
		understandingFile,
	});
	saveLinks(links);

	try {
		const result = await ctx.newSession({
			parentSession: undefined,
			setup: async (sm: SessionManager) => {
				sm.appendSessionInfo(title);
				sm.appendMessage({
					role: "user",
					content: [{ type: "text", text: sessionPrompt }],
					timestamp: Date.now(),
				});
			},
			withSession: async (replacementCtx: ExtensionCommandContext) => {
				const sf = replacementCtx.sessionManager.getSessionFile?.() ?? "";
				const links3 = loadLinks();
				const rec3 = getOrCreateLink(
					links3,
					wsId,
					itemId,
					itemName,
					parsed.kind,
				);
				if (sf) {
					const lk = rec3.sessions.find((s) => s.id === linkId);
					if (lk) lk.sessionFile = sf;
				}
				saveLinks(links3);
				replacementCtx.ui.notify(
					parsed.kind === "bug"
						? "Bug 会话已创建，输入 /tapd bug 获取完整缺陷信息并定位原因"
						: "会话已创建，输入 /tapd analyze 开始需求理解",
					"info",
				);
			},
		});
		if (result.cancelled) throw new Error("创建会话已取消");
	} catch (error) {
		removeSessionLink(linkId);
		throw error;
	}
}
