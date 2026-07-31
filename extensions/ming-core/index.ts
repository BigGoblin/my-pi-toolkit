/**
 * ming-core — 编排本 toolkit 的通用能力扩展。
 *
 * tapd / context7 仍为独立入口。子 Agent 继续通过瘦路径
 * `extensions/cursor-models/index.ts` 单独加载 provider，勿改指向本入口。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentTodos from "../agent-todos/index.js";
import chatMode from "../chat-mode/index.js";
import cursorModels from "../cursor-models/index.js";
import modelManager from "../model-manager/index.js";
import multiTask from "../multi-task/index.js";
import piLens from "../pi-lens/index.js";
import repoSearchSubagent from "../repo-search-subagent/index.js";
import startupDashboard from "../startup-dashboard/index.js";
import subagentConsole from "../subagent-console/index.js";
import titlebarWorking from "../titlebar-working/index.js";

export default function mingCore(pi: ExtensionAPI): void {
	cursorModels(pi);
	modelManager(pi);
	piLens(pi);
	chatMode(pi);
	agentTodos(pi);
	multiTask(pi);
	repoSearchSubagent(pi);
	subagentConsole(pi);
	titlebarWorking(pi);
	startupDashboard(pi);
}
