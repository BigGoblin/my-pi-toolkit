import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	type Component,
	type TUI,
} from "@earendil-works/pi-tui";
import { statusGlyph, UI_GLYPHS } from "../shared/tui/visual-language.js";
import { countTodos, type TodoItem } from "./model.js";
import { statusText, type TodoStore } from "./store.js";

const WIDGET_KEY = "agent-todos";
const STATUS_KEY = "agent-todos";
const MAX_ITEM_LINES = 16;

function mountTodoWidget(ctx: ExtensionContext, todos: TodoItem[]): void {
	ctx.ui.setWidget(
		WIDGET_KEY,
		(_tui: TUI, theme: Theme) => new TodoPanel(todos, theme),
		{ placement: "aboveEditor" },
	);
}

export function refreshTodoUI(ctx: ExtensionContext, store: TodoStore): void {
	if (!ctx.hasUI) return;
	const todos = store.getTodos();
	if (todos.length === 0) {
		clearTodoUI(ctx);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, statusText(todos));
	mountTodoWidget(ctx, todos);
}

/** 先卸再挂，把 TASKS 移到 aboveEditor 栈底（排在 Working 等优先条下方）。 */
export function restackTodoUI(ctx: ExtensionContext, store: TodoStore): void {
	if (!ctx.hasUI) return;
	const todos = store.getTodos();
	if (todos.length === 0) return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.setStatus(STATUS_KEY, statusText(todos));
	mountTodoWidget(ctx, todos);
}

export function hideTodoPanel(ctx: ExtensionContext, store: TodoStore): void {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.setStatus(STATUS_KEY, statusText(store.getTodos()));
}

export function clearTodoUI(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

class TodoPanel implements Component {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly todos: TodoItem[],
		private readonly theme: Theme,
	) {}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const counts = countTodos(this.todos);
		const lines = [
			truncateToWidth(renderHeader(counts, this.theme), width),
			truncateToWidth(renderProgressBar(counts, width, this.theme), width),
		];
		const visible = this.todos.slice(0, MAX_ITEM_LINES);
		for (const todo of visible) {
			lines.push(truncateToWidth(formatTodoLine(todo, this.theme), width));
		}
		const hidden = this.todos.length - visible.length;
		if (hidden > 0) {
			lines.push(
				truncateToWidth(
					this.theme.fg("dim", `${UI_GLYPHS.more} ${hidden} more`),
					width,
				),
			);
		}
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

function renderHeader(
	counts: ReturnType<typeof countTodos>,
	theme: Theme,
): string {
	const total = counts.active || counts.completed;
	const parts = [
		theme.bold(theme.fg("accent", "TASKS")),
		theme.fg("muted", `${counts.completed}/${total}`),
	];
	if (counts.inProgress > 0)
		parts.push(theme.fg("accent", `active ${counts.inProgress}`));
	if (counts.pending > 0)
		parts.push(theme.fg("dim", `pending ${counts.pending}`));
	if (counts.cancelled > 0)
		parts.push(theme.fg("dim", `cancelled ${counts.cancelled}`));
	return parts.join(theme.fg("dim", "  ·  "));
}

function renderProgressBar(
	counts: ReturnType<typeof countTodos>,
	width: number,
	theme: Theme,
): string {
	const total = Math.max(counts.active, 1);
	const barWidth = Math.max(8, Math.min(24, width - 8));
	const filled = Math.round((counts.completed / total) * barWidth);
	const bar =
		theme.fg("success", "━".repeat(filled)) +
		theme.fg("dim", "─".repeat(Math.max(0, barWidth - filled)));
	return `${bar} ${theme.fg("muted", `${Math.round((counts.completed / total) * 100)}%`)}`;
}

function todoVisualStatus(
	todo: TodoItem,
): "active" | "success" | "error" | "pending" {
	switch (todo.status) {
		case "in_progress":
			return "active";
		case "completed":
			return "success";
		case "cancelled":
			return "error";
		default:
			return "pending";
	}
}

function todoContent(todo: TodoItem, theme: Theme): string {
	if (todo.status === "in_progress") {
		return theme.bold(theme.fg("accent", todo.content));
	}
	if (todo.status === "pending") return theme.fg("text", todo.content);
	return theme.fg("dim", todo.content);
}

function formatTodoLine(todo: TodoItem, theme: Theme): string {
	return `${statusGlyph(theme, todoVisualStatus(todo))} ${todoContent(todo, theme)}`;
}
