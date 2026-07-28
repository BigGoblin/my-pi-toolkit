import type {
	TapdConfig,
	TapdItem,
	TapdItemKind,
	TapdResponse,
	TapdWorkspace,
} from "../types.js";
import { apiUrl, tapdGet } from "./http.js";

const STORY_FIELDS =
	"id,name,status,v_status,priority,priority_label,owner,developer,workspace_id,parent_id,ancestor_id,iteration_id,workitem_type_id,begin,due,effort,effort_completed,remain,modified";
const BUG_FIELDS =
	"id,title,description,status,v_status,priority,priority_label,severity,current_owner,iteration_id,begin,due,modified,workspace_id";

async function fetchTodoIds(
	wsId: string,
	config: TapdConfig,
	kind: TapdItemKind,
	signal?: AbortSignal,
) {
	const ids: string[] = [];
	const endpoint =
		kind === "bug"
			? "/user_oauth/get_user_todo_bug"
			: "/user_oauth/get_user_todo_story";
	const key = kind === "bug" ? "Bug" : "Story";
	for (let page = 1; page <= 50; page++) {
		const response = await tapdGet<
			TapdResponse<Record<string, { id: string }>>
		>(
			apiUrl(config, endpoint, {
				workspace_id: wsId,
				limit: "200",
				page: String(page),
			}),
			config,
			signal,
		);
		if (!response?.data?.length) break;
		for (const row of response.data) if (row[key]?.id) ids.push(row[key].id);
		if (response.data.length < 200) break;
	}
	return ids;
}

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size)
		result.push(items.slice(index, index + size));
	return result;
}

async function fetchRawItems(
	wsId: string,
	ids: string[],
	kind: TapdItemKind,
	config: TapdConfig,
	signal?: AbortSignal,
) {
	const items: Record<string, unknown>[] = [];
	const field = kind === "bug" ? "Bug" : "Story";
	for (const idChunk of chunks(ids, 50)) {
		const response = await tapdGet<
			TapdResponse<Record<string, Record<string, unknown>>>
		>(
			apiUrl(config, kind === "bug" ? "/bugs" : "/stories", {
				workspace_id: wsId,
				id: idChunk.join(","),
				fields: kind === "bug" ? BUG_FIELDS : STORY_FIELDS,
				with_v_status: "1",
				limit: "200",
			}),
			config,
			signal,
		);
		if (response?.data)
			for (const row of response.data) if (row[field]) items.push(row[field]);
	}
	return items;
}

async function fetchIterations(
	wsId: string,
	config: TapdConfig,
	signal?: AbortSignal,
) {
	const items: {
		id: string;
		name: string;
		startdate?: string;
		enddate?: string;
	}[] = [];
	for (let page = 1; page <= 50; page++) {
		const response = await tapdGet<
			TapdResponse<{ Iteration: Record<string, string> }>
		>(
			apiUrl(config, "/iterations", {
				workspace_id: wsId,
				status: "open",
				limit: "200",
				page: String(page),
			}),
			config,
			signal,
		);
		if (!response?.data?.length) break;
		for (const row of response.data) {
			const item = row.Iteration;
			if (item?.id)
				items.push({
					id: item.id,
					name: item.name,
					startdate: item.startdate,
					enddate: item.enddate,
				});
		}
		if (response.data.length < 200) break;
	}
	return items;
}

async function fetchTypeNames(
	wsId: string,
	config: TapdConfig,
	signal?: AbortSignal,
) {
	const names = new Map<string, string>();
	for (let page = 1; page <= 20; page++) {
		const response = await tapdGet<
			TapdResponse<{ WorkitemType: { id: string; name: string } }>
		>(
			apiUrl(config, "/workitem_types", {
				workspace_id: wsId,
				limit: "200",
				page: String(page),
			}),
			config,
			signal,
		);
		if (!response?.data?.length) break;
		for (const row of response.data)
			if (row.WorkitemType?.id)
				names.set(row.WorkitemType.id, row.WorkitemType.name);
		if (response.data.length < 200) break;
	}
	return names;
}

