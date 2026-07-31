import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SubagentPresentation } from "../shared/subagent/config.js";

export interface RepoSearchSubagentConfig {
	model?: string;
	presentation?: SubagentPresentation;
}

export interface ResolvedRepoSearchConfig {
	model: string;
	source: "project" | "user" | "current";
	configPath?: string;
	presentation?: SubagentPresentation;
}

function readConfig(filePath: string): RepoSearchSubagentConfig | undefined {
	if (!fs.existsSync(filePath)) return undefined;

	let value: unknown;
	try {
		value = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`无法解析 Repo Search 子 Agent 配置 ${filePath}: ${message}`,
		);
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Repo Search 子 Agent 配置必须是 JSON 对象: ${filePath}`);
	}

	const input = value as { model?: unknown; presentation?: unknown };
	const model = input.model;
	if (
		model !== undefined &&
		(typeof model !== "string" || model.trim() === "")
	) {
		throw new Error(
			`Repo Search 子 Agent 配置的 model 必须是非空字符串: ${filePath}`,
		);
	}

	const presentation = input.presentation;
	if (
		presentation !== undefined &&
		!["manual", "auto", "inline", "split", "tab"].includes(String(presentation))
	)
		throw new Error(
			`Repo Search 子 Agent 配置的 presentation 无效: ${filePath}`,
		);
	return {
		model: typeof model === "string" ? model.trim() : undefined,
		presentation: presentation as SubagentPresentation | undefined,
	};
}

export function userConfigPath(): string {
	return path.join(getAgentDir(), "repo-search-subagent.json");
}

export function projectConfigPath(cwd: string): string {
	let current = path.resolve(cwd);
	while (true) {
		const candidate = path.join(
			current,
			CONFIG_DIR_NAME,
			"repo-search-subagent.json",
		);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current)
			return path.join(cwd, CONFIG_DIR_NAME, "repo-search-subagent.json");
		current = parent;
	}
}

export function resolveRepoSearchConfig(
	cwd: string,
	projectTrusted: boolean,
	currentModel: { provider: string; id: string } | undefined,
): ResolvedRepoSearchConfig {
	const projectPath = projectConfigPath(cwd);
	const projectConfig = projectTrusted ? readConfig(projectPath) : undefined;
	const userPath = userConfigPath();
	const userConfig = readConfig(userPath);
	const presentation = projectConfig?.presentation ?? userConfig?.presentation;
	if (projectConfig?.model)
		return {
			model: projectConfig.model,
			source: "project",
			configPath: projectPath,
			presentation,
		};
	if (userConfig?.model)
		return {
			model: userConfig.model,
			source: "user",
			configPath: userPath,
			presentation,
		};
	if (!currentModel) {
		throw new Error(
			`未配置 Repo Search 子 Agent 模型，且主 Agent 当前没有可继承的模型。请在 ${userPath} 中配置 { "model": "provider/model-id" }。`,
		);
	}

	return {
		model: `${currentModel.provider}/${currentModel.id}`,
		source: "current",
		presentation,
	};
}
