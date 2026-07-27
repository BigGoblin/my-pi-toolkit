import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
	TapdConfig,
	TapdItem,
	TapdItemKind,
	TapdResponse,
	TapdWorkspace,
} from "./types.js";

export const DEFAULT_BASE = "https://api.tapd.cn";

export function loadConfig(): TapdConfig | null {
	const p = join(getAgentDir(), "tapd.json");
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf-8")) as TapdConfig;
	} catch {
		return null;
	}
}

export function apiUrl(
	c: TapdConfig,
	path: string,
	q?: Record<string, string>,
): string {
	const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
	return base + path + (q ? "?" + new URLSearchParams(q).toString() : "");
}

export async function tapdGet<T>(
	url: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<T | null> {
	try {
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${c.token}`,
				"Content-Type": "application/json",
			},
			signal,
		});
		if (!response.ok) return null;
		const json: any = await response.json();
		return json.status === 1 ? (json as T) : null;
	} catch (err: any) {
		if (err.name === "AbortError") return null;
		console.error("TAPD fetch error:", err.message);
		return null;
	}
}

export async function tapdPost<T>(
	url: string,
	c: TapdConfig,
	body: Record<string, unknown>,
): Promise<T | null> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${c.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!response.ok) return null;
		const json: any = await response.json();
		return json.status === 1 ? (json as T) : null;
	} catch (err: any) {
		console.error("TAPD POST error:", err.message);
		return null;
	}
}

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

async function fetchTodoIds(
	wsId: string,
	c: TapdConfig,
	kind: "story" | "bug",
	signal?: AbortSignal,
): Promise<string[]> {
	const ids: string[] = [];
	const endpoint =
		kind === "bug"
			? "/user_oauth/get_user_todo_bug"
			: "/user_oauth/get_user_todo_story";
	const key = kind === "bug" ? "Bug" : "Story";
	let page = 1;
	while (true) {
		const response = await tapdGet<
			TapdResponse<Record<string, { id: string }>>
		>(
			apiUrl(c, endpoint, {
				workspace_id: wsId,
				limit: "200",
				page: String(page),
			}),
			c,
			signal,
		);
		if (!response?.data || response.data.length === 0) break;
		for (const row of response.data) if (row[key]?.id) ids.push(row[key].id);
		if (response.data.length < 200 || page >= 50) break;
		page++;
	}
	return ids;
}

const STORY_FIELDS =
	"id,name,status,v_status,priority,priority_label,owner,developer,workspace_id,parent_id,ancestor_id,iteration_id,workitem_type_id,begin,due,effort,effort_completed,remain,modified";
const STORY_DETAIL_FIELDS =
	"id,name,description,status,v_status,priority,priority_label,owner,developer,workspace_id,iteration_id,category_id,release_id,module,version,source,feature,label,cc,begin,due";
const BUG_FIELDS =
	"id,title,description,status,v_status,priority,priority_label,severity,current_owner,iteration_id,begin,due,modified,workspace_id";

async function fetchItems<T>(
	endpoint: string,
	field: "Story" | "Bug",
	wsId: string,
	ids: string[],
	fields: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<T[]> {
	const all: T[] = [];
	for (const chunk of chunkArr(ids, 50)) {
		const response = await tapdGet<TapdResponse<Record<string, T>>>(
			apiUrl(c, endpoint, {
				workspace_id: wsId,
				id: chunk.join(","),
				fields,
				with_v_status: "1",
				limit: "200",
			}),
			c,
			signal,
		);
		if (response?.data)
			for (const row of response.data) if (row[field]) all.push(row[field]);
	}
	return all;
}

async function fetchStories(
	wsId: string,
	ids: string[],
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<any[]> {
	return fetchItems<any>(
		"/stories",
		"Story",
		wsId,
		ids,
		STORY_FIELDS,
		c,
		signal,
	);
}

async function fetchBugs(
	wsId: string,
	ids: string[],
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<any[]> {
	return fetchItems<any>("/bugs", "Bug", wsId, ids, BUG_FIELDS, c, signal);
}

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

function chunkArr<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		chunks.push(items.slice(i, i + size));
	return chunks;
}

async function fetchIterations(
	wsId: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<
	{ id: string; name: string; startdate?: string; enddate?: string }[]
> {
	const items: any[] = [];
	let page = 1;
	while (true) {
		const response = await tapdGet<TapdResponse<{ Iteration: any }>>(
			apiUrl(c, "/iterations", {
				workspace_id: wsId,
				status: "open",
				limit: "200",
				page: String(page),
			}),
			c,
			signal,
		);
		if (!response?.data || response.data.length === 0) break;
		for (const row of response.data) {
			const iteration = row.Iteration;
			if (iteration?.id)
				items.push({
					id: iteration.id,
					name: iteration.name,
					startdate: iteration.startdate,
					enddate: iteration.enddate,
				});
		}
		if (response.data.length < 200 || page >= 50) break;
		page++;
	}
	return items;
}

async function fetchTypeNames(
	wsId: string,
	c: TapdConfig,
	signal?: AbortSignal,
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	let page = 1;
	while (true) {
		const response = await tapdGet<
			TapdResponse<{ WorkitemType: { id: string; name: string } }>
		>(
			apiUrl(c, "/workitem_types", {
				workspace_id: wsId,
				limit: "200",
				page: String(page),
			}),
			c,
			signal,
		);
		if (!response?.data || response.data.length === 0) break;
		for (const row of response.data) {
			const type = row.WorkitemType;
			if (type?.id) names.set(type.id, type.name);
		}
		if (response.data.length < 200 || page >= 20) break;
		page++;
	}
	return names;
}

function isCurrent(iteration: {
	startdate?: string;
	enddate?: string;
}): boolean {
	if (!iteration.startdate || !iteration.enddate) return false;
	const today = new Date().toISOString().slice(0, 10);
	return iteration.startdate <= today && iteration.enddate >= today;
}

async function fetchStoryWorkspace(
	ws: TapdWorkspace,
	c: TapdConfig,
	scope: "current" | "all",
	signal?: AbortSignal,
): Promise<{ items: TapdItem[]; errors: string[] }> {
	const items: TapdItem[] = [];
	const errors: string[] = [];
	const ids = await fetchTodoIds(ws.id, c, "story", signal);
	if (ids.length === 0) return { items, errors };
	const [stories, iterations, typeNames] = await Promise.all([
		fetchStories(ws.id, ids, c, signal),
		fetchIterations(ws.id, c, signal),
		fetchTypeNames(ws.id, c, signal),
	]);
	const iterationNames = new Map(
		iterations.map((iteration) => [iteration.id, iteration.name]),
	);
	const currentIds = new Set(
		iterations.filter(isCurrent).map((iteration) => iteration.id),
	);
	const mapStory = (raw: any): TapdItem => {
		const iterationId = raw.iteration_id ?? undefined;
		return {
			id: raw.id,
			kind: "story",
			name: raw.name,
			status: raw.v_status ?? raw.status,
			priority: raw.priority_label ?? raw.priority ?? "-",
			owner: raw.owner,
			workspaceId: raw.workspace_id,
			workspaceName: ws.name,
			begin: raw.begin?.slice(0, 10),
			due: raw.due?.slice(0, 10),
			iterationId,
			iterationName: iterationId ? iterationNames.get(iterationId) : undefined,
			parentId: raw.parent_id ?? undefined,
			workitemTypeName: raw.workitem_type_id
				? typeNames.get(raw.workitem_type_id)
				: undefined,
			children: [],
			depth: 0,
			hasChildren: false,
		};
	};
	for (const raw of stories) {
		const item = mapStory(raw);
		if (
			scope === "current" &&
			!(item.iterationId && currentIds.has(item.iterationId))
		)
			continue;
		items.push(item);
	}
	const present = new Set(items.map((item) => item.id));
	const missing = Array.from(
		new Set(
			items
				.filter((item) => item.parentId && !present.has(item.parentId))
				.map((item) => item.parentId!),
		),
	);
	if (missing.length > 0)
		for (const raw of await fetchStories(ws.id, missing, c, signal))
			items.push(mapStory(raw));
	return { items, errors };
}

async function fetchBugWorkspace(
	ws: TapdWorkspace,
	c: TapdConfig,
	scope: "current" | "all",
	signal?: AbortSignal,
): Promise<{ items: TapdItem[]; errors: string[] }> {
	const items: TapdItem[] = [];
	const errors: string[] = [];
	const ids = await fetchTodoIds(ws.id, c, "bug", signal);
	if (ids.length === 0) return { items, errors };
	const [bugs, iterations] = await Promise.all([
		fetchBugs(ws.id, ids, c, signal),
		fetchIterations(ws.id, c, signal),
	]);
	const iterationNames = new Map(
		iterations.map((iteration) => [iteration.id, iteration.name]),
	);
	const currentIds = new Set(
		iterations.filter(isCurrent).map((iteration) => iteration.id),
	);
	for (const raw of bugs) {
		const iterationId = raw.iteration_id ?? undefined;
		if (scope === "current" && !(iterationId && currentIds.has(iterationId)))
			continue;
		items.push({
			id: raw.id,
			kind: "bug",
			name: raw.title ?? raw.name ?? "(无标题)",
			status: raw.v_status ?? raw.status ?? "-",
			priority: raw.priority_label ?? raw.priority ?? "-",
			owner: raw.current_owner ?? raw.owner ?? "",
			severity: raw.severity ?? "",
			workspaceId: raw.workspace_id ?? ws.id,
			workspaceName: ws.name,
			begin: raw.begin?.slice(0, 10),
			due: raw.due?.slice(0, 10),
			iterationId,
			iterationName: iterationId ? iterationNames.get(iterationId) : undefined,
			children: [],
			depth: 0,
			hasChildren: false,
		});
	}
	return { items, errors };
}

export async function fetchAll(
	workspaces: TapdWorkspace[],
	c: TapdConfig,
	scope: "current" | "all",
	signal: AbortSignal,
	kind: TapdItemKind = "story",
): Promise<{ items: TapdItem[]; errors: string[] }> {
	const fetcher = kind === "bug" ? fetchBugWorkspace : fetchStoryWorkspace;
	const results = await Promise.all(
		workspaces.map((workspace) => fetcher(workspace, c, scope, signal)),
	);
	const items: TapdItem[] = [];
	const errors: string[] = [];
	for (const result of results) {
		items.push(...result.items);
		errors.push(...result.errors);
	}
	return { items, errors };
}
