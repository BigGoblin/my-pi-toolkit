import { apiUrl, tapdGet } from "./http.js";
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
	"id,name,description,status,v_status,priority,priority_label,owner,developer,workspace_id,iteration_id,category_id,release_id,module,version,source,feature,label,cc,begin,due";

export interface TapdStoryDetail {
	id: string;
	name: string;
	description?: string;
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
			id: storyId,
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
			id: bugId,
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
