import {
	DynamicBorder,
	getSelectListTheme,
	type ExtensionUIContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	SelectList,
	type SelectItem,
	Text,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";

const DIALOG_OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: {
		anchor: "center",
		width: "64%",
		maxHeight: "72%",
		margin: 2,
	},
} as const;

export async function showOverlaySelect(
	ui: ExtensionUIContext,
	title: string,
	options: string[],
): Promise<string | undefined> {
	return ui.custom<string | undefined>(
		(
			tui: TUI,
			theme: Theme,
			_keybindings: KeybindingsManager,
			done: (value: string | undefined) => void,
		) => {
			const container = new Container();
			const list = new SelectList(
				options.map((option) => ({ value: option, label: option })),
				Math.max(4, Math.min(options.length, tui.terminal.rows - 10)),
				getSelectListTheme(),
			);
			list.onSelect = (item: SelectItem) => done(item.value);
			list.onCancel = () => done(undefined);
			container.addChild(
				new DynamicBorder((value: string) => theme.fg("accent", value)),
			);
			container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
			container.addChild(list);
			container.addChild(
				new Text(theme.fg("dim", "↑↓ 选择 · Enter 确认 · Esc 返回"), 1, 0),
			);
			container.addChild(
				new DynamicBorder((value: string) => theme.fg("accent", value)),
			);
			return {
				render: (width: number) => container.render(width),
				handleInput: (data: string) => list.handleInput(data),
				invalidate: () => container.invalidate(),
			};
		},
		DIALOG_OVERLAY_OPTIONS,
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
			_keybindings: KeybindingsManager,
			done: (value: "confirm" | "cancel") => void,
		) => {
			let selected = 0;
			return {
				render(width: number) {
					const choices = selected === 0 ? "[确认]  取消" : " 确认  [取消]";
					return [
						theme.fg(
							"accent",
							`╭─ ${theme.bold(title)} ${"─".repeat(Math.max(0, width - title.length - 5))}╮`,
						),
						...message.split("\n").map((line) => `│ ${line}`),
						`│ ${theme.fg("accent", choices)}`,
						theme.fg("dim", "│ ←→ 选择 · Enter 确认 · Esc 取消"),
						theme.fg("accent", `╰${"─".repeat(Math.max(1, width - 2))}╯`),
					];
				},
				handleInput(data: string) {
					if (data === "\x1b" || data === "\x03") done("cancel");
					else if (data === "\x1b[D" || data === "\x1b[C") {
						selected = selected === 0 ? 1 : 0;
						tui.requestRender();
					} else if (data === "\r" || data === "\n")
						done(selected === 0 ? "confirm" : "cancel");
				},
				invalidate() {},
			};
		},
		DIALOG_OVERLAY_OPTIONS,
	);
	return result === "confirm";
}
