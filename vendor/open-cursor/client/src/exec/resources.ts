import type {
  BackgroundShellSpawnArgs,
  BackgroundShellSpawnResult,
} from "@open-cursor/protocol/__generated__/agent/v1/background_shell_exec_pb.js";
import type {
  ComputerUseArgs,
  ComputerUseResult,
} from "@open-cursor/protocol/__generated__/agent/v1/computer_use_tool_pb.js";
import type {
  DeleteArgs,
  DeleteResult,
} from "@open-cursor/protocol/__generated__/agent/v1/delete_exec_pb.js";
import type {
  DiagnosticsArgs,
  DiagnosticsResult,
} from "@open-cursor/protocol/__generated__/agent/v1/diagnostics_exec_pb.js";
import type {
  ExecClientMessage,
  ExecServerMessage,
  ExecuteHookArgs,
  ExecuteHookResult,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";
import type {
  FetchArgs,
  FetchResult,
} from "@open-cursor/protocol/__generated__/agent/v1/fetch_tool_pb.js";
import type {
  GrepArgs,
  GrepResult,
} from "@open-cursor/protocol/__generated__/agent/v1/grep_exec_pb.js";
import type { LsArgs, LsResult } from "@open-cursor/protocol/__generated__/agent/v1/ls_exec_pb.js";
import type {
  ListMcpResourcesExecArgs,
  ListMcpResourcesExecResult,
  ReadMcpResourceExecArgs,
  ReadMcpResourceExecResult,
} from "@open-cursor/protocol/__generated__/agent/v1/mcp_resource_tool_pb.js";
import type {
  McpArgs,
  McpResult,
} from "@open-cursor/protocol/__generated__/agent/v1/mcp_tool_pb.js";
import type {
  ReadArgs,
  ReadResult,
} from "@open-cursor/protocol/__generated__/agent/v1/read_exec_pb.js";
import type {
  RecordScreenArgs,
  RecordScreenResult,
} from "@open-cursor/protocol/__generated__/agent/v1/record_screen_tool_pb.js";
import type {
  RequestContextArgs,
  RequestContextResult,
} from "@open-cursor/protocol/__generated__/agent/v1/request_context_exec_pb.js";
import type {
  ShellArgs,
  ShellResult,
  ShellStream,
} from "@open-cursor/protocol/__generated__/agent/v1/shell_exec_pb.js";
import type {
  WriteArgs,
  WriteResult,
} from "@open-cursor/protocol/__generated__/agent/v1/write_exec_pb.js";
import type {
  WriteShellStdinArgs,
  WriteShellStdinResult,
} from "@open-cursor/protocol/__generated__/agent/v1/write_shell_stdin_tool_pb.js";

import { type Executor, ExecHandler, StreamExecHandler, type StreamExecutor } from "./executor.js";
import type { ExecManager } from "./manager.js";
import { createClientSerializer, createServerDeserializer } from "./serialization.js";

export interface ExecutorResource<TArgs, TResult> {
  symbol: symbol;
  deserializeArgs: (msg: ExecServerMessage) => { id: number; args: TArgs } | undefined;
  serializeResult: (id: number, result: TResult) => ExecClientMessage;
  registerControlledImplementation: (
    implementation: Executor<TArgs, TResult>,
    controlledExecManager: ExecManager,
  ) => void;
}

export interface StreamExecutorResource<TArgs, TStream> {
  symbol: symbol;
  deserializeArgs: (msg: ExecServerMessage) => { id: number; args: TArgs } | undefined;
  serializeStream: (id: number, stream: TStream) => ExecClientMessage;
  registerControlledImplementation: (
    implementation: StreamExecutor<TArgs, TStream>,
    controlledExecManager: ExecManager,
  ) => void;
}

function createResource<TArgs, TResult>(
  argsCase: string,
  resultCase: string,
): ExecutorResource<TArgs, TResult> {
  const deserializeArgs = createServerDeserializer<TArgs>(argsCase);
  const serializeResult = createClientSerializer<TResult>(resultCase);
  return {
    symbol: Symbol(),
    deserializeArgs,
    serializeResult,
    registerControlledImplementation(implementation, controlledExecManager) {
      controlledExecManager.register(
        new ExecHandler(implementation, deserializeArgs, serializeResult),
      );
    },
  };
}

function createStreamResource<TArgs, TStream>(
  argsCase: string,
  streamCase: string,
): StreamExecutorResource<TArgs, TStream> {
  const deserializeArgs = createServerDeserializer<TArgs>(argsCase);
  const serializeStream = createClientSerializer<TStream>(streamCase);
  return {
    symbol: Symbol(),
    deserializeArgs,
    serializeStream,
    registerControlledImplementation(implementation, controlledExecManager) {
      controlledExecManager.register(
        new StreamExecHandler(implementation, deserializeArgs, serializeStream),
      );
    },
  };
}

export const readResource = createResource<ReadArgs, ReadResult>("readArgs", "readResult");

export const writeResource = createResource<WriteArgs, WriteResult>("writeArgs", "writeResult");

export const deleteResource = createResource<DeleteArgs, DeleteResult>(
  "deleteArgs",
  "deleteResult",
);

export const shellResource = createResource<ShellArgs, ShellResult>("shellArgs", "shellResult");

export const shellStreamResource = createStreamResource<ShellArgs, ShellStream>(
  "shellStreamArgs",
  "shellStream",
);

export const grepResource = createResource<GrepArgs, GrepResult>("grepArgs", "grepResult");

export const lsResource = createResource<LsArgs, LsResult>("lsArgs", "lsResult");

export const diagnosticsResource = createResource<DiagnosticsArgs, DiagnosticsResult>(
  "diagnosticsArgs",
  "diagnosticsResult",
);

export const requestContextResource = createResource<RequestContextArgs, RequestContextResult>(
  "requestContextArgs",
  "requestContextResult",
);

export const mcpResource = createResource<McpArgs, McpResult>("mcpArgs", "mcpResult");

export const listMcpResourcesResource = createResource<
  ListMcpResourcesExecArgs,
  ListMcpResourcesExecResult
>("listMcpResourcesExecArgs", "listMcpResourcesExecResult");

export const readMcpResourceResource = createResource<
  ReadMcpResourceExecArgs,
  ReadMcpResourceExecResult
>("readMcpResourceExecArgs", "readMcpResourceExecResult");

export const backgroundShellResource = createResource<
  BackgroundShellSpawnArgs,
  BackgroundShellSpawnResult
>("backgroundShellSpawnArgs", "backgroundShellSpawnResult");

export const writeShellStdinResource = createResource<WriteShellStdinArgs, WriteShellStdinResult>(
  "writeShellStdinArgs",
  "writeShellStdinResult",
);

export const fetchResource = createResource<FetchArgs, FetchResult>("fetchArgs", "fetchResult");

export const recordScreenResource = createResource<RecordScreenArgs, RecordScreenResult>(
  "recordScreenArgs",
  "recordScreenResult",
);

export const computerUseResource = createResource<ComputerUseArgs, ComputerUseResult>(
  "computerUseArgs",
  "computerUseResult",
);

export const hookExecutorResource = createResource<ExecuteHookArgs, ExecuteHookResult>(
  "executeHookArgs",
  "executeHookResult",
);
