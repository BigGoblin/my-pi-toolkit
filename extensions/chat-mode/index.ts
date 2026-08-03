import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerAskUserChoiceTool } from "../shared/ask-user-choice-tool.js";
import { createModeController } from "./mode-controller.js";
import { getPlanLifecycleSnapshot } from "./plan-lifecycle.js";
import { registerPlanCommand } from "./plan-command.js";
import {
	CHAT_MODE_STATE_ENTRY,
	registerChatModeLifecycle,
} from "./lifecycle.js";
import { seedPlanFile, type SessionPlanFile } from "./plan-file.js";
import { registerPlanTools } from "./plan-tools.js";
import { getChatMode } from "./state.js";

export default function chatModeExtension(pi: ExtensionAPI): void {
	registerAskUserChoiceTool(pi);
	let planFile: SessionPlanFile | undefined;
	let pendingImplementationKickoff = false;

	function persistMode(): void {
		if (!planFile) return;
		pi.appendEntry(CHAT_MODE_STATE_ENTRY, {
			version: 3,
			mode: getChatMode(),
			toolsBeforeRestricted: modeController.getToolsBeforeRestricted(),
			planLifecycle: getPlanLifecycleSnapshot(),
		});
	}

	const modeController = createModeController(
		pi,
		() => planFile?.absolutePath,
		persistMode,
	);

	async function enterPlan(ctx: ExtensionContext, source: "tool" | "user") {
		if (!planFile) throw new Error("Session Plan path is not initialized");
		const seed = await seedPlanFile(planFile);
		modeController.switchMode("plan", ctx, { entrySource: source });
		persistMode();
		return { plan: planFile, seed };
	}

	registerPlanTools(pi, {
		getMode: getChatMode,
		getPlan: () => planFile,
		enterPlan,
		switchMode: modeController.switchMode,
		markImplementationKickoff: () => {
			pendingImplementationKickoff = true;
		},
	});

	registerPlanCommand(pi, {
		getMode: getChatMode,
		getPlan: () => planFile,
		enterPlan: (ctx) => enterPlan(ctx, "user"),
	});

	registerChatModeLifecycle(pi, {
		modeController,
		getActiveTools: () => pi.getActiveTools(),
		getPlan: () => planFile,
		setPlan: (plan) => {
			planFile = plan;
		},
		enterPlan,
		persistMode,
		clearImplementationKickoff: () => {
			pendingImplementationKickoff = false;
		},
		hasImplementationKickoff: () => pendingImplementationKickoff,
		consumeImplementationKickoff: () => {
			pendingImplementationKickoff = false;
		},
	});
}
