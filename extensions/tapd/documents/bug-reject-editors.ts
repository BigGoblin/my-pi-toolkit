import {
	getSelectListTheme,
	type ExtensionUIContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Editor,
	Input,
	matchesKey,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import { STANDARD_OVERLAY_OPTIONS } from "../../shared/tui/overlay-shell.js";

function createEditorTheme(theme: Theme) {
	return {
		borderColor: (text: string) => theme.fg("borderMuted", text),
		selectList: getSelectListTheme(),
	};
}

/** Overlay 单行输入：Enter 确认，Esc 取消。 */
export async function showOverlayLineInput(
	ui: ExtensionUIContext,
	title: string,
	initial: string,
): Promise<string | undefined> {
	return ui.custom<string | undefined>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (value: string | undefined) => void,
		) => {
			const input = new Input();
			input.setValue(initial);
			input.focused = true;
			input.onSubmit = (value: string) => done(value);
			input.onEscape = () => done(undefined);
			return {
				render(width: number): string[] {
					return [
						theme.bold(theme.fg("text", title)),
						"",
						...input.render(Math.max(8, width)),
					];
				},
				handleInput(data: string): void {
					if (keybindings.matches(data, "tui.select.cancel")) {
						done(undefined);
						return;
					}
					input.handleInput(data);
					tui.requestRender();
				},
				invalidate() {},
				footer: () => "Enter 确认 · Esc 取消",
			};
		},
		STANDARD_OVERLAY_OPTIONS,
	);
}

/**
 * Overlay 多行编辑：嵌入 Pi 官方 Editor。
 * Enter 确认，Ctrl+Enter 换行（Windows 终端常用），Esc 取消。
 */
export async function showOverlayMultilineEditor(
	ui: ExtensionUIContext,
	title: string,
	initial: string,
): Promise<string | undefined> {
	return ui.custom<string | undefined>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (value: string | undefined) => void,
		) => {
			const editor = new Editor(tui, createEditorTheme(theme));
			editor.focused = true;
			editor.setText(initial);
			editor.onSubmit = (text: string) => done(text);
			editor.onChange = () => tui.requestRender();

			return {
				render(width: number): string[] {
					return [
						theme.bold(theme.fg("text", title)),
						theme.fg("muted", "Enter 确认 · Ctrl+Enter 换行"),
						"",
						...editor.render(Math.max(8, width)),
					];
				},
				handleInput(data: string): void {
					if (keybindings.matches(data, "tui.select.cancel")) {
						done(undefined);
						return;
					}
					// Windows 终端上 Shift+Enter 常不可用；显式支持 Ctrl+Enter 换行。
					if (
						matchesKey(data, "ctrl+enter") ||
						matchesKey(data, "ctrl+return")
					) {
						editor.insertTextAtCursor("\n");
						tui.requestRender();
						return;
					}
					editor.handleInput(data);
					tui.requestRender();
				},
				invalidate() {
					editor.invalidate();
				},
				footer: () => "Enter 确认 · Ctrl+Enter 换行 · Esc 取消",
			};
		},
		STANDARD_OVERLAY_OPTIONS,
	);
}
