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

export function modeBadge(theme: Theme, mode: ModeName): string {
	return theme.fg(
		MODE_COLORS[mode],
		`${UI_GLYPHS.active} ${mode.toUpperCase()}`,
	);
}

export function secondaryLine(theme: Theme, text: string): string {
	return `  ${theme.fg("dim", UI_GLYPHS.branch)} ${theme.fg("muted", text)}`;
}

export function timelineLine(theme: Theme, text = ""): string {
	const content = text ? ` ${theme.fg("muted", text)}` : "";
	return `${theme.fg("dim", UI_GLYPHS.line)}${content}`;
}

export function sectionRule(theme: Theme, width: number): string {
	return theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
}

export function fitLine(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(text, width, "…", true);
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}
