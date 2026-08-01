import { truncateToWidth } from "@earendil-works/pi-tui";
import { fit, type Color } from "./tui-utils.js";

function itemRows(
	items: string[],
	width: number,
	columns: number,
	color: Color,
): string[] {
	if (items.length === 0) return [`${color("  ○ ")}${color("none")}`];
	if (columns === 1) {
		return items.map(
			(item) => `${color("  › ")}${truncateToWidth(item, width - 4, "…")}`,
		);
	}

	const columnWidth = Math.floor((width - 1) / columns);
	const rows = Math.ceil(items.length / columns);
	const result: string[] = [];
	for (let row = 0; row < rows; row += 1) {
		const cells: string[] = [];
		for (let column = 0; column < columns; column += 1) {
			const item = items[row + column * rows];
			cells.push(
				item
					? `${color(" › ")}${truncateToWidth(item, columnWidth - 3, "…")}`
					: "",
			);
		}
		result.push(cells.map((cell) => fit(cell, columnWidth)).join(" "));
	}
	return result;
}

export function panelBody(
	title: string,
	items: string[],
	width: number,
	color: Color,
	borderMuted: Color,
	columns = 1,
): string[] {
	return [
		color(title),
		borderMuted("─".repeat(Math.max(1, width))),
		...itemRows(items, width, columns, color),
	];
}

export function equalize(groups: string[][]): void {
	const height = Math.max(...groups.map((group) => group.length));
	for (const group of groups) while (group.length < height) group.push("");
}
