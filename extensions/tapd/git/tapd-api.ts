import type { TapdConfig } from "../types.js";
import { apiUrl, tapdGet, tapdPost } from "../core/http.js";
import type { LinkedTapdObject, TapdGitKind } from "./types.js";

interface TapdDataResponse<T> {
	status: number;
	data: T;
	info?: string;
}

interface BugFieldInfo {
	name: string;
	label: string;
	options?: Record<string, string>;
	html_type?: string;
}

export interface MergeVersionMatch {
	fieldName?: string;
	value?: string;
	candidates?: string[];
	reason?: string;
}

function longObjectId(workspaceId: string, objectId: string): string {
	if (!/^\d{1,9}$/.test(objectId)) return objectId;
	return `11${workspaceId}${objectId.padStart(9, "0")}`;
}

export async function fetchCommitKeyword(
	config: TapdConfig,
	object: LinkedTapdObject,
): Promise<string> {
	const response = await tapdGet<TapdDataResponse<string>>(
		apiUrl(config, "/svn_commits/get_scm_copy_keywords", {
			workspace_id: object.workspaceId,
			object_id: longObjectId(object.workspaceId, object.objectId),
			type: object.kind,
		}),
		config,
	);
	if (!response?.data) throw new Error("无法获取 TAPD 源码提交关键字");
	return response.data;
}

export async function updateTapdStatus(
	config: TapdConfig,
	object: LinkedTapdObject,
	status: string,
	currentOwner?: string,
	extraFields: Record<string, string> = {},
): Promise<void> {
	const body: Record<string, unknown> = {
		workspace_id: object.workspaceId,
		id: longObjectId(object.workspaceId, object.objectId),
		v_status: status,
		...extraFields,
	};
	if (currentOwner) body.current_owner = currentOwner;
	let path = "/stories";
	if (object.kind === "bug") path = "/bugs";
	else if (object.kind === "task") path = "/tasks";
	const response = await tapdPost<TapdDataResponse<unknown>>(
		apiUrl(config, path),
		config,
		body,
	);
	if (!response) throw new Error(`TAPD ${object.kind} 状态更新失败`);
}

function normalizeVersion(value: string): string {
	return value.trim().replace(/^refs\/tags\//, "");
}

function baseVersion(value: string): string {
	return normalizeVersion(value).replace(/\s*[（(]\s*迭代[^）)]*[）)]\s*$/, "");
}

function iterationCode(value: string): string | null {
	return (
		value.match(/(?:迭代\s*)?(\d+\s*-\s*\d+)/)?.[1]?.replace(/\s/g, "") ?? null
	);
}

function findMergeVersionField(
	data: Record<string, BugFieldInfo>,
): BugFieldInfo | null {
	return (
		Object.values(data).find((field) => field.label === "合入版本") ?? null
	);
}

async function fetchMergeVersionField(
	config: TapdConfig,
	workspaceId: string,
): Promise<BugFieldInfo | null> {
	const response = await tapdGet<
		TapdDataResponse<Record<string, BugFieldInfo>>
	>(
		apiUrl(config, "/bugs/get_fields_info", { workspace_id: workspaceId }),
		config,
	);
	return response?.data ? findMergeVersionField(response.data) : null;
}

function historicalVersion(field: BugFieldInfo): string | undefined {
	return Object.keys(field.options ?? {}).find(
		(option) => option === "其他(历史缺陷)" || option === "其他（历史缺陷）",
	);
}

export async function matchHistoricalBugMergeVersion(
	config: TapdConfig,
	workspaceId: string,
): Promise<MergeVersionMatch> {
	const field = await fetchMergeVersionField(config, workspaceId);
	if (!field) return { reason: "TAPD 未提供合入版本字段" };
	const value = historicalVersion(field);
	return value
		? { fieldName: field.name, value, reason: "未能定位引入 commit" }
		: {
				fieldName: field.name,
				reason: "合入版本候选值中没有“其他(历史缺陷)”",
			};
}

