import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	truncateToWidth,
	type Component,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";

export interface SubagentPickerItem {
	id: string;
	label: string;
	parentSessionId?: string;
	actions: string[];
}

export interface SubagentPickerResult {
	id: string;
	action: string;
}

type PickerScope = "current" | "all";
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
	const current =
		scope === "current"
			? theme.fg("accent", theme.bold("[当前会话]"))
			: theme.fg("dim", " 当前会话 ");
	const all =
		scope === "all"
			? theme.fg("accent", theme.bold("[所有]"))
			: theme.fg("dim", " 所有 ");
	return `${current}  ${all}`;
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
	const pageSize = Math.max(3, Math.floor(options.tui.terminal.rows * 0.6) - 4);
	const maximumStart = Math.max(0, options.items.length - pageSize);
	const start = Math.min(
		maximumStart,
		Math.max(0, options.selectedIndex - pageSize + 1),
	);
	const rows = options.items
		.slice(start, start + pageSize)
		.map((item, offset) => {
			const selected = start + offset === options.selectedIndex;
			const marker = selected ? options.theme.fg("accent", "❯ ") : "  ";
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
	const header = truncateToWidth(options.header, innerWidth, "…", true);
	const help = truncateToWidth(
		options.theme.fg("dim", options.help),
		innerWidth,
		"…",
		true,
	);
	return [
		`${border("╭")}${header}${border("╮")}`,
		...rows.map((row) => `${border("│")}${row}${border("│")}`),
		`${border("│")}${help}${border("│")}`,
		border(`╰${"─".repeat(innerWidth)}╯`),
	];
}

class SubagentPicker implements Component {
	private scope: PickerScope = "current";
	private selectedIndex = 0;
	private actionItem?: SubagentPickerItem;

	constructor(
		private readonly config: {
			items: SubagentPickerItem[];
			currentSessionId: string;
			tui: TUI;
			theme: Theme;
			done: (result: SubagentPickerResult | undefined) => void;
		},
	) {}

	private visibleItems(): SubagentPickerItem[] {
		return scopedItems(
			this.config.items,
			this.scope,
			this.config.currentSessionId,
		);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) return this.handleEscape();
		if (!this.actionItem && this.isTab(data)) return this.switchScope();
		const itemCount = this.actionItem
			? this.actionItem.actions.length
			: this.visibleItems().length;
		const nextIndex = movedIndex(data, this.selectedIndex, itemCount);
		if (nextIndex !== undefined) return this.selectIndex(nextIndex);
		if (matchesKey(data, "return")) this.confirmSelection();
	}

	private handleEscape(): void {
		if (!this.actionItem) return this.config.done(undefined);
		this.actionItem = undefined;
		this.selectedIndex = 0;
		this.config.tui.requestRender();
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

	private confirmSelection(): void {
		if (this.actionItem) {
			const action = this.actionItem.actions[this.selectedIndex];
			if (action) this.config.done({ id: this.actionItem.id, action });
			return;
		}
		const item = this.visibleItems()[this.selectedIndex];
		if (!item) return;
		this.actionItem = item;
		this.selectIndex(0);
	}

	render(width: number): string[] {
		const items = this.actionItem
			? this.actionItem.actions.map((label) => ({ label }))
			: this.visibleItems();
		return renderPicker({
			items,
			selectedIndex: this.selectedIndex,
			header: this.actionItem
				? this.config.theme.fg(
						"accent",
						this.config.theme.bold(`${this.actionItem.label} · 操作`),
					)
				: tabHeader(this.scope, this.config.theme),
			emptyText: "当前会话暂无子 Agent；按 Tab 查看所有记录",
			help: this.actionItem
				? "↑↓ 选择 · Enter 执行 · Esc 返回列表"
				: "Tab 切换 · ↑↓ 选择 · Enter 查看操作 · Esc 返回",
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
