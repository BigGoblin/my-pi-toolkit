/** Persist Cursor Fast toggle under ~/.pi/agent. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface FastStateFile {
  fast?: boolean;
}

function statePath(): string {
  return join(getAgentDir(), "cursor-fast.json");
}

export function isFast(): boolean {
  const path = statePath();
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as FastStateFile;
    return raw.fast === true;
  } catch {
    return false;
  }
}

export function setFast(value: boolean): void {
  writeFileSync(statePath(), JSON.stringify({ fast: value }, null, 2), "utf8");
}

export function toggleFast(): boolean {
  const next = !isFast();
  setFast(next);
  return next;
}
