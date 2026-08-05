import { marked } from "marked";
import { fetchStoryDetail, fetchUserInfo } from "../core/api.js";
import { apiUrl, tapdGet, tapdPost } from "../core/http.js";
import { storyUrl } from "../todo/model.js";
import type {
	CreatedSubtask,
	DevelopmentTaskSuggestion,
	SubtaskPlanItem,
	TapdConfig,
	TapdResponse,
} from "../types.js";

export interface SubtaskTypeIds {
	design: string;
	development: string;
}

export interface SubtaskSyncContext {
	owner: string;
	types: SubtaskTypeIds;
	inheritedFields: Record<string, string>;
}

/** 拉取父需求、当前用户与工作项类型；缺少任一必需类型返回 null。 */
export async function fetchSubtaskSyncContext(
	config: TapdConfig,
	workspaceId: string,
	storyId: string,
): Promise<SubtaskSyncContext | null> {
	const [parentStory, user, workitemTypes] = await Promise.all([
		fetchStoryDetail(workspaceId, storyId, config),
		fetchUserInfo(config),
		tapdGet<
			TapdResponse<{
				WorkitemType: { id: string; name: string; english_name?: string };
			}>
		>(
			apiUrl(config, "/workitem_types", {
				workspace_id: workspaceId,
				status: "3",
				limit: "200",
			}),
			config,
		),
	]);
	if (!parentStory || !user?.nick) return null;
	const types = workitemTypes?.data?.map((row) => row.WorkitemType) ?? [];
	const designType =
		types.find((type) => type.english_name === "design") ??
		types.find((type) => type.name === "设计子需求");
	const developmentType =
		types.find((type) =>
			["development", "develop"].includes(type.english_name ?? ""),
		) ?? types.find((type) => type.name === "开发子需求");
	if (!designType?.id || !developmentType?.id) return null;

	const inheritedFields = Object.fromEntries(
		[
			"priority_label",
			"iteration_id",
			"category_id",
			"release_id",
			"module",
			"version",
			"source",
			"feature",
			"label",
			"cc",
			"begin",
			"due",
		]
			.map((field) => [field, parentStory[field as keyof typeof parentStory]])
			.filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === "string" && entry[1] !== "",
			),
	);
	return {
		owner: user.nick,
		types: { design: designType.id, development: developmentType.id },
		inheritedFields,
	};
}

export async function buildSubtaskDescription(
	item: SubtaskPlanItem,
	storyName: string,
	created: CreatedSubtask[],
	collaborationMarkdown: string,
): Promise<string> {
	let markdown = collaborationMarkdown;
	if (item.kind === "development") {
		const designResult = created.find((done) => done.kind === "design");
		const dependencies =
			item.dependencies.length > 0
				? item.dependencies.map((value) => `- ${value}`)
				: ["无"];
		markdown = [
			"## 开发范围",
			...item.scope.map((value) => `- ${value}`),
			"",
			"## 验收标准",
			...item.acceptanceCriteria.map((value) => `- ${value}`),
			"",
			"## 依赖关系",
			...dependencies,
			"",
			"## 关联设计",
			`- 父需求：${storyName}`,
			`- 设计子需求：${designResult?.tapdUrl ?? "本批次创建"}`,
		].join("\n");
	}
	return marked.parse(markdown, { gfm: true, breaks: false });
}

/** 更新已有子需求，成功返回 true。 */
export async function updateSubtaskOnTapd(
	config: TapdConfig,
	workspaceId: string,
	existing: CreatedSubtask,
	item: SubtaskPlanItem,
	description: string,
	owner: string,
): Promise<boolean> {
	const response = await tapdPost<{ status: number; data?: unknown }>(
		apiUrl(config, "/stories"),
		config,
		{
			workspace_id: workspaceId,
			id: existing.tapdId,
			name: item.title,
			description,
			effort: String(item.effort),
			owner,
			developer: owner,
		},
	);
	return Boolean(response);
}

/** 创建子需求，成功返回 CreatedSubtask；失败抛出带标题的错误。 */
export async function createSubtaskOnTapd(
	config: TapdConfig,
	workspaceId: string,
	storyId: string,
	item: SubtaskPlanItem,
	description: string,
	owner: string,
	types: SubtaskTypeIds,
	inheritedFields: Record<string, string>,
): Promise<CreatedSubtask> {
	try {
		const response = await tapdPost<{
			status: number;
			data?: { Story?: { id: string } };
		}>(apiUrl(config, "/stories"), config, {
			workspace_id: workspaceId,
			name: item.title,
			description,
			parent_id: storyId,
			workitem_type_id:
				item.kind === "design" ? types.design : types.development,
			effort: String(item.effort),
			owner,
			developer: owner,
			...inheritedFields,
		});
		const childId = response?.data?.Story?.id;
		if (!childId) throw new Error("接口未返回子需求 ID");
		return {
			localId: item.localId,
			kind: item.kind,
			title: item.title,
			effort: item.effort,
			tapdId: childId,
			tapdUrl: storyUrl(workspaceId, childId),
			createdAt: new Date().toISOString(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${item.title} 创建失败：${message}`);
	}
}

export type { DevelopmentTaskSuggestion };
