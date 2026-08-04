import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { UI_GLYPHS } from "../shared/tui/visual-language.js";
import type { DirtySummary, SessionBranchBinding } from "./types.js";

/** 顶层三选一：切回绑定分支 / 留在当前分支并重新绑定 / 取消。 */
export type TopLevelIntent = "switch" | "rebind" | "cancel";

/** dirty 时第二层三选一：stash 后切换 / 直接尝试切换 / 取消。 */
export type DirtySwitchIntent = "stash" | "direct" | "cancel";

function dirtyNote(dirty: DirtySummary): string {
	if (dirty.total <= 0) return "";
	const parts: string[] = [];
	if (dirty.staged > 0) parts.push(`${dirty.staged} 暂存`);
	if (dirty.unstaged > 0) parts.push(`${dirty.unstaged} 未暂存`);
	if (dirty.untracked > 0) parts.push(`${dirty.untracked} 未跟踪`);
	return `（工作区有 ${dirty.total} 处改动：${parts.join("、")}）`;
}

/** 第一层选择：会话绑定分支与当前分支不一致时。 */
export async function promptTopLevel(
	ctx: ExtensionContext,
	binding: SessionBranchBinding,
	currentBranch: string,
	dirty: DirtySummary,
): Promise<TopLevelIntent> {
	const choice = await ctx.ui.select(
		`会话绑定分支 ${binding.gitBranch}，当前在 ${currentBranch}${dirtyNote(dirty)}`,
		[
			`${UI_GLYPHS.action} 切回会话分支 ${binding.gitBranch}`,
			`${UI_GLYPHS.action} 留在 ${currentBranch} 继续，并重新绑定到 ${currentBranch}`,
			"取消",
		],
	);
	if (!choice) return "cancel";
	if (choice.startsWith(`${UI_GLYPHS.action} 切回`)) return "switch";
	if (choice.startsWith(`${UI_GLYPHS.action} 留在`)) return "rebind";
	return "cancel";
}

/** 第二层选择：选择切回绑定分支但工作区 dirty 时。 */
export async function promptDirtySwitch(
	ctx: ExtensionContext,
	targetBranch: string,
	currentBranch: string,
	dirty: DirtySummary,
): Promise<DirtySwitchIntent> {
	const choice = await ctx.ui.select(
		`当前在 ${currentBranch}，工作区有改动，如何切回 ${targetBranch}？${dirtyNote(dirty)}`,
		[
			`${UI_GLYPHS.action} stash 全部改动后切换（含未跟踪文件）`,
			"直接尝试切换（保留改动，可能携带到目标分支）",
			"取消",
		],
	);
	if (!choice) return "cancel";
	if (choice.startsWith(`${UI_GLYPHS.action} stash`)) return "stash";
	if (choice.startsWith("直接尝试切换")) return "direct";
	return "cancel";
}

/** 二次确认重新绑定。 */
export async function confirmRebind(
	ctx: ExtensionContext,
	binding: SessionBranchBinding,
	currentBranch: string,
): Promise<boolean> {
	return ctx.ui.confirm(
		"重新绑定会话分支",
		`把该会话从 ${binding.gitBranch} 重新绑定到当前分支 ${currentBranch}？\n\n不执行任何 Git 变更；即使本次恢复随后失败，绑定更新仍有效。`,
	);
}
