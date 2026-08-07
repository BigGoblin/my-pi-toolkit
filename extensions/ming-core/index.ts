/**
 * ming-core — 编排本 toolkit 的通用能力扩展。
 *
 * tapd / context7 仍为独立入口。子 Agent 使用瘦加载路径：
 * Multi Task 只显式加载 cursor-models、pi-lens 和 path-guard，勿改为指向本入口。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentTodos from "../agent-todos/index.js";
import builtInToolStyle from "../built-in-tool-style/index.js";
import chatMode from "../chat-mode/index.js";
import cursorModels from "../cursor-models/index.js";
import helps from "../helps/index.js";
import modelManager from "../model-manager/index.js";
import multiTask from "../multi-task/index.js";
import openaiCompatModels from "../openai-compat-models/index.js";
import piLens from "../pi-lens/index.js";
import repoSearchSubagent from "../repo-search-subagent/index.js";
import { sessionBranchGuard } from "../session-branch-guard/index.js";
import startupDashboard from "../startup-dashboard/index.js";
import subagentConsole from "../subagent-console/index.js";
import taskDuration from "../task-duration/index.js";

export default async function mingCore(pi: ExtensionAPI): Promise<void> {
	openaiCompatModels(pi);
	cursorModels(pi);
	modelManager(pi);
	await piLens(pi);
	chatMode(pi);
	builtInToolStyle(pi);
	agentTodos(pi);
	multiTask(pi);
	repoSearchSubagent(pi);
	subagentConsole(pi);
	sessionBranchGuard(pi);
	taskDuration(pi);
	startupDashboard(pi);
	helps(pi);
}
