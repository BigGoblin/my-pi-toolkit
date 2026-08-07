import type { Theme } from "@earendil-works/pi-coding-agent";
import { fitLine } from "./visual-language.js";

export const STANDARD_OVERLAY_MAX_HEIGHT_RATIO = 0.88;
export const STANDARD_OVERLAY_MARGIN = 1;

export const STANDARD_OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: {
		anchor: "center",
		width: "92%",
		maxHeight: "88%",
		margin: STANDARD_OVERLAY_MARGIN,
	},
} as const;

export const OVERLAY_CHROME_ROWS = 6;

export interface OverlayHeightBudget {
	maxHeightRatio?: number;
	margin?: number;
	chromeRows?: number;
}

export interface OverlayShellView {
	header: string;
	body: string[];
	footer: string;
}

export function overlayInnerWidth(width: number): number {
	return Math.max(18, width - 2);
}

export function overlayPanelHeight(
	rows: number,
	budget: OverlayHeightBudget = {},
): number {
	const margin = Math.max(0, budget.margin ?? STANDARD_OVERLAY_MARGIN);
	const availableRows = Math.max(1, rows - margin * 2);
	const ratio = Math.max(
		0,
		Math.min(1, budget.maxHeightRatio ?? STANDARD_OVERLAY_MAX_HEIGHT_RATIO),
	);
	return Math.max(1, Math.floor(availableRows * ratio));
}

export function overlayViewportHeight(
	rows: number,
	budget: OverlayHeightBudget = {},
): number {
	return Math.max(
		1,
		overlayPanelHeight(rows, budget) -
			(budget.chromeRows ?? OVERLAY_CHROME_ROWS),
	);
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
