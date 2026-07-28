import {
	fetchStoryChildren,
	fetchStoryDetail,
	fetchUserInfo,
	fetchWorkitemTypes,
	type TapdStoryDetail,
} from "../core/api.js";
import type { TapdConfig } from "../types.js";
import type { LinkedTapdObject } from "./types.js";
import { updateTapdStatus } from "./tapd-api.js";

const DEVELOPMENT_COMPLETE = "开发完成";

function isFunctionalStory(story: TapdStoryDetail): boolean {
	return !story.parent_id || story.parent_id === "0";
}

function isOwnedBy(owner: string | undefined, nick: string): boolean {
	return (owner ?? "")
		.split(/[;,，]/)
		.map((value) => value.trim())
		.filter(Boolean)
		.includes(nick);
}

function storyLabel(story: TapdStoryDetail): string {
	return story.name ? `${story.name} (${story.id})` : story.id;
}

async function completeStory(
	config: TapdConfig,
	workspaceId: string,
	story: TapdStoryDetail,
): Promise<void> {
	await updateTapdStatus(
		config,
		{ workspaceId, objectId: story.id, kind: "story" },
		DEVELOPMENT_COMPLETE,
	);
}

/**
 * A linked development sub-story is completed directly. For a top-level
 * functional story, only work owned by the token user is transitioned: the
 * functional story itself when owned by that user, plus directly related
 * development sub-stories owned by that user.
 */
export async function updateStoryForMergeRequest(
	config: TapdConfig,
	object: LinkedTapdObject,
	reportProgress?: (content: string) => void,
): Promise<string[]> {
	const story = await fetchStoryDetail(
		object.workspaceId,
		object.objectId,
		config,
	);
	if (!story) throw new Error(`无法获取 TAPD 需求 ${object.objectId}`);

	if (!isFunctionalStory(story)) {
		reportProgress?.(
			`正在更新开发子需求「${story.name}」为 ${DEVELOPMENT_COMPLETE}...`,
		);
		await completeStory(config, object.workspaceId, story);
		return [`story/${object.objectId} → ${DEVELOPMENT_COMPLETE}`];
	}

	const [user, children, workitemTypes] = await Promise.all([
		fetchUserInfo(config),
		fetchStoryChildren(object.workspaceId, story.id, config),
		fetchWorkitemTypes(object.workspaceId, config),
	]);
	if (!user?.nick)
		throw new Error("无法获取当前 TAPD 用户，不能安全更新功能需求");
	const developmentType =
		workitemTypes.find((type) =>
			["development", "develop"].includes(type.english_name ?? ""),
		) ?? workitemTypes.find((type) => type.name === "开发子需求");
	if (!developmentType?.id)
		throw new Error("当前工作空间未找到“开发子需求”类型");
	const ownedDevelopmentChildren = children.filter(
		(child) =>
			child.workitem_type_id === developmentType.id &&
			isOwnedBy(child.owner, user.nick),
	);
	const updates: string[] = [];

	if (isOwnedBy(story.owner, user.nick)) {
		reportProgress?.(
			`功能需求处理人为当前用户，正在更新为 ${DEVELOPMENT_COMPLETE}...`,
		);
		await completeStory(config, object.workspaceId, story);
		updates.push(`story/${object.objectId} → ${DEVELOPMENT_COMPLETE}`);
	} else {
		updates.push(
			`story/${object.objectId} 跳过（处理人：${story.owner || "未设置"}）`,
		);
	}

	for (const child of ownedDevelopmentChildren) {
		reportProgress?.(
			`正在更新我的开发子需求「${child.name}」为 ${DEVELOPMENT_COMPLETE}...`,
		);
		await completeStory(config, object.workspaceId, child);
		updates.push(`开发子需求 ${storyLabel(child)} → ${DEVELOPMENT_COMPLETE}`);
	}
	if (ownedDevelopmentChildren.length === 0)
		updates.push("没有处理人为当前用户的开发子需求");
	return updates;
}
