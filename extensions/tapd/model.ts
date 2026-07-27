import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TapdItem } from "./types.js";

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
  return item.kind === "bug" ? bugUrl(item.workspaceId, item.id) : storyUrl(item.workspaceId, item.id);
}

export function getTypeIcon(item: TapdItem): string {
  if (item.kind === "bug") return "🐛";
  const name = item.workitemTypeName ?? "";
  if (name.includes("PR合并")) return "🔀";
  if (name.includes("文档") || name.includes("Doc")) return "📄";
  if (name.includes("搭建")) return "🏗️";
  if (name.includes("数据")) return "📊";
  if (name.includes("测试")) return "🧪";
  if (name.includes("设计") || name.includes("UI")) return "🎨";
  if (name.includes("开发") || name.includes("研发")) return "💻";
  if (name.includes("需求")) return "🎯";
  if (name.includes("缺陷") || name.includes("Bug")) return "🐛";
  if (name.includes("任务")) return "📝";
  if (name.includes("技术") || name.includes("架构")) return "🔧";
  if (name.includes("优化") || name.includes("改进")) return "✨";
  if (name.includes("运维") || name.includes("部署")) return "🚀";
  if (name.includes("调研") || name.includes("分析")) return "🔍";
  if (name.includes("重构")) return "♻️";
  return "📋";
}

export function prioritySymbol(raw: string): string {
  const value = raw.trim();
  const map: Record<string, string> = {
    "4": "紧急", "3": "高", "2": "中", "1": "低", "5": "紧急",
    High: "高", Middle: "中", Medium: "中", Low: "低", Urgent: "紧急",
    high: "高", middle: "中", medium: "中", low: "低", urgent: "紧急",
    insignificant: "无关紧要", Insignificant: "无关紧要",
    紧急: "紧急", 高: "高", 中: "中", 低: "低",
  };
  return map[value] ?? map[value.toLowerCase()] ?? (value || "-");
}

export function padR(value: string, width: number): string {
  const actualWidth = visibleWidth(value);
  return actualWidth >= width ? truncateToWidth(value, width, "") : value + " ".repeat(width - actualWidth);
}

export function fmtDate(value?: string): string {
  return value?.slice(0, 10) ?? "";
}

export function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

const sortOrder: Record<string, number> = { 紧急: 0, 高: 1, 中: 2, 低: 3 };

export function sortFn(a: TapdItem, b: TapdItem): number {
  const priorityA = sortOrder[a.priority] ?? 99;
  const priorityB = sortOrder[b.priority] ?? 99;
  return priorityA !== priorityB ? priorityA - priorityB : (a.due ?? "9999").localeCompare(b.due ?? "9999");
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
  return [...seen].sort();
}

export function flatFilter(forest: TapdItem[], typeName: string): TapdItem[] {
  const result: TapdItem[] = [];
  const walk = (nodes: TapdItem[]) => {
    for (const node of nodes) {
      if (node.workitemTypeName === typeName) result.push({ ...node, depth: 0, hasChildren: false, children: [] });
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
    for (const node of nodes) { result.push(node); walk(node.children); }
  };
  walk(forest);
  return result;
}

export function searchFlat(forest: TapdItem[], query: string): TapdItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const result = flattenItems(forest).filter((item) => {
    return oneLine(item.name).toLowerCase().includes(normalized)
      || item.id.includes(normalized)
      || item.status.toLowerCase().includes(normalized)
      || item.priority.toLowerCase().includes(normalized)
      || (item.severity?.toLowerCase().includes(normalized) ?? false)
      || (item.owner?.toLowerCase().includes(normalized) ?? false)
      || (item.workitemTypeName?.toLowerCase().includes(normalized) ?? false)
      || item.workspaceName.toLowerCase().includes(normalized);
  }).map((item) => ({ ...item, depth: 0, hasChildren: false, children: [] }));
  result.sort(sortFn);
  return result;
}
