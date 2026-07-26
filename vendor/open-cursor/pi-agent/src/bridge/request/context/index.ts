import type { CursorRule } from "@open-cursor/protocol/__generated__/agent/v1/cursor_rules_pb.js";

import { parsePiSystemPrompt } from "./parser.js";
import { buildCursorRules } from "./rules-builder.js";

export interface PreparedPiContext {
  rules: CursorRule[];
  cleanedPrompt: string;
}

export async function preparePiContext(systemPrompt: string): Promise<PreparedPiContext> {
  const parsed = parsePiSystemPrompt(systemPrompt);
  const rules = await buildCursorRules(parsed);
  return { rules, cleanedPrompt: parsed.cleanedPrompt };
}
