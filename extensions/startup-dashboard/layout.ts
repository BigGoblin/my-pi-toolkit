import { VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import type { DashboardData } from "./discovery.js";
import { equalize, panelBody } from "./panels.js";
import { box, fit, GAP, inset, joinRows, type Color } from "./tui-utils.js";

function renderBrand(width: number, theme: Theme): string[] {
	const accent = (text: string) => theme.fg("accent", text);
	const warning = (text: string) => theme.fg("warning", text);
	const dim = (text: string) => theme.fg("dim", text);
	const tipsWidth = 34;
	const leftWidth = width - tipsWidth - GAP.length;
	const logo = [
		"███╗   ███╗      ██████╗ ██╗",
		"████╗ ████║      ██╔══██╗██║",
		"██╔████╔██║█████╗██████╔╝██║",
		"██║╚██╔╝██║╚════╝██╔═══╝ ██║",
		"██║ ╚═╝ ██║      ██║     ██║",
		"╚═╝     ╚═╝      ╚═╝     ╚═╝",
	];
	const metadata = [
		"",
		`${theme.bold(`M-PI v${VERSION}`)}  ${dim("│")}  ${theme.fg("muted", "小明的专属 AI Agent")}`,
	];
	const left = logo.map((line, i) => `${accent(line)}  ${metadata[i] ?? ""}`);
	const tips = box(
		[
			"",
			`  ${warning("◆  Project")}`,
			`     ${accent("github.com/BigGoblin")}`,
			`     ${accent("/my-pi-toolkit")}`,
			"",
		],
		tipsWidth,
		(text) => theme.fg("borderMuted", text),
	);
	return joinRows([left, tips], [leftWidth, tipsWidth]);
}

function renderIntro(width: number, theme: Theme): string[] {
	const accent = (text: string) => theme.fg("accent", text);
	return box(
		[
			"",
			`  ${accent(theme.bold("M-PI"))} 是${accent("小明的专属 AI Agent")}。`,
			`  ${theme.fg("muted", theme.italic("帮你规划、检索、编码与自动化，一切都在终端中完成。"))}`,
			"",
		],
		width,
		accent,
	);
}

function sectionBodies(
	data: DashboardData,
	theme: Theme,
	widths: number[],
	columns: number[],
): string[][] {
	const border = (text: string) => theme.fg("borderMuted", text);
	const specs: Array<[string, string, string[], Color]> = [
		["CONTEXT", "▮", data.contexts, (t) => theme.fg("accent", t)],
		["SKILLS", "ϟ", data.skills, (t) => theme.fg("thinkingHigh", t)],
		["EXTENSIONS", "◆", data.extensions, (t) => theme.fg("success", t)],
		["THEMES", "◇", data.themes, (t) => theme.fg("warning", t)],
	];
	return specs.map(([title, marker, items, color], index) =>
		panelBody(
			title,
			marker,
			items,
			(widths[index] ?? widths[0] ?? 20) - 2,
			color,
			border,
			columns[index] ?? 1,
		),
	);
}

function renderWide(
	width: number,
	data: DashboardData,
	theme: Theme,
): string[] {
	const margin = 2;
	const available = width - margin * 2;
	const usable = available - GAP.length * 3;
	const widths = [
		Math.floor(usable * 0.22),
		Math.floor(usable * 0.34),
		Math.floor(usable * 0.28),
	];
	widths.push(usable - widths.reduce((sum, value) => sum + value, 0));
	const border = (text: string) => theme.fg("borderMuted", text);
	const bodies = sectionBodies(data, theme, widths, [1, 2, 2, 1]);
	equalize(bodies);
	const panels = bodies.map((body, index) => box(body, widths[index]!, border));
	return [
		...inset(renderBrand(available, theme), margin),
		"",
		...inset(renderIntro(available, theme), margin),
		"",
		...inset(joinRows(panels, widths), margin),
		"",
	];
}

function renderMedium(
	width: number,
	data: DashboardData,
	theme: Theme,
): string[] {
	const margin = 1;
	const available = width - 2;
	const half = Math.floor((available - GAP.length) / 2);
	const widths = [half, available - GAP.length - half];
	const border = (text: string) => theme.fg("borderMuted", text);
	const bodies = sectionBodies(
		data,
		theme,
		[...widths, ...widths],
		[2, 2, 2, 2],
	);
	equalize(bodies.slice(0, 2));
	equalize(bodies.slice(2, 4));
	const rows = [0, 2].flatMap((start) => [
		...joinRows(
			[
				box(bodies[start]!, widths[0], border),
				box(bodies[start + 1]!, widths[1], border),
			],
			widths,
		),
		"",
	]);
	return inset(
		[
			`${theme.fg("accent", theme.bold("M-PI"))}  ${theme.fg("muted", "小明的专属 AI Agent")}  ${theme.fg("dim", "· BigGoblin/my-pi-toolkit")}`,
			"",
			...renderIntro(available, theme),
			"",
			...rows,
		],
		margin,
	);
}

function renderNarrow(
	width: number,
	data: DashboardData,
	theme: Theme,
): string[] {
	const available = Math.max(4, width);
	const border = (text: string) => theme.fg("borderMuted", text);
	const bodies = sectionBodies(
		data,
		theme,
		[available, available, available, available],
		[2, 2, 2, 2],
	);
	const lines = [
		fit(
			`${theme.fg("accent", theme.bold("M-PI"))} ${theme.fg("muted", "· 小明的专属 AI Agent")}`,
			available,
		),
		"",
	];
	for (const body of bodies) lines.push(...box(body, available, border), "");
	return lines;
}

export function renderDashboard(
	width: number,
	data: DashboardData,
	theme: Theme,
): string[] {
	if (width <= 0) return [];
	if (width < 20) {
		return [
			fit(`${theme.fg("accent", theme.bold("M-PI"))} · AI Toolkit`, width),
		];
	}
	if (width >= 120) return renderWide(width, data, theme);
	if (width >= 80) return renderMedium(width, data, theme);
	return renderNarrow(width, data, theme);
}
