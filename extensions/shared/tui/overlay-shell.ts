import type { Theme } from "@earendil-works/pi-coding-agent";
import { fitLine } from "./visual-language.js";

export const STANDARD_OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: {
		anchor: "center",
		width: "92%",
		maxHeight: "88%",
		margin: 1,
	},
} as const;

export const OVERLAY_CHROME_ROWS = 6;

export interface OverlayShellView {
	header: string;
	body: string[];
	footer: string;
}

export function overlayInnerWidth(width: number): number {
	return Math.max(18, width - 2);
}

export function overlayPanelHeight(rows: number): number {
	return Math.max(8, Math.floor(rows * 0.88));
}

export function overlayViewportHeight(rows: number): number {
	return Math.max(1, overlayPanelHeight(rows) - OVERLAY_CHROME_ROWS);
}

export function renderOverlayShell(
	theme: Theme,
	width: number,
	view: OverlayShellView,
): string[] {
	const innerWidth = overlayInnerWidth(width);
	const border = (value: string) => theme.fg("border", value);
	const rule = border(`├${"─".repeat(Math.max(0, innerWidth))}┤`);
	const framed = (line: string) =>
		`${border("│")}${fitLine(line, innerWidth)}${border("│")}`;
	return [
		border(`╭${"─".repeat(Math.max(0, innerWidth))}╮`),
		framed(view.header),
		rule,
		...view.body.map(framed),
		rule,
		framed(view.footer),
		border(`╰${"─".repeat(Math.max(0, innerWidth))}╯`),
	];
}
