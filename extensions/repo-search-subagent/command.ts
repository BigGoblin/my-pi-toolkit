import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

export function registerRepoSearchCommand(pi: ExtensionAPI): void {
	pi.registerCommand("repo-search", {
		description: "使用只读 Repo Search 子 Agent 执行跨文件代码库检索",
		handler: (args: string, ctx: ExtensionCommandContext) => {
			const task = args.trim();
			if (!task) {
				ctx.ui.notify("用法：/repo-search <检索任务>", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent 正在执行，请稍后再运行 /repo-search", "warning");
				return;
			}
			pi.sendUserMessage(
				[
					"请立即调用 repo_search 工具完成以下只读代码库检索。",
					"不要自行替代工具执行检索；工具返回后，请根据报告直接回答。",
					"",
					"检索任务：",
					task,
				].join("\n"),
			);
		},
	});
}