export async function matchBugMergeVersion(
	config: TapdConfig,
	workspaceId: string,
	tag: string,
	iterationCodes: string[],
): Promise<MergeVersionMatch> {
	const field = await fetchMergeVersionField(config, workspaceId);
	if (!field) return { reason: "TAPD 未提供合入版本字段" };
	if (!field.options || Object.keys(field.options).length === 0) {
		return { fieldName: field.name, reason: "合入版本字段没有候选值" };
	}
	const normalizedTag = normalizeVersion(tag);
	if (normalizedTag in field.options) {
		return { fieldName: field.name, value: normalizedTag };
	}
	const candidates = Object.keys(field.options).filter(
		(option) => baseVersion(option) === normalizedTag,
	);
	if (candidates.length === 0) {
		const historical = historicalVersion(field);
		if (historical) {
			return {
				fieldName: field.name,
				value: historical,
				reason: `候选值中不存在 ${tag}，按规则使用 ${historical}`,
			};
		}
		return {
			fieldName: field.name,
			reason: `候选值中不存在 ${tag}，且没有“其他(历史缺陷)”`,
		};
	}
	if (candidates.length === 1) {
		return { fieldName: field.name, value: candidates[0] };
	}
	const uniqueCodes = Array.from(new Set(iterationCodes.filter(Boolean)));
	if (uniqueCodes.length !== 1) {
		return {
			fieldName: field.name,
			candidates: uniqueCodes.length === 0 ? candidates : undefined,
			reason:
				uniqueCodes.length === 0
					? `${tag} 有多个候选值，但引入 commit 的 TAPD 事项没有可用迭代，请人工选择`
					: `引入 commit 关联了多个迭代: ${uniqueCodes.join(", ")}`,
		};
	}
	const matches = candidates.filter(
		(candidate) => iterationCode(candidate) === uniqueCodes[0],
	);
	if (matches.length !== 1) {
		return {
			fieldName: field.name,
			reason: `${tag} 与迭代 ${uniqueCodes[0]} 无法唯一匹配合入版本候选值`,
		};
	}
	return { fieldName: field.name, value: matches[0] };
}

export async function fetchObjectIterationCode(
	config: TapdConfig,
	object: LinkedTapdObject,
): Promise<string | null> {
	let path = "/stories";
	let wrapper = "Story";
	if (object.kind === "bug") {
		path = "/bugs";
		wrapper = "Bug";
	} else if (object.kind === "task") {
		path = "/tasks";
		wrapper = "Task";
	}
	const response = await tapdGet<
		TapdDataResponse<Record<string, Record<string, string>>[]>
	>(
		apiUrl(config, path, {
			workspace_id: object.workspaceId,
			id: longObjectId(object.workspaceId, object.objectId),
			fields: "id,iteration_id",
			limit: "1",
		}),
		config,
	);
	const iterationId = response?.data?.[0]?.[wrapper]?.iteration_id;
	if (!iterationId) return null;
	const iterations = await tapdGet<
		TapdDataResponse<{ Iteration: Record<string, string> }[]>
	>(
		apiUrl(config, "/iterations", {
			workspace_id: object.workspaceId,
			id: iterationId,
			fields: "id,name",
			limit: "1",
		}),
		config,
	);
	const name = iterations?.data?.[0]?.Iteration?.name;
	return name ? iterationCode(name) : null;
}

export async function createBugRemark(
	config: TapdConfig,
	object: LinkedTapdObject,
	author: string,
	description: string,
): Promise<void> {
	const response = await tapdPost<TapdDataResponse<unknown>>(
		apiUrl(config, "/comments"),
		config,
		{
			workspace_id: object.workspaceId,
			entry_id: longObjectId(object.workspaceId, object.objectId),
			entry_type: "bug_remark",
			author,
			description,
		},
	);
	if (!response) throw new Error("TAPD Bug 流转备注写入失败");
}

export function tapdKindLabel(kind: TapdGitKind): string {
	if (kind === "bug") return "Bug";
	if (kind === "task") return "任务";
	return "需求";
}
