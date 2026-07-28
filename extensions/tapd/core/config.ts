import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { TapdConfig } from "../types.js";

export const DEFAULT_TAPD_API_BASE = "https://api.tapd.cn";

export function loadConfig(): TapdConfig | null {
	const path = join(getAgentDir(), "tapd.json");
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as TapdConfig;
	} catch {
		return null;
	}
}
