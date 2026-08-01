import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const BUILTIN_TOOL_NAMES = [
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
] as const;

export const READ_ONLY_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
export type BuiltinToolStyle = "native" | "grok" | BuiltinToolName[];
export const DEFAULT_BUILTIN_TOOL_STYLE: BuiltinToolStyle = "grok";

export interface BuiltinToolStyleConfig {
	builtinToolStyle?: BuiltinToolStyle;
}

export interface ResolvedBuiltinToolStyle {
	style: BuiltinToolStyle;
	enabledTools: BuiltinToolName[];
	configPath: string;
}

function isToolName(value: unknown): value is BuiltinToolName {
	return (
		typeof value === "string" &&
		BUILTIN_TOOL_NAMES.includes(value as BuiltinToolName)
	);
}

function parseStyle(value: unknown, configPath: string): BuiltinToolStyle {
	if (value === undefined || value === "native" || value === "grok") {
		return value ?? DEFAULT_BUILTIN_TOOL_STYLE;
	}
	if (Array.isArray(value) && value.every(isToolName)) {
		return Array.from(new Set(value));
	}
	throw new Error(
		`builtinToolStyle 必须是 native、grok 或工具名称数组: ${configPath}`,
	);
}

function readConfigObject(configPath: string): Record<string, unknown> {
	// pi-lens-ignore: ts-path-traversal
	if (!fs.existsSync(configPath)) return {};
	try {
		// pi-lens-ignore: ts-path-traversal
		const value: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("配置根节点必须是 JSON 对象");
		}
		return value as Record<string, unknown>;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`无法解析 ${configPath}: ${message}`);
	}
}

export function builtinToolStyleConfigPath(): string {
	// pi-lens-ignore: ts-path-traversal
	return path.join(getAgentDir(), "ming-core.json");
}

export function resolveBuiltinToolStyle(): ResolvedBuiltinToolStyle {
	const configPath = builtinToolStyleConfigPath();
	const config = readConfigObject(configPath);
	const style = parseStyle(config.builtinToolStyle, configPath);
	let enabledTools: BuiltinToolName[];
	if (style === "native") enabledTools = [];
	else if (style === "grok") enabledTools = [...BUILTIN_TOOL_NAMES];
	else enabledTools = style;
	return { style, enabledTools, configPath };
}

export function writeBuiltinToolStyle(style: BuiltinToolStyle): string {
	const configPath = builtinToolStyleConfigPath();
	const config = readConfigObject(configPath);
	config.builtinToolStyle = style;
	// pi-lens-ignore: ts-path-traversal
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	// pi-lens-ignore: ts-path-traversal
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	return configPath;
}
