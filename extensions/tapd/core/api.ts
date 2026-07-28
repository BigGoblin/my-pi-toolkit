import { apiUrl, tapdGet } from "./http.js";
import { longTapdObjectId } from "./object-id.js";
import type { TapdConfig, TapdResponse, TapdWorkspace } from "../types.js";

export async function fetchUserInfo(
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<{ nick: string } | null> {
	const response = await tapdGet<{ status: number; data: { nick: string } }>(
		apiUrl(c, "/users/info"),
		c,
		signal,
	);
	return response?.data ?? null;
}

export async function fetchWorkspaces(
	nick: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<TapdWorkspace[]> {
	const response = await tapdGet<TapdResponse<{ Workspace: TapdWorkspace }>>(
		apiUrl(c, "/workspaces/user_participant_projects", { nick }),
		c,
		signal,
	);
	if (!response?.data) return [];
	return response.data
		.map((row) => row.Workspace)
		.filter(Boolean)
		.map((workspace) => ({ id: workspace.id, name: workspace.name }));
}

const STORY_DETAIL_FIELDS =
	"id,name,description,status,v_status,priority,priority_label,owner,developer,workspace_id,parent_id,workitem_type_id,iteration_id,category_id,release_id,module,version,source,feature,label,cc,begin,due";

export interface TapdStoryDetail {
	id: string;
	name: string;
	description?: string;
	status?: string;
	v_status?: string;
	owner?: string;
	developer?: string;
	workspace_id?: string;
	parent_id?: string;
	workitem_type_id?: string;
	priority_label?: string;
	iteration_id?: string;
	category_id?: string;
	release_id?: string;
	module?: string;
	version?: string;
	source?: string;
	feature?: string;
	label?: string;
	cc?: string;
	begin?: string;
	due?: string;
}

export async function fetchStoryDetail(
	wsId: string,
	storyId: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<TapdStoryDetail | null> {
	const response = await tapdGet<TapdResponse<{ Story: any }>>(
		apiUrl(c, "/stories", {
			workspace_id: wsId,
			id: longTapdObjectId(wsId, storyId),
			fields: STORY_DETAIL_FIELDS,
			with_v_status: "1",
			limit: "1",
		}),
		c,
		signal,
	);
	const story = response?.data?.[0]?.Story;
	return story?.id ? story : null;
}

export interface TapdWorkitemType {
	id: string;
	name: string;
	english_name?: string;
}

export async function fetchWorkitemTypes(
	wsId: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<TapdWorkitemType[]> {
	const types: TapdWorkitemType[] = [];
	for (let page = 1; ; page += 1) {
		const response = await tapdGet<
			TapdResponse<{ WorkitemType: TapdWorkitemType }>
		>(
			apiUrl(c, "/workitem_types", {
				workspace_id: wsId,
				limit: "200",
				page: String(page),
			}),
			c,
			signal,
		);
		if (!response) throw new Error("获取 TAPD 工作项类型失败");
		const pageItems = (response.data ?? [])
			.map((row) => row.WorkitemType)
			.filter((type): type is TapdWorkitemType => Boolean(type?.id));
		types.push(...pageItems);
		if (pageItems.length < 200) return types;
	}
}

export async function fetchStoryChildren(
	wsId: string,
	parentId: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<TapdStoryDetail[]> {
	const children: TapdStoryDetail[] = [];
	for (let page = 1; ; page += 1) {
		const response = await tapdGet<TapdResponse<{ Story: TapdStoryDetail }>>(
			apiUrl(c, "/stories", {
				workspace_id: wsId,
				parent_id: longTapdObjectId(wsId, parentId),
				fields: STORY_DETAIL_FIELDS,
				with_v_status: "1",
				limit: "200",
				page: String(page),
			}),
			c,
			signal,
		);
		if (!response) throw new Error("获取 TAPD 子需求失败");
		const pageItems = (response.data ?? [])
			.map((row) => row.Story)
			.filter((story): story is TapdStoryDetail => Boolean(story?.id));
		children.push(...pageItems);
		if (pageItems.length < 200) return children;
	}
}

export interface TapdBugDetail {
	id: string;
	title: string;
	description?: string;
	[key: string]: unknown;
}

export async function fetchBugDetail(
	wsId: string,
	bugId: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<TapdBugDetail | null> {
	const response = await tapdGet<TapdResponse<{ Bug: TapdBugDetail }>>(
		apiUrl(c, "/bugs", {
			workspace_id: wsId,
			id: longTapdObjectId(wsId, bugId),
			with_v_status: "1",
			limit: "1",
		}),
		c,
		signal,
	);
	const bug = response?.data?.[0]?.Bug;
	return bug?.id ? bug : null;
}

export function htmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|tr|li)>/gi, "\n")
		.replace(/<li[^>]*>/gi, "- ")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
