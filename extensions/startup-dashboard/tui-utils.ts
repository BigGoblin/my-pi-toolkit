import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const GAP = "  ";
export type Color = (text: string) => string;

export function fit(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(text, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export function inset(lines: string[], margin: number): string[] {
	const prefix = " ".repeat(margin);
	return lines.map((line) => prefix + line);
}

export function box(lines: string[], width: number, border: Color): string[] {
	if (width < 4) return lines.map((line) => fit(line, width));
	const inner = width - 2;
	return [
		border(`╭${"─".repeat(inner)}╮`),
		...lines.map((line) => `${border("│")}${fit(line, inner)}${border("│")}`),
		border(`╰${"─".repeat(inner)}╯`),
	];
}

export function joinRows(columns: string[][], widths: number[]): string[] {
	const height = Math.max(...columns.map((column) => column.length));
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			columns
				.map((column, i) => fit(column[row] ?? "", widths[i] ?? 0))
				.join(GAP),
		);
	}
	return rows;
}
