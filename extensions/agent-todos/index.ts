/**
 * Agent Todos — Cursor TodoWrite 风格的任务清单
 *
 * 复杂任务先拆分；完整列表常驻 editor 上方 widget，不依赖 /todos。
 * 设计见 docs/agent-todos-design.md。
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	countTodos,
	formatTodosForModel,
	summarizeChanges,
	validateTodoWrite,
	type TodoWriteDetails,
} from "./model.js";
import {
	TODO_WRITE_PROMPT_GUIDELINES,
	TODO_WRITE_PROMPT_SNIPPET,
	todoSystemPromptAppend,
} from "./prompt.js";
import { renderTodoCall, renderTodoResult } from "./render.js";
import { TodoStore } from "./store.js";
import { clearTodoUI, refreshTodoUI } from "./ui.js";

const TodoStatusSchema = StringEnum(
	["pending", "in_progress", "completed", "cancelled"] as const,
	{ description: "Todo status" },
);

const TodoWriteParams = Type.Object({
	merge: Type.Boolean({
		description:
			"true: merge by id into the existing list; false: replace the whole list (empty array clears)",
	}),
	todos: Type.Array(
		Type.Object({
			id: Type.String({
				description: "Stable short id (prefer kebab-case)",
			}),
			content: Type.String({ description: "Task description" }),
			status: TodoStatusSchema,
		}),
		{
			description:
				"Todo items. With merge=false use 0 (clear) or ≥2 items; with merge=true pass only changes.",
		},
	),
});

export default function agentTodosExtension(pi: ExtensionAPI) {
	const store = new TodoStore();

	const reconstruct = (ctx: Parameters<typeof refreshTodoUI>[0]) => {
		store.reconstructFromBranch(ctx.sessionManager.getBranch());
		refreshTodoUI(ctx, store);
	};

	pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
	pi.on("session_shutdown", async (_event, ctx) => clearTodoUI(ctx));

	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${todoSystemPromptAppend()}`,
	}));

	pi.registerTool({
		name: "todo_write",
		label: "Todo Write",
		description:
			"Create or update the agent task checklist. Use merge=true for incremental updates by id; merge=false to replace (or clear with []). At most one in_progress item.",
		promptSnippet: TODO_WRITE_PROMPT_SNIPPET,
		promptGuidelines: TODO_WRITE_PROMPT_GUIDELINES,
		parameters: TodoWriteParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const before = store.getTodos();
			const validated = validateTodoWrite(before, params.todos, params.merge);
			if (!validated.ok) {
				const details: TodoWriteDetails = {
					action: "write",
					merge: params.merge,
					todos: before,
					counts: countTodos(before),
					error: validated.error,
				};
				return {
					content: [{ type: "text", text: `Error: ${validated.error}` }],
					details,
					isError: true,
				};
			}

			store.setTodos(validated.todos);
			refreshTodoUI(ctx, store);

			const counts = countTodos(validated.todos);
			const changes = summarizeChanges(before, validated.todos);
			const details: TodoWriteDetails = {
				action: "write",
				merge: params.merge,
				todos: validated.todos,
				counts,
				changes,
			};
			return {
				content: [
					{
						type: "text",
						text: formatTodosForModel(validated.todos, params.merge, counts),
					},
				],
				details,
			};
		},

		renderCall(args, theme) {
			return renderTodoCall(args, theme);
		},

		renderResult(result, { expanded }, theme) {
			return renderTodoResult(result, expanded, theme);
		},
	});
}
