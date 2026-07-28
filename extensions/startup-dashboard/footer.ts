import { basename } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isFast } from "../cursor-models/fast-state.js";

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface FooterSnapshot {
	project: string;
	branch?: string;
	provider: string;
	model: string;
	thinking: string;
	fast?: boolean;
	usage: UsageTotals;
	contextTokens: number | null;
	contextWindow: number;
	contextPercent: number | null;
}

function addUsage(totals: UsageTotals, usage: UsageLike | undefined): void {
	if (!usage) return;
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

function collectUsage(ctx: ExtensionContext): UsageTotals {
	const totals: UsageTotals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "assistant" || message.role === "toolResult") {
				addUsage(totals, message.usage);
			}
		} else if (entry.type === "branch_summary" || entry.type === "compaction") {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

export function createFooterSnapshot(
	ctx: ExtensionContext,
	branch?: string | null,
): FooterSnapshot {
	const context = ctx.getContextUsage();
	const provider = ctx.model?.provider ?? "no-provider";
	return {
		project: basename(ctx.cwd) || ctx.cwd,
		branch: branch ?? undefined,
		provider,
		model: ctx.model?.id ?? "no-model",
		thinking: ctx.thinkingLevel ?? "off",
		fast: provider === "cursor-agent" ? isFast() : undefined,
		usage: collectUsage(ctx),
		contextTokens: context?.tokens ?? null,
		contextWindow: context?.contextWindow ?? ctx.model?.contextWindow ?? 0,
		contextPercent: context?.percent ?? null,
	};
}

function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function align(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width, "");
	const availableLeft = width - rightWidth - 2;
	const clippedLeft = truncateToWidth(left, availableLeft, "…");
	return (
		clippedLeft +
		" ".repeat(width - visibleWidth(clippedLeft) - rightWidth) +
		right
	);
}

function thinkingText(level: string, theme: Theme): string {
	const text = ` · Think:${level}`;
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

function contextText(snapshot: FooterSnapshot, theme: Theme): string {
	const current =
		snapshot.contextTokens === null
			? "?"
			: formatTokens(snapshot.contextTokens);
	const maximum = formatTokens(snapshot.contextWindow);
	const percent =
		snapshot.contextPercent === null
			? "?"
			: `${snapshot.contextPercent.toFixed(1)}%`;
	const text = `Context ${current}/${maximum} (${percent})`;
	if ((snapshot.contextPercent ?? 0) > 90) return theme.fg("error", text);
	if ((snapshot.contextPercent ?? 0) > 70) return theme.fg("warning", text);
	return theme.fg("muted", text);
}

export function renderFooter(
	width: number,
	snapshot: FooterSnapshot,
	theme: Theme,
): string[] {
	if (width <= 0) return [];
	const rule = theme.fg("borderMuted", "─".repeat(width));
	const branch = snapshot.branch
		? ` ${theme.fg("dim", "· Branch")} ${theme.fg("muted", snapshot.branch)}`
		: "";
	const project = `${theme.fg("accent", "◆")} ${theme.fg("dim", "Project")} ${theme.fg("text", snapshot.project)}${branch}`;
	let fast = "";
	if (snapshot.fast !== undefined) {
		const fastText = `Fast:${snapshot.fast ? "ON" : "OFF"}`;
		fast = ` · ${theme.fg(snapshot.fast ? "success" : "dim", fastText)}`;
	}
	const modelName = theme.bold(
		theme.fg("accent", `${snapshot.provider}/${snapshot.model}`),
	);
	const model = `${modelName}${thinkingText(snapshot.thinking, theme)}${fast}`;
	const usage = snapshot.usage;
	const tokens = theme.fg(
		"dim",
		`↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)} Cache R${formatTokens(usage.cacheRead)} W${formatTokens(usage.cacheWrite)} $${usage.cost.toFixed(3)}`,
	);
	const context = contextText(snapshot, theme);

	if (width >= 100)
		return [rule, align(project, model, width), align(tokens, context, width)];
	return [
		rule,
		truncateToWidth(project, width, ""),
		truncateToWidth(model, width, ""),
		truncateToWidth(tokens, width, ""),
		truncateToWidth(context, width, ""),
	];
}
