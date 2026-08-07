/** TAPD extension entry point. */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { fetchUserInfo, fetchWorkspaces } from "./core/api.js";
import { loadConfig } from "./core/config.js";
import {
	ANALYZE_TRIGGER_PROMPT,
	COLLABORATION_TRIGGER_PROMPT,
	DESIGN_TRIGGER_PROMPT,
} from "./documents/prompts.js";
import { createTapdSession } from "./sessions/create.js";
import { createSubtasks } from "./subtasks/sync.js";
import { withTapdListOverlays } from "./todo/overlay-context.js";
import { showTable } from "./todo/ui.js";
import {
	locateTapdBug,
	sendTapdWorkflowPrompt,
} from "./documents/workflows.js";
import { rejectTapdBug } from "./documents/bug-reject.js";
import {
	registerTapdGitMessageRenderer,
	runTapdGitCommand,
} from "./git/commands.js";
import { requestTapdReview } from "./review/command.js";
import { registerTapdReviewTool } from "./review/tool.js";
import { withTapdWorking } from "./working.js";

async function openTapdTodoList(
	ctx: ExtensionCommandContext,
	config: NonNullable<ReturnType<typeof loadConfig>>,
	initialCurrent: boolean,
): Promise<Awaited<ReturnType<typeof showTable>> | undefined> {
	return withTapdWorking(ctx, "tapd-todo-list", async (cancel) => {
		cancel?.setMessage("Working... 正在连接 TAPD");
		const user = await fetchUserInfo(config);
		cancel?.throwIfAborted();
		if (!user) {
			ctx.ui.notify("TAPD 连接失败，请检查令牌", "error");
			return undefined;
		}
		cancel?.setMessage("Working... 正在获取工作空间");
		const workspaces = await fetchWorkspaces(user.nick, config);
		cancel?.throwIfAborted();
		if (workspaces.length === 0) {
			ctx.ui.notify("没有找到工作空间", "error");
			return undefined;
		}
		cancel?.setMessage(
			`Working... 找到 ${workspaces.length} 个工作空间，正在获取待办`,
		);
		return showTable(
			withTapdListOverlays(ctx),
			config,
			workspaces,
			initialCurrent,
			cancel,
		);
	});
}

export default function tapdExtension(pi: ExtensionAPI) {
	const STATE_KEY = "tapd-view-state";
	registerTapdReviewTool(pi);
	registerTapdGitMessageRenderer(pi);

	pi.registerCommand("tapd", {
		description: "查看 TAPD 待办；生成需求文档或审核需求实现代码",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items: AutocompleteItem[] = [
				{
					value: "bug",
					label: "bug",
					description: "获取当前关联 Bug 的完整信息并尝试定位代码原因",
				},
				{
					value: "bug-reject",
					label: "bug-reject",
					description: "拒绝当前关联 Bug（单页确认评价原因与解决方法）",
				},
				{
					value: "analyze",
					label: "analyze",
					description: "分析当前关联需求并生成理解文档",
				},
				{
					value: "design",
					label: "design",
					description: "基于已确认的需求理解生成设计方案",
				},
				{
					value: "collaboration",
					label: "collaboration",
					description: "生成供产品、后端和前端 Leader 评审的协作文档",
				},
				{
					value: "review",
					label: "review",
					description: "根据需求与设计方案审核当前代码修改",
				},
				{
					value: "sub-task",
					label: "sub-task",
					description: "根据 design.md 创建设计和开发子需求",
				},
				{
					value: "git-status",
					label: "git-status",
					description: "查看 TAPD Git 工作流状态",
				},
				{ value: "branch", label: "branch", description: "创建 TAPD 关联分支" },
				{
					value: "commit",
					label: "commit",
					description: "提交并推送 TAPD 关联改动",
				},
				{ value: "mr", label: "mr", description: "创建或更新 MR 并回写 TAPD" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const config = loadConfig();
			if (!config) {
				ctx.ui.notify(
					'请先配置 ~/.pi/agent/tapd.json:\n{ "token": "你的TAPD个人令牌" }',
					"error",
				);
				return;
			}

			const trimmedArgs = args.trim();
			const [sub = "", ...restArgs] = trimmedArgs.split(/\s+/);
			const additionalInstructions = restArgs.join(" ").trim();
			if (await runTapdGitCommand(pi, sub, restArgs, ctx, config)) return;
			if (sub === "bug") {
				await locateTapdBug(pi, ctx, config);
				return;
			}
			if (sub === "bug-reject") {
				await rejectTapdBug(pi, ctx, config);
				return;
			}
			if (sub === "analyze") {
				await sendTapdWorkflowPrompt(
					pi,
					ctx,
					ANALYZE_TRIGGER_PROMPT,
					additionalInstructions,
				);
				return;
			}
			if (sub === "design") {
				await sendTapdWorkflowPrompt(
					pi,
					ctx,
					DESIGN_TRIGGER_PROMPT,
					additionalInstructions,
				);
				return;
			}
			if (sub === "collaboration") {
				await sendTapdWorkflowPrompt(
					pi,
					ctx,
					COLLABORATION_TRIGGER_PROMPT,
					additionalInstructions,
				);
				return;
			}
			if (sub === "review") {
				await requestTapdReview(pi, ctx, restArgs);
				return;
			}
			if (sub === "sub-task") {
				await createSubtasks(pi, ctx, config);
				return;
			}

			let curOnly = true;
			const entries = ctx.sessionManager.getEntries();
			const stateEntry = entries
				.filter(
					(entry: SessionEntry) =>
						entry.type === "custom" && entry.customType === STATE_KEY,
				)
				.at(-1);
			if (stateEntry?.type === "custom") {
				const data = stateEntry.data as { currentOnly?: unknown } | undefined;
				if (typeof data?.currentOnly === "boolean") curOnly = data.currentOnly;
			}

			const outcome = await openTapdTodoList(ctx, config, curOnly);
			if (!outcome) return;
			if (outcome.kind === "session_action") {
				const { action, itemKey, itemName } = outcome;
				try {
					if (action.type === "switch") {
						await ctx.switchSession(action.sessionFile);
					} else {
						await createTapdSession(
							ctx,
							config,
							itemKey,
							itemName,
							action.draft,
						);
					}
				} catch {
					// 会话可能已替换，勿再使用旧 ctx
				}
				return;
			}
			if (outcome.saveState)
				pi.appendEntry(STATE_KEY, { currentOnly: curOnly });
		},
	});

	pi.registerShortcut("ctrl+shift+t", {
		description: "打开 TAPD 待办",
		handler: async (ctx) => {
			const config = loadConfig();
			if (!config) {
				ctx.ui.notify("请先配置 ~/.pi/agent/tapd.json", "warning");
				return;
			}
			await openTapdTodoList(ctx as ExtensionCommandContext, config, true);
		},
	});
}
