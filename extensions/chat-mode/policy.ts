import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isPlanFilePath, isProjectPiPath, PLAN_FILE_RELATIVE } from "./paths.js";
import { ENTER_PLAN_TOOL, EXIT_PLAN_TOOL } from "./plan-file.js";

const PATH_GATED_TOOLS = new Set(["write", "edit"]);
const SAFE_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"repo_search",
	"tapd_review",
	"resolve-library-id",
	"query-docs",
	"agent_todo_write",
	"lens_diagnostics",
	"lsp_diagnostics",
	"symbol_search",
	"project_report",
	"module_report",
	"read_symbol",
	"read_enclosing",
	"pi_lens_activate_tools",
	ENTER_PLAN_TOOL,
	EXIT_PLAN_TOOL,
]);

export function restrictedModeToolNames(activeTools: string[]): string[] {
	const names = activeTools.filter(
		(name) => SAFE_TOOLS.has(name) || PATH_GATED_TOOLS.has(name),
	);
	for (const name of [ENTER_PLAN_TOOL, EXIT_PLAN_TOOL]) {
		if (!names.includes(name)) names.push(name);
	}
	return names;
}

export async function checkAskToolCall(
	event: ToolCallEvent,
	cwd: string,
): Promise<string | undefined> {
	if (SAFE_TOOLS.has(event.toolName)) return undefined;
	if (!PATH_GATED_TOOLS.has(event.toolName)) {
		return `Ask mode blocked "${event.toolName}" because it is not an approved read-only tool. Press Shift+Tab to switch mode.`;
	}

	const input = event.input as { path?: unknown };
	if (typeof input.path !== "string") {
		return `Ask mode blocked "${event.toolName}" because no target path was provided.`;
	}
	if (await isProjectPiPath(cwd, input.path)) return undefined;
	return `Ask mode only allows ${event.toolName} inside the project-local .pi directory. Press Shift+Tab to switch mode.`;
}

export async function checkPlanToolCall(
	event: ToolCallEvent,
	cwd: string,
): Promise<string | undefined> {
	if (SAFE_TOOLS.has(event.toolName)) return undefined;
	if (!PATH_GATED_TOOLS.has(event.toolName)) {
		return `Rejected: "${event.toolName}" is not allowed in plan mode.`;
	}

	const input = event.input as { path?: unknown };
	if (typeof input.path !== "string") {
		return `Rejected: "${event.toolName}" requires a target path.`;
	}
	if (await isPlanFilePath(cwd, input.path)) return undefined;
	return `Rejected: file edits are not allowed in plan mode - the only editable file is the plan file (${PLAN_FILE_RELATIVE}).`;
}
