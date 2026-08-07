import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import { restackAboveEditorWidgets } from "./widget-restack.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

export function abortError(message = "已取消：用户按 Esc 中止"): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

/**
 * Slash command 期间展示与对话区类似的 Working 行，并监听 Esc → AbortSignal。
 * （Pi 的 setWorkingVisible 仅在 streaming 时生效，故用 widget 模拟。）
 */
export class WorkingCancel {
	readonly signal: AbortSignal;
	private readonly controller = new AbortController();
	private readonly unsub?: () => void;
	private message = "Working...";
	private suspended = false;
	private disposed = false;
	private frame = 0;
	private timer?: ReturnType<typeof setInterval>;
	private requestRender?: () => void;

	constructor(
		private readonly ctx: ExtensionContext,
		private readonly key: string,
	) {
		this.signal = this.controller.signal;
		if (!ctx.hasUI) return;
		this.unsub = ctx.ui.onTerminalInput((data) => {
			if (this.disposed || this.suspended) return;
			if (matchesKey(data, "escape")) this.controller.abort();
		});
		this.show();
	}

	throwIfAborted(): void {
		if (this.signal.aborted) throw abortError();
	}

	/** 对话框/Overlay 期间：隐藏 Working，Esc 交给对话框。 */
	suspend(): void {
		this.suspended = true;
		this.hideWidget();
	}

	/** 对话框结束后恢复 Working（若已 abort 则不再显示）。 */
	resume(message?: string): void {
		this.suspended = false;
		if (message) this.message = message;
		if (!this.disposed && !this.signal.aborted) this.show();
	}

	setMessage(message: string): void {
		this.message = message;
		if (!this.suspended && !this.disposed && !this.signal.aborted) {
			this.requestRender?.();
		}
	}

	dispose(): void {
		this.disposed = true;
		this.unsub?.();
		this.hideWidget();
	}

	private show(): void {
		this.ctx.ui.setWidget(
			this.key,
			(tui: TUI, theme: Theme) => {
				this.requestRender = () => tui.requestRender();
				this.timer ??= setInterval(() => {
					this.frame = (this.frame + 1) % SPINNER.length;
					this.requestRender?.();
				}, 80);
				return {
					render: () => [
						`${theme.fg("accent", SPINNER[this.frame])} ${theme.fg("muted", `${this.message} (Esc 取消)`)}`,
					],
					invalidate(): void {},
					dispose: () => {
						if (this.timer) {
							clearInterval(this.timer);
							this.timer = undefined;
						}
					},
				};
			},
			{ placement: "aboveEditor" },
		);
		// TASKS 等后挂载的面板会排在下方，Working 保持在最上方
		restackAboveEditorWidgets(this.ctx);
	}

	private hideWidget(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.requestRender = undefined;
		this.ctx.ui.setWidget(this.key, undefined);
	}
}

/** 兼容旧 Git 模块命名。 */
export { WorkingCancel as GitWorkingCancel };
