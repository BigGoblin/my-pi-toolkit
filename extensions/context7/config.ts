import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Context7Config {
  apiKey?: string;
}

export function loadConfig(): Context7Config {
  const fromEnv = process.env.CONTEXT7_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv };

  const path = join(getAgentDir(), "context7.json");
  if (!existsSync(path)) return {};

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Context7Config;
    const apiKey = raw.apiKey?.trim();
    return apiKey ? { apiKey } : {};
  } catch {
    return {};
  }
}

export function configPath(): string {
  return join(getAgentDir(), "context7.json");
}
