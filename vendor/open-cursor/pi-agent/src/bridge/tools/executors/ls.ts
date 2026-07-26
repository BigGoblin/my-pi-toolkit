import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Executor } from "@open-cursor/client";
import { resolvePath } from "@open-cursor/client";
import type { LsArgs, LsResult } from "@open-cursor/protocol/__generated__/agent/v1/ls_exec_pb.js";
import {
  LsError,
  LsResult as LsResultClass,
  LsSuccess,
} from "@open-cursor/protocol/__generated__/agent/v1/ls_exec_pb.js";
import {
  LsDirectoryTreeNode,
  LsDirectoryTreeNode_File,
} from "@open-cursor/protocol/__generated__/agent/v1/selected_context_pb.js";

import { toolResultToText, toolResultWasTruncated } from "../../shared/tool-result.js";
import { requestToolExecution, shellQuote } from "../relay.js";
import { decodeToolCallId, type PiToolContext } from "../types.js";

export function buildLsCommand(pathArg: string): string {
  return `ls -A1p -- ${shellQuote(pathArg)}`;
}

function isLsNoticeLine(line: string): boolean {
  return line.startsWith("[Showing lines ") || line.startsWith("[Showing last ");
}

function parseLsText(text: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [];
  const files: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line === "(empty directory)" || isLsNoticeLine(line)) {
      continue;
    }

    if (line.endsWith("/")) {
      dirs.push(line.slice(0, -1));
    } else {
      files.push(line);
    }
  }

  return { dirs, files };
}

export function buildLsResultFromToolResult(
  path: string,
  cwd: string,
  result: ToolResultMessage,
): LsResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return new LsResultClass({
      result: {
        case: "error",
        value: new LsError({ path, error: text || "Ls failed" }),
      },
    });
  }

  const rootPath = resolvePath(path || ".", cwd);
  const { dirs, files } = parseLsText(text);
  const truncated = toolResultWasTruncated(result);

  const childrenDirs = dirs.map(
    (name) =>
      new LsDirectoryTreeNode({
        absPath: resolvePath(name, rootPath),
        childrenDirs: [],
        childrenFiles: [],
        childrenWereProcessed: false,
        fullSubtreeExtensionCounts: {},
        numFiles: 0,
      }),
  );

  const childrenFiles = files.map((name) => new LsDirectoryTreeNode_File({ name }));

  const root = new LsDirectoryTreeNode({
    absPath: rootPath,
    childrenDirs,
    childrenFiles,
    childrenWereProcessed: !truncated,
    fullSubtreeExtensionCounts: {},
    numFiles: childrenFiles.length,
  });

  return new LsResultClass({
    result: {
      case: "success",
      value: new LsSuccess({ directoryTreeRoot: root }),
    },
  });
}

export class LocalLsExecutor implements Executor<LsArgs, LsResult> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async execute(_ctx: unknown, args: LsArgs): Promise<LsResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);
    const lsPath = args.path || ".";

    if (!this.ctx.getActiveTools().has("bash")) {
      return new LsResultClass({
        result: {
          case: "error",
          value: new LsError({ path: lsPath, error: "Tool not available" }),
        },
      });
    }

    const timeoutSeconds =
      args.timeoutMs && args.timeoutMs > 0
        ? Math.max(1, Math.ceil(args.timeoutMs / 1000))
        : undefined;
    const command = buildLsCommand(lsPath);

    const piResult = await requestToolExecution(this.ctx.getChannel?.() ?? null, {
      toolCallId,
      cursorExecType: "ls",
      piToolName: "bash",
      piToolArgs: {
        command,
        ...(timeoutSeconds !== undefined ? { timeout: timeoutSeconds } : {}),
      },
    });

    return buildLsResultFromToolResult(lsPath, this.ctx.cwd, piResult);
  }
}
