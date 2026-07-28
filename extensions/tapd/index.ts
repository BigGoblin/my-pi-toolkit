/**
 * TAPD 待办扩展 — 树形交互表格
 *
 * 使用 TAPD Bearer Token 认证（只需个人令牌）。
 * 通过 /user_oauth/get_user_todo_story 获取当前用户待办。
 *
 * 配置 ~/.pi/agent/tapd.json：
 * { "token": "你的TAPD个人令牌" }
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { marked } from "marked";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
	apiUrl,
	fetchBugDetail,
	fetchStoryDetail,
	fetchUserInfo,
	fetchWorkspaces,
	htmlToText,
	loadConfig,
	tapdGet,
	tapdPost,
} from "./api.js";
import { bugUrl, storyUrl } from "./model.js";
import {
	findSessionLink,
	getCollaborationDocPath,
	getOrCreateLink,
	getTapdDocPath,
	loadLinks,
	parseItemKey,
	rememberProjectPaths,
	saveLinks,
} from "./storage.js";
import { showTable } from "./ui.js";
import {
	ANALYZE_TRIGGER_PROMPT,
	COLLABORATION_TRIGGER_PROMPT,
	DESIGN_TRIGGER_PROMPT,
	buildBugContextPrompt,
	buildBugLocatePrompt,
	buildUnderstandPrompt,
} from "./prompts.js";
import type {
	CreateDraft,
	DevelopmentTaskSuggestion,
	SubtaskPlan,
	SubtaskPlanItem,
	TapdConfig,
	TapdResponse,
} from "./types.js";

async function createTapdSession(
	ctx: ExtensionCommandContext,
	config: TapdConfig,
	itemKey: string,
	itemName: string,
	draft: CreateDraft,
): Promise<void> {
	const parsed = parseItemKey(itemKey);
	const wsId = parsed.wsId;
	const itemId = parsed.itemId;
	const { title, projectPaths } = draft;
	rememberProjectPaths(projectPaths);

	const url =
		parsed.kind === "bug" ? bugUrl(wsId, itemId) : storyUrl(wsId, itemId);
	const detail =
		parsed.kind === "bug"
			? await fetchBugDetail(wsId, itemId, config)
			: await fetchStoryDetail(wsId, itemId, config);
	const description = detail?.description
		? htmlToText(String(detail.description))
		: "";
	const itemTitle =
		parsed.kind === "bug"
			? (detail as any)?.title || title
			: (detail as any)?.name || title;
	let understandingFile: string | undefined;
	let sessionPrompt: string;
	if (parsed.kind === "bug") {
		sessionPrompt = buildBugContextPrompt({
			title: itemTitle,
			bugId: itemId,
			url,
			description,
			projectPaths,
		});
	} else {
		// Use the TAPD story ID as the stable directory name so renaming the
		// requirement does not create a second document directory.
		understandingFile = getTapdDocPath(
			ctx.cwd,
			`story-${itemId}`,
			"understanding.md",
		);
		mkdirSync(dirname(understandingFile), { recursive: true });
		sessionPrompt = buildUnderstandPrompt({
			title: itemTitle,
			storyId: itemId,
			url,
			description,
			projectPaths,
			understandingFile,
		});
	}

	const links = loadLinks();
	const rec2 = getOrCreateLink(links, wsId, itemId, itemName, parsed.kind);
	const linkId =
		Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	rec2.sessions.push({
		id: linkId,
		createdAt: new Date().toISOString(),
		title,
		projectPaths: projectPaths.length > 0 ? projectPaths : undefined,
		understandingFile,
	});
	saveLinks(links);

	const result = await ctx.newSession({
		parentSession: undefined,
		setup: async (sm: SessionManager) => {
			sm.appendMessage({
				role: "user",
				content: [{ type: "text", text: sessionPrompt }],
				timestamp: Date.now(),
			});
		},
		withSession: async (replacementCtx: ExtensionCommandContext) => {
			const sf = replacementCtx.sessionManager.getSessionFile?.() ?? "";
			const links3 = loadLinks();
			const rec3 = getOrCreateLink(links3, wsId, itemId, itemName, parsed.kind);
			if (sf) {
				const lk = rec3.sessions.find((s) => s.id === linkId);
				if (lk) lk.sessionFile = sf;
			}
			saveLinks(links3);
			replacementCtx.ui.notify(
				parsed.kind === "bug"
					? "Bug 会话已创建，输入 /tapd bug 获取完整缺陷信息并定位原因"
					: "会话已创建，输入 /tapd analyze 开始需求理解",
				"info",
			);
		},
	});

	if (result.cancelled) {
		throw new Error("创建会话已取消");
	}
}

const SUBTASKS_START = "<!-- TAPD_SUBTASKS_START -->";
const SUBTASKS_END = "<!-- TAPD_SUBTASKS_END -->";

function parseDevelopmentTasks(markdown: string): DevelopmentTaskSuggestion[] {
	const start = markdown.indexOf(SUBTASKS_START);
	const end = markdown.indexOf(SUBTASKS_END, start + SUBTASKS_START.length);
	if (start < 0 || end < 0) throw new Error("缺少 TAPD 子需求拆分标记");
	const raw = markdown.slice(start + SUBTASKS_START.length, end).trim();
	let parsed: { developmentTasks?: unknown };
	try {
		parsed = JSON.parse(raw) as { developmentTasks?: unknown };
	} catch {
		throw new Error("TAPD 子需求拆分块不是合法 JSON");
	}
	if (
		!Array.isArray(parsed.developmentTasks) ||
		parsed.developmentTasks.length === 0
	)
		throw new Error("developmentTasks 必须是非空数组");
	if (parsed.developmentTasks.length > 5)
		throw new Error("开发子需求不能超过 5 个，请先在 design.md 中合并任务");

	const tasks = parsed.developmentTasks.map((value, index) => {
		if (!value || typeof value !== "object")
			throw new Error(`第 ${index + 1} 个开发子需求格式无效`);
		const task = value as Record<string, unknown>;
		const id = typeof task.id === "string" ? task.id.trim() : undefined;
		const title = typeof task.title === "string" ? task.title.trim() : "";
		const scope = Array.isArray(task.scope)
			? task.scope.filter(
					(item): item is string =>
						typeof item === "string" && item.trim() !== "",
				)
			: [];
		const acceptanceCriteria = Array.isArray(task.acceptanceCriteria)
			? task.acceptanceCriteria.filter(
					(item): item is string =>
						typeof item === "string" && item.trim() !== "",
				)
			: [];
		const dependencies = Array.isArray(task.dependencies)
			? task.dependencies.filter(
					(item): item is string =>
						typeof item === "string" && item.trim() !== "",
				)
			: [];
		const suggestedEffort = Number(task.suggestedEffort);
		if (!title || scope.length === 0 || acceptanceCriteria.length === 0)
			throw new Error(`第 ${index + 1} 个开发子需求缺少标题、范围或验收标准`);
		return {
			id,
			title,
			scope,
			acceptanceCriteria,
			dependencies,
			suggestedEffort:
				Number.isFinite(suggestedEffort) && suggestedEffort > 0
					? suggestedEffort
					: undefined,
		};
	});
	const titles = new Set(tasks.map((task) => task.title));
	if (titles.size !== tasks.length) throw new Error("开发子需求标题不能重复");
	const ids = tasks
		.map((task) => task.id)
		.filter((id): id is string => Boolean(id));
	if (new Set(ids).size !== ids.length)
		throw new Error("开发子需求 id 不能重复");
	for (const task of tasks) {
		if (task.dependencies.some((dependency) => !titles.has(dependency)))
			throw new Error(`“${task.title}”包含无法匹配的依赖任务`);
	}
	return tasks;
}

async function inputPositiveEffort(
	ctx: ExtensionCommandContext,
	label: string,
	suggested?: number,
	implementationSummary?: string,
): Promise<number | null> {
	const effortHint = suggested
		? `建议 ${suggested}，请输入大于 0 的数字`
		: "请输入大于 0 的数字，例如 2";
	const prompt = implementationSummary
		? `主要实现：${implementationSummary}\n${effortHint}`
		: effortHint;
	while (true) {
		const input = await ctx.ui.input(label, prompt);
		if (input === undefined || input === null) return null;
		const effort = Number(input.trim());
		if (Number.isFinite(effort) && effort > 0) return effort;
		ctx.ui.notify(`${label}必须是大于 0 的数字，请重新输入`, "error");
	}
}

async function buildSubtaskPlan(
	ctx: ExtensionCommandContext,
	designFile: string,
	designHash: string,
	collaborationHash: string,
	storyName: string,
	tasks: DevelopmentTaskSuggestion[],
): Promise<SubtaskPlan | null> {
	const summary = tasks
		.map((task, index) => `${index + 1}. 前端-${task.title}`)
		.join("\n");
	const useDesignSplit = await ctx.ui.confirm(
		"确认开发子需求拆分",
		`技术设计建议拆成 ${tasks.length} 个开发子需求：\n${summary}\n\n是否采用该拆分？选择否可自定义数量和标题。`,
	);

	let selected = tasks;
	if (!useDesignSplit) {
		const countInput = await ctx.ui.input("开发子需求数量", "请输入 1～5");
		if (countInput === undefined || countInput === null) return null;
		const count = Number(countInput.trim());
		if (!Number.isInteger(count) || count < 1 || count > 5) {
			ctx.ui.notify("开发子需求数量必须是 1～5 的整数", "error");
			return null;
		}
		selected = [];
		for (let index = 0; index < count; index += 1) {
			const suggested = tasks[index];
			const titleInput = await ctx.ui.input(
				`开发子需求 ${index + 1} 标题`,
				suggested?.title ?? "请输入可独立验收的业务任务标题",
			);
			if (!titleInput?.trim()) return null;
			const scopeInput = await ctx.ui.input(
				`开发子需求 ${index + 1} 范围`,
				suggested?.scope.join("；") ?? "使用；分隔多项范围",
			);
			if (!scopeInput?.trim()) return null;
			const acceptanceInput = await ctx.ui.input(
				`开发子需求 ${index + 1} 验收标准`,
				suggested?.acceptanceCriteria.join("；") ?? "使用；分隔多项标准",
			);
			if (!acceptanceInput?.trim()) return null;
			selected.push({
				title: titleInput.trim(),
				scope: scopeInput
					.split("；")
					.map((item: string) => item.trim())
					.filter(Boolean),
				acceptanceCriteria: acceptanceInput
					.split("；")
					.map((item: string) => item.trim())
					.filter(Boolean),
				dependencies: suggested?.dependencies ?? [],
				suggestedEffort: suggested?.suggestedEffort,
			});
		}
	}

	const designEffort = await inputPositiveEffort(ctx, "设计子需求工时");
	if (designEffort === null) return null;
	const items: SubtaskPlanItem[] = [
		{
			localId: "design",
			kind: "design",
			title: `前端-${storyName}设计`,
			scope: [],
			acceptanceCriteria: [],
			dependencies: [],
			effort: designEffort,
		},
	];
	for (let index = 0; index < selected.length; index += 1) {
		const task = selected[index];
		const implementationSummary = task.scope.slice(0, 3).join("；");
		const effort = await inputPositiveEffort(
			ctx,
			`开发子需求 ${index + 1} 工时｜${task.title}`,
			task.suggestedEffort,
			implementationSummary,
		);
		if (effort === null) return null;
		items.push({
			...task,
			localId: task.id ? `development-${task.id}` : `development-${index + 1}`,
			kind: "development",
			title: task.title.startsWith("前端-") ? task.title : `前端-${task.title}`,
			effort,
		});
	}
	const confirmed = await ctx.ui.confirm(
		"创建 TAPD 子需求",
		items
			.map(
				(item) =>
					`${item.kind === "design" ? "设计" : "开发"}：${item.title}（${item.effort}）`,
			)
			.join("\n"),
	);
	if (!confirmed) return null;
	return {
		designFile,
		designContentHash: designHash,
		collaborationContentHash: collaborationHash,
		confirmedAt: new Date().toISOString(),
		items,
	};
}

async function buildSynchronizedSubtaskPlan(
	ctx: ExtensionCommandContext,
	previous: SubtaskPlan,
	designFile: string,
	designHash: string,
	collaborationHash: string,
	storyName: string,
	tasks: DevelopmentTaskSuggestion[],
): Promise<SubtaskPlan | null> {
	const previousDevelopment = previous.items.filter(
		(item) => item.kind === "development",
	);
	const previousDesign = previous.items.find((item) => item.kind === "design");
	const items: SubtaskPlanItem[] = [
		{
			localId: "design",
			kind: "design",
			title: `前端-${storyName}设计`,
			scope: [],
			acceptanceCriteria: [],
			dependencies: [],
			effort: previousDesign?.effort ?? 1,
		},
	];

	for (let index = 0; index < tasks.length; index += 1) {
		const task = tasks[index];
		const stableLocalId = task.id ? `development-${task.id}` : undefined;
		const normalizedTitle = task.title.startsWith("前端-")
			? task.title
			: `前端-${task.title}`;
		const existing =
			(stableLocalId
				? previousDevelopment.find((item) => item.localId === stableLocalId)
				: undefined) ??
			previousDevelopment.find((item) => item.id && item.id === task.id) ??
			previousDevelopment.find((item) => item.title === normalizedTitle) ??
			previousDevelopment[index];
		let effort = existing?.effort;
		if (effort === undefined) {
			const enteredEffort = await inputPositiveEffort(
				ctx,
				`新增开发子需求 ${index + 1} 工时｜${task.title}`,
				task.suggestedEffort,
				task.scope.slice(0, 3).join("；"),
			);
			if (enteredEffort === null) return null;
			effort = enteredEffort;
		}
		items.push({
			...task,
			localId: existing?.localId ?? stableLocalId ?? `development-${index + 1}`,
			kind: "development",
			title: task.title.startsWith("前端-") ? task.title : `前端-${task.title}`,
			effort,
		});
	}

	const previousIds = new Set(previous.items.map((item) => item.localId));
	const nextIds = new Set(items.map((item) => item.localId));
	const updated = items.filter((item) => previousIds.has(item.localId));
	const added = items.filter((item) => !previousIds.has(item.localId));
	const removed = previous.items.filter(
		(item) => item.kind === "development" && !nextIds.has(item.localId),
	);
	const confirmed = await ctx.ui.confirm(
		"同步 TAPD 子需求",
		[
			`将更新 ${updated.length} 个已有子需求，新增 ${added.length} 个开发子需求。`,
			removed.length > 0
				? `设计中已移除 ${removed.length} 项，将保留 TAPD 原子需求、不自动删除。`
				: "",
			"",
			...items.map(
				(item) =>
					`${previousIds.has(item.localId) ? "更新" : "新增"}：${item.title}（${item.effort}）`,
			),
		]
			.filter(Boolean)
			.join("\n"),
	);
	if (!confirmed) return null;
	return {
		designFile,
		designContentHash: designHash,
		collaborationContentHash: collaborationHash,
		confirmedAt: new Date().toISOString(),
		items,
	};
}

async function createSubtasks(
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
	const designFile = getTapdDocPath(
		ctx.cwd,
		`story-${current.record.storyId}`,
		"design.md",
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

async function sendTapdWorkflowPrompt(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	prompt: string,
): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent 正在执行，请稍后再试", "warning");
		return;
	}

	const current = findSessionLink(ctx.sessionManager.getSessionFile?.() ?? "");
	if (current?.record.kind === "bug") {
		ctx.ui.notify("当前是 Bug 会话，请执行 /tapd bug 定位缺陷原因", "warning");
		return;
	}

	// This command is registered by the extension instance bound to the current
	// session, so use its current pi. Never retain the ReplacedSessionContext
	// from the newSession() callback for a later command invocation.
	pi.sendUserMessage(prompt);
}

async function locateTapdBug(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: TapdConfig,
): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent 正在执行，请稍后再试", "warning");
		return;
	}
	const current = findSessionLink(ctx.sessionManager.getSessionFile?.() ?? "");
	if (!current) {
		ctx.ui.notify(
			"当前会话没有关联 TAPD 条目，请先从 TAPD 缺陷列表创建或切换会话",
			"warning",
		);
		return;
	}
	if (current.record.kind !== "bug") {
		ctx.ui.notify("/tapd bug 只能在 Bug 会话中执行", "warning");
		return;
	}

	ctx.ui.notify("正在获取 TAPD 完整缺陷信息...", "info");
	const bugId = current.record.itemId ?? current.record.storyId;
	const detail = await fetchBugDetail(
		current.record.workspaceId,
		bugId,
		config,
	);
	if (!detail) {
		ctx.ui.notify("获取 TAPD 缺陷详情失败，请检查权限或稍后重试", "error");
		return;
	}
	const normalizedDetail: Record<string, unknown> = { ...detail };
	if (typeof detail.description === "string") {
		normalizedDetail.description_text = htmlToText(detail.description);
	}
	pi.sendUserMessage(
		buildBugLocatePrompt({
			title: detail.title || current.record.name,
			bugId,
			url: bugUrl(current.record.workspaceId, bugId),
			projectPaths: current.session.projectPaths ?? [],
			detail: normalizedDetail,
		}),
	);
}

// ============ 扩展入口 ============

export default function tapdExtension(pi: ExtensionAPI) {
	const STATE_KEY = "tapd-view-state";

	pi.registerCommand("tapd", {
		description: "查看 TAPD 待办；生成需求理解、技术设计或协作评审文档",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items: AutocompleteItem[] = [
				{
					value: "bug",
					label: "bug",
					description: "获取当前关联 Bug 的完整信息并尝试定位代码原因",
				},
				{
					value: "analyze",
					label: "analyze",
					description: "分析当前关联需求并生成理解文档",
				},
				{
					value: "design",
					label: "design",
					description: "基于已确认的需求理解生成设计方案",
				},
				{
					value: "collaboration",
					label: "collaboration",
					description: "生成供产品、后端和前端 Leader 评审的协作文档",
				},
				{
					value: "sub-task",
					label: "sub-task",
					description: "根据 design.md 创建设计和开发子需求",
				},
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const config = loadConfig();
			if (!config) {
				ctx.ui.notify(
					'请先配置 ~/.pi/agent/tapd.json:\n{ "token": "你的TAPD个人令牌" }',
					"error",
				);
				return;
			}

			const sub = args.trim().split(/\s+/)[0];
			if (sub === "bug") {
				await locateTapdBug(pi, ctx, config);
				return;
			}
			if (sub === "analyze") {
				await sendTapdWorkflowPrompt(pi, ctx, ANALYZE_TRIGGER_PROMPT);
				return;
			}
			if (sub === "design") {
				await sendTapdWorkflowPrompt(pi, ctx, DESIGN_TRIGGER_PROMPT);
				return;
			}
			if (sub === "collaboration") {
				await sendTapdWorkflowPrompt(pi, ctx, COLLABORATION_TRIGGER_PROMPT);
				return;
			}
			if (sub === "sub-task") {
				await createSubtasks(ctx, config);
				return;
			}

			ctx.ui.notify("正在连接 TAPD...", "info");
			const user = await fetchUserInfo(config);
			if (!user) {
				ctx.ui.notify("TAPD 连接失败，请检查令牌", "error");
				return;
			}

			ctx.ui.notify(`已连接 (${user.nick})，正在获取工作空间...`, "info");
			const workspaces = await fetchWorkspaces(user.nick, config);
			if (workspaces.length === 0) {
				ctx.ui.notify("没有找到工作空间", "error");
				return;
			}

			let curOnly = true;
			const entries = ctx.sessionManager.getEntries();
			const se = entries
				.filter((e: any) => e.type === "custom" && e.customType === STATE_KEY)
				.pop() as any;
			if (se?.data) curOnly = se.data.currentOnly ?? true;

			ctx.ui.notify(
				`找到 ${workspaces.length} 个工作空间，正在获取待办...`,
				"info",
			);
			const outcome = await showTable(ctx, config, workspaces, curOnly);
			if (outcome.kind === "session_action") {
				const { action, itemKey, itemName } = outcome;
				try {
					if (action.type === "switch") {
						await ctx.switchSession(action.sessionFile);
					} else {
						await createTapdSession(
							ctx,
							config,
							itemKey,
							itemName,
							action.draft,
						);
					}
				} catch {
					// 会话可能已替换，勿再使用旧 ctx
				}
				return;
			}
			if (outcome.saveState)
				pi.appendEntry(STATE_KEY, { currentOnly: curOnly });
		},
	});

	pi.registerShortcut("ctrl+shift+t", {
		description: "打开 TAPD 待办",
		handler: async (ctx: ExtensionCommandContext) => {
			const config = loadConfig();
			if (!config) {
				ctx.ui.notify("请先配置 ~/.pi/agent/tapd.json", "warning");
				return;
			}
			const user = await fetchUserInfo(config);
			if (!user) {
				ctx.ui.notify("TAPD 连接失败", "error");
				return;
			}
			const workspaces = await fetchWorkspaces(user.nick, config);
			if (workspaces.length > 0) await showTable(ctx, config, workspaces, true);
		},
	});
}
