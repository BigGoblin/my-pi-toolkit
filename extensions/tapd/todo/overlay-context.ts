import type {
	ExtensionCommandContext,
	ExtensionUIContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type {
	Component,
	KeybindingsManager,
	TUI,
} from "@earendil-works/pi-tui";
import { STANDARD_OVERLAY_OPTIONS } from "../../shared/tui/overlay-shell.js";
import { showOverlayConfirm, showOverlaySelect } from "./overlay-dialogs.js";
import { TapdOverlayFrame } from "./overlay-frame.js";

type OverlayComponent = Component & { dispose?(): void };
type OverlayFactory = (
	tui: TUI,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (result: unknown) => void,
) => OverlayComponent | Promise<OverlayComponent>;
type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];

const TAPD_OVERLAY_OPTIONS: NonNullable<CustomOptions> =
	STANDARD_OVERLAY_OPTIONS;

export function withTapdListOverlays(
	ctx: ExtensionCommandContext,
): ExtensionCommandContext {
	const overlayCustom = ((factory: OverlayFactory, options?: CustomOptions) => {
		const framedFactory: OverlayFactory = async (
			tui,
			theme,
			keybindings,
			done,
		) =>
			new TapdOverlayFrame(
				await factory(tui, theme, keybindings, done),
				theme,
				tui,
				keybindings,
			);
		return ctx.ui.custom(framedFactory, options ?? TAPD_OVERLAY_OPTIONS);
	}) as ExtensionUIContext["custom"];
	const overlaySelect: ExtensionUIContext["select"] = (
		title: string,
		options: string[],
	) => showOverlaySelect(ctx.ui, title, options);
	const overlayConfirm: ExtensionUIContext["confirm"] = (
		title: string,
		message: string,
	) => showOverlayConfirm(ctx.ui, title, message);
	const ui = new Proxy(ctx.ui, {
		get(target, property) {
			if (property === "custom") return overlayCustom;
			if (property === "select") return overlaySelect;
			if (property === "confirm") return overlayConfirm;
			const value = Reflect.get(target, property, target) as unknown;
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return new Proxy(ctx, {
		get(target, property) {
			if (property === "ui") return ui;
			const value = Reflect.get(target, property, target) as unknown;
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
