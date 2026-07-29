import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { TodoWriteDetails } from "./model.js";

export function renderTodoCall(
	args: { merge: boolean; todos: unknown[] },
	theme: Theme,
): Text {
	const count = Array.isArray(args.todos) ? args.todos.length : 0;
	const mode = args.merge ? "merge" : "replace";
	const text =
		theme.fg("toolTitle", theme.bold("agent_todo_write ")) +
		theme.fg("muted", mode) +
		theme.fg("dim", ` ${count} item(s)`);
	return new Text(text, 0, 0);
}

export function renderTodoResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	expanded: boolean,
	theme: Theme,
): Text {
	const details = result.details as TodoWriteDetails | undefined;
	if (!details) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? (text.text ?? "") : "", 0, 0);
	}
	if (details.error) {
		return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
	}

	const changes = details.changes;
	const parts: string[] = [];
	if (changes?.added) parts.push(`+${changes.added}`);
	if (changes?.updated) parts.push(`~${changes.updated}`);
	if (changes?.completed) parts.push(`✓${changes.completed}`);
	if (details.todos.length === 0) parts.push("cleared");
	const summary =
		parts.length > 0
			? parts.join(" · ")
			: `${details.counts.completed}/${details.counts.active || details.counts.total}`;

	if (!expanded) {
		return new Text(
			theme.fg("success", "✓ ") + theme.fg("muted", summary),
			0,
			0,
		);
	}

	let listText =
		theme.fg("success", "✓ ") +
		theme.fg("muted", summary) +
		theme.fg("dim", ` · ${details.counts.total} total`);
	for (const todo of details.todos) {
		const mark =
			todo.status === "completed"
				? "✅"
				: todo.status === "in_progress"
					? "🔄"
					: todo.status === "cancelled"
						? "⛔"
						: "⬜";
		const body =
			todo.status === "completed" || todo.status === "cancelled"
				? theme.fg("dim", theme.strikethrough(todo.content))
				: todo.status === "in_progress"
					? theme.fg("accent", todo.content)
					: theme.fg("muted", todo.content);
		listText += `\n${mark} ${theme.fg("accent", todo.id)} ${body}`;
	}
	return new Text(listText, 0, 0);
}
