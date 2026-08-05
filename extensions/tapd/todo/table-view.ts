import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	Input,
	matchesKey,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import { overlayViewportHeight } from "../../shared/tui/overlay-shell.js";
import { collectDesignedStoryKeys } from "./design-status.js";
import { linkKey } from "../sessions/keys.js";
import type { TapdItem, TapdItemKind } from "../types.js";
import { collectTypes, flatFilter, searchFlat, tapdUrl } from "./model.js";
import { navigationTarget } from "./session-picker-input.js";
import {
	decodeTableAction,
	renderTableView,
	typeViewport,
	type TableAction,
} from "./table-view-render.js";
import { TreeList } from "./tree-list.js";

export interface TableSelection {
	action: string;
	url?: string;
	itemKey?: string;
	itemName?: string;
	typeFilter?: string | null;
}

function countAll(nodes: TapdItem[]): number {
	return nodes.reduce((count, node) => count + 1 + countAll(node.children), 0);
}

export interface TableViewOptions {
	forest: TapdItem[];
	viewLabel: string;
	typeFilter: string | null;
	kind: TapdItemKind;
	storyCount: number;
	bugCount: number;
}

export function renderTable(
	ctx: ExtensionContext,
	options: TableViewOptions,
): Promise<TableSelection | null> {
	const config: ViewConfig = {
		...options,
		total: countAll(options.forest),
		typeOptions: ["全部", ...collectTypes(options.forest)],
		designed: collectDesignedStoryKeys(options.forest, ctx.cwd),
	};
	return ctx.ui.custom<TableSelection | null>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: TableSelection | null) => void,
		) => new TableView({ tui, theme, keybindings, done, config }),
	);
}

interface ViewConfig extends TableViewOptions {
	total: number;
	typeOptions: string[];
	designed: Set<string>;
}

interface TableViewConstructorOptions {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	done: (result: TableSelection | null) => void;
	config: ViewConfig;
}

class TableView {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly done: (result: TableSelection | null) => void;
	private readonly config: ViewConfig;
	private readonly tree: TreeList;
	private readonly searchInput = new Input();
	private activeType: string | null;
	private choosingType = false;
	private typeIndex: number;
	private focusSearch = false;
	private searching = false;
	private shownCount: number;

