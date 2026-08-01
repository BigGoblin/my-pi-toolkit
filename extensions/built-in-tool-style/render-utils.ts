import * as path from "node:path";
import {
	formatSize,
	keyHint,
	type AgentToolResult,
	type Theme,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { compactText } from "../shared/tui/tool-format.js";
import type { VisualStatus } from "../shared/tui/visual-language.js";

export function displayPath(value: string | undefined, cwd: string): string {
	if (!value?.trim()) return ".";
	const relative = path.isAbsolute(value)
		? path.relative(cwd, value)
		: path.normalize(value);
	return relative && !relative.startsWith("..") ? relative : value;
}

export function textContent(result: AgentToolResult<unknown>): string {
	const parts: string[] = [];
	const content = result.content as Array<{ type: string; text?: string }>;
	for (const item of content) {
		if (item.type === "text" && typeof item.text === "string") {
			parts.push(item.text);
		}
	}
	return parts.join("\n");
}

export function toolStatus(isPartial: boolean, isError: boolean): VisualStatus {
	if (isPartial) return "active";
	return isError ? "error" : "success";
}

export function contentLineCount(value: string): number {
	if (!value) return 0;
	return value.endsWith("\n")
		? Math.max(0, value.split("\n").length - 1)
		: value.split("\n").length;
}

export function contentSummary(value: string): string {
	return `${contentLineCount(value)} lines · ${formatSize(Buffer.byteLength(value))}`;
}

export function errorSummary(value: string): string {
	const line = value
		.split("\n")
		.map((part) => part.trim())
		.find(Boolean);
	return compactText(line || "failed", 100);
}

export function expansionHint(expanded: boolean): string | undefined {
	return expanded ? undefined : keyHint("app.tools.expand", "details");
}

export function truncationSummary(
	truncation: TruncationResult | undefined,
): string | undefined {
	if (!truncation?.truncated) return undefined;
	return `truncated: showing ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)})`;
}

export function tailLines(value: string, maximum: number): string {
	const lines = value.split("\n");
	return lines.slice(Math.max(0, lines.length - maximum)).join("\n");
}

export function colorDiff(diff: string, theme: Theme): string {
	return diff
		.split("\n")
		.map((line) => {
			if (line.startsWith("+")) return theme.fg("toolDiffAdded", line);
			if (line.startsWith("-")) return theme.fg("toolDiffRemoved", line);
			return theme.fg("toolDiffContext", line);
		})
		.join("\n");
}

export function elapsed(startedAt: number, endedAt = Date.now()): string {
	const milliseconds = Math.max(0, endedAt - startedAt);
	if (milliseconds < 1000) return `${milliseconds}ms`;
	return `${(milliseconds / 1000).toFixed(1)}s`;
}
