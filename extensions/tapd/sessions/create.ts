import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fetchBugDetail, fetchStoryDetail, htmlToText } from "../core/api.js";
import { bugUrl, storyUrl } from "../todo/model.js";
import { rememberProjectPaths } from "./storage.js";
import { parseItemKey } from "./keys.js";
import { getTapdDocPath } from "./docs.js";
import type { TapdSessionState } from "./session-state.js";
import { spawnTapdSession } from "./spawn.js";
import {
	buildBugContextPrompt,
	buildUnderstandPrompt,
} from "../documents/prompts.js";
import type { CreateDraft, TapdConfig } from "../types.js";

function resolveTargetCwd(
	workingDirectory: string | undefined,
	fallbackCwd: string,
): string {
	if (!workingDirectory?.trim()) return resolve(fallbackCwd);
	const target = resolve(workingDirectory.trim());
	let stats;
	try {
		stats = statSync(target);
	} catch {
		throw new Error(`工作目录不存在：${target}`);
	}
	if (!stats.isDirectory()) throw new Error(`工作目录不是目录：${target}`);
	return target;
}

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
	const targetCwd = resolveTargetCwd(draft.workingDirectory, ctx.cwd);

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
			targetCwd,
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

	await spawnTapdSession(ctx, {
		title,
		targetCwd,
		state,
		sessionPrompt,
		notifyMessage:
			parsed.kind === "bug"
				? "Bug 会话已创建，输入 /tapd bug 获取完整缺陷信息并定位原因"
				: "会话已创建，输入 /tapd analyze 开始需求理解",
	});
}
