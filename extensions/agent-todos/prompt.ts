export const TOOL_NAME = "agent_todo_write";

export const TODO_WRITE_PROMPT_SNIPPET =
	"Maintain a structured task checklist for multi-step work (Cursor TodoWrite-style)";

export const TODO_WRITE_PROMPT_GUIDELINES = [
	`Use ${TOOL_NAME} before the first write/edit or side-effecting command when the task has multiple steps, is easy to lose track of, or spans files.`,
	`Split work into verifiable steps; the first ${TOOL_NAME} usually has at least 2 items.`,
	"Keep at most one todo in_progress; mark a step in_progress when starting it, completed when done, cancelled when abandoned.",
	`Prefer merge=true for incremental updates; use merge=false only to replace the whole list or clear it with an empty array.`,
	`Do not call ${TOOL_NAME} for simple Q&A, pure explanation, or a trivial one-file change.`,
	`Prefer ${TOOL_NAME} over any other todo tool so the local progress panel stays in sync.`,
];

/** 每轮追加到 system prompt，强化「先拆分」行为 */
export function todoSystemPromptAppend(): string {
	return `
## Agent Todos
For non-trivial multi-step work, call ${TOOL_NAME} to split the task before the first file write/edit or side-effecting command.
Keep at most one in_progress item. Update with merge=true as you progress. Skip ${TOOL_NAME} for simple questions or trivial single-step edits.
Do not use Cursor's native todo_write for this checklist; use ${TOOL_NAME} so the panel above the editor updates.
`.trim();
}
