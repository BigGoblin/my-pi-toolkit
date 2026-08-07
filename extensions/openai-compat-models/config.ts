import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const OPENAI_APIS = new Set([
	"openai-completions",
	"openai-responses",
]);

export interface ModelDefaults {
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	thinkingLevelMap?: ProviderModelConfig["thinkingLevelMap"];
	compat?: ProviderModelConfig["compat"];
}

export interface DiscoverableProvider {
	id: string;
	name?: string;
	baseUrl: string;
	apiKey: string;
	api: "openai-completions" | "openai-responses";
	headers?: Record<string, string>;
	authHeader?: boolean;
	modelDefaults?: ModelDefaults;
}

interface RawProvider {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	models?: unknown[];
	modelDefaults?: ModelDefaults;
}

interface ModelsFile {
	providers?: Record<string, RawProvider>;
}

function modelsJsonPath(): string {
	return join(getAgentDir(), "models.json");
}

export function loadDiscoverableProviders(): DiscoverableProvider[] {
	const path = modelsJsonPath();
	if (!existsSync(path)) return [];

	let parsed: ModelsFile;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8")) as ModelsFile;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		console.warn(`[openai-compat-models] 无法解析 ${path}: ${detail}`);
		return [];
	}

	const providers = parsed.providers;
	if (!providers || typeof providers !== "object") return [];

	const result: DiscoverableProvider[] = [];
	for (const [id, entry] of Object.entries(providers)) {
		if (!entry || typeof entry !== "object") continue;
		if (Array.isArray(entry.models) && entry.models.length > 0) continue;

		const baseUrl = entry.baseUrl?.trim();
		const apiKey = entry.apiKey?.trim();
		if (!baseUrl || !apiKey) continue;

		const apiRaw = entry.api?.trim() || "openai-completions";
		if (!OPENAI_APIS.has(apiRaw)) continue;

		result.push({
			id,
			name: entry.name?.trim() || undefined,
			baseUrl,
			apiKey,
			api: apiRaw as DiscoverableProvider["api"],
			headers: entry.headers,
			authHeader: entry.authHeader,
			modelDefaults: entry.modelDefaults,
		});
	}
	return result;
}

/** Resolve literal or `$ENV` / `${ENV}` apiKey for the discovery request. */
export function resolveApiKey(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const braced = trimmed.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
	if (braced) {
		const env = process.env[braced[1]]?.trim();
		return env || undefined;
	}

	const plain = trimmed.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
	if (plain) {
		const env = process.env[plain[1]]?.trim();
		return env || undefined;
	}

	return trimmed;
}
