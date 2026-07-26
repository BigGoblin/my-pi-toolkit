import {
  backgroundShellResource,
  computerUseResource,
  deleteResource,
  diagnosticsResource,
  fetchResource,
  grepResource,
  hookExecutorResource,
  listMcpResourcesResource,
  lsResource,
  mcpResource,
  RegistryAccessor,
  readMcpResourceResource,
  readResource,
  recordScreenResource,
  requestContextResource,
  shellResource,
  shellStreamResource,
  writeResource,
  writeShellStdinResource,
} from "@open-cursor/client";
import type { CursorRule } from "@open-cursor/protocol/__generated__/agent/v1/cursor_rules_pb.js";
import type { McpToolDefinition } from "@open-cursor/protocol/__generated__/agent/v1/mcp_pb.js";

import { LocalDeleteExecutor } from "./executors/delete.js";
import { LocalGrepExecutor } from "./executors/grep.js";
import { LocalHookExecutor } from "./executors/hook.js";
import { LocalLsExecutor } from "./executors/ls.js";
import { LocalMcpExecutor } from "./executors/mcp.js";
import { LocalReadExecutor } from "./executors/read.js";
import { LocalRequestContextExecutor } from "./executors/request-context.js";
import { LocalShellStreamExecutor } from "./executors/shell-stream.js";
import { LocalShellExecutor } from "./executors/shell.js";
import {
  StubBackgroundShellExecutor,
  StubComputerUseExecutor,
  StubDiagnosticsExecutor,
  StubFetchExecutor,
  StubListMcpResourcesExecutor,
  StubReadMcpResourceExecutor,
  StubRecordScreenExecutor,
  StubWriteShellStdinExecutor,
} from "./executors/stubs.js";
import { LocalWriteExecutor } from "./executors/write.js";
import type { PiToolContext } from "./types.js";

export type { PiToolContext } from "./types.js";

interface LocalResourceProviderOptions {
  ctx: PiToolContext;
  requestContextTools?: McpToolDefinition[];
  workspacePaths?: string[];
  cursorRules?: CursorRule[];
}

export class LocalResourceProvider extends RegistryAccessor {
  constructor(options: LocalResourceProviderOptions) {
    super();
    const { ctx, requestContextTools = [], workspacePaths } = options;
    const resolvedWorkspacePaths = workspacePaths ?? [ctx.cwd];

    // hook-executor
    this.register(hookExecutorResource, new LocalHookExecutor());

    // request-context
    this.register(
      requestContextResource,
      new LocalRequestContextExecutor(
        requestContextTools,
        resolvedWorkspacePaths,
        options.cursorRules ?? [],
      ),
    );

    // read, write, delete
    this.register(readResource, new LocalReadExecutor(ctx));
    this.register(writeResource, new LocalWriteExecutor(ctx));
    this.register(deleteResource, new LocalDeleteExecutor(ctx));

    // shell (unary + stream)
    const shellExecutor = new LocalShellExecutor(ctx);
    this.register(shellResource, shellExecutor);
    this.register(shellStreamResource, new LocalShellStreamExecutor(ctx));

    // grep, ls
    this.register(grepResource, new LocalGrepExecutor(ctx));
    this.register(lsResource, new LocalLsExecutor(ctx));

    // stubs (not implemented)
    this.register(backgroundShellResource, new StubBackgroundShellExecutor());
    this.register(writeShellStdinResource, new StubWriteShellStdinExecutor());
    this.register(fetchResource, new StubFetchExecutor());
    this.register(diagnosticsResource, new StubDiagnosticsExecutor());
    this.register(mcpResource, new LocalMcpExecutor(ctx));
    this.register(listMcpResourcesResource, new StubListMcpResourcesExecutor());
    this.register(readMcpResourceResource, new StubReadMcpResourceExecutor());
    this.register(recordScreenResource, new StubRecordScreenExecutor());
    this.register(computerUseResource, new StubComputerUseExecutor());
  }
}
