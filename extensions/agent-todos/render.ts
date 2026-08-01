import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { resultText } from "../shared/tui/tool-format.js";
import { toolCall, toolResult } from "../shared/tui/tool-render.js";
import type { TodoWriteDetails } from "./model.js";

export function renderTodoCall(
	args: { merge: boolean; todos: unknown[] },
	theme: Theme,
): Text {
	const count = Array.isArray(args.todos) ? args.todos.length : 0;
	return toolCall(
		theme,
		"agent_todo_write",
		args.merge ? "merge" : "replace",
		`${count} item${count === 1 ? "" : "s"}`,
	);
}

export function renderTodoResult(
	result: {
		content: Array<{ type: string; text?: string }>;
		details?: unknown;
	},
	expanded: boolean,
	theme: Theme,
): Text {
	const details = result.details as TodoWriteDetails | undefined;
	if (!details) {
		return toolResult(theme, {
			status: "error",
			title: "agent_todo_write",
			summary: resultText(result.content, "no details"),
		});
	}
	if (details.error) {
		return toolResult(theme, {
			status: "error",
			title: "agent_todo_write",
			summary: details.error,
		});
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
	const todoLines = expanded
		? details.todos.map(
				(todo) => `${todo.status.padEnd(11)} ${todo.id}  ${todo.content}`,
			)
		: undefined;
	return toolResult(theme, {
		status: "success",
		title: "agent_todo_write",
		summary,
		details: todoLines,
		hint: !expanded && details.todos.length > 0 ? "Ctrl+O details" : undefined,
	});
}
