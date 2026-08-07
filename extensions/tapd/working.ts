import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	WorkingCancel,
	abortError,
	isAbortError,
} from "../shared/tui/working-cancel.js";

export { WorkingCancel, abortError, isAbortError };

/** 包住一段 TAPD 异步工作：显示 Working、Esc 取消，结束后清理。 */
export async function withTapdWorking<T>(
	ctx: ExtensionContext,
	key: string,
	run: (cancel: WorkingCancel | undefined) => Promise<T>,
): Promise<T | undefined> {
	const cancel = ctx.hasUI ? new WorkingCancel(ctx, key) : undefined;
	try {
		return await run(cancel);
	} catch (error) {
		if (isAbortError(error) || cancel?.signal.aborted) {
			ctx.ui.notify("已取消", "info");
			return undefined;
		}
		throw error;
	} finally {
		cancel?.dispose();
	}
}
