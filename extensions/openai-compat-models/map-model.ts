import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { ModelDefaults } from "./config.js";
import type { RemoteModel } from "./fetch-models.js";

const ZERO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
} as const;

/** Common reasoning-capable model id fragments when modelDefaults.reasoning is unset. */
const REASONING_ID_RE =
	/(?:^|[/_.-])(?:gpt-5|o1|o3|o4)(?:$|[/_.-])|reason|thinking/i;

function inferReasoning(modelId: string, defaults?: ModelDefaults): boolean {
	if (typeof defaults?.reasoning === "boolean") return defaults.reasoning;
	return REASONING_ID_RE.test(modelId);
}

export function mapRemoteModels(
	remote: RemoteModel[],
	defaults?: ModelDefaults,
): ProviderModelConfig[] {
	const input = defaults?.input ?? (["text"] as ("text" | "image")[]);
	const contextWindow = defaults?.contextWindow ?? 128_000;
	const maxTokens = defaults?.maxTokens ?? 4_096;
	const cost = defaults?.cost ?? ZERO_COST;

	return remote.map((model) => {
		const mapped: ProviderModelConfig = {
			id: model.id,
			name: model.name || model.id,
			reasoning: inferReasoning(model.id, defaults),
			input,
			cost,
			contextWindow: model.context_window ?? contextWindow,
			maxTokens: model.max_tokens ?? maxTokens,
		};
		if (defaults?.thinkingLevelMap) {
			mapped.thinkingLevelMap = defaults.thinkingLevelMap;
		}
		if (defaults?.compat) {
			mapped.compat = defaults.compat;
		}
		return mapped;
	});
}
