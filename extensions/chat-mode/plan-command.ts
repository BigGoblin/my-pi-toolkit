import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { showPlanDialog } from "./plan-dialog.js";
import { readPlanFile, type SessionPlanFile } from "./plan-file.js";
import type { ChatMode } from "./state.js";

interface PlanCommandOptions {
	getMode: () => ChatMode;
	getPlan: () => SessionPlanFile | undefined;
	enterPlan: (ctx: ExtensionCommandContext) => Promise<unknown>;
}

const COMPLETIONS: AutocompleteItem[] = [
	{
		value: "review",
		label: "review",
		description: "再次打开当前 session 的 Plan 审阅对话框",
	},
];

async function reviewPlan(
	ctx: ExtensionCommandContext,
	plan: SessionPlanFile | undefined,
): Promise<void> {
	if (!plan) {
		ctx.ui.notify("Session Plan 路径尚未初始化。", "warning");
		return;
	}
	const content = await readPlanFile(plan);
	if (!content) {
		ctx.ui.notify("当前 session 尚无可查看的 Plan。", "warning");
		return;
	}
	await showPlanDialog(ctx, plan.absolutePath, content);
}

export function registerPlanCommand(
	pi: ExtensionAPI,
	options: PlanCommandOptions,
): void {
	pi.registerCommand("plan", {
		description: "进入 Plan Mode；使用 /plan review 再次查看方案",
		getArgumentCompletions: (prefix: string) => {
			const normalized = prefix.trim().toLowerCase();
			return COMPLETIONS.filter((item) => item.value.startsWith(normalized));
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("请等待当前 Agent 运行结束后再执行 Plan 命令。", "warning");
				return;
			}
			const action = args.trim().toLowerCase();
			if (action === "review") {
				await reviewPlan(ctx, options.getPlan());
				return;
			}
			if (action) {
				ctx.ui.notify("用法：/plan 或 /plan review", "warning");
				return;
			}
			if (options.getMode() === "plan") {
				ctx.ui.notify("已在 Plan 模式。", "info");
				return;
			}
			await options.enterPlan(ctx);
		},
	});
}
