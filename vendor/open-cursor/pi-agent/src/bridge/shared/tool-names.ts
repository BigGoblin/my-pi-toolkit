export type CursorExecType =
  | "read"
  | "write"
  | "write-binary"
  | "shell"
  | "shell-stream"
  | "grep"
  | "ls"
  | "delete";

export type PiToolName = "read" | "write" | "bash" | "edit";

const CURSOR_EXEC_TO_PI_TOOL: Record<CursorExecType, PiToolName> = {
  read: "read",
  write: "write",
  "write-binary": "bash",
  shell: "bash",
  "shell-stream": "bash",
  grep: "bash",
  ls: "bash",
  delete: "bash",
};

export function getDefaultPiToolName(execType: CursorExecType): PiToolName {
  return CURSOR_EXEC_TO_PI_TOOL[execType];
}

/** Infer the Cursor exec type from a Pi tool call. */
export function inferCursorExecType(
  piToolName: string,
  piToolArgs: Record<string, unknown>,
): CursorExecType | undefined {
  if (piToolName === "read") return "read";
  if (piToolName === "write") return "write";

  if (piToolName === "bash") {
    const command = typeof piToolArgs["command"] === "string" ? piToolArgs["command"] : "";
    if (/^\s*rg\s/.test(command) || /^\s*grep\s/.test(command)) return "grep";
    if (/^\s*ls\s/.test(command)) return "ls";
    if (/^\s*rm\s/.test(command)) return "delete";
    if (/^\s*find\s/.test(command)) return "ls";
    if (/^\s*base64\s/.test(command)) return "write-binary";
    return "shell";
  }

  return undefined;
}
