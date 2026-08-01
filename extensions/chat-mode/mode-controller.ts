import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	enterPlanFromTool,
	enterPlanFromUser,
	leavePlan,
} from "./plan-lifecycle.js";
import { restrictedModeToolNames } from "./policy.js";
import {
	getChatMode,
	nextChatMode,
	setChatMode,
	type ChatMode,
} from "./state.js";

const BUILD_COLOR = "\x1b[38;2;49;109;221m";
const RESET_FOREGROUND = "\x1b[39m";

export interface ModeSwitchOptions {
	viaToolApproval?: boolean;
	entrySource?: "tool" | "user";
}

export interface ModeController {
	getToolsBeforeRestricted(): string[] | undefined;
	reset(): void;
	restoreRestricted(mode: ChatMode, savedTools: string[]): void;
	switchMode(
		mode: ChatMode,
		ctx: ExtensionContext,
		options?: ModeSwitchOptions,
	): void;
	updateStatus(ctx: ExtensionContext): void;
}

export function createModeController(
	pi: ExtensionAPI,
	activePlanPath: () => string | undefined,
	persist: () => void,
): ModeController {
	let toolsBeforeRestricted: string[] | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		const mode = getChatMode();
		let label = `${BUILD_COLOR}● BUILD${RESET_FOREGROUND}`;
		if (mode === "ask") label = ctx.ui.theme.fg("success", "◆ ASK");
		if (mode === "plan") label = ctx.ui.theme.fg("warning", "◇ PLAN");
		ctx.ui.setStatus("chat-mode", label);
	}

	function restoreBuildTools(): void {
		if (!toolsBeforeRestricted) return;
		const available = new Set(
			pi.getAllTools().map((tool: { name: string }) => tool.name),
		);
		pi.setActiveTools(
			toolsBeforeRestricted.filter((name) => available.has(name)),
		);
	}

	function applyModeTools(mode: ChatMode): void {
		if (mode === "build") {
			restoreBuildTools();
			toolsBeforeRestricted = undefined;
			return;
		}
		const baseTools = toolsBeforeRestricted ?? pi.getActiveTools();
		toolsBeforeRestricted = baseTools;
		pi.setActiveTools(restrictedModeToolNames(baseTools));
	}

	function notifyMode(mode: ChatMode, ctx: ExtensionContext): void {
		let message = "已启用 Build：已恢复完整工具权限。";
		if (mode === "ask") message = "已启用 Ask：项目写入仅限 .pi/。";
		if (mode === "plan") {
			message = `已启用 Plan：仅可写入 ${activePlanPath() ?? "活动 Plan"}。`;
		}
		ctx.ui.notify(message, "info");
	}

	return {
		getToolsBeforeRestricted: () => toolsBeforeRestricted,
		reset() {
			restoreBuildTools();
			toolsBeforeRestricted = undefined;
			setChatMode("build");
		},
		restoreRestricted(mode, savedTools) {
			toolsBeforeRestricted = savedTools;
			setChatMode(mode);
			pi.setActiveTools(restrictedModeToolNames(pi.getActiveTools()));
		},
		switchMode(mode, ctx, options) {
			const previous = getChatMode();
			if (mode === previous) return;
			if (mode === "plan") {
				if (options?.entrySource === "tool") enterPlanFromTool();
				else enterPlanFromUser();
			} else if (previous === "plan") {
				leavePlan(options?.viaToolApproval === true);
			}
			applyModeTools(mode);
			setChatMode(mode);
			updateStatus(ctx);
			persist();
			notifyMode(mode, ctx);
		},
		updateStatus,
	};
}

export function toggleMode(
	controller: ModeController,
	ctx: ExtensionContext,
	enterPlan: () => Promise<unknown>,
): void {
	if (!ctx.isIdle()) {
		ctx.ui.notify("请等待当前 Agent 运行结束后再切换模式。", "warning");
		return;
	}
	const next = nextChatMode();
	if (next === "plan") {
		void enterPlan();
		return;
	}
	controller.switchMode(next, ctx);
}
