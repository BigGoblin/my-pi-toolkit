import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	isFocusable,
	truncateToWidth,
	type Component,
	type Focusable,
} from "@earendil-works/pi-tui";

export class TapdOverlayFrame implements Component, Focusable {
	focused = false;

	constructor(
		private readonly content: Component & { dispose?(): void },
		private readonly theme: Theme,
	) {}

	handleInput(data: string): void {
		this.content.handleInput?.(data);
	}

	render(width: number): string[] {
		if (isFocusable(this.content)) this.content.focused = this.focused;
		const innerWidth = Math.max(20, width - 2);
		const lines = this.content.render(innerWidth);
		const border = (value: string) => this.theme.fg("accent", value);
		return [
			border(`╭${"─".repeat(innerWidth)}╮`),
			...lines.map(
				(line: string) =>
					`${border("│")}${truncateToWidth(line, innerWidth, "", true)}${border("│")}`,
			),
			border(`╰${"─".repeat(innerWidth)}╯`),
		];
	}

	invalidate(): void {
		this.content.invalidate();
	}

	dispose(): void {
		this.content.dispose?.();
	}
}
