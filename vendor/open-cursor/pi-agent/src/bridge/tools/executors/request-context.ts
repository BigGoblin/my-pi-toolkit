import os from "node:os";

import type { Executor } from "@open-cursor/client";
import {
  getGitBranch,
  getGitRemoteUrl,
  getGitRepoPath,
  LocalGitExecutor,
} from "@open-cursor/client";
import type { CursorRule } from "@open-cursor/protocol/__generated__/agent/v1/cursor_rules_pb.js";
import type { McpToolDefinition } from "@open-cursor/protocol/__generated__/agent/v1/mcp_pb.js";
import { GitRepoInfo } from "@open-cursor/protocol/__generated__/agent/v1/repo_pb.js";
import type { RequestContextArgs } from "@open-cursor/protocol/__generated__/agent/v1/request_context_exec_pb.js";
import {
  RequestContext,
  RequestContextEnv,
  RequestContextError,
  RequestContextResult,
  RequestContextSuccess,
} from "@open-cursor/protocol/__generated__/agent/v1/request_context_exec_pb.js";

export class LocalRequestContextExecutor implements Executor<
  RequestContextArgs,
  RequestContextResult
> {
  private readonly tools: McpToolDefinition[];
  private readonly workspacePaths: string[];
  private readonly rules: CursorRule[];
  private readonly gitExecutor: LocalGitExecutor;

  constructor(tools: McpToolDefinition[], workspacePaths: string[], rules: CursorRule[] = []) {
    this.tools = tools;
    this.workspacePaths = workspacePaths;
    this.rules = rules;
    this.gitExecutor = new LocalGitExecutor();
  }

  async execute(_ctx: unknown, _args: RequestContextArgs): Promise<RequestContextResult> {
    try {
      const [gitRepos, env] = await Promise.all([this.collectGitRepos(), this.computeEnv()]);

      const requestContext = new RequestContext({
        rules: this.rules,
        env,
        repositoryInfo: [],
        tools: this.tools,
        gitRepos,
        projectLayouts: [],
        mcpInstructions: [],
        fileContents: {},
        customSubagents: [],
      });

      return new RequestContextResult({
        result: {
          case: "success",
          value: new RequestContextSuccess({ requestContext }),
        },
      });
    } catch (error) {
      return new RequestContextResult({
        result: {
          case: "error",
          value: new RequestContextError({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      });
    }
  }

  private async collectGitRepos(): Promise<GitRepoInfo[]> {
    const seen = new Set<string>();
    const repos: GitRepoInfo[] = [];

    for (const workspacePath of this.workspacePaths) {
      const repoPath = await getGitRepoPath(this.gitExecutor, workspacePath);
      if (!repoPath || seen.has(repoPath)) continue;
      seen.add(repoPath);

      const [branchName, remoteUrl] = await Promise.all([
        getGitBranch(this.gitExecutor, repoPath),
        getGitRemoteUrl(this.gitExecutor, repoPath),
      ]);

      const info: Record<string, unknown> = {
        path: repoPath,
        status: "",
        branchName: branchName ?? "",
      };
      if (remoteUrl) info["remoteUrl"] = remoteUrl;
      repos.push(new GitRepoInfo(info));
    }

    return repos;
  }

  private async computeEnv(): Promise<RequestContextEnv> {
    const osVersion = `${os.platform()} ${os.release()}`;
    const shell = process.env["SHELL"] ?? "";

    let timeZone: string | undefined;
    try {
      timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timeZone = undefined;
    }

    return new RequestContextEnv({
      osVersion,
      workspacePaths: this.workspacePaths,
      shell,
      sandboxEnabled: false,
      timeZone: timeZone ?? "",
    });
  }
}
