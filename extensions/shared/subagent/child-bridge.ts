import {
	appendFileSync,
	existsSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
	AgentSettledEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";

interface BridgeEvent {
	kind: string;
	[key: string]: unknown;
}

function assistantText(message: unknown): string {
	const candidate = message as {
		role?: string;
		content?: Array<{ type?: string; text?: string }>;
	};
	if (candidate.role !== "assistant" || !Array.isArray(candidate.content))
		return "";
	return candidate.content
		.flatMap((part) =>
			part.type === "text" && typeof part.text === "string" ? [part.text] : [],
		)
		.join("\n");
}

function writeJsonAtomic(path: string, value: unknown): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(value, null, 2), {
		encoding: "utf8",
		mode: 0o600,
	});
	renameSync(temporary, path);
}

export default function subagentChildBridge(pi: ExtensionAPI): void {
	const runDir = process.env.PI_SUBAGENT_RUN_DIR;
	if (!runDir) return;
	const eventsPath = join(runDir, "events.jsonl");
	const resultPath = join(runDir, "result.json");
	const cancelPath = join(runDir, "cancel");
	const systemPromptPath = join(runDir, "system-prompt.md");
	let lastOutput = "";
	let settled = false;
	let cancelTimer: ReturnType<typeof setInterval> | undefined;

	const emit = (event: BridgeEvent) => {
		appendFileSync(
			eventsPath,
			`${JSON.stringify({ timestamp: Date.now(), ...event })}\n`,
			"utf8",
		);
	};

	pi.on("before_agent_start", (_event: BeforeAgentStartEvent) => {
		if (!existsSync(systemPromptPath)) return;
		return { systemPrompt: readFileSync(systemPromptPath, "utf8") };
	});

	pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
		writeJsonAtomic(join(runDir, "ready.json"), {
			pid: process.pid,
			sessionFile: ctx.sessionManager.getSessionFile?.(),
			startedAt: new Date().toISOString(),
		});
		emit({ kind: "status", text: "子 Agent 已启动" });
		cancelTimer = setInterval(() => {
			if (!existsSync(cancelPath)) return;
			emit({ kind: "status", text: "收到取消请求" });
			const cancellable = ctx as typeof ctx & { abort?: () => void };
			cancellable.abort?.();
			ctx.shutdown();
		}, 200);
		cancelTimer.unref?.();
	});

	pi.on("message_end", (event: MessageEndEvent) => {
		const text = assistantText(event.message);
		if (text) {
			lastOutput = text;
			emit({ kind: "assistant", text });
		}
	});

	pi.on("tool_execution_start", (event: ToolExecutionStartEvent) => {
		emit({
			kind: "tool_call",
			name: event.toolName,
			arguments: event.args,
			toolCallId: event.toolCallId,
		});
	});

	pi.on("tool_execution_end", (event: ToolExecutionEndEvent) => {
		emit({
			kind: "tool_result",
			name: event.toolName,
			toolCallId: event.toolCallId,
			isError: event.isError,
		});
	});

	pi.on("agent_settled", (_event: AgentSettledEvent, ctx: ExtensionContext) => {
		if (settled || !lastOutput) return;
		settled = true;
		writeJsonAtomic(resultPath, {
			output: lastOutput,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			completedAt: new Date().toISOString(),
		});
		emit({ kind: "status", text: "首轮任务已完成，结果已返回主 Agent" });
		if (process.env.PI_SUBAGENT_KEEP_OPEN === "0") ctx.shutdown();
	});

	pi.on("session_shutdown", (event: SessionShutdownEvent) => {
		if (cancelTimer) clearInterval(cancelTimer);
		writeJsonAtomic(join(runDir, "exited.json"), {
			reason: event.reason,
			exitedAt: new Date().toISOString(),
			hadResult: existsSync(resultPath),
		});
	});
}
