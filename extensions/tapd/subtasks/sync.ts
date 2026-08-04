import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
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

	const created = state.subtasks ?? [];
	let plan = state.subtaskPlan;
	let synchronizeExisting = false;
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
		synchronizeExisting = true;
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
	const pending = plan.items.filter(
		(item) => !created.some((done) => done.localId === item.localId),
	);
	const updating = synchronizeExisting
		? plan.items.filter((item) =>
				created.some((done) => done.localId === item.localId),
			)
		: [];
	if (pending.length === 0 && updating.length === 0) {
		ctx.ui.notify(
			`所有子需求均已创建：\n${created.map((item) => item.tapdUrl).join("\n")}`,
			"info",
		);
		return;
	}

	ctx.ui.notify(
		updating.length > 0
			? `正在同步 ${updating.length} 个已有子需求，并创建 ${pending.length} 个新增子需求...`
			: `正在创建 ${pending.length} 个 TAPD 子需求...`,
		"info",
	);
	const syncContext = await fetchSubtaskSyncContext(
		config,
		state.workspaceId,
		storyId,
	);
	if (!syncContext) {
		ctx.ui.notify("获取父需求或当前 TAPD 用户失败", "error");
		return;
	}
	const { owner, types, inheritedFields } = syncContext;

	const persist = (subtasks: typeof created): void => {
		updateSubtaskState(pi, ctx, (next) => {
			next.subtasks = subtasks;
		});
	};

	for (const item of updating) {
		const existing = created.find((done) => done.localId === item.localId);
		if (!existing) continue;
		const description = await buildSubtaskDescription(
			item,
			state.itemName,
			created,
			collaborationMarkdown,
		);
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
		persist(created);
		ctx.ui.notify(`${item.title} 已同步：${existing.tapdUrl}`, "success");
	}

	for (const item of pending) {
		const description = await buildSubtaskDescription(
			item,
			state.itemName,
			created,
			collaborationMarkdown,
		);
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
			persist(created);
			ctx.ui.notify(`${item.title} 已创建：${result.tapdUrl}`, "success");
		} catch (error) {
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
		"success",
	);
}
