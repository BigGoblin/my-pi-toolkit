/** Convert parsed Pi context into CursorRule[] for Cursor's RequestContext.rules. */

import { readFile } from "node:fs/promises";

import {
  CursorRule,
  CursorRuleType,
  CursorRuleTypeAgentFetched,
  CursorRuleTypeGlobal,
} from "@open-cursor/protocol/__generated__/agent/v1/cursor_rules_pb.js";
import { parse as parseYaml } from "yaml";

import type { ParsedPiContext, PiSkillRef } from "./parser.js";

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const s = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!s.startsWith("---")) return { frontmatter: {}, body: s };

  const end = s.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: s };

  const raw = parseYaml(s.slice(4, end));
  const frontmatter: Record<string, unknown> =
    raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    frontmatter,
    body: s.slice(end + 4).trim(),
  };
}

function globalRule(path: string, content: string): CursorRule {
  return new CursorRule({
    fullPath: path,
    content,
    type: new CursorRuleType({
      type: { case: "global", value: new CursorRuleTypeGlobal() },
    }),
  });
}

function agentFetchedRuleType(description: string): CursorRuleType {
  return new CursorRuleType({
    type: {
      case: "agentFetched",
      value: new CursorRuleTypeAgentFetched({ description }),
    },
  });
}

async function agentFetchedRule(skill: PiSkillRef): Promise<CursorRule> {
  try {
    const raw = await readFile(skill.location, "utf-8");
    const { body } = parseFrontmatter(raw);
    return new CursorRule({
      fullPath: skill.location,
      content: body || raw,
      type: agentFetchedRuleType(skill.description),
    });
  } catch {
    return new CursorRule({
      fullPath: skill.location,
      content: skill.description,
      type: agentFetchedRuleType(skill.description),
    });
  }
}

export async function buildCursorRules(parsed: ParsedPiContext): Promise<CursorRule[]> {
  const globals = parsed.contextFiles.map((f) => globalRule(f.path, f.content));
  const skills = await Promise.all(parsed.skills.map(agentFetchedRule));
  return [...globals, ...skills];
}
