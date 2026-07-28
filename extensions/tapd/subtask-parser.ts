import type { DevelopmentTaskSuggestion } from "./types.js";

const SUBTASKS_START = "<!-- TAPD_SUBTASKS_START -->";
const SUBTASKS_END = "<!-- TAPD_SUBTASKS_END -->";

export function parseDevelopmentTasks(markdown: string): DevelopmentTaskSuggestion[] {
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
