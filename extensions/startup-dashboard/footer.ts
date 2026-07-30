import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type FooterSnapshot, validNumber } from "./footer-data.js";
import {
	type FooterSegment as Segment,
	runtimeSegments,
} from "./footer-runtime.js";

export { createFooterSnapshot } from "./footer-data.js";
export type { FooterSnapshot } from "./footer-data.js";

function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	const [divisor, suffix] =
		count < 1_000_000 ? ([1_000, "k"] as const) : ([1_000_000, "M"] as const);
	const scaled = count / divisor;
	return `${scaled >= 10 ? Math.round(scaled) : Number(scaled.toFixed(1))}${suffix}`;
}

function joinSegments(segments: Segment[], theme: Theme): string {
	return segments
		.filter((segment) => visibleWidth(segment.content) > 0)
		.map((segment) => segment.content)
		.join(theme.fg("dim", " · "));
}

function align(left: string, right: string, width: number): string {
	if (!left) return truncateToWidth(right, width, "");
	if (!right) return truncateToWidth(left, width, "");
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width, "");
	const availableLeft = width - rightWidth - 2;
	if (availableLeft <= 0) return truncateToWidth(right, width, "");
	const clippedLeft = truncateToWidth(left, availableLeft, "…");
	return `${clippedLeft}${" ".repeat(width - visibleWidth(clippedLeft) - rightWidth)}${right}`;
}

function contextPercent(snapshot: FooterSnapshot): number | undefined {
	const explicit = validNumber(snapshot.contextPercent);
	if (explicit !== undefined) return Math.min(explicit, 100);
	const used = validNumber(snapshot.contextTokens);
	const maximum = validNumber(snapshot.contextWindow);
	if (used === undefined || maximum === undefined || maximum <= 0)
		return undefined;
	return Math.min((used / maximum) * 100, 100);
}

function contextColor(
	percent: number | undefined,
): "success" | "warning" | "error" | "muted" {
	if (percent === undefined) return "muted";
	if (percent >= 95) return "error";
	if (percent >= 70) return "warning";
	return "success";
}

function progressBar(percent: number, width: number): string {
	if (width <= 0) return "";
	const filled = (Math.min(Math.max(percent, 0), 100) / 100) * width;
	const whole = Math.floor(filled);
	const fractions = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
	const fraction =
		whole < width ? fractions[Math.floor((filled - whole) * 8)] : "";
	return `${"█".repeat(whole)}${fraction}${"░".repeat(Math.max(0, width - whole - (fraction ? 1 : 0)))}`;
}

function contextText(
	snapshot: FooterSnapshot,
	theme: Theme,
	barWidth: number,
	percentOnly = false,
): string | undefined {
	const used = validNumber(snapshot.contextTokens);
	const maximum = validNumber(snapshot.contextWindow);
	const percent = contextPercent(snapshot);
	if (used === undefined && maximum === undefined && percent === undefined)
		return undefined;

	const details: string[] = [];
	if (!percentOnly) {
		if (used !== undefined && maximum !== undefined) {
			details.push(`${formatTokens(used)}/${formatTokens(maximum)}`);
		} else if (used !== undefined) {
			details.push(formatTokens(used));
		} else if (maximum !== undefined) {
			details.push(`max ${formatTokens(maximum)}`);
		}
	}
	if (percent !== undefined && barWidth > 0 && !percentOnly) {
		details.push(progressBar(percent, barWidth));
	}
	if (percent !== undefined) details.push(`${percent.toFixed(1)}%`);
	const text = `ctx ${details.join(" ")}`;
	const styled = theme.fg(contextColor(percent), text);
	return percent !== undefined && percent > 90 ? theme.bold(styled) : styled;
}

