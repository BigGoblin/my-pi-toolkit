import type {
  ExecClientMessage,
  ExecServerMessage,
} from "@open-cursor/protocol/__generated__/agent/v1/exec_pb.js";

import type { SimpleExecHandler } from "./manager.js";

export interface Executor<TArgs, TResult> {
  execute(ctx: unknown, args: TArgs, options?: { execId?: string }): Promise<TResult>;
}

export interface StreamExecutor<TArgs, TStream> {
  execute(ctx: unknown, args: TArgs, options?: { execId?: string }): AsyncIterable<TStream>;
}

export class ExecHandler<TArgs, TResult> implements SimpleExecHandler {
  private readonly exec: Executor<TArgs, TResult>;
  private readonly deserializeArgs: (
    msg: ExecServerMessage,
  ) => { id: number; args: TArgs } | undefined;
  private readonly serializeResult: (id: number, result: TResult) => ExecClientMessage;

  constructor(
    exec: Executor<TArgs, TResult>,
    deserializeArgs: (msg: ExecServerMessage) => { id: number; args: TArgs } | undefined,
    serializeResult: (id: number, result: TResult) => ExecClientMessage,
  ) {
    this.exec = exec;
    this.deserializeArgs = deserializeArgs;
    this.serializeResult = serializeResult;
  }

  handle(
    ctx: unknown,
    serverMessage: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage> | undefined {
    const r = this.deserializeArgs(serverMessage);
    if (r === undefined) return undefined;
    const { id, args } = r;
    // oxlint-disable-next-line typescript/no-this-alias -- required: arrow functions cannot be generators
    const self = this;
    return (async function* () {
      const result = await self.exec.execute(ctx, args, {
        execId: serverMessage.execId,
      });
      yield self.serializeResult(id, result);
    })();
  }
}

export class StreamExecHandler<TArgs, TStream> implements SimpleExecHandler {
  private readonly exec: StreamExecutor<TArgs, TStream>;
  private readonly deserializeArgs: (
    msg: ExecServerMessage,
  ) => { id: number; args: TArgs } | undefined;
  private readonly serializeStream: (id: number, message: TStream) => ExecClientMessage;

  constructor(
    exec: StreamExecutor<TArgs, TStream>,
    deserializeArgs: (msg: ExecServerMessage) => { id: number; args: TArgs } | undefined,
    serializeStream: (id: number, message: TStream) => ExecClientMessage,
  ) {
    this.exec = exec;
    this.deserializeArgs = deserializeArgs;
    this.serializeStream = serializeStream;
  }

  handle(
    ctx: unknown,
    serverMessage: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage> | undefined {
    const r = this.deserializeArgs(serverMessage);
    if (r === undefined) return undefined;
    const { id, args } = r;
    // oxlint-disable-next-line typescript/no-this-alias -- required: arrow functions cannot be generators
    const self = this;
    return (async function* () {
      for await (const message of self.exec.execute(ctx, args, {
        execId: serverMessage.execId,
      })) {
        yield self.serializeStream(id, message);
      }
    })();
  }
}
