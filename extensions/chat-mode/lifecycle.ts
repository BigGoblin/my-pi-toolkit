import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
	BeforeAgentStartEvent,
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionCompactEvent,
	SessionStartEvent,
	Theme,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { ChatModeEditor } from "./editor.js";
import { type ModeController, toggleMode } from "./mode-controller.js";
import {
	enterPlanFromTool,
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
import { wantsAskModeForDocs } from "./ensure-ask-for-docs.js";
import { checkAskToolCall, checkPlanToolCall } from "./policy.js";
import {
	ASK_MODE_PROMPT,
	IMPLEMENTATION_KICKOFF,
	PLAN_EXIT_REMINDER_CUSTOM_TYPE,
	PLAN_MODE_REMINDER_CUSTOM_TYPE,
	planReminderText,
} from "./prompt.js";
import { getChatMode, isRestrictedMode, type ChatMode } from "./state.js";

export const CHAT_MODE_STATE_ENTRY = "chat-mode-state";

const EPHEMERAL_PLAN_ROOT = resolve(tmpdir(), "pi-plan-sessions");

export interface PersistedModeState {
	version?: 3;
	mode: ChatMode;
	toolsBeforeRestricted?: string[];
	toolsBeforeAsk?: string[];
	planLifecycle?: PlanLifecycleSnapshot;
}

export interface ChatModeLifecycleOptions {
	modeController: ModeController;
	getActiveTools: () => string[];
	getPlan: () => SessionPlanFile | undefined;
	setPlan: (plan: SessionPlanFile) => void;
	enterPlan: (
		ctx: ExtensionContext,
		source: "tool" | "user",
	) => Promise<unknown>;
	persistMode: () => void;
	clearImplementationKickoff: () => void;
	hasImplementationKickoff: () => boolean;
	consumeImplementationKickoff: () => void;
}

export function registerChatModeLifecycle(
	pi: ExtensionAPI,
	options: ChatModeLifecycleOptions,
): void {
	pi.on("session_start", createSessionStartHandler(options));
	pi.on("session_compact", createSessionCompactHandler(options));
	pi.on("before_agent_start", createBeforeAgentStartHandler(options));
	pi.on("context", createContextHandler(options));
	pi.on("tool_call", createToolCallHandler(options));
}

function createSessionStartHandler(options: ChatModeLifecycleOptions) {
	return async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		await restoreSessionModeState(options, ctx);
		if (ctx.mode !== "tui") return;
		ctx.ui.setEditorComponent(createChatModeEditor(options, ctx));
	};
}

async function restoreSessionModeState(
	options: ChatModeLifecycleOptions,
	ctx: ExtensionContext,
): Promise<void> {
	options.clearImplementationKickoff();
	options.modeController.reset();
	resetPlanLifecycle();

	const plan = sessionPlanFile(
		ctx.sessionManager.getSessionDir() || EPHEMERAL_PLAN_ROOT,
		ctx.sessionManager.getSessionId(),
	);
	options.setPlan(plan);

	const branch = ctx.sessionManager.getBranch() as Array<{
		type: string;
		customType?: string;
		data?: PersistedModeState;
	}>;
	const saved = branch
		.filter(
			(entry) =>
				entry.type === "custom" && entry.customType === CHAT_MODE_STATE_ENTRY,
		)
		.pop()?.data;

	restorePlanLifecycle(saved?.planLifecycle);
	if (saved?.mode === "plan" && saved.planLifecycle?.state === undefined) {
		enterPlanFromTool();
	}
	if (saved?.mode === "plan") await seedPlanFile(plan);
	if (saved && isRestrictedMode(saved.mode)) {
		const savedTools =
			saved.toolsBeforeRestricted ??
			saved.toolsBeforeAsk ??
			options.getActiveTools();
		options.modeController.restoreRestricted(saved.mode, savedTools);
	}
	options.modeController.updateStatus(ctx);
	options.persistMode();
}

function createChatModeEditor(
	options: ChatModeLifecycleOptions,
	ctx: ExtensionContext,
) {
	return (tui: TUI, theme: Theme, keybindings: KeybindingsManager) => {
		const editor = new ChatModeEditor(tui, theme, keybindings);
		editor.onToggle = () =>
			toggleMode(options.modeController, ctx, () =>
				options.enterPlan(ctx, "user"),
			);
		return editor;
	};
}

function createSessionCompactHandler(options: ChatModeLifecycleOptions) {
	return (_event: SessionCompactEvent) => {
		resetPlanRemindersAfterCompaction();
		options.persistMode();
	};
}

function createBeforeAgentStartHandler(options: ChatModeLifecycleOptions) {
	return async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		// TAPD 文档流：Plan 只能写 session plan.md，与 .pi/docs 冲突，强制 Ask。
		if (
			wantsAskModeForDocs(ctx.sessionManager.getEntries()) &&
			getChatMode() !== "ask"
		) {
			options.modeController.switchMode("ask", ctx);
		}

		const mode = getChatMode();
		const kind = takePlanReminder(mode === "plan");
		const plan = options.getPlan();
		const hasContent =
			plan && (kind === "full" || kind === "reentry")
				? (await readPlanFile(plan)) !== undefined
				: false;
		const reminder = kind
			? planReminderText(kind, plan?.absolutePath ?? "unavailable", hasContent)
			: undefined;
		if (kind) options.persistMode();

		let message:
			| { customType: string; content: string; display: false }
			| undefined;
		if (kind && reminder) {
			const customType =
				kind === "exit"
					? PLAN_EXIT_REMINDER_CUSTOM_TYPE
					: PLAN_MODE_REMINDER_CUSTOM_TYPE;
			message = { customType, content: reminder, display: false };
		}

		if (mode === "ask") {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${ASK_MODE_PROMPT}`,
				...(message ? { message } : {}),
			};
		}
		if (message) return { message };
	};
}

function createContextHandler(options: ChatModeLifecycleOptions) {
	return (event: ContextEvent) => {
		const mode = getChatMode();
		const messages = event.messages.filter(
			(message: ContextEvent["messages"][number]) =>
				mode === "plan" ||
				!(
					message.role === "custom" &&
					message.customType === PLAN_MODE_REMINDER_CUSTOM_TYPE
				),
		);
		if (!options.hasImplementationKickoff() || mode !== "build") {
			return { messages };
		}

		options.consumeImplementationKickoff();
		return {
			messages: [
				...messages,
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: IMPLEMENTATION_KICKOFF }],
					timestamp: Date.now(),
				},
			],
		};
	};
}

function createToolCallHandler(options: ChatModeLifecycleOptions) {
	return async (event: ToolCallEvent, ctx: ExtensionContext) => {
		const mode = getChatMode();
		let reason: string | undefined;
		if (mode === "ask") reason = await checkAskToolCall(event, ctx.cwd);
		if (mode === "plan") {
			reason = await checkPlanToolCall(
				event,
				ctx.cwd,
				options.getPlan()?.absolutePath,
			);
		}
		return reason ? { block: true, reason } : undefined;
	};
}
