import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { appendBindingCurrent, createBinding, readBinding } from "./binding.js";
import { readDirtySummary, readGitContext } from "./git.js";
import { compareBinding } from "./guard.js";
import type { RebindWriter } from "./resolution.js";
import { confirmRebind } from "./ui.js";
import type {
	GitContext,
	MismatchKind,
	SessionBranchBinding,
} from "./types.js";

/** 分支不匹配处理器（由工厂内部闭包提供，携带 blocked 状态）。 */
export type MismatchHandler = (
	ctx: ExtensionCommandContext,
	binding: SessionBranchBinding,
	gitContext: GitContext,
	mismatch: MismatchKind,
	writer: RebindWriter,
) => Promise<boolean>;

/** 当前会话写入器（session_start 补偿与 resolve/rebind 命令）。 */
function currentRebindWriter(pi: ExtensionAPI): RebindWriter {
	return { write: (binding) => appendBindingCurrent(pi, binding) };
}

/** 注册 /session-branch 命令。 */
export function registerSessionBranchCommand(
	pi: ExtensionAPI,
	options: {
		getBlocked: () => boolean;
		handleMismatch: MismatchHandler;
	},
): void {
	pi.registerCommand("session-branch", {
		description: "查看或处理会话与 Git 分支绑定（status/resolve/rebind）",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const sub = (args ?? "").trim().split(/\s+/)[0] ?? "";
			if (sub === "status" || sub === "") {
				await showStatus(pi, ctx, options.getBlocked());
				return;
			}
			if (sub === "resolve") {
				await runResolve(pi, ctx, options.handleMismatch);
				return;
			}
			if (sub === "rebind") {
				await runRebind(pi, ctx);
				return;
			}
			ctx.ui.notify("用法：/session-branch [status|resolve|rebind]", "warning");
		},
	});
}

async function showStatus(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	blocked: boolean,
): Promise<void> {
	const gitContext = await readGitContext(pi, ctx.cwd);
	const binding = readBinding(ctx.sessionManager.getEntries());
	const dirty = gitContext.repoRoot
		? await readDirtySummary(pi, gitContext.repoRoot)
		: undefined;
	let currentBranch: string;
	if (gitContext.branch) currentBranch = gitContext.branch;
	else currentBranch = gitContext.isRepo ? "(detached)" : "(非 Git)";
	let workspace: string;
	if (!dirty) workspace = "-";
	else if (dirty.total === 0) workspace = "clean";
	else
		workspace = `${dirty.total} 处改动（暂存 ${dirty.staged} / 未暂存 ${dirty.unstaged} / 未跟踪 ${dirty.untracked}）`;
	const lines = [
		`会话: ${ctx.sessionManager.getSessionId()}`,
		`仓库: ${binding?.repoRoot ?? gitContext.repoRoot ?? "(非 Git)"}`,
		`绑定分支: ${binding?.gitBranch ?? "(未绑定)"}`,
		`当前分支: ${currentBranch}`,
		`工作区: ${workspace}`,
		`状态: ${blocked ? "已阻塞（分支不匹配）" : "正常"}`,
	];
	ctx.ui.notify(lines.join("\n"), blocked ? "warning" : "info");
}

async function runResolve(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	handleMismatch: MismatchHandler,
): Promise<void> {
	const gitContext = await readGitContext(pi, ctx.cwd);
	const binding = readBinding(ctx.sessionManager.getEntries());
	if (!binding) {
		if (!gitContext.isRepo || !gitContext.repoRoot || !gitContext.branch) {
			ctx.ui.notify("会话未绑定分支且当前没有可用 Git 分支", "warning");
			return;
		}
		appendBindingCurrent(pi, createBinding(gitContext, "adopted"));
		ctx.ui.notify(`会话已关联到当前分支 ${gitContext.branch}`, "success");
		return;
	}
	const mismatch = compareBinding(binding, gitContext);
	if (mismatch === "same") {
		ctx.ui.notify("会话与当前分支一致，无需处理", "info");
		return;
	}
	await handleMismatch(
		ctx,
		binding,
		gitContext,
		mismatch,
		currentRebindWriter(pi),
	);
}

async function runRebind(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const gitContext = await readGitContext(pi, ctx.cwd);
	if (!gitContext.isRepo || !gitContext.repoRoot || !gitContext.branch) {
		ctx.ui.notify("rebind 需要当前处于 Git 仓库的具体分支", "warning");
		return;
	}
	const binding = readBinding(ctx.sessionManager.getEntries());
	if (binding && compareBinding(binding, gitContext) === "repo-differs") {
		ctx.ui.notify("会话绑定的是另一个仓库，首版不支持跨仓库 rebind", "warning");
		return;
	}
	const ok = binding
		? await confirmRebind(ctx, binding, gitContext.branch)
		: true;
	if (!ok) return;
	appendBindingCurrent(
		pi,
		createBinding(gitContext, binding ? "rebound" : "created"),
	);
	ctx.ui.notify(`会话已重新绑定到 ${gitContext.branch}`, "success");
}
