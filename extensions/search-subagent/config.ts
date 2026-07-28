import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SearchSubagentConfig {
	model?: string;
}

export interface ResolvedSearchConfig {
	model: string;
	source: "project" | "user" | "current";
	configPath?: string;
}

function readConfig(filePath: string): SearchSubagentConfig | undefined {
	if (!fs.existsSync(filePath)) return undefined;

	let value: unknown;
	try {
		value = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`无法解析 Search 子 Agent 配置 ${filePath}: ${message}`);
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Search 子 Agent 配置必须是 JSON 对象: ${filePath}`);
	}

	const model = (value as { model?: unknown }).model;
	if (
		model !== undefined &&
		(typeof model !== "string" || model.trim() === "")
	) {
		throw new Error(
			`Search 子 Agent 配置的 model 必须是非空字符串: ${filePath}`,
		);
	}

	return { model: typeof model === "string" ? model.trim() : undefined };
}

export function userConfigPath(): string {
	return path.join(getAgentDir(), "search-subagent.json");
}

export function projectConfigPath(cwd: string): string {
	let current = path.resolve(cwd);
	while (true) {
		const candidate = path.join(
			current,
			CONFIG_DIR_NAME,
			"search-subagent.json",
		);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current)
			return path.join(cwd, CONFIG_DIR_NAME, "search-subagent.json");
		current = parent;
	}
}

export function resolveSearchConfig(
	cwd: string,
	projectTrusted: boolean,
	currentModel: { provider: string; id: string } | undefined,
): ResolvedSearchConfig {
	const projectPath = projectConfigPath(cwd);
	if (projectTrusted) {
		const projectConfig = readConfig(projectPath);
		if (projectConfig?.model) {
			return {
				model: projectConfig.model,
				source: "project",
				configPath: projectPath,
			};
		}
	}

	const userPath = userConfigPath();
	const userConfig = readConfig(userPath);
	if (userConfig?.model) {
		return { model: userConfig.model, source: "user", configPath: userPath };
	}

	if (!currentModel) {
		throw new Error(
			`未配置 Search 子 Agent 模型，且主 Agent 当前没有可继承的模型。请在 ${userPath} 中配置 { "model": "provider/model-id" }。`,
		);
	}

	return {
		model: `${currentModel.provider}/${currentModel.id}`,
		source: "current",
	};
}