	constructor(options: TableViewConstructorOptions) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.done = options.done;
		this.config = options.config;
		const { config } = options;
		this.activeType = config.typeFilter;
		this.typeIndex = Math.max(
			0,
			config.typeOptions.indexOf(config.typeFilter ?? "全部"),
		);
		this.shownCount = config.total;
		this.tree = new TreeList(config.designed);
		const bodyRows = overlayViewportHeight(this.tui.terminal.rows);
		this.tree.setMaxVisible(Math.max(3, Math.min(26, bodyRows - 5)));
		this.tree.setRoots(this.filteredForest());
		this.tree.onCancel = () => this.done(null);
		this.searchInput.onEscape = () => {
			this.clearSearch();
			this.setSearchFocus(false);
			this.tui.requestRender();
		};
	}

	private filteredForest(): TapdItem[] {
		return this.activeType
			? flatFilter(this.config.forest, this.activeType)
			: this.config.forest;
	}

	private applySearch(): void {
		const query = this.searchInput.getValue().trim();
		this.searching = Boolean(query);
		const source = this.filteredForest();
		const rows = query ? searchFlat(source, query) : source;
		this.tree.setRoots(rows);
		this.shownCount = query ? rows.length : countAll(source);
	}

	private clearSearch(): void {
		this.searchInput.setValue("");
		(this.searchInput as Input & { cursor: number }).cursor = 0;
		this.applySearch();
	}

	private setSearchFocus(focused: boolean): void {
		this.focusSearch = focused;
		this.searchInput.focused = focused;
	}

	private selectCurrent(): void {
		const item = this.tree.getSelectedItem();
		if (item)
			this.done({
				action: "link_view",
				itemKey: linkKey(item.workspaceId, item.id, item.kind),
				itemName: item.name,
			});
	}

	render(width: number): string[] {
		return renderTableView({
			theme: this.theme,
			width,
			rows: this.tui.terminal.rows,
			config: this.config,
			state: {
				activeType: this.activeType,
				choosingType: this.choosingType,
				typeIndex: this.typeIndex,
				focusSearch: this.focusSearch,
				searching: this.searching,
				shownCount: this.shownCount,
			},
			tree: this.tree,
			searchInput: this.searchInput,
		});
	}

	invalidate(): void {}

	/** 底部 Footer 提示：与 TapdOverlayFrame 的 content.footer 约定对应。 */
	footer(width: number): string {
		if (this.choosingType)
			return "↑↓/PgUp/PgDn/Home/End 选择 · Enter 应用 · Esc 返回";
		if (this.focusSearch)
			return "输入过滤 · ↑↓/PgUp/PgDn 导航 · Enter 关联 · Esc 清除 · Ctrl+C 退出";
		// fitLine 从尾部截断：按宽度分档，保证 Esc/Ctrl+C 始终完整可见。
		const typeHint = this.config.kind === "story" ? " · t 类型" : "";
		if (width < 60)
			return "↑↓/PgUp/PgDn 导航 · Enter 关联 · / 搜索 · Esc/Ctrl+C";
		if (width < 68)
			return "↑↓/PgUp/PgDn 导航 · Enter 关联 · / 搜索 · i 迭代 · Esc/Ctrl+C";
		if (width < 86)
			return "↑↓/PgUp/PgDn 导航 · Enter 关联 · / 搜索 · i 迭代 · o 打开 · Esc/Ctrl+C";
		if (width < 100)
			return `↑↓/PgUp/PgDn 导航 · Enter 关联 · / 搜索 · Tab 切换 · i 迭代${typeHint} · o 打开 · Esc/Ctrl+C`;
		return `↑↓/PgUp/PgDn/Home/End 导航 · Enter 关联 · / 搜索 · Tab 切换 · i 迭代${typeHint} · o 打开 · Esc/Ctrl+C 退出`;
	}

	handleInput(data: string): void {
		if (this.choosingType) return this.handleTypeInput(data);
		if (this.focusSearch) return this.handleSearchInput(data);
		const action = decodeTableAction(data, this.config.kind, this.keybindings);
		if (action) return this.applyTableAction(action);
		if (this.tree.handleInput(data)) this.tui.requestRender();
	}

	private applyTableAction(action: TableAction): void {
		switch (action) {
			case "exit":
				return this.done(null);
			case "cancel":
				if (this.searchInput.getValue()) {
					this.clearSearch();
					this.tui.requestRender();
				} else this.done(null);
				return;
			case "kind_toggle":
				return this.done({ action });
			case "search":
				this.setSearchFocus(true);
				this.tui.requestRender();
				return;
			case "type_filter":
				this.choosingType = true;
				this.tui.requestRender();
				return;
			case "confirm":
				return this.selectCurrent();
			case "open": {
				const item = this.tree.getSelectedItem();
				if (item) this.done({ action, url: tapdUrl(item) });
				return;
			}
			default:
				return this.done({ action });
		}
	}

	private handleSearchInput(data: string): void {
		if (matchesKey(data, "ctrl+c")) return this.done(null);
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.clearSearch();
			this.setSearchFocus(false);
			this.tui.requestRender();
			return;
		}
		if (
			navigationTarget(data, {
				current: 0,
				last: 0,
				pageSize: 1,
				allowVim: false,
			}) !== null
		) {
			this.tree.handleInput(data);
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm"))
			return this.selectCurrent();
		this.searchInput.handleInput(data);
		this.applySearch();
		this.tui.requestRender();
	}

	private handleTypeInput(data: string): void {
		const last = this.config.typeOptions.length - 1;
		if (this.keybindings.matches(data, "tui.select.cancel"))
			this.choosingType = false;
		else {
			const next = navigationTarget(data, {
				current: this.typeIndex,
				last,
				pageSize: typeViewport(this.tui.terminal.rows),
			});
			if (next !== null) this.typeIndex = next;
			else if (this.keybindings.matches(data, "tui.select.confirm")) {
				const selected = this.config.typeOptions[this.typeIndex];
				this.done({
					action: "type_filter",
					typeFilter: selected === "全部" ? null : selected,
				});
				return;
			}
		}
		this.tui.requestRender();
	}
}
