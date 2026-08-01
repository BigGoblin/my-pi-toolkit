import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TapdItem } from "../types.js";

export function buildTree(raw: TapdItem[]): TapdItem[] {
	const byId = new Map<string, TapdItem>();
	const roots: TapdItem[] = [];
	for (const item of raw) {
		byId.set(item.id, item);
		item.children = [];
		item.depth = 0;
		item.hasChildren = false;
	}
	for (const item of raw) {
		const parent = item.parentId ? byId.get(item.parentId) : undefined;
		if (parent && parent.id !== item.id) {
			parent.children.push(item);
			parent.hasChildren = true;
		} else {
			roots.push(item);
		}
	}
	function setDepth(item: TapdItem, depth: number) {
		item.depth = depth;
		for (const child of item.children) setDepth(child, depth + 1);
	}
	for (const root of roots) setDepth(root, 0);
	return roots;
}

export function storyUrl(workspaceId: string, storyId: string): string {
	return `https://www.tapd.cn/${workspaceId}/prong/stories/view/${storyId}`;
}

export function bugUrl(workspaceId: string, bugId: string): string {
	return `https://www.tapd.cn/${workspaceId}/bugtrace/bugs/view/${bugId}`;
}

export function tapdUrl(item: TapdItem): string {
	return item.kind === "bug"
		? bugUrl(item.workspaceId, item.id)
		: storyUrl(item.workspaceId, item.id);
}

const TYPE_LABELS: Array<[RegExp, string]> = [
	[/PR合并/i, "PR"],
	[/文档|Doc/i, "DOC"],
	[/搭建/, "SET"],
	[/数据/, "DATA"],
	[/测试/, "TEST"],
	[/设计|UI/i, "DES"],
	[/开发|研发/, "DEV"],
	[/需求/, "REQ"],
	[/缺陷|Bug/i, "BUG"],
	[/任务/, "TASK"],
	[/技术|架构/, "TECH"],
	[/优化|改进/, "OPT"],
	[/运维|部署/, "OPS"],
	[/调研|分析/, "RCH"],
	[/重构/, "REF"],
];

export function getTypeLabel(item: TapdItem): string {
	if (item.kind === "bug") return "BUG";
	const name = item.workitemTypeName ?? "";
	return TYPE_LABELS.find(([pattern]) => pattern.test(name))?.[1] ?? "ITEM";
}

export function prioritySymbol(raw: string): string {
	const value = raw.trim();
	const map: Record<string, string> = {
		"4": "紧急",
		"3": "高",
		"2": "中",
		"1": "低",
		"5": "紧急",
		High: "高",
		Middle: "中",
		Medium: "中",
		Low: "低",
		Urgent: "紧急",
		high: "高",
		middle: "中",
		medium: "中",
		low: "低",
		urgent: "紧急",
		insignificant: "无关紧要",
		Insignificant: "无关紧要",
		紧急: "紧急",
		高: "高",
		中: "中",
		低: "低",
	};
	return map[value] ?? map[value.toLowerCase()] ?? (value || "-");
}

export function padR(value: string, width: number): string {
	const actualWidth = visibleWidth(value);
	return actualWidth >= width
		? truncateToWidth(value, width, "")
		: value + " ".repeat(width - actualWidth);
}

export function fmtDate(value?: string): string {
	return value?.slice(0, 10) ?? "";
}

export function oneLine(value: string): string {
	return value
		.replace(/[\r\n\t]+/g, " ")
		.replace(/ {2,}/g, " ")
		.trim();
}

const sortOrder: Record<string, number> = { 紧急: 0, 高: 1, 中: 2, 低: 3 };

export function sortFn(a: TapdItem, b: TapdItem): number {
	const priorityA = sortOrder[a.priority] ?? 99;
	const priorityB = sortOrder[b.priority] ?? 99;
	return priorityA !== priorityB
		? priorityA - priorityB
		: (a.due ?? "9999").localeCompare(b.due ?? "9999");
}

export function sortTree(nodes: TapdItem[]): void {
	nodes.sort(sortFn);
	for (const node of nodes) sortTree(node.children);
}

export function collectTypes(forest: TapdItem[]): string[] {
	const seen = new Set<string>();
	const walk = (nodes: TapdItem[]) => {
		for (const node of nodes) {
			if (node.workitemTypeName) seen.add(node.workitemTypeName);
			walk(node.children);
		}
	};
	walk(forest);
	return Array.from(seen).sort((left, right) => left.localeCompare(right));
}

export function flatFilter(forest: TapdItem[], typeName: string): TapdItem[] {
	const result: TapdItem[] = [];
	const walk = (nodes: TapdItem[]) => {
		for (const node of nodes) {
			if (node.workitemTypeName === typeName)
				result.push({ ...node, depth: 0, hasChildren: false, children: [] });
			walk(node.children);
		}
	};
	walk(forest);
	result.sort(sortFn);
	return result;
}

function flattenItems(forest: TapdItem[]): TapdItem[] {
	const result: TapdItem[] = [];
	const walk = (nodes: TapdItem[]) => {
		for (const node of nodes) {
			result.push(node);
			walk(node.children);
		}
	};
	walk(forest);
	return result;
}

function matchesSearch(item: TapdItem, query: string): boolean {
	const values = [
		oneLine(item.name),
		item.id,
		item.status,
		item.priority,
		item.severity,
		item.owner,
		item.workitemTypeName,
		item.workspaceName,
	];
	return values.some((value) => value?.toLowerCase().includes(query));
}

export function searchFlat(forest: TapdItem[], query: string): TapdItem[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return [];
	const result = flattenItems(forest).flatMap((item) =>
		matchesSearch(item, normalized)
			? [{ ...item, depth: 0, hasChildren: false, children: [] }]
			: [],
	);
	result.sort(sortFn);
	return result;
}
