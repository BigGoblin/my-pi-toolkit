export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
}

export interface TodoCounts {
	total: number;
	pending: number;
	inProgress: number;
	completed: number;
	cancelled: number;
	/** 非 cancelled 条目数，用作 footer 分母 */
	active: number;
}

export interface TodoChangeSummary {
	added: number;
	updated: number;
	completed: number;
}

export interface TodoWriteDetails {
	action: "write";
	merge: boolean;
	todos: TodoItem[];
	counts: TodoCounts;
	changes?: TodoChangeSummary;
	error?: string;
}

const STATUSES = new Set<TodoStatus>([
	"pending",
	"in_progress",
	"completed",
	"cancelled",
]);

export function isTodoStatus(value: string): value is TodoStatus {
	return STATUSES.has(value as TodoStatus);
}

export function countTodos(todos: TodoItem[]): TodoCounts {
	const counts: TodoCounts = {
		total: todos.length,
		pending: 0,
		inProgress: 0,
		completed: 0,
		cancelled: 0,
		active: 0,
	};
	for (const todo of todos) {
		if (todo.status === "pending") counts.pending++;
		else if (todo.status === "in_progress") counts.inProgress++;
		else if (todo.status === "completed") counts.completed++;
		else if (todo.status === "cancelled") counts.cancelled++;
		if (todo.status !== "cancelled") counts.active++;
	}
	return counts;
}

export function mergeTodos(
	existing: TodoItem[],
	incoming: TodoItem[],
	merge: boolean,
): TodoItem[] {
	if (!merge) return incoming.map(cloneTodo);
	const byId = new Map(existing.map((todo) => [todo.id, cloneTodo(todo)]));
	const order = existing.map((todo) => todo.id);
	for (const item of incoming) {
		if (!byId.has(item.id)) order.push(item.id);
		byId.set(item.id, cloneTodo(item));
	}
	return order.map((id) => byId.get(id)!).filter(Boolean);
}

export function validateTodoWrite(
	existing: TodoItem[],
	incoming: unknown,
	merge: boolean,
): { ok: true; todos: TodoItem[] } | { ok: false; error: string } {
	if (!Array.isArray(incoming)) {
		return { ok: false, error: "todos must be an array" };
	}

	if (!merge && incoming.length === 1) {
		return {
			ok: false,
			error: "merge=false requires 0 todos (clear) or at least 2 todos",
		};
	}

	const parsed: TodoItem[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < incoming.length; i++) {
		const raw = incoming[i];
		if (!raw || typeof raw !== "object") {
			return { ok: false, error: `todos[${i}] must be an object` };
		}
		const item = raw as Record<string, unknown>;
		const id = typeof item.id === "string" ? item.id.trim() : "";
		const content = typeof item.content === "string" ? item.content.trim() : "";
		const status = typeof item.status === "string" ? item.status.trim() : "";
		if (!id) return { ok: false, error: `todos[${i}].id is required` };
		if (!content)
			return { ok: false, error: `todos[${i}].content is required` };
		if (!isTodoStatus(status)) {
			return {
				ok: false,
				error: `todos[${i}].status must be pending|in_progress|completed|cancelled`,
			};
		}
		if (seen.has(id)) {
			return { ok: false, error: `duplicate id in request: ${id}` };
		}
		seen.add(id);
		parsed.push({ id, content, status });
	}

	const next = mergeTodos(existing, parsed, merge);
	const inProgress = next.filter((todo) => todo.status === "in_progress");
	if (inProgress.length > 1) {
		return {
			ok: false,
			error: `at most one in_progress todo allowed (got ${inProgress.length})`,
		};
	}
	return { ok: true, todos: next };
}

export function formatTodosForModel(
	todos: TodoItem[],
	merge: boolean,
	counts: TodoCounts,
): string {
	const header = `Todos updated (merge=${merge}): ${counts.total} total · ${counts.inProgress} in_progress · ${counts.completed} completed · ${counts.pending} pending · ${counts.cancelled} cancelled`;
	if (todos.length === 0) return `${header}\n\n(no todos)`;
	const lines = todos.map(
		(todo) => `[${todo.status}] ${todo.id} — ${todo.content}`,
	);
	const focus = todos.find((todo) => todo.status === "in_progress");
	const executionReminder = focus
		? `Execution focus: only "${focus.content}" is in_progress. Before doing work that belongs to a pending/completed item, update agent_todo_write first. If new evidence invalidates a completed item, reopen it before remediation.`
		: "Execution focus: no todo is in_progress. Mark the next todo in_progress before continuing implementation work.";
	return `${header}\n\n${lines.join("\n")}\n\n${executionReminder}`;
}

export function summarizeChanges(
	before: TodoItem[],
	after: TodoItem[],
): { added: number; updated: number; completed: number } {
	const beforeById = new Map(before.map((todo) => [todo.id, todo]));
	let added = 0;
	let updated = 0;
	let completed = 0;
	for (const todo of after) {
		const prev = beforeById.get(todo.id);
		if (!prev) {
			added++;
			if (todo.status === "completed") completed++;
			continue;
		}
		if (prev.content !== todo.content || prev.status !== todo.status) {
			updated++;
			if (prev.status !== "completed" && todo.status === "completed")
				completed++;
		}
	}
	return { added, updated, completed };
}

function cloneTodo(todo: TodoItem): TodoItem {
	return { id: todo.id, content: todo.content, status: todo.status };
}