function identitySegments(snapshot: FooterSnapshot, theme: Theme): Segment[] {
	return [
		snapshot.modeStatus
			? { id: "mode", content: snapshot.modeStatus }
			: undefined,
		snapshot.project
			? {
					id: "project",
					content: `${theme.fg("accent", "◆")} ${theme.bold(theme.fg("text", snapshot.project))}`,
				}
			: undefined,
		snapshot.branch
			? {
					id: "branch",
					content: `${theme.fg("muted", "")} ${theme.fg("muted", snapshot.branch)}`,
				}
			: undefined,
		snapshot.title
			? { id: "title", content: theme.fg("text", snapshot.title) }
			: undefined,
	].filter((segment): segment is Segment => segment !== undefined);
}

function usageSegments(snapshot: FooterSnapshot, theme: Theme): Segment[] {
	const usage = snapshot.usage;
	const cacheParts = [
		usage.cacheRead !== undefined
			? `R${formatTokens(usage.cacheRead)}`
			: undefined,
		usage.cacheWrite !== undefined
			? `W${formatTokens(usage.cacheWrite)}`
			: undefined,
	].filter((part): part is string => part !== undefined);
	return [
		usage.input !== undefined
			? {
					id: "input",
					content: theme.fg("muted", `↑ ${formatTokens(usage.input)}`),
				}
			: undefined,
		usage.output !== undefined
			? {
					id: "output",
					content: theme.fg("muted", `↓ ${formatTokens(usage.output)}`),
				}
			: undefined,
		cacheParts.length > 0
			? {
					id: "cache",
					content: theme.fg("dim", `cache ${cacheParts.join("/")}`),
				}
			: undefined,
	].filter((segment): segment is Segment => segment !== undefined);
}

function costSegment(
	snapshot: FooterSnapshot,
	theme: Theme,
): Segment | undefined {
	return snapshot.usage.cost !== undefined
		? {
				id: "cost",
				content: theme.fg("warning", `$${snapshot.usage.cost.toFixed(2)}`),
			}
		: undefined;
}

function wrapSegments(
	segments: Segment[],
	width: number,
	theme: Theme,
): string[] {
	const lines: string[] = [];
	let current: Segment[] = [];
	for (const segment of segments) {
		const candidate = joinSegments([...current, segment], theme);
		if (current.length > 0 && visibleWidth(candidate) > width) {
			lines.push(truncateToWidth(joinSegments(current, theme), width, "…"));
			current = [segment];
		} else {
			current.push(segment);
		}
	}
	if (current.length > 0) {
		lines.push(truncateToWidth(joinSegments(current, theme), width, "…"));
	}
	return lines;
}

export function renderFooter(
	width: number,
	snapshot: FooterSnapshot,
	theme: Theme,
): string[] {
	if (width <= 0) return [];
	const identity = identitySegments(snapshot, theme);
	const runtime = runtimeSegments(snapshot, theme, width < 100);
	const usage = usageSegments(snapshot, theme);
	const cost = costSegment(snapshot, theme);

	if (width >= 72) {
		const runtimeText = joinSegments(runtime, theme);
		const runtimeWidth = visibleWidth(runtimeText);
		const identityBudget = Math.max(
			0,
			width - runtimeWidth - (runtimeText ? 2 : 0),
		);
		const identityText = truncateToWidth(
			joinSegments(identity, theme),
			identityBudget,
			"…",
		);
		const first = align(identityText, runtimeText, width);

		const usageText = joinSegments(usage, theme);
		const fixedRight = joinSegments(cost ? [cost] : [], theme);
		const availableContext = Math.max(
			0,
			width - visibleWidth(usageText) - visibleWidth(fixedRight) - 8,
		);
		const context = contextText(
			snapshot,
			theme,
			Math.min(12, Math.max(0, availableContext - 18)),
		);
		const resourceRight = joinSegments(
			[cost, context ? { id: "context", content: context } : undefined].filter(
				(segment): segment is Segment => segment !== undefined,
			),
			theme,
		);
		return [first, align(usageText, resourceRight, width)].filter(
			(line) => visibleWidth(line) > 0,
		);
	}

	const context = contextText(snapshot, theme, 0, width < 48);
	const allSegments = [
		...identity,
		...runtime,
		...(context ? [{ id: "context", content: context }] : []),
		...(cost ? [cost] : []),
		...usage,
	];
	return wrapSegments(allSegments, width, theme);
}
