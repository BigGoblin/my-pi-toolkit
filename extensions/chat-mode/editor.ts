import type { Theme } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import { modeEditorBorder } from "../shared/tui/visual-language.js";
import { getChatMode } from "./state.js";

let boundTui: TUI | undefined;

export function refreshChatModeEditor(): void {
	boundTui?.requestRender();
}

export function unbindChatModeEditor(): void {
	boundTui = undefined;
}

function isPlainHorizontalBorder(line: string): boolean {
	return /^─+$/.test(line.replace(/\x1b\[[0-9;]*m/g, ""));
}

export class ChatModeEditor extends CustomEditor {
	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
		boundTui = this.tui;
	}

	onToggle?: () => void;
	/** Full Theme for mode colors; EditorTheme only has borderColor. */
	resolveTheme?: () => Theme;

	handleInput(data: string): void {
		// Intercept before CustomEditor so Pi's app.thinking.cycle (Shift+Tab) does not fire.
		if (matchesKey(data, "shift+tab")) {
			this.onToggle?.();
			return;
		}
		super.handleInput(data);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		const theme = this.resolveTheme?.();
		if (!theme || lines.length < 2) return lines;
		// Keep Pi scroll indicator (↑ N) when content is scrolled.
		if (!isPlainHorizontalBorder(lines[0]!)) return lines;
		lines[0] = modeEditorBorder(
			theme,
			getChatMode(),
			width,
			(text) => this.borderColor(text),
		);
		return lines;
	}
}
