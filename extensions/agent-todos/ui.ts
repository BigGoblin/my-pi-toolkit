import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	type Component,
	type TUI,
} from "@earendil-works/pi-tui";
import { countTodos, type TodoItem, type TodoStatus } from "./model.js";
import { statusText, type TodoStore } from "./store.js";

const WIDGET_KEY = "agent-todos";
const STATUS_KEY = "agent-todos";
/** widget 区域避免占满整屏；超出时底部提示剩余条数 */
const MAX_ITEM_LINES = 16;

const STATUS_EMOJI: Record<TodoStatus, string> = {
	pending: "⬜",
	in_progress: "🔄",
	completed: "✅",
	cancelled: "⛔",
};

export function refreshTodoUI(ctx: ExtensionContext, store: TodoStore): void {
	if (!ctx.hasUI) return;
	const todos = store.getTodos();
	if (todos.length === 0) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, statusText(todos));
	ctx.ui.setWidget(
		WIDGET_KEY,
		(_tui: TUI, theme: Theme) => new TodoPanel(todos, theme),
		{ placement: "aboveEditor" },
	);
}

export function hideTodoPanel(ctx: ExtensionContext, store: TodoStore): void {
	if (!ctx.hasUI) return;
	const todos = store.getTodos();
	ctx.ui.setWidget(WIDGET_KEY, undefined);
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

		lines.push(truncateToWidth(renderHeader(counts, th), width));
		lines.push(truncateToWidth(renderProgressBar(counts, width, th), width));

		const visible = this.todos.slice(0, MAX_ITEM_LINES);
		for (let i = 0; i < visible.length; i++) {
			lines.push(truncateToWidth(formatTodoLine(visible[i], i + 1, th), width));
		}
		const hidden = this.todos.length - visible.length;
		if (hidden > 0) {
			lines.push(
				truncateToWidth(th.fg("dim", `… 还有 ${hidden} 项未显示`), width),
			);
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

function renderHeader(
	counts: ReturnType<typeof countTodos>,
	th: Theme,
): string {
	const progress =
		counts.active > 0
			? `${counts.completed}/${counts.active}`
			: `${counts.completed}/${counts.completed}`;
	const parts = [
		th.bold(th.fg("accent", "📋 Todos")),
		th.fg("muted", progress),
	];
	if (counts.inProgress > 0) {
		parts.push(th.fg("accent", `🔄 ${counts.inProgress}`));
	}
	if (counts.pending > 0) {
		parts.push(th.fg("dim", `⬜ ${counts.pending}`));
	}
	if (counts.cancelled > 0) {
		parts.push(th.fg("dim", `⛔ ${counts.cancelled}`));
	}
	return parts.join(th.fg("dim", "  ·  "));
}

function renderProgressBar(
	counts: ReturnType<typeof countTodos>,
	width: number,
	th: Theme,
): string {
	const total = Math.max(counts.active, 1);
	const barWidth = Math.max(8, Math.min(24, width - 8));
	const filled = Math.round((counts.completed / total) * barWidth);
	const empty = Math.max(0, barWidth - filled);
	const bar =
		th.fg("success", "█".repeat(filled)) + th.fg("dim", "░".repeat(empty));
	const pct = Math.round((counts.completed / total) * 100);
	return `${bar} ${th.fg("muted", `${pct}%`)}`;
}

function formatTodoLine(todo: TodoItem, index: number, th: Theme): string {
	const emoji = STATUS_EMOJI[todo.status];
	const indexLabel = th.fg("dim", `${String(index).padStart(2, " ")}.`);
	let content: string;
	switch (todo.status) {
		case "completed":
			content = th.fg("dim", th.strikethrough(todo.content));
			break;
		case "cancelled":
			content = th.fg("dim", th.strikethrough(todo.content));
			break;
		case "in_progress":
			content = th.bold(th.fg("accent", todo.content));
			break;
		default:
			content = th.fg("text", todo.content);
	}
	return `${indexLabel} ${emoji}  ${content}`;
}
