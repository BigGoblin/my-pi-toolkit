import fs from "node:fs";

export function trace(event: string, data: Record<string, unknown> = {}): void {
  if (process.env["PI_CURSOR_AGENT_DEBUG"] !== "1" && !process.env["PI_CURSOR_AGENT_TRACE_FILE"]) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    provider: "open-cursor",
    event,
    ...data,
  };
  const line = `${JSON.stringify(entry)}\n`;
  const file = process.env["PI_CURSOR_AGENT_TRACE_FILE"];

  if (file) {
    fs.appendFileSync(file, line);
    return;
  }

  console.error(`[pi-cursor-agent] ${event}`, JSON.stringify(data));
}
