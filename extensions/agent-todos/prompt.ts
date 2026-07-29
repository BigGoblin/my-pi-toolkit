export const TODO_WRITE_PROMPT_SNIPPET =
	"Maintain a structured task checklist for multi-step work (Cursor TodoWrite-style)";

export const TODO_WRITE_PROMPT_GUIDELINES = [
	"Use todo_write before the first write/edit or side-effecting command when the task has multiple steps, is easy to lose track of, or spans files.",
	"Split work into verifiable steps; the first todo_write usually has at least 2 items.",
	"Keep at most one todo in_progress; mark a step in_progress when starting it, completed when done, cancelled when abandoned.",
	"Prefer merge=true for incremental updates; use merge=false only to replace the whole list or clear it with an empty array.",
	"Do not call todo_write for simple Q&A, pure explanation, or a trivial one-file change.",
];

/** 每轮追加到 system prompt，强化「先拆分」行为 */
export function todoSystemPromptAppend(): string {
	return `
## Agent Todos
For non-trivial multi-step work, call todo_write to split the task before the first file write/edit or side-effecting command.
Keep at most one in_progress item. Update with merge=true as you progress. Skip todo_write for simple questions or trivial single-step edits.
`.trim();
}
