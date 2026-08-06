import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { fetchUserInfo } from "../core/api.js";
import type { TapdConfig } from "../types.js";
import { withTapdListOverlays } from "../todo/overlay-context.js";
import { bugUrl } from "../todo/model.js";
import { readTapdSessionState } from "../sessions/session-state.js";
import {
	fetchBugRejectFields,
	updateBugReject,
} from "./bug-reject-api.js";
import {
	showBugRejectForm,
	type BugRejectFormState,
} from "./bug-reject-form.js";
import {
	showOverlayLineInput,
	showOverlayMultilineEditor,
} from "./bug-reject-editors.js";
import { extractLocateReason } from "./bug-reject-reason.js";

function defaultResolutionIndex(
	options: Array<{ key: string; label: string }>,
): number {
	const preferred = ["intentional design", "ignore", "failed to recur"];
	for (const key of preferred) {
		const index = options.findIndex((option) => option.key === key);
		if (index >= 0) return index;
	}
	return 0;
}

export async function rejectTapdBug(
	_pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: TapdConfig,
): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent 正在执行，请稍后再试", "warning");
		return;
	}
	const state = readTapdSessionState(ctx.sessionManager.getEntries());
	if (!state) {
		ctx.ui.notify(
			"当前会话没有关联 TAPD 条目，请先从 TAPD 缺陷列表创建或切换会话",
			"warning",
		);
		return;
	}
	if (state.kind !== "bug") {
		ctx.ui.notify("/tapd bug-reject 只能在 Bug 会话中执行", "warning");
		return;
	}

	ctx.ui.notify("正在准备拒绝表单...", "info");
	const user = await fetchUserInfo(config);
	if (!user?.nick) {
		ctx.ui.notify("无法获取当前 TAPD 用户，请检查令牌", "error");
		return;
	}

	let fields;
	try {
		fields = await fetchBugRejectFields(config, state.workspaceId);
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
		return;
	}

	const ui = withTapdListOverlays(ctx).ui;
	let draft: BugRejectFormState = {
		reason: extractLocateReason(ctx.sessionManager.getEntries()),
		resolutionIndex: defaultResolutionIndex(fields.resolutionOptions),
		developer: user.nick,
		needFaq: "否",
	};
	const title = `拒绝 Bug ${state.itemId} · ${state.itemName}`;

	while (true) {
		const result = await showBugRejectForm(
			ui,
			title,
			draft,
			fields.resolutionOptions,
		);
		if (!result) {
			ctx.ui.notify("已取消拒绝", "info");
			return;
		}
		draft = result.state;
		if (result.action === "pick-reason") {
			const edited = await showOverlayMultilineEditor(
				ui,
				"评价原因",
				draft.reason,
			);
			if (edited != null) draft.reason = edited;
			continue;
		}
		if (result.action === "pick-resolution") {
			const labels = fields.resolutionOptions.map((option) => option.label);
			const picked = await ui.select("选择解决方法", labels);
			if (picked) {
				const index = fields.resolutionOptions.findIndex(
					(option) => option.label === picked,
				);
				if (index >= 0) draft.resolutionIndex = index;
			}
			continue;
		}
		if (result.action === "pick-developer") {
			const edited = await showOverlayLineInput(
				ui,
				"开发人员",
				draft.developer,
			);
			if (edited != null) {
				draft.developer = edited.trim() || draft.developer;
			}
			continue;
		}

		const resolution = fields.resolutionOptions[draft.resolutionIndex];
		if (!resolution) {
			ctx.ui.notify("请选择解决方法", "warning");
			continue;
		}
		if (!draft.developer.trim()) {
			ctx.ui.notify("开发人员不能为空", "warning");
			continue;
		}

		ctx.ui.notify("正在更新 TAPD 缺陷为已拒绝...", "info");
		try {
			await updateBugReject(config, state.workspaceId, state.itemId, fields, {
				reason: draft.reason.trim(),
				resolutionKey: resolution.key,
				developer: draft.developer.trim(),
				needFaq: draft.needFaq,
				author: user.nick,
			});
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
			return;
		}
		ctx.ui.notify(
			`Bug ${state.itemId} → 已拒绝 · ${resolution.label} · FAQ ${draft.needFaq} · 处理人=测试人员\n${bugUrl(state.workspaceId, state.itemId)}`,
			"success",
		);
		return;
	}
}
