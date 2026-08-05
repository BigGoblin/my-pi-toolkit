import {
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
	type InputEvent,
	type SessionBeforeSwitchEvent,
	type SessionShutdownEvent,
	type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { appendBindingCurrent, createBinding, readBinding } from "./binding.js";
import { readGitContext } from "./git.js";
import { compareBinding } from "./guard.js";
import {
	resolveBranchMismatch,
	targetRebindWriter,
	type RebindWriter,
} from "./resolution.js";
import type {
	GitContext,
	MismatchKind,
	SessionBranchBinding,
} from "./types.js";
import { registerSessionBranchCommand } from "./commands.js";

const STATUS_KEY = "session-branch";

/** 无 UI（print/json）场景的错误输出，避免 console.* 规则告警。 */
function logHeadless(message: string): void {
	process.stderr.write(`[session-branch] ${message}\n`);
}

/** 当前会话写入器（session_start 补偿路径）。 */
function currentRebindWriter(pi: ExtensionAPI): RebindWriter {
	return { write: (binding) => appendBindingCurrent(pi, binding) };
}

export function sessionBranchGuard(pi: ExtensionAPI): void {
	let blocked = false;
	let blockNotified = false;

	const setBlock = (ctx: ExtensionContext): void => {
		blocked = true;
		blockNotified = false;
		ctx.ui.setStatus(STATUS_KEY, "分支不匹配");
	};

	const clearBlock = (ctx: ExtensionContext): void => {
		blocked = false;
		blockNotified = false;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	};

	/**
	 * 处理已存在 binding 的不匹配：repo-differs / detached 只阻塞并提示；
	 * branch-differs 走完整解决流程。返回是否已解决（允许继续）。
	 */
	async function handleMismatch(
		ctx: ExtensionContext,
		binding: SessionBranchBinding,
		gitContext: GitContext,
		mismatch: MismatchKind,
		writer: RebindWriter,
	): Promise<boolean> {
		if (mismatch === "repo-differs") {
			setBlock(ctx);
			const message = `该会话绑定的是另一个仓库（${binding.repoRoot}），无法在当前位置继续；请先 cd 到对应仓库再恢复`;
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else logHeadless(message);
			return false;
		}
		if (mismatch === "detached") {
			setBlock(ctx);
			const message =
				"当前处于 detached HEAD，会话已绑定具体分支；请先手动切换到一个分支，或执行 /session-branch rebind 重新绑定";
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else logHeadless(message);
			return false;
		}
		if (!ctx.hasUI) {
			setBlock(ctx);
			logHeadless(
				`会话绑定分支 ${binding.gitBranch}，当前 ${gitContext.branch ?? "(detached)"}；无 UI 环境不自动执行 Git 变更，已保持阻塞`,
			);
			return false;
		}
		setBlock(ctx);
		const outcome = await resolveBranchMismatch(
			pi,
			ctx,
			binding,
			gitContext,
			writer,
		);
		if (outcome.kind === "switched" || outcome.kind === "rebound") {
			clearBlock(ctx);
			return true;
		}
		if (outcome.kind === "failed")
			ctx.ui.notify(`分支不匹配未解决：${outcome.error}`, "warning");
		return false;
	}

	// —— 会话启动 / 补偿路径 ——
	pi.on(
		"session_start",
		async (event: SessionStartEvent, ctx: ExtensionContext) => {
			const gitContext = await readGitContext(pi, ctx.cwd);
			if (!gitContext.isRepo || !gitContext.repoRoot) return;
			const entries = ctx.sessionManager.getEntries();
			const binding = readBinding(entries);
			if (!binding) {
				// 无绑定：新会话直接创建；历史会话首次升级标记为 adopted
				if (!gitContext.branch) return; // detached 不自动创建
				const fresh =
					event.reason === "new" ||
					event.reason === "fork" ||
					(event.reason === "startup" && entries.length === 0);
				appendBindingCurrent(
					pi,
					createBinding(gitContext, fresh ? "created" : "adopted"),
				);
				if (!fresh)
					ctx.ui.notify(
						`已将此会话关联到当前分支 ${gitContext.branch}`,
						"info",
					);
				return;
			}
			const mismatch = compareBinding(binding, gitContext);
			if (mismatch === "same") return;
			await handleMismatch(
				ctx,
				binding,
				gitContext,
				mismatch,
				currentRebindWriter(pi),
			);
		},
	);

	// —— /resume 前置拦截 ——
	// 必须用目标会话自身的 cwd 做 Git 校验：Pi resume 后会切到该目录。
	// 若仍用切换前的 ctx.cwd，跨项目会话（如 TAPD 在其他仓库创建）会被误判为跨仓库并取消。
	pi.on(
		"session_before_switch",
		async (event: SessionBeforeSwitchEvent, ctx: ExtensionContext) => {
			if (event.reason !== "resume" || !event.targetSessionFile) return;
			let target: SessionManager;
			try {
				target = SessionManager.open(event.targetSessionFile);
			} catch {
				return; // 目标会话不可读，交给 Pi 自身处理
			}
			const binding = readBinding(target.getEntries());
			if (!binding) return; // 无绑定：允许恢复，start 时 adopt
			const sessionCwd = target.getCwd() || ctx.cwd;
			const gitContext = await readGitContext(pi, sessionCwd);
			if (!gitContext.isRepo || !gitContext.repoRoot) return;
			const mismatch = compareBinding(binding, gitContext);
			if (mismatch === "same") return;
			if (mismatch === "repo-differs") {
				ctx.ui.notify(
					`目标会话绑定仓库（${binding.repoRoot}）与会话目录（${sessionCwd}）不一致，已取消恢复`,
					"warning",
				);
				return { cancel: true };
			}
			if (mismatch === "detached") {
				ctx.ui.notify(
					"会话目录处于 detached HEAD，请先在该仓库手动切换分支后再恢复该会话",
					"warning",
				);
				return { cancel: true };
			}
			if (!ctx.hasUI) {
				ctx.ui.notify(
					`目标会话绑定分支 ${binding.gitBranch}，会话目录当前 ${gitContext.branch}；无 UI 环境不自动执行 Git 变更，已取消恢复`,
					"warning",
				);
				return { cancel: true };
			}
			const outcome = await resolveBranchMismatch(
				pi,
				ctx,
				binding,
				gitContext,
				targetRebindWriter(target),
			);
			if (outcome.kind === "switched") return; // 已切回绑定分支，允许恢复
			if (outcome.kind === "rebound") {
				// 校验目标会话确实持久化了 rebind
				try {
					const verify = SessionManager.open(event.targetSessionFile);
					const latest = readBinding(verify.getEntries());
					if (latest?.gitBranch === gitContext.branch) return;
				} catch {
					// fallthrough：校验失败按取消处理
				}
				ctx.ui.notify("rebind 未能持久化到目标会话，已取消恢复", "error");
			}
			return { cancel: true };
		},
	);

	// —— 会话运行期间分支漂移门禁 ——
	pi.on("input", async (event: InputEvent, ctx: ExtensionContext) => {
		if (event.source === "extension") return;
		const gitContext = await readGitContext(pi, ctx.cwd);
		if (!gitContext.isRepo || !gitContext.repoRoot) return;
		const binding = readBinding(ctx.sessionManager.getEntries());
		if (!binding) return;
		const mismatch = compareBinding(binding, gitContext);
		if (mismatch === "same") {
			if (blocked) clearBlock(ctx);
			return;
		}
		if (!ctx.hasUI) {
			blocked = true;
			ctx.ui.setStatus(STATUS_KEY, "分支不匹配");
			logHeadless(
				`已阻止输入：会话绑定分支 ${binding.gitBranch}，当前 ${gitContext.branch ?? "(detached)"}`,
			);
			return { action: "handled" };
		}
		setBlock(ctx);
		if (!blockNotified) {
			blockNotified = true;
			ctx.ui.notify(
				`当前分支 ${gitContext.branch ?? "(detached)"} 与会话绑定分支 ${binding.gitBranch} 不一致，已阻止本次输入；请运行 /session-branch resolve 处理`,
				"warning",
			);
		}
		return { action: "handled" };
	});

	// —— 清理 ——
	pi.on(
		"session_shutdown",
		(_event: SessionShutdownEvent, ctx: ExtensionContext) => {
			blocked = false;
			blockNotified = false;
			ctx.ui.setStatus(STATUS_KEY, undefined);
		},
	);

	// —— 命令 ——
	registerSessionBranchCommand(pi, {
		getBlocked: () => blocked,
		handleMismatch,
	});
}
