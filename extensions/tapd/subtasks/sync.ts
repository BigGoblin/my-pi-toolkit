import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { fetchStoryChildren } from "../core/api.js";
import { getCollaborationDocPath, getDesignDocPath } from "../sessions/docs.js";
import type { TapdConfig } from "../types.js";
import { buildSubtaskPlan, buildSynchronizedSubtaskPlan } from "./plan.js";
import { parseDevelopmentTasks } from "./parser.js";
import {
	buildSubtaskDescription,
	createSubtaskOnTapd,
	fetchSubtaskSyncContext,
	updateSubtaskOnTapd,
} from "./api-sync.js";
import { isAbortError, withTapdWorking } from "../working.js";
import { readSubtaskState, updateSubtaskState } from "./state.js";

export async function createSubtasks(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: TapdConfig,
): Promise<void> {
	const state = readSubtaskState(ctx);
	if (!state) {
		ctx.ui.notify(
			"当前会话没有关联 TAPD 需求，请先从 TAPD 创建或切换关联会话",
			"warning",
		);
		return;
	}
	if (state.kind === "bug") {
		ctx.ui.notify("Bug 暂不支持创建子需求，请切换到需求会话", "warning");
		return;
	}
	const storyId = state.itemId;
	const designFile = getDesignDocPath(ctx.cwd, `story-${storyId}`);
	if (!existsSync(designFile)) {
		ctx.ui.notify(
			`未找到技术设计文档，请先执行 /tapd design：${designFile}`,
			"warning",
		);
		return;
	}
	const markdown = readFileSync(designFile, "utf-8").trim();
	if (!markdown) {
		ctx.ui.notify("技术设计文档为空，无法创建子需求", "warning");
		return;
	}
	const collaborationFile = getCollaborationDocPath(
		ctx.cwd,
		`story-${storyId}`,
	);
	if (!existsSync(collaborationFile)) {
		ctx.ui.notify(
			`未找到评审协作文档，请先执行 /tapd collaboration：${collaborationFile}`,
			"warning",
		);
		return;
	}
	const collaborationMarkdown = readFileSync(collaborationFile, "utf-8").trim();
	if (!collaborationMarkdown) {
		ctx.ui.notify("评审协作文档为空，无法创建设计子需求", "warning");
		return;
	}
	const designHash = createHash("sha256").update(markdown).digest("hex");
	const collaborationHash = createHash("sha256")
		.update(collaborationMarkdown)
		.digest("hex");
	let suggestions;
	try {
		suggestions = parseDevelopmentTasks(markdown);
	} catch (error) {
		ctx.ui.notify(
			`design.md 中的 TAPD 子需求拆分无效：${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return;
	}

	let created = state.subtasks ?? [];
	let plan = state.subtaskPlan;
	const contentChanged =
		plan &&
		(plan.designContentHash !== designHash ||
			plan.collaborationContentHash !== collaborationHash);
	if (plan && contentChanged && created.length > 0) {
		plan =
			(await buildSynchronizedSubtaskPlan(
				ctx,
				plan,
				designFile,
				designHash,
				collaborationHash,
				state.itemName,
				suggestions,
			)) ?? undefined;
		if (!plan) return;
		updateSubtaskState(pi, ctx, (next) => {
			next.subtaskPlan = plan;
		});
	} else if (plan && contentChanged) {
		plan = undefined;
	}
	if (!plan) {
		plan =
			(await buildSubtaskPlan(
				ctx,
				designFile,
				designHash,
				collaborationHash,
				state.itemName,
				suggestions,
			)) ?? undefined;
		if (!plan) return;
		updateSubtaskState(pi, ctx, (next) => {
			next.subtaskPlan = plan;
			next.subtasks = created;
		});
	}
	await withTapdWorking(ctx, "tapd-sub-task", async (cancel) => {
		cancel?.setMessage("Working... 正在获取远端子需求...");
		let syncContext;
		let remoteChildren;
		try {
			[syncContext, remoteChildren] = await Promise.all([
				fetchSubtaskSyncContext(config, state.workspaceId, storyId),
				fetchStoryChildren(state.workspaceId, storyId, config),
			]);
		} catch (error) {
			if (isAbortError(error) || cancel?.signal.aborted) throw error;
			ctx.ui.notify(
				`获取 TAPD 远端子需求失败，已停止同步：${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
			return;
		}
		cancel?.throwIfAborted();
		if (!syncContext) {
			ctx.ui.notify("获取父需求或当前 TAPD 用户失败", "error");
			return;
		}
		const { owner, types, inheritedFields } = syncContext;
		const remoteIds = new Set(remoteChildren.map((child) => child.id));
		const activeCreated = created.filter((item) => remoteIds.has(item.tapdId));
		const staleCount = created.length - activeCreated.length;
		if (staleCount > 0) {
			created = activeCreated;
			updateSubtaskState(pi, ctx, (next) => {
				next.subtasks = created;
			});
			ctx.ui.notify(
				`检测到 ${staleCount} 个远端已删除子需求，将按原计划重建`,
				"info",
			);
		}

		const pendingCount = plan.items.filter(
			(item) => !created.some((done) => done.localId === item.localId),
		).length;
		const updatingCount = plan.items.length - pendingCount;
		cancel?.setMessage(
			`Working... 同步 ${updatingCount} 个已有、创建 ${pendingCount} 个缺失子需求`,
		);

		const persist = (): void => {
			updateSubtaskState(pi, ctx, (next) => {
				next.subtasks = created;
			});
		};

		for (const [index, item] of plan.items.entries()) {
			cancel?.throwIfAborted();
			cancel?.setMessage(
				`Working... 子需求 ${index + 1}/${plan.items.length}：${item.title}`,
			);
			const existing = created.find((done) => done.localId === item.localId);
			const description = await buildSubtaskDescription(
				item,
				state.itemName,
				created,
				collaborationMarkdown,
			);
			if (existing) {
				const ok = await updateSubtaskOnTapd(
					config,
					state.workspaceId,
					existing,
					item,
					description,
					owner,
				);
				if (!ok) {
					ctx.ui.notify(`${item.title} 同步失败，再次执行可重试`, "error");
					return;
				}
				existing.title = item.title;
				existing.effort = item.effort;
				existing.updatedAt = new Date().toISOString();
				persist();
				ctx.ui.notify(`${item.title} 已同步：${existing.tapdUrl}`, "info");
				continue;
			}

			try {
				const result = await createSubtaskOnTapd(
					config,
					state.workspaceId,
					storyId,
					item,
					description,
					owner,
					types,
					inheritedFields,
				);
				created.push(result);
				persist();
				ctx.ui.notify(`${item.title} 已创建：${result.tapdUrl}`, "info");
			} catch (error) {
				if (isAbortError(error) || cancel?.signal.aborted) throw error;
				ctx.ui.notify(
					`${error instanceof Error ? error.message : String(error)}。再次执行可继续补建。`,
					"error",
				);
				return;
			}
		}

		ctx.ui.notify(
			`TAPD 子需求已全部创建：\n${created
				.map(
					(item, index) =>
						`${index + 1}. [${item.kind === "design" ? "设计" : "开发"}] ${item.title}\n${item.tapdUrl}`,
				)
				.join("\n")}`,
			"info",
		);
	});
}
