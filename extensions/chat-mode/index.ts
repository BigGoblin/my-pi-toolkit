import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { ChatModeEditor } from "./editor.js";
import { PLAN_FILE_RELATIVE } from "./paths.js";
import { readPlanFile, seedPlanFile } from "./plan-file.js";
import {
	getPlanLifecycleSnapshot,
	onEnterPlan,
	onLeavePlan,
	resetPlanLifecycle,
	restorePlanLifecycle,
	takePlanReminder,
	type PlanLifecycleSnapshot,
} from "./plan-lifecycle.js";
import { registerPlanTools } from "./plan-tools.js";
import {
	checkAskToolCall,
	checkPlanToolCall,
	restrictedModeToolNames,
} from "./policy.js";
import { ASK_MODE_PROMPT, planReminderText } from "./prompt.js";
import {
	getChatMode,
	isRestrictedMode,
	nextChatMode,
	setChatMode,
	type ChatMode,
} from "./state.js";

const STATE_ENTRY = "chat-mode-state";
const BUILD_COLOR = "\x1b[38;2;49;109;221m";
const RESET_FOREGROUND = "\x1b[39m";

interface PersistedModeState {
	mode: ChatMode;
	/** Snapshot of active tools before entering ask or plan. */
	toolsBeforeRestricted?: string[];
	/** Legacy field from ask-only persistence. */
	toolsBeforeAsk?: string[];
	planLifecycle?: PlanLifecycleSnapshot;
}

export default function chatModeExtension(pi: ExtensionAPI): void {
	let toolsBeforeRestricted: string[] | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		const mode = getChatMode();
		const label =
			mode === "ask"
				? ctx.ui.theme.fg("success", "◆ ASK")
				: mode === "plan"
					? ctx.ui.theme.fg("warning", "◇ PLAN")
					: `${BUILD_COLOR}● BUILD${RESET_FOREGROUND}`;
		ctx.ui.setStatus("chat-mode", label);
	}

	function persistMode(): void {
		const state: PersistedModeState = {
			mode: getChatMode(),
			toolsBeforeRestricted,
			planLifecycle: getPlanLifecycleSnapshot(),
		};
		pi.appendEntry(STATE_ENTRY, state);
	}

	function restoreBuildTools(): void {
		if (!toolsBeforeRestricted) return;
		const allTools = pi.getAllTools() as Array<{ name: string }>;
		const available = new Set(allTools.map((tool) => tool.name));
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
		if (!toolsBeforeRestricted) {
			toolsBeforeRestricted = pi.getActiveTools();
		}
		pi.setActiveTools(restrictedModeToolNames(toolsBeforeRestricted));
	}

	function modeNotifyMessage(mode: ChatMode): string {
		if (mode === "ask") {
			return "已启用 Ask：项目写入仅限 .pi/。";
		}
		if (mode === "plan") {
			return `已启用 Plan：仅可写入 ${PLAN_FILE_RELATIVE}。`;
		}
		return "已启用 Build：已恢复完整工具权限。";
	}

	function switchMode(
		mode: ChatMode,
		ctx: ExtensionContext,
		options?: { viaToolApproval?: boolean },
	): void {
		const previous = getChatMode();
		if (mode === previous) return;

		if (mode === "plan") {
			onEnterPlan();
		} else if (previous === "plan") {
			onLeavePlan(options?.viaToolApproval === true);
		}

		applyModeTools(mode);
		setChatMode(mode);
		updateStatus(ctx);
		persistMode();
		ctx.ui.notify(modeNotifyMessage(mode), "info");
	}

	async function enterPlanFromUser(ctx: ExtensionContext): Promise<void> {
		switchMode("plan", ctx);
		await seedPlanFile(ctx.cwd);
	}

	function toggleMode(ctx: ExtensionContext): void {
		if (!ctx.isIdle()) {
			ctx.ui.notify(
				"请等待当前 Agent 运行结束后再切换模式。",
				"warning",
			);
			return;
		}
		const next = nextChatMode();
		if (next === "plan") {
			void enterPlanFromUser(ctx);
			return;
		}
		switchMode(next, ctx);
	}

	function restorePersistedMode(saved: PersistedModeState | undefined): void {
		restorePlanLifecycle(saved?.planLifecycle);
		if (!saved || !isRestrictedMode(saved.mode)) return;
		toolsBeforeRestricted =
			saved.toolsBeforeRestricted ??
			saved.toolsBeforeAsk ??
			pi.getActiveTools();
		setChatMode(saved.mode);
		pi.setActiveTools(restrictedModeToolNames(pi.getActiveTools()));
	}

	registerPlanTools(pi, {
		getMode: getChatMode,
		switchMode,
	});

	pi.registerCommand("plan", {
		description: "Enter plan mode (explore + write .pi/plan.md only)",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify(
					"Wait for the current agent run before switching mode.",
					"warning",
				);
				return;
			}
			if (getChatMode() === "plan") {
				ctx.ui.notify("已在 Plan 模式。", "info");
				return;
			}
			await enterPlanFromUser(ctx);
		},
	});

	pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		setChatMode("build");
		toolsBeforeRestricted = undefined;
		resetPlanLifecycle();
		const entries = ctx.sessionManager.getEntries() as Array<{
			type: string;
			customType?: string;
			data?: PersistedModeState;
		}>;
		const saved = entries
			.filter(
				(entry) => entry.type === "custom" && entry.customType === STATE_ENTRY,
			)
			.pop();

		restorePersistedMode(saved?.data);
		updateStatus(ctx);

		if (ctx.mode === "tui") {
			ctx.ui.setEditorComponent(
				(tui: TUI, theme: Theme, keybindings: KeybindingsManager) => {
					const editor = new ChatModeEditor(tui, theme, keybindings);
					editor.onToggle = () => toggleMode(ctx);
					return editor;
				},
			);
		}
	});

	pi.on("before_agent_start", async (event: { systemPrompt: string }, ctx) => {
		const mode = getChatMode();
		const reminderKind = takePlanReminder(mode === "plan");
		const planHasContent =
			reminderKind === "full" || reminderKind === "reentry"
				? (await readPlanFile(ctx.cwd)) !== undefined
				: false;
		const reminder = reminderKind
			? planReminderText(reminderKind, planHasContent)
			: undefined;
		if (reminderKind) persistMode();

		const reminderMessage = reminder
			? {
					customType: "plan-mode-reminder",
					content: reminder,
					display: false,
				}
			: undefined;

		if (mode === "ask") {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${ASK_MODE_PROMPT}`,
				...(reminderMessage ? { message: reminderMessage } : {}),
			};
		}
		if (reminderMessage) return { message: reminderMessage };
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		const mode = getChatMode();
		if (mode === "ask") {
			const reason = await checkAskToolCall(event, ctx.cwd);
			return reason ? { block: true, reason } : undefined;
		}
		if (mode === "plan") {
			const reason = await checkPlanToolCall(event, ctx.cwd);
			return reason ? { block: true, reason } : undefined;
		}
	});
}
