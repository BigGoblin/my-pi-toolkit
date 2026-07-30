import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isProjectPiPath } from "./paths.js";

const PATH_GATED_TOOLS = new Set(["write", "edit"]);
const SAFE_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"search",
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
]);

export function askModeToolNames(activeTools: string[]): string[] {
	return activeTools.filter(
		(name) => SAFE_TOOLS.has(name) || PATH_GATED_TOOLS.has(name),
	);
}

export async function checkAskToolCall(
	event: ToolCallEvent,
	cwd: string,
): Promise<string | undefined> {
	if (SAFE_TOOLS.has(event.toolName)) return undefined;
	if (!PATH_GATED_TOOLS.has(event.toolName)) {
		return `Ask mode blocked "${event.toolName}" because it is not an approved read-only tool. Press Tab to switch to Build mode.`;
	}

	const input = event.input as { path?: unknown };
	if (typeof input.path !== "string") {
		return `Ask mode blocked "${event.toolName}" because no target path was provided.`;
	}
	if (await isProjectPiPath(cwd, input.path)) return undefined;
	return `Ask mode only allows ${event.toolName} inside the project-local .pi directory. Press Tab to switch to Build mode.`;
}
