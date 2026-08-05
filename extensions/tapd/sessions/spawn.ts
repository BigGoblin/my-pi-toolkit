import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
	ExtensionCommandContext,
	SessionManager as SessionManagerType,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NEW_CONVERSATION_DEFAULTS_ENTRY } from "../../model-manager/pending-new-conversation.js";
import { invalidateTapdCatalog } from "./catalog.js";
import { deleteSessionFile } from "./session-files.js";
import {
	TAPD_SESSION_STATE_TYPE,
	type TapdSessionState,
} from "./session-state.js";

export interface SpawnTapdSessionOptions {
	title: string;
	targetCwd: string;
	state: TapdSessionState;
	sessionPrompt: string;
	notifyMessage: string;
}

function appendSessionSetup(
	sm: SessionManagerType,
	options: SpawnTapdSessionOptions,
	requestNewConversationDefaults: boolean,
): void {
	sm.appendSessionInfo(options.title);
	sm.appendCustomEntry(TAPD_SESSION_STATE_TYPE, options.state);
	// 跨目录创建走 switchSession（reason=resume），需显式声明这是新对话，
	// 否则 model-manager 会按恢复已有会话处理并保留原模型。
	if (requestNewConversationDefaults)
		sm.appendCustomEntry(NEW_CONVERSATION_DEFAULTS_ENTRY);
	sm.appendMessage({
		role: "user",
		content: [{ type: "text", text: options.sessionPrompt }],
		timestamp: Date.now(),
	});
}

/**
 * 在 targetCwd 中创建 TAPD 会话。
 * 与当前 cwd 相同时走 ctx.newSession；否则预写会话文件再 switchSession。
 */
export async function spawnTapdSession(
	ctx: ExtensionCommandContext,
	options: SpawnTapdSessionOptions,
): Promise<void> {
	const targetCwd = resolve(options.targetCwd);
	const currentCwd = resolve(ctx.cwd);
	const withSession = async (
		replacementCtx: ExtensionCommandContext,
	): Promise<void> => {
		replacementCtx.ui.notify(options.notifyMessage, "info");
	};

	if (targetCwd === currentCwd) {
		const result = await ctx.newSession({
			parentSession: undefined,
			setup: async (sm) => appendSessionSetup(sm, options, false),
			withSession,
		});
		if (result.cancelled) throw new Error("创建会话已取消");
		invalidateTapdCatalog();
		return;
	}

	const draftManager = SessionManager.create(targetCwd);
	const sessionFile = draftManager.getSessionFile();
	if (!sessionFile) throw new Error("无法创建会话文件路径");
	const header = draftManager.getHeader();
	if (!header) throw new Error("无法读取会话头");

	writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, { flag: "wx" });
	const session = SessionManager.open(sessionFile, draftManager.getSessionDir());
	appendSessionSetup(session, options, true);
	invalidateTapdCatalog();

	const result = await ctx.switchSession(sessionFile, { withSession });
	if (result.cancelled) {
		deleteSessionFile(sessionFile);
		throw new Error("创建会话已取消");
	}
}
