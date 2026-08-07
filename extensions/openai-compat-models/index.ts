/**
 * 对 models.json 中未手写 models 的 OpenAI 兼容 provider，注册 refreshModels：
 * 启动不联网；/model 刷新时再拉取 /models。
 */
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import {
	loadDiscoverableProviders,
	resolveApiKey,
	type DiscoverableProvider,
} from "./config.js";
import { fetchOpenAiModels } from "./fetch-models.js";
import { mapRemoteModels } from "./map-model.js";

function storedToConfigs(
	context: RefreshModelsContext,
	providerId: string,
): ProviderModelConfig[] {
	const stored = context.stored?.models;
	if (!stored?.length) return [];
	return stored
		.filter((model) => model.provider === providerId)
		.map((model) => {
			const config: ProviderModelConfig = {
				id: model.id,
				name: model.name,
				reasoning: model.reasoning,
				input: [...model.input] as ("text" | "image")[],
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
			};
			if (model.thinkingLevelMap) {
				config.thinkingLevelMap = model.thinkingLevelMap;
			}
			if (model.compat) {
				config.compat = model.compat;
			}
			return config;
		});
}

function registerOne(pi: ExtensionAPI, entry: DiscoverableProvider): void {
	pi.registerProvider(entry.id, {
		name: entry.name,
		baseUrl: entry.baseUrl,
		apiKey: entry.apiKey,
		api: entry.api,
		headers: entry.headers,
		authHeader: entry.authHeader,
		models: [],
		async refreshModels(context: RefreshModelsContext) {
			if (!context.allowNetwork) {
				return storedToConfigs(context, entry.id);
			}

			const resolvedKey = resolveApiKey(entry.apiKey);
			if (!resolvedKey) {
				throw new Error(`${entry.id}: 无法解析 apiKey（检查环境变量）`);
			}

			const remote = await fetchOpenAiModels(
				entry.baseUrl,
				resolvedKey,
				context.signal,
			);
			if (context.signal.aborted) return storedToConfigs(context, entry.id);

			const mapped = mapRemoteModels(remote, entry.modelDefaults);
			const persistModels = mapped.map((model) => ({
				...model,
				provider: entry.id,
				api: entry.api,
				baseUrl: entry.baseUrl,
			}));

			await context.publish({
				persist: {
					models: persistModels,
					checkedAt: Date.now(),
				},
			});

			return mapped;
		},
	});
}

export default function openaiCompatModels(pi: ExtensionAPI): void {
	for (const entry of loadDiscoverableProviders()) {
		registerOne(pi, entry);
	}
}
