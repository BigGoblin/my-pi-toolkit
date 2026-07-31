import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	notifySubagentRegistryChanged,
	registerLiveSubagent,
	removeLiveSubagent,
	type LiveSubagentRun,
	type SubagentTranscriptEntry,
} from "./registry.js";
import {
	assistantText,
	parseRpcEvent,
	sendRpc,
	writeRunJson,
	type RpcEvent,
} from "./rpc-protocol.js";
import type {
	TerminalSubagentOptions,
	TerminalSubagentResult,
} from "./terminal-runner.js";
export class RpcSubagentSession {
	private readonly lines: string[] = [];
	private readonly entries: SubagentTranscriptEntry[] = [];
	private readonly listeners = new Set<() => void>();
	private readonly toolCalls: TerminalSubagentResult["toolCalls"] = [];
	private status: LiveSubagentRun["status"] = "starting";
	private streaming = false;
	private streamingMessage?: Extract<
		SubagentTranscriptEntry,
		{ kind: "assistant" }
	>;
	private lastOutput = "";
	private stderr = "";
	private settled = false;
	private buffer = "";
	private resolveResult!: (value: TerminalSubagentResult) => void;
	private rejectResult!: (error: Error) => void;
	private readonly result = new Promise<TerminalSubagentResult>(
		(resolve, reject) => {
			this.resolveResult = resolve;
			this.rejectResult = reject;
		},
	);
	private readonly run: LiveSubagentRun;
	constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly id: string,
		private readonly runDir: string,
		private readonly options: TerminalSubagentOptions,
	) {
		this.run = {
			id,
			title: options.title,
			model: options.model,
			cwd: options.cwd,
			status: this.status,
			startedAt: new Date().toISOString(),
			parentSessionId: options.parentSessionId,
			lines: this.lines,
			entries: this.entries,
			send: (message) => this.send(message),
			abort: () => sendRpc(this.child, { type: "abort" }),
			dispose: () => this.dispose(),
			subscribe: (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			},
		};
	}
	start(task: string): Promise<TerminalSubagentResult> {
		registerLiveSubagent(this.run);
		this.writeReady();
		this.attachProcessListeners();
		if (this.options.signal?.aborted) {
			this.stop();
			return this.result;
		}
		this.options.signal?.addEventListener("abort", this.stop, { once: true });
		this.setStatus("running");
		this.append("Starting manual subagent…");
		this.send(task);
		return this.result;
	}
	private readonly stop = () => {
		this.dispose();
		if (!this.settled) this.rejectResult(new Error("子 Agent 已取消"));
	};
	private send(message: string): void {
		if (!message.trim()) return;
		this.entries.push({ kind: "user", text: message.trim() });
		this.append(`YOU: ${message.trim()}`);
		sendRpc(this.child, {
			type: "prompt",
			message: message.trim(),
			...(this.streaming ? { streamingBehavior: "steer" } : {}),
		});
	}
	private dispose(): void {
		sendRpc(this.child, { type: "abort" });
		this.child.stdin.end();
		setTimeout(() => this.child.kill("SIGTERM"), 1000).unref?.();
	}

	private setStatus(status: LiveSubagentRun["status"]): void {
		if (this.status === status) return;
		this.status = status;
		this.run.status = status;
		notifySubagentRegistryChanged();
	}

	private append(line: string): void {
		this.lines.push(line);
		appendFileSync(
			join(this.runDir, "transcript.jsonl"),
			`${JSON.stringify({ at: new Date().toISOString(), line })}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
		while (this.lines.length > 1000) this.lines.shift();
		this.notify();
	}

	private notify(): void {
		this.listeners.forEach((listener) => listener());
		this.options.onUpdate?.({
			status: this.status,
			toolCalls: [...this.toolCalls],
		});
	}

	private attachProcessListeners(): void {
		this.child.stdout.on("data", (data) => this.consume(data.toString()));
		this.child.stderr.on("data", (data) => {
			this.stderr += data.toString();
		});
		this.child.on("error", (error) => this.handleError(error));
		this.child.on("close", (code) => this.handleClose(code));
	}

	private consume(chunk: string): void {
		this.buffer += chunk;
		const records = this.buffer.split("\n");
		this.buffer = records.pop() ?? "";
		for (const record of records) this.parseRecord(record.replace(/\r$/, ""));
	}

	private parseRecord(record: string): void {
		const event = parseRpcEvent(record);
		if (!event) return;
		switch (event.type) {
			case "agent_start":
				this.handleAgentStart();
				break;
			case "tool_execution_start":
				this.handleToolStart(event);
				break;
			case "tool_execution_end":
				this.handleToolEnd(event);
				break;
			case "message_update":
				this.handleMessageUpdate(event.message);
				break;
			case "message_end":
				this.handleMessage(event.message);
				break;
			case "agent_settled":
				this.handleSettled();
				break;
			case "extension_error":
				this.append(`ERROR: ${event.error ?? "extension error"}`);
				break;
			default:
				break;
		}
	}

	private handleAgentStart(): void {
		this.streaming = true;
		this.streamingMessage = undefined;
		this.setStatus("running");
		this.append("Agent started");
	}

	private handleToolStart(event: RpcEvent): void {
		if (!event.toolName) return;
		const args = event.args ?? {};
		this.toolCalls.push({ name: event.toolName, arguments: args });
		this.entries.push({
			kind: "tool",
			id: event.toolCallId ?? `${event.toolName}-${this.toolCalls.length}`,
			name: event.toolName,
			args,
		});
		this.append(`→ ${event.toolName} ${JSON.stringify(args)}`);
	}

	private handleToolEnd(event: RpcEvent): void {
		if (!event.toolName) return;
		const entry = [...this.entries]
			.reverse()
			.find(
				(item) =>
					item.kind === "tool" &&
					(event.toolCallId
						? item.id === event.toolCallId
						: item.name === event.toolName),
			);
		if (entry?.kind === "tool") {
			entry.result = event.result;
			entry.isError = event.isError;
		}
		this.append(`${event.isError ? "✗" : "✓"} ${event.toolName}`);
	}

	private handleMessageUpdate(message: unknown): void {
		if (!this.isAssistantMessage(message)) return;
		if (!this.streamingMessage) {
			this.streamingMessage = { kind: "assistant", message };
			this.entries.push(this.streamingMessage);
		} else this.streamingMessage.message = message;
		this.notify();
	}

	private handleMessage(message: unknown): void {
		if (!this.isAssistantMessage(message)) return;
		if (this.streamingMessage) this.streamingMessage.message = message;
		else this.entries.push({ kind: "assistant", message });
		this.streamingMessage = undefined;
		const text = assistantText(message);
		if (text) this.lastOutput = text;
		this.append(text ? `AGENT: ${text}` : "Assistant message completed");
	}

	private isAssistantMessage(message: unknown): boolean {
		return (message as { role?: unknown } | undefined)?.role === "assistant";
	}

	private handleSettled(): void {
		this.streaming = false;
		this.append("Agent settled");
		if (this.settled) return;
		this.settled = true;
		this.options.signal?.removeEventListener("abort", this.stop);
		if (!this.lastOutput) {
			this.setStatus("failed");
			this.rejectResult(new Error("子 Agent 已结束但未返回文本结果"));
			if (this.options.keepOpen === false) this.dispose();
			return;
		}
		this.setStatus("completed");
		this.writeResult();
		this.resolveResult({
			output: this.lastOutput,
			model: this.options.model,
			toolCalls: this.toolCalls,
			runDir: this.runDir,
		});
		if (this.options.keepOpen === false) this.dispose();
	}

	private handleError(error: Error): void {
		this.setStatus("failed");
		this.append(`ERROR: ${error.message}`);
		if (!this.settled) this.rejectResult(error);
	}

	private handleClose(code: number | null): void {
		if (this.buffer.trim()) this.parseRecord(this.buffer.replace(/\r$/, ""));
		removeLiveSubagent(this.id);
		this.writeExited(code);
		if (this.status !== "completed") this.setStatus("failed");
		this.append(`Process exited (${code ?? 1})`);
		if (!this.settled)
			this.rejectResult(
				new Error(this.stderr.trim() || `子 Agent 进程已退出（${code ?? 1}）`),
			);
	}

	private writeReady(): void {
		writeRunJson(this.runDir, "ready.json", {
			pid: this.child.pid,
			startedAt: this.run.startedAt,
		});
	}

	private writeResult(): void {
		writeRunJson(this.runDir, "result.json", {
			output: this.lastOutput,
			model: this.options.model,
			completedAt: new Date().toISOString(),
		});
	}

	private writeExited(code: number | null): void {
		writeRunJson(this.runDir, "exited.json", {
			exitCode: code ?? 1,
			exitedAt: new Date().toISOString(),
		});
	}
}
