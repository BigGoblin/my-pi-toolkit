import {
	fetchStoryChildren,
	fetchStoryDetail,
	fetchUserInfo,
	fetchWorkitemTypes,
	type TapdStoryDetail,
	type TapdWorkitemType,
} from "../core/api.js";
import type { TapdConfig } from "../types.js";
import type { LinkedTapdObject } from "./types.js";
import { updateTapdStatus } from "./tapd-api.js";

const DEVELOPMENT_COMPLETE = "开发完成";
const TEST_PASSED = "已通过";

interface StoryContext {
	story: TapdStoryDetail;
	developmentType: TapdWorkitemType;
	testType?: TapdWorkitemType;
}

function isFunctionalStory(story: TapdStoryDetail): boolean {
	return !story.parent_id || story.parent_id === "0";
}

function findType(
	workitemTypes: TapdWorkitemType[],
	englishNames: string[],
	chineseNames: string[],
): TapdWorkitemType | undefined {
	return (
		workitemTypes.find((type) =>
			englishNames.includes((type.english_name ?? "").toLowerCase()),
		) ?? workitemTypes.find((type) => chineseNames.includes(type.name))
	);
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

function estimatedEffort(story: TapdStoryDetail): string | undefined {
	const effort = story.effort?.trim();
	return effort && Number.isFinite(Number(effort)) && Number(effort) > 0
		? effort
		: undefined;
}

function effortSummary(effort: string | undefined): string {
	return effort ? `，完成工时 ${effort}` : "，未同步完成工时（无有效预估工时）";
}

async function updateStoryStatus(
	config: TapdConfig,
	workspaceId: string,
	story: TapdStoryDetail,
	status: string,
): Promise<string | undefined> {
	const effort = estimatedEffort(story);
	await updateTapdStatus(
		config,
		{
			workspaceId,
			objectId: story.id,
			kind: "story",
		},
		status,
		undefined,
		effort ? { effort_completed: effort } : {},
	);
	return effort;
}

async function loadStoryContext(
	config: TapdConfig,
	object: LinkedTapdObject,
): Promise<StoryContext> {
	const [story, workitemTypes] = await Promise.all([
		fetchStoryDetail(object.workspaceId, object.objectId, config),
		fetchWorkitemTypes(object.workspaceId, config),
	]);
	if (!story) throw new Error(`无法获取 TAPD 需求 ${object.objectId}`);
	const developmentType = findType(
		workitemTypes,
		["development", "develop"],
		["开发子需求"],
	);
	if (!developmentType?.id)
		throw new Error("当前工作空间未找到“开发子需求”类型");
	const testType = findType(
		workitemTypes,
		["test", "testing"],
		["测试需求", "测试子需求"],
	);
	return { story, developmentType, testType };
}

async function loadOwnedChildren(
	config: TapdConfig,
	object: LinkedTapdObject,
	story: TapdStoryDetail,
): Promise<{ nick: string; children: TapdStoryDetail[] }> {
	const [user, children] = await Promise.all([
		fetchUserInfo(config),
		fetchStoryChildren(object.workspaceId, story.id, config),
	]);
	if (!user?.nick)
		throw new Error("无法获取当前 TAPD 用户，不能安全更新关联需求");
	return {
		nick: user.nick,
		children: children.filter((child) => isOwnedBy(child.owner, user.nick)),
	};
}

async function transitionChildren(
	config: TapdConfig,
	object: LinkedTapdObject,
	children: TapdStoryDetail[],
	typeId: string | undefined,
	status: string,
	kindLabel: string,
	reportProgress?: (content: string) => void,
): Promise<string[]> {
	if (!typeId) return [];
	const matching = children.filter(
		(child) => child.workitem_type_id === typeId,
	);
	const updates: string[] = [];
	for (const child of matching) {
		reportProgress?.(
			`正在更新我的${kindLabel}「${child.name}」为 ${status}...`,
		);
		const effort = await updateStoryStatus(
			config,
			object.workspaceId,
			child,
			status,
		);
		updates.push(
			`${kindLabel} ${storyLabel(child)} → ${status}${effortSummary(effort)}`,
		);
	}
	return updates;
}

/** Draft MRs complete owned development children but keep functional/test work open. */
export async function updateStoryForDraftMergeRequest(
	config: TapdConfig,
	object: LinkedTapdObject,
	reportProgress?: (content: string) => void,
): Promise<string[]> {
	const { story, developmentType, testType } = await loadStoryContext(
		config,
		object,
	);
	if (!isFunctionalStory(story)) {
		if (story.workitem_type_id !== developmentType.id) {
			const kind =
				story.workitem_type_id === testType?.id ? "测试需求" : "非开发子需求";
			return [`story/${object.objectId} 跳过（草稿 MR 不流转${kind}）`];
		}
		reportProgress?.(
			`正在更新开发子需求「${story.name}」为 ${DEVELOPMENT_COMPLETE}...`,
		);
		const effort = await updateStoryStatus(
			config,
			object.workspaceId,
			story,
			DEVELOPMENT_COMPLETE,
		);
		return [
			`开发子需求 ${storyLabel(story)} → ${DEVELOPMENT_COMPLETE}${effortSummary(effort)}`,
		];
	}

	const { children } = await loadOwnedChildren(config, object, story);
	const updates = [
		`功能需求 story/${object.objectId} 跳过（草稿 MR 不流转）`,
		...(await transitionChildren(
			config,
			object,
			children,
			developmentType.id,
			DEVELOPMENT_COMPLETE,
			"开发子需求",
			reportProgress,
		)),
	];
	if (updates.length === 1) updates.push("没有处理人为当前用户的开发子需求");
	return updates;
}

/** Ready MRs complete owned functional/development work and pass owned tests. */
export async function updateStoryForMergeRequest(
	config: TapdConfig,
	object: LinkedTapdObject,
	reportProgress?: (content: string) => void,
): Promise<string[]> {
	const { story, developmentType, testType } = await loadStoryContext(
		config,
		object,
	);
	if (!isFunctionalStory(story)) {
		if (story.workitem_type_id === developmentType.id) {
			reportProgress?.(
				`正在更新开发子需求「${story.name}」为 ${DEVELOPMENT_COMPLETE}...`,
			);
			const effort = await updateStoryStatus(
				config,
				object.workspaceId,
				story,
				DEVELOPMENT_COMPLETE,
			);
			return [
				`开发子需求 ${storyLabel(story)} → ${DEVELOPMENT_COMPLETE}${effortSummary(effort)}`,
			];
		}
		if (story.workitem_type_id !== testType?.id)
			return [`story/${object.objectId} 跳过（非开发或测试需求）`];
		const user = await fetchUserInfo(config);
		if (!user?.nick)
			throw new Error("无法获取当前 TAPD 用户，不能安全更新测试需求");
		if (!isOwnedBy(story.owner, user.nick))
			return [`测试需求 ${storyLabel(story)} 跳过（处理人不是当前用户）`];
		reportProgress?.(`正在更新测试需求「${story.name}」为 ${TEST_PASSED}...`);
		const effort = await updateStoryStatus(
			config,
			object.workspaceId,
			story,
			TEST_PASSED,
		);
		return [
			`测试需求 ${storyLabel(story)} → ${TEST_PASSED}${effortSummary(effort)}`,
		];
	}

	const { nick, children } = await loadOwnedChildren(config, object, story);
	const updates: string[] = [];
	if (isOwnedBy(story.owner, nick)) {
		reportProgress?.(
			`功能需求处理人为当前用户，正在更新为 ${DEVELOPMENT_COMPLETE}...`,
		);
		const effort = await updateStoryStatus(
			config,
			object.workspaceId,
			story,
			DEVELOPMENT_COMPLETE,
		);
		updates.push(
			`功能需求 ${storyLabel(story)} → ${DEVELOPMENT_COMPLETE}${effortSummary(effort)}`,
		);
	} else {
		updates.push(`功能需求 ${storyLabel(story)} 跳过（处理人不是当前用户）`);
	}
	updates.push(
		...(await transitionChildren(
			config,
			object,
			children,
			developmentType.id,
			DEVELOPMENT_COMPLETE,
			"开发子需求",
			reportProgress,
		)),
		...(await transitionChildren(
			config,
			object,
			children,
			testType?.id,
			TEST_PASSED,
			"测试需求",
			reportProgress,
		)),
	);
	return updates;
}
