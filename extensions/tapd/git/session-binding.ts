import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	appendBindingCurrent,
	createBinding,
	readBinding,
} from "../../session-branch-guard/binding.js";
import { compareBinding } from "../../session-branch-guard/guard.js";

/** 绑定同步所需的当前分支上下文。 */
export interface SessionBindingTarget {
	repoRoot: string;
	branch: string;
	head?: string;
}

/**
 * 分支创建/切换成功后，把当前会话的绑定自动切换到目标分支。
 * 无绑定、跨仓库或已一致时不写；只更新会话 custom entry（source=rebound），
 * 不执行任何 Git 变更。返回是否发生了 rebind。
 */
export async function syncSessionBinding(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	target: SessionBindingTarget,
): Promise<boolean> {
	const binding = readBinding(ctx.sessionManager.getEntries());
	if (!binding) return false;
	const gitContext = { isRepo: true, ...target };
	if (compareBinding(binding, gitContext) !== "branch-differs") return false;
	appendBindingCurrent(pi, createBinding(gitContext, "rebound"));
	return true;
}
