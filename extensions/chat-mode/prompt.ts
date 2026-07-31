import { PLAN_FILE_RELATIVE } from "./paths.js";

export const ASK_MODE_PROMPT = `[ASK MODE]

You are in question-and-answer mode.

- Answer, explain, inspect, diagnose, and research.
- Do not modify project files outside the project-local .pi directory.
- Do not attempt to bypass this restriction through shell commands or other tools.
- If the user requests implementation or another restricted action, tell them to press Alt+M to switch to Build mode.
- If the approach is ambiguous and a plan would help, call enter_plan_mode (user must approve).`;

export const PLAN_MODE_PROMPT = `[PLAN MODE]

You are in plan mode — a structured planning phase before any implementation.

- Explore the codebase with read-only tools to understand existing patterns.
- Design an approach; do not implement, refactor, or modify project code.
- The only file you may create or edit is ${PLAN_FILE_RELATIVE}.
- Do not attempt to bypass this restriction through shell commands or other tools.

Write the plan to ${PLAN_FILE_RELATIVE}. Prefer this structure:

## Context
Why the change is needed.

## Approach
The recommended approach (not every alternative).

## Critical files
Paths that must change, plus existing helpers to reuse.

## Verification
How to test the change end to end.

When the plan is ready, call exit_plan_mode to present it for approval. If requirements are ambiguous, ask clarifying questions first. Do not tell the user to press Alt+M yourself — exit_plan_mode handles the handoff.`;
