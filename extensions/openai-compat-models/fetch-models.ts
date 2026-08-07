const FETCH_TIMEOUT_MS = 8_000;

export interface RemoteModel {
	id: string;
	name?: string;
	context_window?: number;
	max_tokens?: number;
}

interface ModelsResponse {
	data?: Array<{
		id?: unknown;
		name?: unknown;
		context_window?: unknown;
		max_tokens?: unknown;
	}>;
}

function modelsUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function withTimeout(signal: AbortSignal | undefined): {
	signal: AbortSignal;
	cleanup: () => void;
} {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) controller.abort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		},
	};
}

export async function fetchOpenAiModels(
	baseUrl: string,
	apiKey: string,
	signal?: AbortSignal,
): Promise<RemoteModel[]> {
	const { signal: combined, cleanup } = withTimeout(signal);
	try {
		const response = await fetch(modelsUrl(baseUrl), {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
			signal: combined,
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}
		const payload = (await response.json()) as ModelsResponse;
		if (!Array.isArray(payload.data)) {
			throw new Error("响应缺少 data 数组");
		}
		const models: RemoteModel[] = [];
		for (const item of payload.data) {
			if (typeof item?.id !== "string" || !item.id.trim()) continue;
			models.push({
				id: item.id.trim(),
				name: typeof item.name === "string" ? item.name.trim() : undefined,
				context_window:
					typeof item.context_window === "number"
						? item.context_window
						: undefined,
				max_tokens:
					typeof item.max_tokens === "number" ? item.max_tokens : undefined,
			});
		}
		return models;
	} finally {
		cleanup();
	}
}
