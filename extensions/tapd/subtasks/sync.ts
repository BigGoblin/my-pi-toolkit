import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { marked } from "marked";
import { fetchStoryDetail, fetchUserInfo } from "../core/api.js";
import { apiUrl, tapdGet, tapdPost } from "../core/http.js";
import { storyUrl } from "../todo/model.js";
import {
	findSessionLink,
	getCollaborationDocPath,
	getDesignDocPath,
	saveLinks,
} from "../sessions/storage.js";
import { parseDevelopmentTasks } from "./parser.js";
import { buildSubtaskPlan, buildSynchronizedSubtaskPlan } from "./plan.js";
import type {
	DevelopmentTaskSuggestion,
	SubtaskPlanItem,
	TapdConfig,
	TapdResponse,
} from "../types.js";
export async function createSubtasks(
	ctx: ExtensionCommandContext,
	config: TapdConfig,
): Promise<void> {
	const current = findSessionLink(ctx.sessionManager.getSessionFile?.() ?? "");
	if (!current) {
		ctx.ui.notify(
			"当前会话没有关联 TAPD 需求，请先从 TAPD 创建或切换关联会话",
			"warning",
		);
		return;
	}
	if (current.record.kind === "bug") {
		ctx.ui.notify("Bug 暂不支持创建子需求，请切换到需求会话", "warning");
		return;
	}
	const designFile = getDesignDocPath(
		ctx.cwd,
		`story-${current.record.storyId}`,
	);
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
		`story-${current.record.storyId}`,
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
	let suggestions: DevelopmentTaskSuggestion[];
	try {
		suggestions = parseDevelopmentTasks(markdown);
	} catch (error) {
		ctx.ui.notify(
			`design.md 中的 TAPD 子需求拆分无效：${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return;
	}

	const created = current.session.subtasks ?? [];
	let plan = current.session.subtaskPlan;
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
				current.record.name,
				suggestions,
			)) ?? undefined;
		if (!plan) return;
		synchronizeExisting = true;
		current.session.subtaskPlan = plan;
		saveLinks(current.links);
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
				current.record.name,
				suggestions,
			)) ?? undefined;
		if (!plan) return;
		current.session.subtaskPlan = plan;
		current.session.subtasks = created;
		saveLinks(current.links);
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
	const [parentStory, user, workitemTypes] = await Promise.all([
		fetchStoryDetail(
			current.record.workspaceId,
			current.record.storyId,
			config,
		),
		fetchUserInfo(config),
		tapdGet<
			TapdResponse<{
				WorkitemType: { id: string; name: string; english_name?: string };
			}>
		>(
			apiUrl(config, "/workitem_types", {
				workspace_id: current.record.workspaceId,
				status: "3",
				limit: "200",
			}),
			config,
		),
	]);
	if (!parentStory || !user?.nick) {
		ctx.ui.notify("获取父需求或当前 TAPD 用户失败", "error");
		return;
	}
	const types = workitemTypes?.data?.map((row) => row.WorkitemType) ?? [];
	const designType =
		types.find((type) => type.english_name === "design") ??
		types.find((type) => type.name === "设计子需求");
	const developmentType =
		types.find((type) =>
			["development", "develop"].includes(type.english_name ?? ""),
		) ?? types.find((type) => type.name === "开发子需求");
	if (!designType?.id || !developmentType?.id) {
		ctx.ui.notify(
			"当前工作空间未同时找到“设计子需求”和“开发子需求”类型",
			"error",
		);
		return;
	}
	const inheritedFields = Object.fromEntries(
		[
			"priority_label",
			"iteration_id",
			"category_id",
			"release_id",
			"module",
			"version",
			"source",
			"feature",
			"label",
			"cc",
			"begin",
			"due",
		]
			.map((field) => [field, parentStory[field as keyof typeof parentStory]])
			.filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === "string" && entry[1] !== "",
			),
	);

	const buildSubtaskDescription = (item: SubtaskPlanItem): string => {
		if (item.kind === "design") return collaborationMarkdown;
		const designResult = created.find((done) => done.kind === "design");
		return [
			"## 开发范围",
			...item.scope.map((value) => `- ${value}`),
			"",
			"## 验收标准",
			...item.acceptanceCriteria.map((value) => `- ${value}`),
			"",
			"## 依赖关系",
			...(item.dependencies.length > 0
				? item.dependencies.map((value) => `- ${value}`)
				: ["无"]),
			"",
			"## 关联设计",
			`- 父需求：${current.record.name}`,
			`- 设计子需求：${designResult?.tapdUrl ?? "本批次创建"}`,
		].join("\n");
	};

	for (const item of updating) {
		const existing = created.find((done) => done.localId === item.localId);
		if (!existing) continue;
		const response = await tapdPost<{ status: number; data?: unknown }>(
			apiUrl(config, "/stories"),
			config,
			{
				workspace_id: current.record.workspaceId,
				id: existing.tapdId,
				name: item.title,
				description: await marked.parse(buildSubtaskDescription(item), {
					gfm: true,
					breaks: false,
				}),
				effort: String(item.effort),
				owner: user.nick,
				developer: user.nick,
			},
		);
		if (!response) {
			ctx.ui.notify(`${item.title} 同步失败，再次执行可重试`, "error");
			return;
		}
		existing.title = item.title;
		existing.effort = item.effort;
		existing.updatedAt = new Date().toISOString();
		current.session.subtasks = created;
		saveLinks(current.links);
		ctx.ui.notify(`${item.title} 已同步：${existing.tapdUrl}`, "success");
	}

	for (const item of pending) {
		const source = buildSubtaskDescription(item);
		try {
			const response = await tapdPost<{
				status: number;
				data?: { Story?: { id: string } };
			}>(apiUrl(config, "/stories"), config, {
				workspace_id: current.record.workspaceId,
				name: item.title,
				description: await marked.parse(source, { gfm: true, breaks: false }),
				parent_id: current.record.storyId,
				workitem_type_id:
					item.kind === "design" ? designType.id : developmentType.id,
				effort: String(item.effort),
				owner: user.nick,
				developer: user.nick,
				...inheritedFields,
			});
			const childId = response?.data?.Story?.id;
			if (!childId) throw new Error("接口未返回子需求 ID");
			const result = {
				localId: item.localId,
				kind: item.kind,
				title: item.title,
				effort: item.effort,
				tapdId: childId,
				tapdUrl: storyUrl(current.record.workspaceId, childId),
				createdAt: new Date().toISOString(),
			};
			created.push(result);
			current.session.subtasks = created;
			saveLinks(current.links);
			ctx.ui.notify(`${item.title} 已创建：${result.tapdUrl}`, "success");
		} catch (error) {
			ctx.ui.notify(
				`${item.title} 创建失败：${error instanceof Error ? error.message : String(error)}。再次执行可继续补建。`,
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
