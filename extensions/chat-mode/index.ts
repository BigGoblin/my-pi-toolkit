import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { ChatModeEditor } from "./editor.js";
import { askModeToolNames, checkAskToolCall } from "./policy.js";
import { ASK_MODE_PROMPT } from "./prompt.js";
import { getChatMode, setChatMode, type ChatMode } from "./state.js";

const STATE_ENTRY = "chat-mode-state";
const BUILD_COLOR = "\x1b[38;2;49;109;221m";
const RESET_FOREGROUND = "\x1b[39m";

interface PersistedModeState {
	mode: ChatMode;
	toolsBeforeAsk?: string[];
}

export default function chatModeExtension(pi: ExtensionAPI): void {
	let toolsBeforeAsk: string[] | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		const label =
			getChatMode() === "ask"
				? ctx.ui.theme.fg("success", "◆ ASK")
				: `${BUILD_COLOR}● BUILD${RESET_FOREGROUND}`;
		ctx.ui.setStatus("chat-mode", label);
	}

	function persistMode(): void {
		const state: PersistedModeState = {
			mode: getChatMode(),
			toolsBeforeAsk,
		};
		pi.appendEntry(STATE_ENTRY, state);
	}

	function restoreBuildTools(): void {
		if (!toolsBeforeAsk) return;
		const allTools = pi.getAllTools() as Array<{ name: string }>;
		const available = new Set(allTools.map((tool) => tool.name));
		pi.setActiveTools(toolsBeforeAsk.filter((name) => available.has(name)));
	}

	function switchMode(mode: ChatMode, ctx: ExtensionContext): void {
		if (mode === getChatMode()) return;
		if (mode === "ask") {
			const activeTools = pi.getActiveTools();
			toolsBeforeAsk = activeTools;
			pi.setActiveTools(askModeToolNames(activeTools));
		} else {
			restoreBuildTools();
			toolsBeforeAsk = undefined;
		}
		setChatMode(mode);
		updateStatus(ctx);
		persistMode();
		ctx.ui.notify(
			mode === "ask"
				? "Ask mode enabled. Project writes are limited to .pi/."
				: "Build mode enabled. Full tool access restored.",
			"info",
		);
	}

	function toggleMode(ctx: ExtensionContext): void {
		if (!ctx.isIdle()) {
			ctx.ui.notify(
				"Wait for the current agent run before switching mode.",
				"warning",
			);
			return;
		}
		switchMode(getChatMode() === "build" ? "ask" : "build", ctx);
	}

	pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		setChatMode("build");
		toolsBeforeAsk = undefined;
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

		if (saved?.data?.mode === "ask") {
			toolsBeforeAsk = saved.data.toolsBeforeAsk ?? pi.getActiveTools();
			setChatMode("ask");
			pi.setActiveTools(askModeToolNames(pi.getActiveTools()));
		}
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

	pi.on("before_agent_start", (event: { systemPrompt: string }) => {
		if (getChatMode() !== "ask") return;
		return { systemPrompt: `${event.systemPrompt}\n\n${ASK_MODE_PROMPT}` };
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		if (getChatMode() !== "ask") return;
		const reason = await checkAskToolCall(event, ctx.cwd);
		return reason ? { block: true, reason } : undefined;
	});
}
