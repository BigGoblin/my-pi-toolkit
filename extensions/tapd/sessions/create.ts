import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
	ExtensionCommandContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { fetchBugDetail, fetchStoryDetail, htmlToText } from "../core/api.js";
import { bugUrl, storyUrl } from "../todo/model.js";
import { rememberProjectPaths } from "./storage.js";
import { parseItemKey } from "./keys.js";
import { getTapdDocPath } from "./docs.js";
import {
	TAPD_SESSION_STATE_TYPE,
	type TapdSessionState,
} from "./session-state.js";
import {
	buildBugContextPrompt,
	buildUnderstandPrompt,
} from "../documents/prompts.js";
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
			? (detail as { title?: string } | null)?.title || itemName || title
			: (detail as { name?: string } | null)?.name || itemName || title;
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

	const now = new Date().toISOString();
	const state: TapdSessionState = {
		version: 1,
		workspaceId: wsId,
		itemId,
		kind: parsed.kind,
		itemName: itemTitle,
		createdAt: now,
		title,
		projectPaths: projectPaths.length > 0 ? projectPaths : undefined,
		understandingFile,
		updatedAt: now,
	};

	const result = await ctx.newSession({
		parentSession: undefined,
		setup: async (sm: SessionManager) => {
			sm.appendSessionInfo(title);
			sm.appendCustomEntry(TAPD_SESSION_STATE_TYPE, state);
			sm.appendMessage({
				role: "user",
				content: [{ type: "text", text: sessionPrompt }],
				timestamp: Date.now(),
			});
		},
		withSession: async (replacementCtx: ExtensionCommandContext) => {
			replacementCtx.ui.notify(
				parsed.kind === "bug"
					? "Bug 会话已创建，输入 /tapd bug 获取完整缺陷信息并定位原因"
					: "会话已创建，输入 /tapd analyze 开始需求理解",
				"info",
			);
		},
	});
	if (result.cancelled) throw new Error("创建会话已取消");
}
