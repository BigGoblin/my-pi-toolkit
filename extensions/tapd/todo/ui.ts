import { execFile } from "node:child_process";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fetchAll } from "../core/workspace-api.js";
import { buildTapdCatalog, listTapdSessions } from "../sessions/catalog.js";
import type {
	TableOutcome,
	TapdConfig,
	TapdItem,
	TapdItemKind,
} from "../types.js";
import type { WorkingCancel } from "../working.js";
import { abortError } from "../working.js";
import { buildTree, sortTree } from "./model.js";
import { showSessionPicker } from "./session-picker.js";
import { renderTable, type TableSelection } from "./table-view.js";

interface TreeState {
	current: TapdItem[];
	all: TapdItem[];
	allLoaded: boolean;
}

interface LoadTreeOptions {
	ctx: ExtensionCommandContext;
	config: TapdConfig;
	workspaces: { id: string; name: string }[];
	cancel?: WorkingCancel;
	trees: Record<TapdItemKind, TreeState>;
	kind: TapdItemKind;
	scope: "current" | "all";
}

async function loadTree(options: LoadTreeOptions): Promise<void> {
	const { ctx, config, workspaces, cancel, trees, kind, scope } = options;
	const state = trees[kind];
	if (
		(scope === "all" && state.allLoaded) ||
		(scope === "current" && state.current.length > 0)
	)
		return;
	const label = `正在获取${kind === "bug" ? "Bug" : "需求"}${scope === "current" ? "当前迭代" : "所有迭代"}待办...`;
	cancel?.setMessage(`Working... ${label}`);
	cancel?.throwIfAborted();
	const result = await fetchAll(
		workspaces,
		config,
		scope,
		cancel?.signal ?? new AbortController().signal,
		kind,
	);
	cancel?.throwIfAborted();
	const data = kind === "story" ? buildTree(result.items) : result.items;
	sortTree(data);
	if (scope === "current") state.current = data;
	else {
		state.all = data;
		state.allLoaded = true;
	}
	if (result.errors.length > 0)
		ctx.ui.notify(
			`部分工作空间获取失败: ${result.errors.join(", ")}`,
			"warning",
		);
}

interface TableLoopState {
	kind: TapdItemKind;
	viewCurrent: boolean;
	typeFilter: string | null;
}

type LoadTableScope = (
	kind: TapdItemKind,
	scope: "current" | "all",
) => Promise<void>;

export async function showTable(
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	workspaces: { id: string; name: string }[],
	initialCurrent: boolean,
	cancel?: WorkingCancel,
): Promise<TableOutcome> {
	const trees: Record<TapdItemKind, TreeState> = {
		story: { current: [], all: [], allLoaded: false },
		bug: { current: [], all: [], allLoaded: false },
	};
	const state: TableLoopState = {
		kind: "story",
		viewCurrent: initialCurrent,
		typeFilter: null,
	};
	const load: LoadTableScope = async (kind, scope) => {
		cancel?.resume(
			`Working... 正在获取${kind === "bug" ? "Bug" : "需求"}待办...`,
		);
		try {
			await loadTree({
				ctx,
				config,
				workspaces,
				cancel,
				trees,
				kind,
				scope,
			});
		} finally {
			if (cancel?.signal.aborted) throw abortError();
		}
	};

	await load("story", "current");
	cancel?.setMessage("Working... 正在扫描历史会话...");
	cancel?.throwIfAborted();
	await buildTapdCatalog((loaded, total) => {
		if (total > 50)
			cancel?.setMessage(`Working... 正在扫描历史会话 ${loaded}/${total}`);
	});
	cancel?.throwIfAborted();
	while (true) {
		if (cancel?.signal.aborted) throw abortError();
		const tree = trees[state.kind];
		cancel?.suspend();
		let selection: TableSelection | null;
		try {
			selection = await renderTable(ctx, {
				forest: state.viewCurrent ? tree.current : tree.all,
				viewLabel: state.viewCurrent ? "当前迭代" : "所有迭代",
				typeFilter: state.typeFilter,
				kind: state.kind,
				storyCount: trees.story.current.length,
				bugCount: trees.bug.current.length,
			});
		} finally {
			cancel?.resume("Working...");
		}
		if (!selection) break;
		const result = await handleSelection(ctx, selection, state, load, cancel);
		if (result === "continue") continue;
		if (result) return result;
		break;
	}
	return { kind: "done", saveState: true };
}

async function handleSelection(
	ctx: ExtensionCommandContext,
	selection: TableSelection,
	state: TableLoopState,
	load: LoadTableScope,
	cancel?: WorkingCancel,
): Promise<TableOutcome | "continue" | undefined> {
	switch (selection.action) {
		case "kind_toggle":
			state.kind = state.kind === "story" ? "bug" : "story";
			state.typeFilter = null;
			await load(state.kind, state.viewCurrent ? "current" : "all");
			return "continue";
		case "scope_toggle":
			state.viewCurrent = !state.viewCurrent;
			await load(state.kind, state.viewCurrent ? "current" : "all");
			return "continue";
		case "type_filter":
			if (state.kind === "story")
				state.typeFilter = selection.typeFilter ?? null;
			return "continue";
		case "open":
			if (selection.url) await openSelection(ctx, selection.url);
			return "continue";
		case "link_view":
			return (
				(await linkedSessionOutcome(ctx, selection, cancel)) ?? "continue"
			);
		default:
			return undefined;
	}
}

async function openSelection(
	ctx: ExtensionCommandContext,
	url: string,
): Promise<void> {
	const error = await openUrl(url);
	if (error)
		ctx.ui.notify(
			`无法自动打开浏览器，请手动访问：${url}\n${error}`,
			"warning",
		);
	else ctx.ui.notify("已在浏览器中打开", "info");
}

async function linkedSessionOutcome(
	ctx: ExtensionCommandContext,
	selection: TableSelection,
	cancel?: WorkingCancel,
): Promise<TableOutcome | undefined> {
	if (!selection.itemKey || !selection.itemName) return undefined;
	const { itemKey, itemName } = selection;
	cancel?.setMessage("Working... 正在扫描关联会话...");
	cancel?.throwIfAborted();
	const sessions = await listTapdSessions(itemKey, (loaded, total) => {
		if (total > 50)
			cancel?.setMessage(
				`Working... 正在扫描关联会话 ${loaded}/${total}`,
			);
	});
	cancel?.throwIfAborted();
	cancel?.suspend();
	let action: Awaited<ReturnType<typeof showSessionPicker>>;
	try {
		action = await showSessionPicker(ctx, sessions, itemName);
	} finally {
		cancel?.resume("Working...");
	}
	return action
		? { kind: "session_action", action, itemKey, itemName }
		: undefined;
}

function browserCandidates(url: string): Array<[string, string[]]> {
	if (process.platform === "win32")
		return [["cmd.exe", ["/d", "/s", "/c", "start", "", url]]];
	if (process.platform === "darwin") return [["open", [url]]];
	return [
		["xdg-open", [url]],
		["gio", ["open", url]],
		["sensible-browser", [url]],
		["wslview", [url]],
		["cmd.exe", ["/d", "/s", "/c", "start", "", url]],
	];
}

async function openUrl(url: string): Promise<string | null> {
	const candidates = browserCandidates(url);
	const errors: string[] = [];
	for (const [command, args] of candidates) {
		const error = await new Promise<Error | null>((resolve) =>
			execFile(command, args, (value) => resolve(value)),
		);
		if (!error) return null;
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			errors.push(`${command}: ${error.message}`);
	}
	return errors.pop() ?? "系统中未找到可用的浏览器打开命令";
}
