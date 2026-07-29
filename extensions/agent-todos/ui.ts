import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { countTodos, type TodoItem, type TodoStatus } from "./model.js";
import { statusText, type TodoStore } from "./store.js";

const WIDGET_KEY = "agent-todos";
const STATUS_KEY = "agent-todos";
/** widget 区域避免占满整屏；超出时底部提示剩余条数 */
const MAX_ITEM_LINES = 16;

export function refreshTodoUI(ctx: ExtensionContext, store: TodoStore): void {
	if (!ctx.hasUI) return;
	const todos = store.getTodos();
	if (todos.length === 0) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	ctx.ui.setWidget(
		WIDGET_KEY,
		(_tui: TUI, theme: Theme) => new TodoPanel(todos, theme),
		{ placement: "aboveEditor" },
	);
	ctx.ui.setStatus(STATUS_KEY, statusText(todos));
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
		const th = this.theme;
		const counts = countTodos(this.todos);
		const lines: string[] = [];
		const progress =
			counts.active > 0
				? `${counts.completed}/${counts.active}`
				: `${counts.completed}/${counts.completed}`;
		const inProg =
			counts.inProgress > 0 ? ` · ${counts.inProgress} in progress` : "";
		lines.push(
			truncateToWidth(
				th.fg("accent", "Todos") + th.fg("muted", `  ${progress}${inProg}`),
				width,
			),
		);

		const visible = this.todos.slice(0, MAX_ITEM_LINES);
		for (const todo of visible) {
			lines.push(truncateToWidth(formatTodoLine(todo, th), width));
		}
		const hidden = this.todos.length - visible.length;
		if (hidden > 0) {
			lines.push(truncateToWidth(th.fg("dim", `… ${hidden} more`), width));
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

function formatTodoLine(todo: TodoItem, th: Theme): string {
	const glyph = statusGlyph(todo.status, th);
	const content =
		todo.status === "completed" || todo.status === "cancelled"
			? th.fg("dim", todo.content)
			: todo.status === "in_progress"
				? th.bold(th.fg("text", todo.content))
				: th.fg("text", todo.content);
	return `${glyph} ${content}`;
}

function statusGlyph(status: TodoStatus, th: Theme): string {
	switch (status) {
		case "pending":
			return th.fg("dim", "○");
		case "in_progress":
			return th.fg("accent", "▸");
		case "completed":
			return th.fg("success", "✓");
		case "cancelled":
			return th.fg("dim", "×");
	}
}