function currentIterationIds(
	iterations: { id: string; startdate?: string; enddate?: string }[],
) {
	const today = new Date().toISOString().slice(0, 10);
	return new Set(
		iterations
			.filter(
				(item) =>
					item.startdate &&
					item.enddate &&
					item.startdate <= today &&
					item.enddate >= today,
			)
			.map((item) => item.id),
	);
}

function mapItem(
	raw: Record<string, any>,
	workspace: TapdWorkspace,
	kind: TapdItemKind,
	iterationNames: Map<string, string>,
	typeNames: Map<string, string>,
): TapdItem {
	const iterationId = raw.iteration_id || undefined;
	return {
		id: raw.id,
		kind,
		name: kind === "bug" ? (raw.title ?? raw.name ?? "(无标题)") : raw.name,
		status: raw.v_status ?? raw.status ?? "-",
		priority: raw.priority_label ?? raw.priority ?? "-",
		owner: kind === "bug" ? (raw.current_owner ?? raw.owner ?? "") : raw.owner,
		severity: kind === "bug" ? (raw.severity ?? "") : undefined,
		workspaceId: raw.workspace_id ?? workspace.id,
		workspaceName: workspace.name,
		begin: raw.begin?.slice(0, 10),
		due: raw.due?.slice(0, 10),
		iterationId,
		iterationName: iterationId ? iterationNames.get(iterationId) : undefined,
		parentId: kind === "story" ? raw.parent_id || undefined : undefined,
		workitemTypeName: raw.workitem_type_id
			? typeNames.get(raw.workitem_type_id)
			: undefined,
		children: [],
		depth: 0,
		hasChildren: false,
	};
}

async function fetchWorkspace(
	workspace: TapdWorkspace,
	config: TapdConfig,
	scope: "current" | "all",
	kind: TapdItemKind,
	signal?: AbortSignal,
) {
	const ids = await fetchTodoIds(workspace.id, config, kind, signal);
	if (!ids.length) return { items: [] as TapdItem[], errors: [] as string[] };
	const [rawItems, iterations, typeNames] = await Promise.all([
		fetchRawItems(workspace.id, ids, kind, config, signal),
		fetchIterations(workspace.id, config, signal),
		kind === "story"
			? fetchTypeNames(workspace.id, config, signal)
			: Promise.resolve(new Map<string, string>()),
	]);
	const iterationNames = new Map(
		iterations.map((item) => [item.id, item.name]),
	);
	const currentIds = currentIterationIds(iterations);
	const items = rawItems
		.map((raw) => mapItem(raw, workspace, kind, iterationNames, typeNames))
		.filter(
			(item) =>
				scope === "all" ||
				Boolean(item.iterationId && currentIds.has(item.iterationId)),
		);
	if (kind === "story") {
		const present = new Set(items.map((item) => item.id));
		const missing = Array.from(
			new Set(
				items
					.map((item) => item.parentId)
					.filter((id): id is string => Boolean(id && !present.has(id))),
			),
		);
		for (const raw of await fetchRawItems(
			workspace.id,
			missing,
			kind,
			config,
			signal,
		))
			items.push(mapItem(raw, workspace, kind, iterationNames, typeNames));
	}
	return { items, errors: [] as string[] };
}

export async function fetchAll(
	workspaces: TapdWorkspace[],
	config: TapdConfig,
	scope: "current" | "all",
	signal: AbortSignal,
	kind: TapdItemKind = "story",
) {
	const results = await Promise.all(
		workspaces.map((workspace) =>
			fetchWorkspace(workspace, config, scope, kind, signal),
		),
	);
	return {
		items: results.flatMap((result) => result.items),
		errors: results.flatMap((result) => result.errors),
	};
}
