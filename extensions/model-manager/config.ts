import * as fs from "node:fs";
import * as path from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

const THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

interface NewConversationConfig {
	enabled?: boolean;
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

interface ModelManagerConfig {
	newConversation?: NewConversationConfig;
}

export interface ResolvedNewConversationConfig {
	enabled: boolean;
	provider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	source: "none" | "user" | "project";
	configPaths: string[];
}

function readJsonObject(filePath: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`无法解析模型管理配置 ${filePath}: ${message}`);
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`模型管理配置必须是 JSON 对象: ${filePath}`);
	}
	return value as Record<string, unknown>;
}

function optionalBoolean(
	value: unknown,
	filePath: string,
): boolean | undefined {
	if (value === undefined || typeof value === "boolean") return value;
	throw new Error(`newConversation.enabled 必须是布尔值: ${filePath}`);
}

function optionalModel(value: unknown, filePath: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && value.trim() !== "") return value.trim();
	throw new Error(`newConversation.model 必须是非空字符串: ${filePath}`);
}

function optionalThinkingLevel(
	value: unknown,
	filePath: string,
): ThinkingLevel | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value === "string" &&
		THINKING_LEVELS.has(value as ThinkingLevel)
	) {
		return value as ThinkingLevel;
	}
	throw new Error(
		`newConversation.thinkingLevel 必须是 off、minimal、low、medium、high、xhigh 或 max: ${filePath}`,
	);
}

function parseConfig(filePath: string): ModelManagerConfig | undefined {
	if (!fs.existsSync(filePath)) return undefined;

	const value = readJsonObject(filePath);
	const section = value.newConversation;
	if (section === undefined) return {};
	if (!section || typeof section !== "object" || Array.isArray(section)) {
		throw new Error(`newConversation 必须是 JSON 对象: ${filePath}`);
	}

	const input = section as Record<string, unknown>;
	return {
		newConversation: {
			enabled: optionalBoolean(input.enabled, filePath),
			model: optionalModel(input.model, filePath),
			thinkingLevel: optionalThinkingLevel(input.thinkingLevel, filePath),
		},
	};
}

function splitModel(value: string, filePath: string): [string, string] {
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) {
		throw new Error(
			`newConversation.model 必须使用 provider/model-id 格式: ${filePath}`,
		);
	}
	return [value.slice(0, separator), value.slice(separator + 1)];
}

export function userConfigPath(): string {
	return path.join(getAgentDir(), "model-manager.json");
}

export function projectConfigPath(cwd: string): string {
	return path.join(cwd, CONFIG_DIR_NAME, "model-manager.json");
}

export function resolveNewConversationConfig(
	cwd: string,
	projectTrusted: boolean,
): ResolvedNewConversationConfig {
	const userPath = userConfigPath();
	const projectPath = projectConfigPath(cwd);
	const userConfig = parseConfig(userPath);
	const projectConfig = projectTrusted ? parseConfig(projectPath) : undefined;
	const configPaths = [
		...(userConfig ? [userPath] : []),
		...(projectConfig ? [projectPath] : []),
	];
	const merged = {
		...userConfig?.newConversation,
		...projectConfig?.newConversation,
	};

	if (configPaths.length === 0 || Object.keys(merged).length === 0) {
		return { enabled: false, source: "none", configPaths };
	}

	const enabled = merged.enabled ?? true;
	if (!merged.model) {
		if (!enabled) {
			return {
				enabled: false,
				thinkingLevel: merged.thinkingLevel,
				source: projectConfig ? "project" : "user",
				configPaths,
			};
		}
		const sourcePath = projectConfig ? projectPath : userPath;
		throw new Error(`newConversation.model 未配置: ${sourcePath}`);
	}

	const sourcePath = projectConfig?.newConversation?.model
		? projectPath
		: userPath;
	const [provider, modelId] = splitModel(merged.model, sourcePath);
	return {
		enabled,
		provider,
		modelId,
		thinkingLevel: merged.thinkingLevel,
		source: projectConfig ? "project" : "user",
		configPaths,
	};
}
