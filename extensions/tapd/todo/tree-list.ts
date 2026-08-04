import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { statusGlyph, UI_GLYPHS } from "../../shared/tui/visual-language.js";
import { linkKey } from "../sessions/keys.js";
import type { TapdItem } from "../types.js";
import { navigationTarget } from "./session-picker-input.js";
import {
	fmtDate,
	getTypeLabel,
	oneLine,
	padR,
	prioritySymbol,
} from "./model.js";

interface FlatItem {
	item: TapdItem;
	indent: number;
	expandable: boolean;
	expanded: boolean;
}

interface Columns {
	status: number;
	priority: number;
	severity: number;
	begin: number;
	due: number;
}

export const TABLE_TITLE_PREFIX_WIDTH = 11;
const TYPE_COLUMN_WIDTH = 6;

export function tableColumns(width: number, kind: TapdItem["kind"]): Columns {
	if (width < 80)
		return { status: 8, priority: 0, severity: 0, begin: 0, due: 0 };
	if (width < 120)
		return { status: 10, priority: 6, severity: 0, begin: 0, due: 10 };
	return {
		status: kind === "bug" ? 8 : 10,
		priority: kind === "bug" ? 6 : 8,
		severity: kind === "bug" ? 6 : 0,
		begin: 10,
		due: 10,
	};
}

export class TreeList {
	private roots: TapdItem[] = [];
	private visible: FlatItem[] = [];
	private maxVisible = 20;
	readonly expandedIds = new Set<string>();
	selectedIdx = 0;
	onSelect?: (item: FlatItem) => void;
	onCancel?: () => void;

	constructor(private readonly designedStoryKeys = new Set<string>()) {}

	getSelectedItem(): TapdItem | null {
		return this.visible[this.selectedIdx]?.item ?? null;
	}

	setMaxVisible(value: number): void {
		this.maxVisible = Math.max(3, value);
	}

	setRoots(roots: TapdItem[]): void {
		this.roots = roots;
		this.selectedIdx = 0;
		this.rebuild();
	}

	private rebuild(): void {
		this.visible = [];
		const walk = (nodes: TapdItem[]) => {
			for (const item of nodes) {
				this.visible.push({
					item,
					indent: item.depth,
					expandable: item.hasChildren,
					expanded: this.expandedIds.has(item.id),
				});
				if (item.hasChildren && this.expandedIds.has(item.id))
					walk(item.children);
			}
		};
		walk(this.roots);
		this.selectedIdx = Math.max(
			0,
			Math.min(this.selectedIdx, this.visible.length - 1),
		);
	}

	private toggle(idx: number, expanded?: boolean): void {
		const row = this.visible[idx];
		if (!row?.expandable) return;
		const next = expanded ?? !this.expandedIds.has(row.item.id);
		if (next) this.expandedIds.add(row.item.id);
		else this.expandedIds.delete(row.item.id);
		this.rebuild();
		const current = this.visible.findIndex(
			(value) => value.item.id === row.item.id,
		);
		if (current >= 0) this.selectedIdx = current;
	}

	handleInput(data: string): boolean {
		const last = Math.max(0, this.visible.length - 1);
		const next = navigationTarget(data, {
			current: this.selectedIdx,
			last,
			pageSize: this.maxVisible,
		});
		if (next !== null) {
			this.selectedIdx = next;
			return true;
		}
		if (data === " ") this.toggle(this.selectedIdx);
		else if (matchesKey(data, "right")) this.toggle(this.selectedIdx, true);
		else if (matchesKey(data, "left")) this.toggle(this.selectedIdx, false);
		else if (matchesKey(data, "enter"))
			this.onSelect?.(this.visible[this.selectedIdx]);
		else if (matchesKey(data, "escape")) this.onCancel?.();
		else return false;
		return true;
	}

	render(width: number, theme: Theme): string[] {
		const maxWidth = Math.max(1, width);
		if (!this.visible.length) return [theme.fg("dim", "  (无)")];
		let start = Math.max(0, this.selectedIdx - Math.floor(this.maxVisible / 2));
		const end = Math.min(this.visible.length, start + this.maxVisible);
		start = Math.max(0, end - this.maxVisible);
		const lines: string[] = [];
		for (let index = start; index < end; index++)
			lines.push(this.renderRow(this.visible[index], index, maxWidth, theme));
		if (this.visible.length > this.maxVisible)
			lines.push(
				theme.fg("dim", `  ${start + 1}-${end}/${this.visible.length}`),
			);
		return lines;
	}

	private renderRow(
		row: FlatItem,
		index: number,
		width: number,
		theme: Theme,
	): string {
		const item = row.item;
		const columns = tableColumns(width, item.kind);
		const indent = "  ".repeat(Math.max(0, row.indent));
		let branch = "  ";
		if (row.expandable) branch = row.expanded ? "- " : "+ ";
		const type = padR(`[${getTypeLabel(item)}]`, TYPE_COLUMN_WIDTH);
		const designed =
			item.kind === "story" &&
			this.designedStoryKeys.has(linkKey(item.workspaceId, item.id, item.kind));
		const design = designed ? ` ${statusGlyph(theme, "success")}DES` : "";
		const fixed = Object.values(columns).reduce(
			(sum, value) => sum + (value ? value + 1 : 0),
			0,
		);
		const selection = statusGlyph(
			theme,
			index === this.selectedIdx ? "active" : "pending",
		);
		const prefix = `${selection} ${indent}${branch}${type} `;
		const titleWidth = Math.max(1, width - visibleWidth(prefix) - fixed);
		const title = `${oneLine(item.name)}${design}`;
		let line =
			prefix +
			padR(truncateToWidth(title, titleWidth, UI_GLYPHS.more), titleWidth);
		const add = (value: string, size: number) => {
			if (size) line += ` ${padR(truncateToWidth(value, size, ""), size)}`;
		};
		add(oneLine(item.status), columns.status);
		add(prioritySymbol(item.priority), columns.priority);
		add(oneLine(item.severity ?? "-"), columns.severity);
		add(fmtDate(item.begin), columns.begin);
		add(fmtDate(item.due), columns.due);
		const clipped = truncateToWidth(line, width, "");
		return index === this.selectedIdx ? theme.fg("accent", clipped) : clipped;
	}
}
