import type { TodoItem } from "./model.js";

export const TOOL_NAME = "agent_todo_write";

export const TODO_WRITE_PROMPT_SNIPPET =
	"Maintain a structured task checklist for multi-step work (Cursor TodoWrite-style)";

export const TODO_WRITE_PROMPT_GUIDELINES = [
	`Use ${TOOL_NAME} before the first write/edit or side-effecting command when the task has multiple steps, is easy to lose track of, or spans files.`,
	`Split work into verifiable steps; the first ${TOOL_NAME} usually has at least 2 items.`,
	"Keep at most one todo in_progress; its description must match the work being performed now.",
	"Mark a todo completed only after its intended outcome is achieved and verified, not merely after an attempted command succeeds.",
	"Before doing more work for a pending or completed todo, update the checklist first. If new evidence shows a completed todo is unfinished, reopen it as in_progress and move the current todo back to pending before continuing.",
	`Prefer merge=true for incremental updates; use merge=false only to replace the whole list or clear it with an empty array.`,
	`Do not call ${TOOL_NAME} for simple Q&A, pure explanation, or a trivial one-file change.`,
	`Prefer ${TOOL_NAME} over any other todo tool so the local progress panel stays in sync.`,
];

/** 在用户请求开始时追加基础规则；执行中的具体焦点由 context reminder 每轮注入。 */
export function todoSystemPromptAppend(): string {
	return `
## Agent Todos
For non-trivial multi-step work, call ${TOOL_NAME} to split the task before the first file write/edit or side-effecting command.
Keep at most one in_progress item, and make sure it describes the work actually being performed now.
Mark an item completed only when its intended outcome has been achieved and verified, not merely because a command finished successfully.
Before continuing work that belongs to a pending or completed item, update the checklist first. If later evidence invalidates a completion, reopen that item as in_progress and move the current item back to pending before doing remediation work.
Update with merge=true as you progress. Skip ${TOOL_NAME} for simple questions or trivial single-step edits.
Do not use Cursor's native todo_write for this checklist; use ${TOOL_NAME} so the panel above the editor updates.
`.trim();
}

/** 仿 Grok Build：每次 LLM 调用前重申当前项和下一项，不依赖时间或工具次数阈值。 */
export function todoFocusReminder(todos: TodoItem[]): string | undefined {
	const current = todos.find((todo) => todo.status === "in_progress");
	const next = todos.find((todo) => todo.status === "pending");
	if (!current && !next) return undefined;

	const focus = current
		? `Current in_progress: ${current.id} — ${current.content}`
		: "Current in_progress: none";
	const nextStep = next
		? `Next pending: ${next.id} — ${next.content}`
		: undefined;
	return [
		"<system-reminder>",
		"Agent Todo focus (a planning aid, not proof of execution):",
		focus,
		nextStep,
		current
			? `Continue working on this item. If the work you are about to do belongs to another item, call ${TOOL_NAME} first so the checklist reflects the new focus.`
			: `Before continuing implementation work, call ${TOOL_NAME} to mark the appropriate pending item in_progress.`,
		"Do not perform retrospective bookkeeping solely to manufacture status transitions.",
		"</system-reminder>",
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}
