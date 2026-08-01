import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionCompactEvent,
	SessionStartEvent,
	Theme,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { ChatModeEditor } from "./editor.js";
import { createModeController, toggleMode } from "./mode-controller.js";
import { registerPlanCommand } from "./plan-command.js";
import {
	enterPlanFromTool,
	getPlanLifecycleSnapshot,
	resetPlanLifecycle,
	resetPlanRemindersAfterCompaction,
	restorePlanLifecycle,
	takePlanReminder,
	type PlanLifecycleSnapshot,
} from "./plan-lifecycle.js";
import {
	readPlanFile,
	seedPlanFile,
	sessionPlanFile,
	type SessionPlanFile,
} from "./plan-file.js";
import { registerPlanTools } from "./plan-tools.js";
import { checkAskToolCall, checkPlanToolCall } from "./policy.js";
import { ASK_MODE_PROMPT, planReminderText } from "./prompt.js";
import { getChatMode, isRestrictedMode, type ChatMode } from "./state.js";

const STATE_ENTRY = "chat-mode-state";
const EPHEMERAL_PLAN_ROOT = resolve(tmpdir(), "pi-plan-sessions");

interface PersistedModeState {
	version?: 3;
	mode: ChatMode;
	toolsBeforeRestricted?: string[];
	toolsBeforeAsk?: string[];
	planLifecycle?: PlanLifecycleSnapshot;
}

export default function chatModeExtension(pi: ExtensionAPI): void {
	let planFile: SessionPlanFile | undefined;

	function persistMode(): void {
		if (!planFile) return;
		const persisted: PersistedModeState = {
			version: 3,
			mode: getChatMode(),
			toolsBeforeRestricted: modeController.getToolsBeforeRestricted(),
			planLifecycle: getPlanLifecycleSnapshot(),
		};
		pi.appendEntry(STATE_ENTRY, persisted);
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
	});

	registerPlanCommand(pi, {
		getMode: getChatMode,
		getPlan: () => planFile,
		enterPlan: (ctx) => enterPlan(ctx, "user"),
	});

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		modeController.reset();
		resetPlanLifecycle();
		planFile = sessionPlanFile(
			ctx.sessionManager.getSessionDir() || EPHEMERAL_PLAN_ROOT,
			ctx.sessionManager.getSessionId(),
		);
		const branch = ctx.sessionManager.getBranch() as Array<{
			type: string;
			customType?: string;
			data?: PersistedModeState;
		}>;
		const saved = branch
			.filter(
				(entry) => entry.type === "custom" && entry.customType === STATE_ENTRY,
			)
			.pop()?.data;

		restorePlanLifecycle(saved?.planLifecycle);
		if (saved?.mode === "plan" && saved.planLifecycle?.state === undefined) {
			enterPlanFromTool();
		}
		if (saved?.mode === "plan") await seedPlanFile(planFile);
		if (saved && isRestrictedMode(saved.mode)) {
			const savedTools =
				saved.toolsBeforeRestricted ?? saved.toolsBeforeAsk ?? pi.getActiveTools();
			modeController.restoreRestricted(saved.mode, savedTools);
		}
		modeController.updateStatus(ctx);
		persistMode();

		if (ctx.mode === "tui") {
			ctx.ui.setEditorComponent(
				(tui: TUI, theme: Theme, keybindings: KeybindingsManager) => {
					const editor = new ChatModeEditor(tui, theme, keybindings);
					editor.onToggle = () =>
						toggleMode(modeController, ctx, () => enterPlan(ctx, "user"));
					return editor;
				},
			);
		}
	});

	pi.on("session_compact", (_event: SessionCompactEvent) => {
		resetPlanRemindersAfterCompaction();
		persistMode();
	});

	pi.on(
		"before_agent_start",
		async (event: BeforeAgentStartEvent, _ctx: ExtensionContext) => {
			const mode = getChatMode();
			const kind = takePlanReminder(mode === "plan");
			const hasContent =
				planFile && (kind === "full" || kind === "reentry")
					? (await readPlanFile(planFile)) !== undefined
					: false;
			const reminder = kind
				? planReminderText(
						kind,
						planFile?.absolutePath ?? "unavailable",
						hasContent,
					)
				: undefined;
			if (kind) persistMode();
			const message = reminder
				? { customType: "plan-mode-reminder", content: reminder, display: false }
				: undefined;
			if (mode === "ask") {
				return {
					systemPrompt: `${event.systemPrompt}\n\n${ASK_MODE_PROMPT}`,
					...(message ? { message } : {}),
				};
			}
			if (message) return { message };
		},
	);

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		const mode = getChatMode();
		let reason: string | undefined;
		if (mode === "ask") reason = await checkAskToolCall(event, ctx.cwd);
		if (mode === "plan") {
			reason = await checkPlanToolCall(
				event,
				ctx.cwd,
				planFile?.absolutePath,
			);
		}
		return reason ? { block: true, reason } : undefined;
	});
}
