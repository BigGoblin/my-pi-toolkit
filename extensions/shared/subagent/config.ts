import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type SubagentPresentation =
	| "manual"
	| "auto"
	| "inline"
	| "split"
	| "tab";

export interface SubagentUiConfig {
	presentation: SubagentPresentation;
	fallback: "inline" | "error";
	keepOpen: boolean;
	retainCompletedMinutes: number;
	windowsTerminal: { size: number; shell: string };
}

const DEFAULT_CONFIG: SubagentUiConfig = {
	presentation: "manual",
	fallback: "inline",
	keepOpen: true,
	retainCompletedMinutes: 60,
	windowsTerminal: { size: 0.45, shell: "pwsh.exe" },
};

function isPresentation(value: unknown): value is SubagentPresentation {
	return ["manual", "auto", "inline", "split", "tab"].includes(String(value));
}

function readRawConfig(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("配置必须是 JSON 对象");
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`无法解析子 Agent UI 配置 ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function resolveConfiguredPresentation(
	raw: Record<string, unknown>,
	override?: SubagentPresentation,
): SubagentPresentation {
	const value = override ?? raw.presentation ?? DEFAULT_CONFIG.presentation;
	if (isPresentation(value)) return value;
	throw new Error(
		"子 Agent presentation 必须是 manual、auto、inline、split 或 tab",
	);
}

function resolveTerminalConfig(raw: Record<string, unknown>): {
	size: number;
	shell: string;
} {
	const value =
		raw.windowsTerminal && typeof raw.windowsTerminal === "object"
			? (raw.windowsTerminal as Record<string, unknown>)
			: {};
	const size = typeof value.size === "number" ? value.size : 0.45;
	const shell =
		typeof value.shell === "string" && value.shell.trim()
			? value.shell.trim()
			: DEFAULT_CONFIG.windowsTerminal.shell;
	return { size: Math.min(0.8, Math.max(0.2, size)), shell };
}

export function loadSubagentUiConfig(
	override?: SubagentPresentation,
): SubagentUiConfig {
	const raw = readRawConfig(join(getAgentDir(), "subagents.json"));
	const retain = raw.retainCompletedMinutes;
	return {
		presentation: resolveConfiguredPresentation(raw, override),
		fallback: raw.fallback === "error" ? "error" : "inline",
		keepOpen:
			typeof raw.keepOpen === "boolean"
				? raw.keepOpen
				: DEFAULT_CONFIG.keepOpen,
		retainCompletedMinutes:
			typeof retain === "number" && retain >= 1
				? retain
				: DEFAULT_CONFIG.retainCompletedMinutes,
		windowsTerminal: resolveTerminalConfig(raw),
	};
}

export function resolvePresentation(
	config: SubagentUiConfig,
): "manual" | "inline" | "split" | "tab" {
	if (config.presentation !== "auto") return config.presentation;
	return process.platform === "win32" && process.env.WT_SESSION
		? "split"
		: "inline";
}
