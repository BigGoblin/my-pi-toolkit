import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import {
	resolveNewConversationConfig,
	userConfigPath,
	type ResolvedNewConversationConfig,
} from "./config.js";
import { wantsNewConversationDefaults } from "./pending-new-conversation.js";
import { registerThinkingCommand } from "./thinking-command.js";

const CONVERSATION_ENTRY_TYPES = new Set([
	"message",
	"compaction",
	"branch_summary",
	"custom_message",
]);

function isFreshConversation(
	event: SessionStartEvent,
	ctx: ExtensionContext,
): boolean {
	if (event.reason === "new") return true;
	if (
		event.reason === "resume" &&
		wantsNewConversationDefaults(ctx.sessionManager.getEntries())
	) {
		return true;
	}
	if (event.reason !== "startup") return false;
	return !ctx.sessionManager
		.getEntries()
		.some((entry: SessionEntry) => CONVERSATION_ENTRY_TYPES.has(entry.type));
}

async function applyNewConversationDefaults(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: ResolvedNewConversationConfig,
	notifySuccess: boolean,
): Promise<boolean> {
	if (!config.enabled) return false;
	if (!config.provider || !config.modelId) return false;

	const model = ctx.modelRegistry.find(config.provider, config.modelId);
	if (!model) {
		ctx.ui.notify(
			`模型管理：找不到 ${config.provider}/${config.modelId}`,
			"error",
		);
		return false;
	}

	const modelChanged =
		ctx.model?.provider !== model.provider || ctx.model?.id !== model.id;
	if (modelChanged && !(await pi.setModel(model))) {
		ctx.ui.notify(
			`模型管理：${config.provider}/${config.modelId} 没有可用认证`,
			"error",
		);
		return false;
	}

	const thinkingChanged =
		config.thinkingLevel !== undefined &&
		pi.getThinkingLevel() !== config.thinkingLevel;
	if (config.thinkingLevel !== undefined) {
		pi.setThinkingLevel(config.thinkingLevel);
	}

	if (notifySuccess && (modelChanged || thinkingChanged)) {
		const thinking = config.thinkingLevel ? ` • ${config.thinkingLevel}` : "";
		ctx.ui.notify(
			`新对话默认模型：${config.provider}/${config.modelId}${thinking}`,
			"info",
		);
	}
	return true;
}

function describeConfig(config: ResolvedNewConversationConfig): string {
	if (!config.enabled) {
		const suffix =
			config.source === "none" ? `；请配置 ${userConfigPath()}` : "";
		return `模型管理：新对话默认模型未启用${suffix}`;
	}

	const thinking = config.thinkingLevel ? ` • ${config.thinkingLevel}` : "";
	return [
		`模型管理：${config.provider}/${config.modelId}${thinking}`,
		`来源：${config.source}`,
		...config.configPaths.map((filePath) => `配置：${filePath}`),
	].join("\n");
}

export default function modelManagerExtension(pi: ExtensionAPI): void {
	registerThinkingCommand(pi);

	pi.on(
		"session_start",
		async (event: SessionStartEvent, ctx: ExtensionContext) => {
			if (!isFreshConversation(event, ctx)) return;

			try {
				const config = resolveNewConversationConfig(
					ctx.cwd,
					ctx.isProjectTrusted(),
				);
				await applyNewConversationDefaults(pi, ctx, config, true);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`模型管理：${message}`, "error");
			}
		},
	);

	pi.registerCommand("model-manager", {
		description: "查看或重新应用模型管理配置",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const config = resolveNewConversationConfig(
					ctx.cwd,
					ctx.isProjectTrusted(),
				);
				if (args.trim() === "apply") {
					const applied = await applyNewConversationDefaults(
						pi,
						ctx,
						config,
						false,
					);
					ctx.ui.notify(
						applied ? "模型管理：配置已应用" : describeConfig(config),
						applied ? "info" : "warning",
					);
					return;
				}
				ctx.ui.notify(
					describeConfig(config),
					config.enabled ? "info" : "warning",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`模型管理：${message}`, "error");
			}
		},
	});
}
