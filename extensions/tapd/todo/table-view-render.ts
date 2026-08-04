import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	truncateToWidth,
	type Input,
	type KeybindingsManager,
} from "@earendil-works/pi-tui";
import { overlayViewportHeight } from "../../shared/tui/overlay-shell.js";
import { statusGlyph, UI_GLYPHS } from "../../shared/tui/visual-language.js";
import type { TapdItemKind } from "../types.js";
import { oneLine, padR } from "./model.js";
import {
	TABLE_TITLE_PREFIX_WIDTH,
	tableColumns,
	type TreeList,
} from "./tree-list.js";

export interface TableRenderConfig {
	viewLabel: string;
	kind: TapdItemKind;
	storyCount: number;
	bugCount: number;
	total: number;
	typeOptions: string[];
}

export interface TableRenderState {
	activeType: string | null;
	choosingType: boolean;
	typeIndex: number;
	focusSearch: boolean;
	searching: boolean;
	shownCount: number;
}

export interface TableRendererOptions {
	theme: Theme;
	width: number;
	rows: number;
	config: TableRenderConfig;
	state: TableRenderState;
	tree: TreeList;
	searchInput: Input;
}

export type TableAction =
	| "exit"
	| "cancel"
	| "kind_toggle"
	| "search"
	| "scope_toggle"
	| "type_filter"
	| "confirm"
	| "open";

export function decodeTableAction(
	data: string,
	kind: TapdItemKind,
	keybindings: KeybindingsManager,
): TableAction | null {
	if (matchesKey(data, "ctrl+c")) return "exit";
	if (keybindings.matches(data, "tui.select.cancel")) return "cancel";
	if (matchesKey(data, "tab") || matchesKey(data, "shift+tab"))
		return "kind_toggle";
	if (data === "/") return "search";
	if (data === "i") return "scope_toggle";
	if (data === "t" && kind === "story") return "type_filter";
	if (keybindings.matches(data, "tui.select.confirm")) return "confirm";
	if (data === "o") return "open";
	return null;
}

export function typeViewport(rows: number): number {
	return Math.max(3, Math.min(14, overlayViewportHeight(rows) - 4));
}

export function renderTableView(options: TableRendererOptions): string[] {
	return options.state.choosingType
		? renderTypes(options)
		: renderTable(options);
}

function renderTypes(options: TableRendererOptions): string[] {
	const { theme, width, config, state } = options;
	const lines = [theme.bold(theme.fg("text", "按类型筛选")), ""];
	const viewport = typeViewport(options.rows);
	let start = Math.max(0, state.typeIndex - Math.floor(viewport / 2));
	const end = Math.min(config.typeOptions.length, start + viewport);
	start = Math.max(0, end - viewport);
	for (let index = start; index < end; index++) {
		const active = index === state.typeIndex;
		const marker = statusGlyph(theme, active ? "active" : "pending");
		const row = `${marker} ${config.typeOptions[index]}`;
		lines.push(active ? theme.fg("accent", row) : theme.fg("muted", row));
	}
	if (config.typeOptions.length > viewport)
		lines.push(
			theme.fg("dim", `${start + 1}-${end}/${config.typeOptions.length}`),
		);
	lines.push(
		theme.fg("dim", "↑↓/PgUp/PgDn/Home/End 选择 · Enter 应用 · Esc 返回"),
	);
	return lines.map((line) => truncateToWidth(line, Math.max(1, width), ""));
}

function renderTable(options: TableRendererOptions): string[] {
	const { theme, width, config, state, tree, searchInput } = options;
	const lines: string[] = [];
	const story = `${statusGlyph(theme, config.kind === "story" ? "active" : "pending")} [REQ] ${config.storyCount}`;
	const bug = `${statusGlyph(theme, config.kind === "bug" ? "active" : "pending")} [BUG] ${config.bugCount}`;
	let header = `${story}  ${bug}  ${config.viewLabel} ${state.shownCount}${state.searching ? `/${config.total}` : ""}`;
	if (state.activeType) header += ` [${state.activeType}]`;
	if (state.searching) header += " [搜索]";
	lines.push(
		theme.bold(
			theme.fg("text", truncateToWidth(header, width, UI_GLYPHS.more)),
		),
	);
	if (state.focusSearch) lines.push(...searchInput.render(width));
	else
		lines.push(
			theme.fg(
				"dim",
				truncateToWidth(
					`搜索: ${searchInput.getValue() || "(按 / 输入)"}`,
					width,
					"",
				),
			),
		);
	lines.push(columnHeader(theme, width, config.kind));
	lines.push(...tree.render(width, theme));
	if (config.kind === "bug" && width >= 80) {
		const selected = tree.getSelectedItem();
		if (selected)
			lines.push(
				theme.fg(
					"muted",
					truncateToWidth(
						`当前 Bug: ${oneLine(selected.name)}`,
						width,
						UI_GLYPHS.more,
					),
				),
			);
	}
	const hint = state.focusSearch
		? "输入过滤 · ↑↓/PgUp/PgDn 导航 · Enter 关联 · Esc 清除 · Ctrl+C 退出"
		: "↑↓/PgUp/PgDn/Home/End 导航 · Enter 关联 · Esc/Ctrl+C 退出 · / 搜索 · Tab 切换";
	lines.push(theme.fg("dim", truncateToWidth(hint, width, UI_GLYPHS.more)));
	return lines;
}

function columnHeader(theme: Theme, width: number, kind: TapdItemKind): string {
	const columns = tableColumns(width, kind);
	const fixed = Object.values(columns).reduce(
		(sum, size) => sum + (size ? size + 1 : 0),
		0,
	);
	const titleWidth = Math.max(1, width - TABLE_TITLE_PREFIX_WIDTH - fixed);
	let line = `${" ".repeat(TABLE_TITLE_PREFIX_WIDTH)}${padR("标题", titleWidth)}`;
	const add = (label: string, size: number) => {
		if (size) line += ` ${padR(label, size)}`;
	};
	add("状态", columns.status);
	add("优先", columns.priority);
	add("严重度", columns.severity);
	add("开始", columns.begin);
	add("结束", columns.due);
	return theme.fg("dim", truncateToWidth(line, width, ""));
}
