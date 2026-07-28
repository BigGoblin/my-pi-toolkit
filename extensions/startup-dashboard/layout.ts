import { VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { DashboardData } from "./discovery.js";
import { box, fit, GAP, inset, joinRows, type Color } from "./tui-utils.js";

function itemRows(
	items: string[],
	width: number,
	columns: number,
	color: Color,
): string[] {
	if (items.length === 0) return [`${color("  · ")}(none)`];
	if (columns === 1)
		return items.map(
			(item) => `${color("  · ")}${truncateToWidth(item, width - 4, "…")}`,
		);

	const columnWidth = Math.floor((width - 1) / columns);
	const rows = Math.ceil(items.length / columns);
	const result: string[] = [];
	for (let row = 0; row < rows; row += 1) {
		const cells: string[] = [];
		for (let column = 0; column < columns; column += 1) {
			const item = items[row + column * rows];
			cells.push(
				item
					? `${color(" · ")}${truncateToWidth(item, columnWidth - 3, "…")}`
					: "",
			);
		}
		result.push(cells.map((cell) => fit(cell, columnWidth)).join(" "));
	}
	return result;
}

function panelBody(
	title: string,
	marker: string,
	items: string[],
	innerWidth: number,
	color: Color,
	borderMuted: Color,
	columns = 1,
): string[] {
	return [
		"",
		`  ${color(marker)} ${color(title)}`,
		`  ${borderMuted("─".repeat(Math.max(1, innerWidth - 4)))}`,
		"",
		...itemRows(items, innerWidth - 2, columns, color),
		"",
	];
}

function equalize(groups: string[][]): void {
	const height = Math.max(...groups.map((group) => group.length));
	for (const group of groups) while (group.length < height) group.push("");
}

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

function renderWide(
	width: number,
	data: DashboardData,
	theme: Theme,
): string[] {
	const margin = 2;
	const available = width - margin * 2;
	const first = Math.floor((available - GAP.length * 2) * 0.28);
	const second = Math.floor((available - GAP.length * 2) * 0.33);
	const widths = [first, second, available - GAP.length * 2 - first - second];
	const colors = {
		context: (text: string) => theme.fg("accent", text),
		skills: (text: string) => theme.fg("thinkingHigh", text),
		extensions: (text: string) => theme.fg("success", text),
		border: (text: string) => theme.fg("borderMuted", text),
	};
	const bodies = [
		panelBody(
			"CONTEXT",
			"▮",
			data.contexts,
			widths[0] - 2,
			colors.context,
			colors.border,
		),
		panelBody(
			"SKILLS",
			"ϟ",
			data.skills,
			widths[1] - 2,
			colors.skills,
			colors.border,
		),
		panelBody(
			"EXTENSIONS",
			"◆",
			data.extensions,
			widths[2] - 2,
			colors.extensions,
			colors.border,
			2,
		),
	];
	equalize(bodies);
	const panels = bodies.map((body, i) => box(body, widths[i], colors.border));
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
	const context = panelBody(
		"CONTEXT",
		"▮",
		data.contexts,
		available - 2,
		(t) => theme.fg("accent", t),
		border,
		2,
	);
	const skills = panelBody(
		"SKILLS",
		"ϟ",
		data.skills,
		widths[0] - 2,
		(t) => theme.fg("thinkingHigh", t),
		border,
	);
	const extensions = panelBody(
		"EXTENSIONS",
		"◆",
		data.extensions,
		widths[1] - 2,
		(t) => theme.fg("success", t),
		border,
	);
	equalize([skills, extensions]);
	return inset(
		[
			`${theme.fg("accent", theme.bold("M-PI"))}  ${theme.fg("muted", "小明的专属 AI Agent")}  ${theme.fg("dim", "· BigGoblin/my-pi-toolkit")}`,
			"",
			...renderIntro(available, theme),
			"",
			...box(context, available, border),
			"",
			...joinRows(
				[box(skills, widths[0], border), box(extensions, widths[1], border)],
				widths,
			),
			"",
		],
		margin,
	);
}

function compactItems(items: string[]): string[] {
	const limit = 4;
	const shown = items.slice(0, limit);
	return items.length > limit
		? [...shown, `+${items.length - limit} more`]
		: shown;
}

function renderNarrow(
	width: number,
	data: DashboardData,
	theme: Theme,
): string[] {
	const available = Math.max(4, width);
	const border = (text: string) => theme.fg("borderMuted", text);
	const specs: Array<[string, string, string[], Color]> = [
		["CONTEXT", "▮", data.contexts, (t) => theme.fg("accent", t)],
		[
			"SKILLS",
			"ϟ",
			compactItems(data.skills),
			(t) => theme.fg("thinkingHigh", t),
		],
		[
			"EXTENSIONS",
			"◆",
			compactItems(data.extensions),
			(t) => theme.fg("success", t),
		],
	];
	const lines = [
		fit(
			`${theme.fg("accent", theme.bold("M-PI"))} ${theme.fg("muted", "· 小明的专属 AI Agent")}`,
			available,
		),
		"",
	];
	for (const [title, marker, items, color] of specs) {
		lines.push(
			...box(
				panelBody(title, marker, items, available - 2, color, border, 2),
				available,
				border,
			),
			"",
		);
	}
	return lines;
}

export function renderDashboard(
	width: number,
	data: DashboardData,
	theme: Theme,
): string[] {
	if (width <= 0) return [];
	if (width < 20)
		return [
			fit(`${theme.fg("accent", theme.bold("M-PI"))} · AI Toolkit`, width),
		];
	if (width >= 120) return renderWide(width, data, theme);
	if (width >= 80) return renderMedium(width, data, theme);
	return renderNarrow(width, data, theme);
}
