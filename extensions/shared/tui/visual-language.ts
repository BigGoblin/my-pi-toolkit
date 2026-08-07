import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const UI_GLYPHS = {
	active: "●",
	success: "✓",
	error: "✗",
	pending: "○",
	action: "›",
	branch: "└",
	line: "│",
	more: "…",
} as const;

export type VisualStatus = "active" | "success" | "error" | "pending";
export type ModeName = "build" | "plan" | "ask";

const STATUS_COLORS = {
	active: "accent",
	success: "success",
	error: "error",
	pending: "dim",
} as const;

const MODE_COLORS = {
	build: "accent",
	plan: "warning",
	ask: "success",
} as const;

export function statusGlyph(theme: Theme, status: VisualStatus): string {
	return theme.fg(STATUS_COLORS[status], UI_GLYPHS[status]);
}

/** Embed a mode label in an editor top border: `─ BUILD ───────`. */
export function modeEditorBorder(
	theme: Theme,
	mode: ModeName,
	width: number,
	border: (text: string) => string,
): string {
	if (width <= 0) return "";
	if (width === 1) return border("─");

	let label = theme.fg(MODE_COLORS[mode], ` ${mode.toUpperCase()} `);
	const fixedWidth = 2; // leading and trailing ─
	const minimumGap = 3;
	while (
		fixedWidth + visibleWidth(label) + minimumGap > width &&
		visibleWidth(label) > 0
	) {
		label = truncateToWidth(label, Math.max(0, visibleWidth(label) - 1), "");
	}
	const gapWidth = Math.max(0, width - fixedWidth - visibleWidth(label));
	return `${border("─")}${label}${border("─".repeat(gapWidth))}${border("─")}`;
}

export function secondaryLine(theme: Theme, text: string): string {
	return `  ${theme.fg("dim", UI_GLYPHS.branch)} ${theme.fg("muted", text)}`;
}

export function mutedLine(theme: Theme, text: string): string {
	return theme.fg("muted", text);
}

export function timelineLine(theme: Theme, text = ""): string {
	const content = text ? ` ${theme.fg("muted", text)}` : "";
	return `  ${theme.fg("dim", UI_GLYPHS.line)}${content}`;
}

export function sectionRule(theme: Theme, width: number): string {
	return theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
}

export function fitLine(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(text, width, "…", true);
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}
