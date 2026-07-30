import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FooterSnapshot } from "./footer-data.js";

export interface FooterSegment {
	id: string;
	content: string;
}

function thinkingText(level: string, theme: Theme, compact = false): string {
	const text = compact ? level : `think:${level}`;
	switch (level) {
		case "off":
			return theme.fg("thinkingOff", text);
		case "minimal":
			return theme.fg("thinkingMinimal", text);
		case "low":
			return theme.fg("thinkingLow", text);
		case "medium":
			return theme.fg("thinkingMedium", text);
		case "high":
			return theme.fg("thinkingHigh", text);
		case "xhigh":
			return theme.fg("thinkingXhigh", text);
		case "max":
			return theme.fg("thinkingMax", text);
		default:
			return theme.fg("muted", text);
	}
}

function modelText(snapshot: FooterSnapshot, theme: Theme): string | undefined {
	const provider = snapshot.provider
		? theme.fg("dim", snapshot.provider)
		: undefined;
	const model = snapshot.model
		? theme.bold(theme.fg("accent", snapshot.model))
		: undefined;
	if (provider && model) return `${provider}${theme.fg("dim", "/")}${model}`;
	return provider ?? model;
}

function fastSegment(
	snapshot: FooterSnapshot,
	theme: Theme,
	compact: boolean,
): FooterSegment | undefined {
	if (snapshot.fast === undefined) return undefined;
	if (!snapshot.fast) {
		return { id: "fast", content: theme.fg("dim", "fast:off") };
	}
	return {
		id: "fast",
		content: theme.fg("success", compact ? "⚡" : "⚡ fast"),
	};
}

export function runtimeSegments(
	snapshot: FooterSnapshot,
	theme: Theme,
	compact = false,
): FooterSegment[] {
	const model = modelText(snapshot, theme);
	return [
		model ? { id: "model", content: model } : undefined,
		snapshot.thinking
			? {
					id: "thinking",
					content: thinkingText(snapshot.thinking, theme, compact),
				}
			: undefined,
		fastSegment(snapshot, theme, compact),
	].filter((segment): segment is FooterSegment => segment !== undefined);
}
