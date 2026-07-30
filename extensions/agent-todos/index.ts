/**
 * Agent Todos — Cursor TodoWrite 风格的任务清单
 *
 * 复杂任务先拆分；完整列表显示在 editor 上方，可用 /todos 手动隐藏或显示。
 */

import { Type, type Static } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
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
	TOOL_NAME,
	todoSystemPromptAppend,
} from "./prompt.js";
import { renderTodoCall, renderTodoResult } from "./render.js";
import { TodoStore } from "./store.js";
import { clearTodoUI, hideTodoPanel, refreshTodoUI } from "./ui.js";

const TODO_STATUSES = [
	"pending",
	"in_progress",
	"completed",
	"cancelled",
] as const;
const TodoStatusSchema = Type.Unsafe<(typeof TODO_STATUSES)[number]>({
	type: "string",
	enum: TODO_STATUSES,
	description: "Todo status",
});

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
	let panelVisible = true;

	const updateUI = (ctx: Parameters<typeof refreshTodoUI>[0]) => {
		if (panelVisible) refreshTodoUI(ctx, store);
		else hideTodoPanel(ctx, store);
	};

	const reconstruct = (ctx: Parameters<typeof refreshTodoUI>[0]) => {
		store.reconstructFromBranch(ctx.sessionManager.getBranch());
		panelVisible = true;
		updateUI(ctx);
	};

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) =>
		reconstruct(ctx),
	);
	pi.on("session_tree", async (_event: unknown, ctx: ExtensionContext) =>
		reconstruct(ctx),
	);
	pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) =>
		clearTodoUI(ctx),
	);

	pi.registerCommand("todos", {
		description: "Show or hide the todo panel above the editor",
		handler: (_args: string, ctx: ExtensionCommandContext) => {
			if (store.getTodos().length === 0) {
				ctx.ui.notify("No todos to show.", "info");
				return;
			}
			panelVisible = !panelVisible;
			updateUI(ctx);
			ctx.ui.notify(`Todo panel ${panelVisible ? "shown" : "hidden"}.`, "info");
		},
	});

	pi.on("before_agent_start", async (event: { systemPrompt: string }) => ({
		systemPrompt: `${event.systemPrompt}\n\n${todoSystemPromptAppend()}`,
	}));

	pi.registerTool({
		name: TOOL_NAME,
		label: "Agent Todo Write",
		description:
			"Create or update the local agent task checklist shown above the editor. Use merge=true for incremental updates by id; merge=false to replace (or clear with []). At most one in_progress item. Prefer this over Cursor native todo_write.",
		promptSnippet: TODO_WRITE_PROMPT_SNIPPET,
		promptGuidelines: TODO_WRITE_PROMPT_GUIDELINES,
		parameters: TodoWriteParams,
		executionMode: "sequential",

		async execute(
			_toolCallId: string,
			params: Static<typeof TodoWriteParams>,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
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

			const hasNewOpenTodo = validated.todos.some(
				(todo) =>
					(todo.status === "pending" || todo.status === "in_progress") &&
					!before.some(
						(previous) =>
							previous.id === todo.id &&
							(previous.status === "pending" ||
								previous.status === "in_progress"),
					),
			);
			if (hasNewOpenTodo) panelVisible = true;

			store.setTodos(validated.todos);
			updateUI(ctx);

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

		renderCall(
			args: Parameters<typeof renderTodoCall>[0],
			theme: Parameters<typeof renderTodoCall>[1],
		) {
			return renderTodoCall(args, theme);
		},

		renderResult(
			result: Parameters<typeof renderTodoResult>[0],
			{ expanded }: { expanded: boolean },
			theme: Parameters<typeof renderTodoResult>[2],
		) {
			return renderTodoResult(result, expanded, theme);
		},
	});
}
