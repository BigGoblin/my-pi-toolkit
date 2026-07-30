import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isFast } from "../cursor-models/fast-state.js";

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
}

export interface UsageTotals {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
}

export interface FooterSnapshot {
	project?: string;
	branch?: string;
	title?: string;
	provider?: string;
	model?: string;
	thinking?: string;
	fast?: boolean;
	modeStatus?: string;
	usage: UsageTotals;
	contextTokens?: number;
	contextWindow?: number;
	contextPercent?: number;
}

export function validNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

function validText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	return text && text.toLowerCase() !== "untitled" ? text : undefined;
}

function addMetric(
	totals: UsageTotals,
	key: keyof UsageTotals,
	value: unknown,
): void {
	const amount = validNumber(value);
	if (amount === undefined) return;
	totals[key] = (totals[key] ?? 0) + amount;
}

function addUsage(totals: UsageTotals, usage: UsageLike | undefined): void {
	if (!usage) return;
	addMetric(totals, "input", usage.input);
	addMetric(totals, "output", usage.output);
	addMetric(totals, "cacheRead", usage.cacheRead);
	addMetric(totals, "cacheWrite", usage.cacheWrite);
	addMetric(totals, "cost", usage.cost?.total);
}

function collectUsage(ctx: ExtensionContext): UsageTotals {
	const totals: UsageTotals = {};
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
	title?: string,
	modeStatus?: string,
): FooterSnapshot {
	const context = ctx.getContextUsage();
	const provider = validText(ctx.model?.provider);
	return {
		project: validText(basename(ctx.cwd)),
		branch: validText(branch),
		title: validText(title),
		provider,
		model: validText(ctx.model?.id),
		thinking: validText(ctx.thinkingLevel),
		fast: provider === "cursor-agent" ? isFast() : undefined,
		modeStatus,
		usage: collectUsage(ctx),
		contextTokens: validNumber(context?.tokens),
		contextWindow: validNumber(
			context?.contextWindow ?? ctx.model?.contextWindow,
		),
		contextPercent: validNumber(context?.percent),
	};
}
