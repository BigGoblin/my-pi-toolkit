import type { TapdConfig } from "../types.js";
import { DEFAULT_TAPD_API_BASE } from "./config.js";

export function apiUrl(
	config: TapdConfig,
	path: string,
	query?: Record<string, string>,
): string {
	const base = (config.baseUrl ?? DEFAULT_TAPD_API_BASE).replace(/\/$/, "");
	return base + path + (query ? `?${new URLSearchParams(query)}` : "");
}

async function tapdRequest<T>(
	method: "GET" | "POST" | "PUT",
	url: string,
	config: TapdConfig,
	body?: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<T | null> {
	try {
		const response = await fetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${config.token}`,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
			signal,
		});
		if (!response.ok) return null;
		const json = (await response.json()) as { status?: number };
		return json.status === undefined || json.status === 1 ? (json as T) : null;
	} catch (error) {
		if (error instanceof Error && error.name !== "AbortError") {
			console.error(`TAPD ${method} error:`, error.message);
		}
		return null;
	}
}

export function tapdGet<T>(
	url: string,
	config: TapdConfig,
	signal?: AbortSignal,
) {
	return tapdRequest<T>("GET", url, config, undefined, signal);
}

export function tapdPost<T>(
	url: string,
	config: TapdConfig,
	body: Record<string, unknown>,
) {
	return tapdRequest<T>("POST", url, config, body);
}

export function tapdPut<T>(
	url: string,
	config: TapdConfig,
	body: Record<string, unknown>,
) {
	return tapdRequest<T>("PUT", url, config, body);
}
