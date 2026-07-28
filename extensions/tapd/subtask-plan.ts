import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DevelopmentTaskSuggestion, SubtaskPlan, SubtaskPlanItem } from "./types.js";

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

export async function buildSubtaskPlan(
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

export async function buildSynchronizedSubtaskPlan(
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
