import { VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { DashboardData } from "./discovery.js";
import { equalize, panelBody } from "./panels.js";
import { fit, GAP, inset, joinRows, type Color } from "./tui-utils.js";

function heading(width: number, theme: Theme): string[] {
	const name = `${theme.fg("accent", theme.bold("M-PI"))} ${theme.fg("text", "BUILD")}`;
	const version = theme.fg("dim", `Pi v${VERSION}`);
	const gap = Math.max(1, width - visibleWidth(name) - visibleWidth(version));
	return [
		fit(`${name}${" ".repeat(gap)}${version}`, width),
		theme.fg("muted", "Intelligent coding workspace"),
		theme.fg("borderMuted", "─".repeat(width)),
	];
}

function sectionBodies(
	data: DashboardData,
	theme: Theme,
	widths: number[],
	columns: number[],
): string[][] {
	const border = (text: string) => theme.fg("borderMuted", text);
	const specs: Array<[string, string[], Color]> = [
		["CONTEXT", data.contexts, (text) => theme.fg("accent", text)],
		["SKILLS", data.skills, (text) => theme.fg("thinkingHigh", text)],
		["EXTENSIONS", data.extensions, (text) => theme.fg("success", text)],
		["THEMES", data.themes, (text) => theme.fg("warning", text)],
	];
	return specs.map(([title, items, color], index) =>
		panelBody(
			title,
			items,
			widths[index] ?? widths[0] ?? 20,
			color,
			border,
			columns[index] ?? 1,
		),
	);
}

function readyLine(theme: Theme): string {
	return [
		theme.fg("success", "● Ready"),
		theme.fg("muted", "Shift+Tab mode"),
		theme.fg("muted", "/help commands"),
		theme.fg("muted", "/settings theme"),
	].join(theme.fg("dim", "  ·  "));
}

function renderWide(width: number, data: DashboardData, theme: Theme): string[] {
	const margin = 2;
	const available = width - margin * 2;
	const usable = available - GAP.length * 3;
	const widths = [
		Math.floor(usable * 0.22),
		Math.floor(usable * 0.32),
		Math.floor(usable * 0.28),
	];
	widths.push(usable - widths.reduce((sum, value) => sum + value, 0));
	const bodies = sectionBodies(data, theme, widths, [1, 2, 2, 1]);
	equalize(bodies);
	return inset(
		[
			...heading(available, theme),
			"",
			...joinRows(bodies, widths),
			"",
			readyLine(theme),
			"",
		],
		margin,
	);
}

function renderMedium(width: number, data: DashboardData, theme: Theme): string[] {
	const margin = 1;
	const available = width - margin * 2;
	const left = Math.floor((available - GAP.length) / 2);
	const widths = [left, available - GAP.length - left];
	const bodies = sectionBodies(data, theme, [...widths, ...widths], [1, 1, 1, 1]);
	equalize(bodies.slice(0, 2));
	equalize(bodies.slice(2));
	return inset(
		[
			...heading(available, theme),
			"",
			...joinRows(bodies.slice(0, 2), widths),
			"",
			...joinRows(bodies.slice(2), widths),
			"",
			fit(readyLine(theme), available),
			"",
		],
		margin,
	);
}

function renderNarrow(width: number, data: DashboardData, theme: Theme): string[] {
	const available = Math.max(4, width);
	const bodies = sectionBodies(data, theme, [available, available, available, available], [1, 1, 1, 1]);
	return [
		...heading(available, theme),
		"",
		...bodies.flatMap((body) => [...body, ""]),
		fit(readyLine(theme), available),
	];
}

export function renderDashboard(width: number, data: DashboardData, theme: Theme): string[] {
	if (width <= 0) return [];
	if (width < 20) return [fit(theme.fg("accent", theme.bold("M-PI BUILD")), width)];
	if (width >= 120) return renderWide(width, data, theme);
	if (width >= 80) return renderMedium(width, data, theme);
	return renderNarrow(width, data, theme);
}
