import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	truncateToWidth,
	type Component,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import { fitLine } from "../shared/tui/visual-language.js";

export interface SubagentPickerItem {
	id: string;
	label: string;
	parentSessionId?: string;
	actions: string[];
}

export interface SubagentPickerResult {
	id: string;
	action: string;
	scope: "current" | "all";
}

type PickerScope = SubagentPickerResult["scope"];
type DisplayItem = { label: string };

function scopedItems(
	items: SubagentPickerItem[],
	scope: PickerScope,
	currentSessionId: string,
): SubagentPickerItem[] {
	return scope === "all"
		? items
		: items.filter((item) => item.parentSessionId === currentSessionId);
}

function movedIndex(
	data: string,
	current: number,
	itemCount: number,
): number | undefined {
	if (itemCount === 0) return undefined;
	if (matchesKey(data, "up")) return Math.max(0, current - 1);
	if (matchesKey(data, "down")) return Math.min(itemCount - 1, current + 1);
	if (matchesKey(data, "pageUp")) return Math.max(0, current - 10);
	if (matchesKey(data, "pageDown"))
		return Math.min(itemCount - 1, current + 10);
	return undefined;
}

function tabHeader(scope: PickerScope, theme: Theme): string {
	const current = scope === "current"
		? theme.fg("accent", theme.bold("CURRENT"))
		: theme.fg("dim", "CURRENT");
	const all = scope === "all"
		? theme.fg("accent", theme.bold("ALL"))
		: theme.fg("dim", "ALL");
	return `${theme.bold(theme.fg("text", "SUBAGENTS"))}  ${current}  ${all}`;
}

function renderPicker(options: {
	items: DisplayItem[];
	selectedIndex: number;
	header: string;
	emptyText: string;
	help: string;
	tui: TUI;
	theme: Theme;
	width: number;
}): string[] {
	const innerWidth = Math.max(28, options.width - 2);
	const pageSize = Math.max(3, Math.floor(options.tui.terminal.rows * 0.6) - 7);
	const maximumStart = Math.max(0, options.items.length - pageSize);
	const start = Math.min(
		maximumStart,
		Math.max(0, options.selectedIndex - pageSize + 1),
	);
	const rows = options.items
		.slice(start, start + pageSize)
		.map((item, offset) => {
			const selected = start + offset === options.selectedIndex;
			const marker = selected ? options.theme.fg("accent", "› ") : "  ";
			const label = options.theme.fg(selected ? "text" : "muted", item.label);
			return truncateToWidth(`${marker}${label}`, innerWidth, "…", true);
		});
	if (rows.length === 0)
		rows.push(
			truncateToWidth(
				options.theme.fg("dim", options.emptyText),
				innerWidth,
				"…",
				true,
			),
		);
	while (rows.length < pageSize) rows.push(" ".repeat(innerWidth));
	const border = (value: string) => options.theme.fg("border", value);
	const header = fitLine(options.header, innerWidth);
	const help = fitLine(options.theme.fg("dim", options.help), innerWidth);
	return [
		border(`╭${"─".repeat(innerWidth)}╮`),
		`${border("│")}${header}${border("│")}`,
		border(`├${"─".repeat(innerWidth)}┤`),
		...rows.map((row) => `${border("│")}${fitLine(row, innerWidth)}${border("│")}`),
		border(`├${"─".repeat(innerWidth)}┤`),
		`${border("│")}${help}${border("│")}`,
		border(`╰${"─".repeat(innerWidth)}╯`),
	];
}

class SubagentPicker implements Component {
	private scope: PickerScope;
	private selectedIndex: number;

	constructor(
		private readonly config: {
			items: SubagentPickerItem[];
			currentSessionId: string;
			initialScope: PickerScope;
			initialId?: string;
			tui: TUI;
			theme: Theme;
			done: (result: SubagentPickerResult | undefined) => void;
		},
	) {
		this.scope = config.initialScope;
		const initialIndex = this.visibleItems().findIndex(
			(item) => item.id === config.initialId,
		);
		this.selectedIndex = Math.max(0, initialIndex);
	}

	private visibleItems(): SubagentPickerItem[] {
		return scopedItems(
			this.config.items,
			this.scope,
			this.config.currentSessionId,
		);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) return this.config.done(undefined);
		if (this.isTab(data)) return this.switchScope();
		const nextIndex = movedIndex(
			data,
			this.selectedIndex,
			this.visibleItems().length,
		);
		if (nextIndex !== undefined) return this.selectIndex(nextIndex);
		if (matchesKey(data, "return")) return this.runDefaultAction();
		if (matchesKey(data, "c")) return this.runNamedAction("请求取消");
		if (matchesKey(data, "x")) return this.runNamedAction("终止子 Agent");
		if (matchesKey(data, "d")) return this.runNamedAction("清理任务记录");
	}

	private isTab(data: string): boolean {
		return matchesKey(data, "tab") || matchesKey(data, "shift+tab");
	}

	private switchScope(): void {
		this.scope = this.scope === "current" ? "all" : "current";
		this.selectIndex(0);
	}

	private selectIndex(index: number): void {
		this.selectedIndex = index;
		this.config.tui.requestRender();
	}

	private selectedItem(): SubagentPickerItem | undefined {
		return this.visibleItems()[this.selectedIndex];
	}

	private runDefaultAction(): void {
		const item = this.selectedItem();
		const action = item?.actions[0];
		if (item && action)
			this.config.done({ id: item.id, action, scope: this.scope });
	}

	private runNamedAction(action: string): void {
		const item = this.selectedItem();
		if (item?.actions.includes(action))
			this.config.done({ id: item.id, action, scope: this.scope });
	}

	private helpText(): string {
		const item = this.selectedItem();
		if (!item) return "Tab 切换 · ↑↓ 选择 · Esc 返回";
		const hints = ["Tab 切换", "↑↓ 选择", `Enter ${item.actions[0] ?? "详情"}`];
		if (item.actions.includes("请求取消")) hints.push("C 取消");
		if (item.actions.includes("终止子 Agent")) hints.push("X 终止");
		if (item.actions.includes("清理任务记录")) hints.push("D 清理");
		hints.push("Esc 返回");
		return hints.join(" · ");
	}

	render(width: number): string[] {
		return renderPicker({
			items: this.visibleItems(),
			selectedIndex: this.selectedIndex,
			header: tabHeader(this.scope, this.config.theme),
			emptyText: "当前会话暂无子 Agent；按 Tab 查看所有记录",
			help: this.helpText(),
			tui: this.config.tui,
			theme: this.config.theme,
			width,
		});
	}

	invalidate(): void {}
}

export async function selectSubagentAction(
	ctx: ExtensionContext,
	items: SubagentPickerItem[],
	initial?: Pick<SubagentPickerResult, "id" | "scope">,
): Promise<SubagentPickerResult | undefined> {
	return ctx.ui.custom<SubagentPickerResult | undefined>(
		(
			tui: TUI,
			theme: Theme,
			_kb: KeybindingsManager,
			done: (result: SubagentPickerResult | undefined) => void,
		) =>
			new SubagentPicker({
				items,
				currentSessionId: ctx.sessionManager.getSessionId(),
				initialScope: initial?.scope ?? "current",
				initialId: initial?.id,
				tui,
				theme,
				done,
			}),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "72%",
				maxHeight: "68%",
				margin: 1,
			},
		},
	);
}
