import { rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import {
	isFocusable,
	type Component,
	type Focusable,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	overlayInnerWidth,
	overlayViewportHeight,
	renderOverlayShell,
} from "../../shared/tui/overlay-shell.js";

export class TapdOverlayFrame implements Component, Focusable {
	focused = false;

	constructor(
		private readonly content: Component & {
			dispose?(): void;
			/** 自定义底部提示（传入 body 内宽）；不提供时回退到 keybindings 的 Esc back · Ctrl+C close。 */
			footer?(width: number): string;
		},
		private readonly theme: Theme,
		private readonly tui: TUI,
		private readonly keybindings: KeybindingsManager,
	) {}

	handleInput(data: string): void {
		this.content.handleInput?.(data);
	}

	render(width: number): string[] {
		if (isFocusable(this.content)) this.content.focused = this.focused;
		const innerWidth = overlayInnerWidth(width);
		const viewportHeight = overlayViewportHeight(this.tui.terminal.rows);
		const body = this.content.render(innerWidth).slice(0, viewportHeight);
		while (body.length < viewportHeight) body.push("");
		const cancelKeys = this.keybindings.getKeys("tui.select.cancel");
		const back = cancelKeys[0] ? rawKeyHint(cancelKeys[0], "back") : "Esc back";
		const close = cancelKeys[1]
			? rawKeyHint(cancelKeys[1], "close")
			: "Ctrl+C close";
		const footer = this.content.footer
			? this.content.footer(innerWidth)
			: `${back} · ${close}`;
		return renderOverlayShell(this.theme, width, {
			header: `${this.theme.bold(this.theme.fg("text", "TAPD"))}  ${this.theme.fg("muted", "TODO & SESSIONS")}`,
			body,
			footer: this.theme.fg("dim", footer),
		});
	}

	invalidate(): void {
		this.content.invalidate();
	}

	dispose(): void {
		this.content.dispose?.();
	}
}
