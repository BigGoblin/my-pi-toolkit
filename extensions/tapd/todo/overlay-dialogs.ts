import {
	getSelectListTheme,
	type ExtensionUIContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	matchesKey,
	SelectList,
	type SelectItem,
	Text,
	type KeybindingsManager,
	type TUI,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	overlayViewportHeight,
	STANDARD_OVERLAY_OPTIONS,
} from "../../shared/tui/overlay-shell.js";
import { statusGlyph } from "../../shared/tui/visual-language.js";
import { TapdOverlayFrame } from "./overlay-frame.js";

export async function showOverlaySelect(
	ui: ExtensionUIContext,
	title: string,
	options: string[],
): Promise<string | undefined> {
	return ui.custom<string | undefined>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (value: string | undefined) => void,
		) => {
			const container = new Container();
			const list = new SelectList(
				options.map((option) => ({ value: option, label: option })),
				Math.max(
					4,
					Math.min(
						options.length,
						overlayViewportHeight(tui.terminal.rows) - 2,
					),
				),
				getSelectListTheme(),
			);
			list.onSelect = (item: SelectItem) => done(item.value);
			list.onCancel = () => done(undefined);
			container.addChild(new Text(theme.bold(theme.fg("text", title)), 1, 0));
			container.addChild(list);
			return new TapdOverlayFrame(
				{
					render: (width: number) => container.render(width),
					handleInput: (data: string) => list.handleInput(data),
					invalidate: () => container.invalidate(),
					footer: () => "↑↓ select · Enter confirm · Esc back",
				},
				theme,
				tui,
				keybindings,
			);
		},
		STANDARD_OVERLAY_OPTIONS,
	);
}

export async function showOverlayConfirm(
	ui: ExtensionUIContext,
	title: string,
	message: string,
): Promise<boolean> {
	const result = await ui.custom<"confirm" | "cancel">(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (value: "confirm" | "cancel") => void,
		) => {
			let selected = 0;
			const content = {
				render(width: number) {
					const messageWidth = Math.max(10, width - 2);
					const confirm = `${statusGlyph(theme, selected === 0 ? "active" : "pending")} Confirm`;
					const cancel = `${statusGlyph(theme, selected === 1 ? "active" : "pending")} Cancel`;
					return [
						theme.bold(theme.fg("text", title)),
						"",
						...wrapTextWithAnsi(message, messageWidth).map(
							(line: string) => ` ${line}`,
						),
						"",
						`${confirm}    ${cancel}`,
					];
				},
				handleInput(data: string) {
					if (keybindings.matches(data, "tui.select.cancel")) {
						done("cancel");
						return;
					}
					if (matchesKey(data, "left") || matchesKey(data, "right")) {
						selected = selected === 0 ? 1 : 0;
						tui.requestRender();
						return;
					}
					if (keybindings.matches(data, "tui.select.confirm"))
						done(selected === 0 ? "confirm" : "cancel");
				},
				invalidate() {},
				footer: () => "←→ select · Enter confirm · Esc cancel",
			};
			return new TapdOverlayFrame(content, theme, tui, keybindings);
		},
		STANDARD_OVERLAY_OPTIONS,
	);
	return result === "confirm";
}
