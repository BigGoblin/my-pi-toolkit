import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	secondaryLine,
	statusGlyph,
	timelineLine,
	type VisualStatus,
} from "./visual-language.js";

export interface ToolResultView {
	status: VisualStatus;
	title: string;
	summary?: string;
	details?: string[];
	body?: string;
	hint?: string;
}

export function toolCall(
	theme: Theme,
	title: string,
	summary?: string,
	detail?: string,
): Text {
	const heading = `${statusGlyph(theme, "active")} ${theme.fg("toolTitle", theme.bold(title))}`;
	const suffix = summary ? ` ${theme.fg("muted", summary)}` : "";
	const lines = [`${heading}${suffix}`];
	if (detail) lines.push(secondaryLine(theme, detail));
	return new Text(lines.join("\n"), 0, 0);
}

export function toolHeader(theme: Theme, view: ToolResultView): string {
	const summary = view.summary ? ` ${theme.fg("muted", view.summary)}` : "";
	return `${statusGlyph(theme, view.status)} ${theme.fg("toolTitle", theme.bold(view.title))}${summary}`;
}

export function toolResult(theme: Theme, view: ToolResultView): Text {
	const lines = [toolHeader(theme, view)];
	for (const detail of view.details ?? [])
		lines.push(secondaryLine(theme, detail));
	if (view.body) {
		lines.push(timelineLine(theme));
		lines.push(
			...view.body.split("\n").map((line) => `${timelineLine(theme)} ${line}`),
		);
	}
	if (view.hint) lines.push(secondaryLine(theme, view.hint));
	return new Text(lines.join("\n"), 0, 0);
}
