/**
 * TAPD 待办扩展 — 树形交互表格
 *
 * 使用 TAPD Bearer Token 认证（只需个人令牌，无需 apiUser/owner）。
 * 通过 /user_oauth/get_user_todo_story 获取当前用户的待办。
 *
 * 配置 ~/.pi/agent/tapd.json：
 * {
 *   "token": "你的TAPD个人令牌"
 * }
 *
 * 可选：
 * {
 *   "token": "...",
 *   "baseUrl": "https://api.tapd.cn"   // 默认值
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { exec } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Text,
  visibleWidth,
  truncateToWidth,
} from "@earendil-works/pi-tui";

// ============ 配置 ============

interface TapdConfig {
  token: string;
  baseUrl?: string;
}

function loadConfig(): TapdConfig | null {
  const configPath = join(getAgentDir(), "tapd.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as TapdConfig;
  } catch {
    return null;
  }
}

// ============ API 客户端 (Bearer Token) ============

const DEFAULT_BASE = "https://api.tapd.cn";

function apiUrl(config: TapdConfig, path: string, query?: Record<string, string>): string {
  const base = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  return base + path + qs;
}

async function tapdGet<T>(url: string, config: TapdConfig, signal?: AbortSignal): Promise<T | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      signal,
    });
    if (!resp.ok) {
      console.error(`TAPD HTTP ${resp.status} for ${url}`);
      return null;
    }
    const json: any = await resp.json();
    if (json.status !== 1) {
      console.error(`TAPD api error for ${url}: ${json.info ?? "unknown"}`);
      return null;
    }
    return json as T;
  } catch (err: any) {
    if (err.name === "AbortError") return null;
    console.error(`TAPD fetch error for ${url}:`, err.message);
    return null;
  }
}

// ============ TAPD 类型 ============

interface TapdResponse<T> { status: number; data: T[]; info?: string; }

interface TapdUserInfo {
  nick: string;
  name?: string;
  id?: string;
}

interface TapdWorkspace {
  Workspace: { id: string; name: string; pretty_name?: string; category?: string };
}

interface TapdTodoStory {
  Story: { id: string; workspace_id: string };
}

interface TapdStoryFull {
  Story: {
    id: string;
    name: string;
    status: string;
    v_status?: string;
    priority?: string;
    priority_label?: string;
    owner: string;
    developer?: string;
    workspace_id: string;
    parent_id?: string;
    ancestor_id?: string;
    iteration_id?: string;
    workitem_type_id?: string;
    begin?: string;
    due?: string;
    effort?: string;
    effort_completed?: string;
    remain?: string;
    modified?: string;
  };
}

interface TapdIterationRaw {
  Iteration: { id: string; name: string; startdate?: string; enddate?: string };
}

interface TapdWorkitemTypeRaw {
  WorkitemType: { id: string; name: string };
}

// ============ 本地数据模型 ============

interface TapdItem {
  id: string;
  name: string;
  status: string;
  priority: string;
  owner: string;
  workspaceId: string;
  workspaceName: string;
  begin?: string;
  due?: string;
  iterationId?: string;
  iterationName?: string;
  parentId?: string;
  ancestorId?: string;
  workitemTypeName?: string;
  effort?: string;
  effortCompleted?: string;
  remain?: string;
  children: TapdItem[];
  depth: number;
  hasChildren: boolean;
}

// ============ 数据获取 ============

async function fetchUserInfo(config: TapdConfig, signal?: AbortSignal): Promise<TapdUserInfo | null> {
  const url = apiUrl(config, "/users/info");
  const resp = await tapdGet<{ status: number; data: TapdUserInfo }>(url, config, signal);
  return resp?.data ?? null;
}

async function fetchWorkspaces(nick: string, config: TapdConfig, signal?: AbortSignal): Promise<{ id: string; name: string }[]> {
  const url = apiUrl(config, "/workspaces/user_participant_projects", { nick });
  const resp = await tapdGet<TapdResponse<TapdWorkspace>>(url, config, signal);
  if (!resp?.data) return [];
  return resp.data.map((d) => d.Workspace).filter(Boolean).map((w) => ({ id: w.id, name: w.name }));
}

async function fetchTodoStoryIds(workspaceId: string, config: TapdConfig, signal?: AbortSignal): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  while (true) {
    const url = apiUrl(config, "/user_oauth/get_user_todo_story", {
      workspace_id: workspaceId,
      limit: "200",
      page: String(page),
    });
    const resp = await tapdGet<TapdResponse<TapdTodoStory>>(url, config, signal);
    if (!resp?.data || resp.data.length === 0) break;
    for (const row of resp.data) {
      if (row.Story?.id) ids.push(row.Story.id);
    }
    if (resp.data.length < 200) break;
    page++;
    if (page > 50) break;
  }
  return ids;
}

async function fetchStoriesByIds(workspaceId: string, ids: string[], config: TapdConfig, signal?: AbortSignal): Promise<TapdStoryFull[]> {
  const all: TapdStoryFull[] = [];
  const fields = "id,name,status,v_status,priority,priority_label,owner,developer,workspace_id,parent_id,ancestor_id,iteration_id,workitem_type_id,begin,due,effort,effort_completed,remain,modified";
  for (const chunk of chunkArray(ids, 50)) {
    const url = apiUrl(config, "/stories", {
      workspace_id: workspaceId,
      id: chunk.join(","),
      fields,
      with_v_status: "1",
      limit: "200",
    });
    const resp = await tapdGet<TapdResponse<TapdStoryFull>>(url, config, signal);
    if (resp?.data) {
      for (const row of resp.data) if (row.Story?.id) all.push(row);
    }
  }
  return all;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function fetchOpenIterations(workspaceId: string, config: TapdConfig, signal?: AbortSignal): Promise<{ id: string; name: string; startdate?: string; enddate?: string }[]> {
  const items: { id: string; name: string; startdate?: string; enddate?: string }[] = [];
  let page = 1;
  while (true) {
    const url = apiUrl(config, "/iterations", {
      workspace_id: workspaceId,
      status: "open",
      limit: "200",
      page: String(page),
    });
    const resp = await tapdGet<TapdResponse<TapdIterationRaw>>(url, config, signal);
    if (!resp?.data || resp.data.length === 0) break;
    for (const row of resp.data) {
      const it = row.Iteration;
      if (it?.id) items.push({ id: it.id, name: it.name, startdate: it.startdate, enddate: it.enddate });
    }
    if (resp.data.length < 200) break;
    page++;
    if (page > 50) break;
  }
  return items;
}

async function fetchWorkitemTypes(workspaceId: string, config: TapdConfig, signal?: AbortSignal): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  while (true) {
    const url = apiUrl(config, "/workitem_types", {
      workspace_id: workspaceId,
      limit: "200",
      page: String(page),
    });
    const resp = await tapdGet<TapdResponse<TapdWorkitemTypeRaw>>(url, config, signal);
    if (!resp?.data || resp.data.length === 0) break;
    for (const row of resp.data) {
      const wt = row.WorkitemType;
      if (wt?.id) map.set(wt.id, wt.name);
    }
    if (resp.data.length < 200) break;
    page++;
    if (page > 20) break;
  }
  return map;
}

function isCurrentIteration(startdate?: string, enddate?: string): boolean {
  if (!startdate || !enddate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return startdate <= today && enddate >= today;
}

// ============ 树形构建 ============

function buildTree(rawItems: TapdItem[]): TapdItem[] {
  const idMap = new Map<string, TapdItem>();
  const roots: TapdItem[] = [];

  for (const item of rawItems) {
    idMap.set(item.id, item);
    item.children = [];
    item.depth = 0;
    item.hasChildren = false;
  }

  for (const item of rawItems) {
    let parent: TapdItem | undefined;
    if (item.parentId && idMap.has(item.parentId)) {
      parent = idMap.get(item.parentId);
    }

    if (parent && parent.id !== item.id) {
      parent.children.push(item);
      parent.hasChildren = true;
    } else {
      roots.push(item);
    }
  }

  function setDepth(node: TapdItem, depth: number) {
    node.depth = depth;
    for (const child of node.children) setDepth(child, depth + 1);
  }
  for (const root of roots) setDepth(root, 0);

  return roots;
}

// ============ 格式化 ============

function openUrl(url: string): void {
  const cmd = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.error("Failed to open URL:", err.message); });
}

function tapdItemUrl(item: TapdItem): string {
  return `https://www.tapd.cn/${item.workspaceId}/prong/stories/view/${item.id}`;
}

function getTypeLabel(item: TapdItem): string {
  return item.workitemTypeName ?? "需求";
}

/** 按 TAPD 工作项类型名匹配对应 icon（来源：3个工作空间全量类型汇总） */
function getTypeIcon(item: TapdItem): string {
  const n = item.workitemTypeName ?? "";
  // 精确/关键词匹配，越具体越靠前
  if (n.includes("PR合并")) return "🔀";
  if (n.includes("文档") || n.includes("Doc")) return "📄";
  if (n.includes("搭建")) return "🏗️";
  if (n.includes("数据") || n.includes("报表") || n.includes("统计")) return "📊";
  if (n.includes("测试")) return "🧪";
  if (n.includes("设计") || n.includes("UI") || n.includes("视觉")) return "🎨";
  if (n.includes("开发") || n.includes("研发")) return "💻";
  if (n.includes("需求")) return "🎯";
  if (n.includes("缺陷") || n.includes("Bug") || n.includes("bug")) return "🐛";
  if (n.includes("任务")) return "📝";
  if (n.includes("技术") || n.includes("架构")) return "🔧";
  if (n.includes("优化") || n.includes("改进") || n.includes("性能")) return "✨";
  if (n.includes("运维") || n.includes("部署") || n.includes("发布")) return "🚀";
  if (n.includes("调研") || n.includes("分析") || n.includes("竞品")) return "🔍";
  if (n.includes("重构") || n.includes("整理")) return "♻️";
  return "📋";
}

function numericPriority(p: string): string {
  const map: Record<string, string> = { "4": "紧急", "3": "高", "2": "中", "1": "低", "5": "紧急" };
  return map[p] ?? p;
}

const PRIORITY_SYMBOL: Record<string, string> = { "紧急": "紧急", "高": "高 ", "中": "中 ", "低": "低 ",
  "High": "高 ", "Middle": "中 ", "Low": "低 ", "Urgent": "紧急",
  "high": "高 ", "middle": "中 ", "low": "低 ", "urgent": "紧急",
};

function fmtPriority(raw: string): string {
  const label = PRIORITY_SYMBOL[raw] ? raw : numericPriority(raw);
  return PRIORITY_SYMBOL[label] ?? label;
}

function padR(str: string, w: number): string {
  const vw = visibleWidth(str);
  return vw >= w ? truncateToWidth(str, w, "") : str + " ".repeat(w - vw);
}

function fmtDate(d?: string): string {
  if (!d) return "";
  return d.slice(0, 10);
}

const sortOrder: Record<string, number> = { "紧急": 0, "高": 1, "中": 2, "低": 3 };

function sortFn(a: TapdItem, b: TapdItem): number {
  const pa = sortOrder[a.priority] ?? 99;
  const pb = sortOrder[b.priority] ?? 99;
  if (pa !== pb) return pa - pb;
  return (a.due ?? "9999").localeCompare(b.due ?? "9999");
}

// ============ 树形列表组件 ============

interface FlatItem {
  item: TapdItem;
  indent: number;
  expandable: boolean;
  expanded: boolean;
}

class TreeList {
  private roots: TapdItem[] = [];
  expandedIds = new Set<string>();
  private visible: FlatItem[] = [];
  selectedIdx = 0;
  private maxVisible = 20;

  onSelect?: (item: FlatItem) => void;
  onCancel?: () => void;

  setRoots(roots: TapdItem[]) {
    this.roots = roots;
    this.selectedIdx = 0;
    this.rebuild();
  }

  private rebuild() {
    this.visible = [];
    const walk = (nodes: TapdItem[]) => {
      for (const node of nodes) {
        this.visible.push({
          item: node,
          indent: node.depth,
          expandable: node.hasChildren,
          expanded: this.expandedIds.has(node.id),
        });
        if (node.hasChildren && this.expandedIds.has(node.id)) {
          walk(node.children);
        }
      }
    };
    walk(this.roots);
    if (this.selectedIdx >= this.visible.length) {
      this.selectedIdx = Math.max(0, this.visible.length - 1);
    }
  }

  toggleExpand(idx: number) {
    if (idx < 0 || idx >= this.visible.length) return;
    const fi = this.visible[idx];
    if (!fi.expandable) return;
    if (this.expandedIds.has(fi.item.id)) {
      this.expandedIds.delete(fi.item.id);
    } else {
      this.expandedIds.add(fi.item.id);
    }
    this.rebuild();
    const newIdx = this.visible.findIndex((v) => v.item.id === fi.item.id);
    if (newIdx >= 0) this.selectedIdx = newIdx;
  }

  expand(idx: number) {
    if (idx < 0 || idx >= this.visible.length) return;
    const fi = this.visible[idx];
    if (!fi.expandable || fi.expanded) return;
    this.expandedIds.add(fi.item.id);
    this.rebuild();
    const newIdx = this.visible.findIndex((v) => v.item.id === fi.item.id);
    if (newIdx >= 0) this.selectedIdx = newIdx;
  }

  collapse(idx: number) {
    if (idx < 0 || idx >= this.visible.length) return;
    const fi = this.visible[idx];
    if (!fi.expandable || !fi.expanded) return;
    this.expandedIds.delete(fi.item.id);
    this.rebuild();
    const newIdx = this.visible.findIndex((v) => v.item.id === fi.item.id);
    if (newIdx >= 0) this.selectedIdx = newIdx;
  }

  handleInput(data: string): boolean {
    if (data === "\x1b[A" || data === "k") {
      if (this.selectedIdx > 0) this.selectedIdx--;
      return true;
    }
    if (data === "\x1b[B" || data === "j") {
      if (this.selectedIdx < this.visible.length - 1) this.selectedIdx++;
      return true;
    }
    if (data === "\x1b[5~") { this.selectedIdx = Math.max(0, this.selectedIdx - 10); return true; }
    if (data === "\x1b[6~") { this.selectedIdx = Math.min(this.visible.length - 1, this.selectedIdx + 10); return true; }
    if (data === " ") { this.toggleExpand(this.selectedIdx); return true; }
    if (data === "\x1b[C") { this.expand(this.selectedIdx); return true; }
    if (data === "\x1b[D") { this.collapse(this.selectedIdx); return true; }
    if (data === "\r" || data === "\n") {
      if (this.visible.length > 0 && this.selectedIdx < this.visible.length) {
        this.onSelect?.(this.visible[this.selectedIdx]);
      }
      return true;
    }
    if (data === "\x1b") { this.onCancel?.(); return true; }
    return false;
  }

  render(width: number, theme: any): string[] {
    const maxW = width - 2;
    if (this.visible.length === 0) {
      return [theme.fg("dim", "  (无匹配项)")];
    }

    const half = Math.floor(this.maxVisible / 2);
    let start = Math.max(0, this.selectedIdx - half);
    let end = Math.min(this.visible.length, start + this.maxVisible);
    if (end - start < this.maxVisible) start = Math.max(0, end - this.maxVisible);

    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      const fi = this.visible[i];
      const isSel = i === this.selectedIdx;
      const item = fi.item;

      const indent = "  ".repeat(fi.indent);
      const marker = fi.expandable ? (fi.expanded ? "▾ " : "▸ ") : "  ";
      const icon = getTypeIcon(item);

      let line = indent + marker + icon;

      const prefixLen = visibleWidth(indent + marker + icon + " ");
      const titleW = Math.max(10, maxW - prefixLen - 10 - 8 - 12 - 12 - 4);
      const statusW = 10;
      const priorityW = 8;
      const beginW = 12;
      const dueW = 12;

      line += " " + padR(truncateToWidth(item.name, titleW, "…"), titleW);
      line += " " + padR(truncateToWidth(item.status, statusW, ""), statusW);
      line += " " + padR(fmtPriority(item.priority), priorityW);
      line += " " + padR(fmtDate(item.begin), beginW);
      line += " " + padR(fmtDate(item.due), dueW);

      if (isSel) {
        line = theme.fg("accent", truncateToWidth(line, maxW, ""));
      } else {
        line = truncateToWidth(line, maxW, "");
      }
      lines.push(line);
    }

    if (this.visible.length > this.maxVisible) {
      lines.push(theme.fg("dim", `  ${start + 1}-${end}/${this.visible.length}`));
    }
    return lines;
  }
}

// ============ 表格 UI ============

async function showTable(
  ctx: ExtensionContext,
  config: TapdConfig,
  workspaces: { id: string; name: string }[],
  _currentOnly: boolean,
): Promise<void> {
  const controller = new AbortController();

  // 默认先加载当前迭代
  ctx.ui.notify(`正在获取当前迭代待办...`, "info");
  const currentResult = await fetchAllTodos(workspaces, config, "current", controller.signal);
  let currentTree = buildTree(currentResult.items);
  sortTree(currentTree);

  if (currentResult.errors.length > 0) {
    ctx.ui.notify(`部分工作空间获取失败: ${currentResult.errors.join(", ")}`, "warning");
  }

  // 所有迭代懒加载
  let allTree: TapdItem[] = [];
  let allLoaded = false;

  let viewCurrentOnly = true;
  let typeFilter: string | null = null;

  while (true) {
    const tree = viewCurrentOnly ? currentTree : allTree;
    const viewLabel = viewCurrentOnly ? "当前迭代" : "所有迭代";

    // 按类型过滤并平铺（typeFilter 不为 null 时）
    let displayTree: TapdItem[];
    if (typeFilter) {
      displayTree = flattenAndFilter(tree, typeFilter);
    } else {
      displayTree = tree;
    }

    const selected = await renderTreeTable(ctx, displayTree, viewLabel, typeFilter);

    if (selected === "__TOGGLE__") {
      viewCurrentOnly = !viewCurrentOnly;
      // 切换到"所有"时才加载
      if (!viewCurrentOnly && !allLoaded) {
        ctx.ui.notify("正在获取所有迭代待办...", "info");
        const allResult = await fetchAllTodos(workspaces, config, "all", controller.signal);
        allTree = buildTree(allResult.items);
        sortTree(allTree);
        allLoaded = true;
        if (allResult.errors.length > 0) {
          ctx.ui.notify(`部分工作空间获取失败: ${allResult.errors.join(", ")}`, "warning");
        }
      }
      continue;
    }

    if (selected === "__TYPE__") {
      // 类型选项始终来自全量数据
      const allTypes = collectTypes(allLoaded && allTree.length > 0 ? allTree : currentTree);
      const opts = ["全部", ...allTypes];
      const chosen = await ctx.ui.select("按类型筛选:", opts);
      if (chosen && chosen !== "全部") {
        typeFilter = chosen;
      } else {
        typeFilter = null;
      }
      continue;
    }
    if (selected === null) break;
    if (selected) {
      openUrl(selected);
      ctx.ui.notify("已在浏览器中打开", "info");
      continue;
    }
    break;
  }
}

function sortTree(nodes: TapdItem[]) {
  nodes.sort(sortFn);
  for (const n of nodes) sortTree(n.children);
}

/** 收集树中所有唯一的 workitemTypeName */
function collectTypes(forest: TapdItem[]): string[] {
  const seen = new Set<string>();
  const walk = (nodes: TapdItem[]) => {
    for (const n of nodes) {
      const t = n.workitemTypeName;
      if (t && !seen.has(t)) seen.add(t);
      walk(n.children);
    }
  };
  walk(forest);
  return [...seen].sort();
}

/** 按类型过滤并平铺（所有 depth=0） */
function flattenAndFilter(forest: TapdItem[], typeName: string): TapdItem[] {
  const result: TapdItem[] = [];
  const walk = (nodes: TapdItem[]) => {
    for (const n of nodes) {
      if (n.workitemTypeName === typeName) {
        result.push({ ...n, depth: 0, hasChildren: false, children: [] });
      }
      walk(n.children);
    }
  };
  walk(forest);
  result.sort(sortFn);
  return result;
}

async function renderTreeTable(
  _ctx: ExtensionContext,
  forest: TapdItem[],
  viewLabel: string,
  typeFilter: string | null,
): Promise<string | null> {
  function countAll(nodes: TapdItem[]): number {
    let c = 0;
    for (const n of nodes) { c++; c += countAll(n.children); }
    return c;
  }
  const totalCount = countAll(forest);

  return await _ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const treeList = new TreeList();
    treeList.setRoots(forest);
    treeList.onSelect = (fi) => done(tapdItemUrl(fi.item));
    treeList.onCancel = () => done(null);

    let currentWidth = 80;
    let container: Container;

    function rebuildAll() {
      // 列宽：标题=剩余, 状态=10, 优先=8, 开始=12, 结束=12
      const titleW = Math.max(10, currentWidth - 2 - 5 - 10 - 8 - 12 - 12 - 4);

      container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      container.addChild(new Text(
        theme.fg("accent", theme.bold(`TAPD 待办 - ${viewLabel}`)) +
        theme.fg("dim", `  |  ${totalCount} 项`) +
        (typeFilter ? theme.fg("warning", `  [${typeFilter}]`) : ""),
        1, 0,
      ));

      container.addChild(new Text(
        "     " +
        theme.fg("dim", padR("标题", titleW)) +
        " " + theme.fg("dim", padR("状态", 10)) +
        " " + theme.fg("dim", padR("优先", 8)) +
        " " + theme.fg("dim", padR("开始", 12)) +
        " " + theme.fg("dim", padR("结束", 12)),
        1, 0,
      ));

      for (const line of treeList.render(currentWidth, theme)) {
        container.addChild(new Text(line, 1, 0));
      }

      container.addChild(new Text(
        theme.fg("dim", "↑↓ 导航  Space/→/← 展开收起  Enter 打开  Tab 切换迭代  t 切换类型  Esc 退出"),
        1, 0,
      ));
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    }

    rebuildAll();

    return {
      render(width: number) {
        if (width !== currentWidth) { currentWidth = width; rebuildAll(); }
        return container.render(width);
      },
      invalidate() { container.invalidate(); },
      handleInput(data: string) {
        if (data === "\t" || data === "\x1b[Z") { done("__TOGGLE__"); return; }
        if (data === "t") { done("__TYPE__"); return; }
        if (treeList.handleInput(data)) { rebuildAll(); tui.requestRender(); }
      },
    };
  });
}

async function fetchAllTodos(
  workspaces: { id: string; name: string }[],
  config: TapdConfig,
  scope: "current" | "all",
  signal: AbortSignal,
): Promise<{ items: TapdItem[]; errors: string[] }> {
  const results = await Promise.all(workspaces.map((ws) => fetchWsTodos(ws, config, scope, signal)));
  const allItems: TapdItem[] = [];
  const allErrors: string[] = [];
  for (const r of results) { allItems.push(...r.items); allErrors.push(...r.errors); }
  return { items: allItems, errors: allErrors };
}

async function fetchWsTodos(
  ws: { id: string; name: string },
  config: TapdConfig,
  scope: "current" | "all",
  signal?: AbortSignal,
): Promise<{ items: TapdItem[]; errors: string[] }> {
  const items: TapdItem[] = [];
  const errors: string[] = [];

  // 1. 获取我的待办 story ID 列表
  const todoIds = await fetchTodoStoryIds(ws.id, config, signal);
  if (todoIds.length === 0) return { items, errors };

  // 2. 获取详细信息
  const detailed = await fetchStoriesByIds(ws.id, todoIds, config, signal);

  // 3. 获取迭代列表，判定"当前迭代"（不回落，没有当前迭代就是空）
  const iterations = await fetchOpenIterations(ws.id, config, signal);
  const iterNameMap = new Map<string, string>();
  const currentIterIds = new Set<string>();
  for (const it of iterations) {
    iterNameMap.set(it.id, it.name);
    if (isCurrentIteration(it.startdate, it.enddate)) { currentIterIds.add(it.id); }
  }

  // 当前迭代模式：如果没有当前迭代，直接返回空
  if (scope === "current" && currentIterIds.size === 0) return { items, errors };

  // 4. 获取工作项类型名称映射
  const typeNames = await fetchWorkitemTypes(ws.id, config, signal);

  // 5. 转换数据（当前迭代模式跳过不在其中的项）
  for (const raw of detailed) {
    const s = raw.Story;
    const iterId = s.iteration_id ?? undefined;

    // 当前迭代模式：跳过不在当前迭代的项
    if (scope === "current" && !(iterId && currentIterIds.has(iterId))) continue;

    items.push({
      id: s.id,
      name: s.name,
      status: s.v_status ?? s.status,
      priority: s.priority_label ?? s.priority ?? "-",
      owner: s.owner,
      workspaceId: s.workspace_id,
      workspaceName: ws.name,
      begin: s.begin?.slice(0, 10),
      due: s.due?.slice(0, 10),
      iterationId: iterId,
      iterationName: iterId ? iterNameMap.get(iterId) : undefined,
      parentId: s.parent_id ?? undefined,
      ancestorId: s.ancestor_id ?? undefined,
      workitemTypeName: s.workitem_type_id ? typeNames.get(s.workitem_type_id) : undefined,
      effort: s.effort,
      effortCompleted: s.effort_completed,
      remain: s.remain,
      children: [],
      depth: 0,
      hasChildren: false,
    });
  }

  // 6. 检查缺失的父需求并补充
  const presentIds = new Set(items.map((i) => i.id));
  const missingParentIds = new Set<string>();
  for (const item of items) {
    if (item.parentId && !presentIds.has(item.parentId)) {
      missingParentIds.add(item.parentId);
    }
  }

  if (missingParentIds.size > 0) {
    const parentStories = await fetchStoriesByIds(ws.id, [...missingParentIds], config, signal);
    for (const raw of parentStories) {
      const s = raw.Story;
      const iterId = s.iteration_id ?? undefined;
      items.push({
        id: s.id,
        name: s.name,
        status: s.v_status ?? s.status,
        priority: s.priority_label ?? s.priority ?? "-",
        owner: s.owner,
        workspaceId: s.workspace_id,
        workspaceName: ws.name,
        begin: s.begin?.slice(0, 10),
        due: s.due?.slice(0, 10),
        iterationId: iterId,
        iterationName: iterId ? iterNameMap.get(iterId) : undefined,
        parentId: s.parent_id ?? undefined,
        ancestorId: s.ancestor_id ?? undefined,
        workitemTypeName: s.workitem_type_id ? typeNames.get(s.workitem_type_id) : undefined,
        effort: s.effort,
        effortCompleted: s.effort_completed,
        remain: s.remain,
        children: [],
        depth: 0,
        hasChildren: false,
      });
    }
  }

  return { items, errors };
}

// ============ 扩展入口 ============

export default function tapdExtension(pi: ExtensionAPI) {
  const STATE_KEY = "tapd-view-state";

  pi.registerCommand("tapd", {
    description: "查看 TAPD 待办（树形表格）",
    handler: async (_args, ctx) => {
      const config = loadConfig();
      if (!config) {
        ctx.ui.notify(
          `请先配置 ~/.pi/agent/tapd.json:\n{\n  "token": "你的TAPD个人令牌"\n}`,
          "error",
        );
        return;
      }

      // 获取当前用户
      ctx.ui.notify("正在连接 TAPD...", "info");
      const userInfo = await fetchUserInfo(config);
      if (!userInfo) {
        ctx.ui.notify("TAPD 连接失败，请检查令牌是否有效", "error");
        return;
      }

      // 获取工作空间
      ctx.ui.notify(`已连接 (${userInfo.nick})，正在获取工作空间...`, "info");
      const workspaces = await fetchWorkspaces(userInfo.nick, config);
      if (workspaces.length === 0) {
        ctx.ui.notify("没有找到工作空间", "error");
        return;
      }

      let currentOnly = true;
      const entries = ctx.sessionManager.getEntries();
      const stateEntry = entries
        .filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === STATE_KEY)
        .pop() as { data?: { currentOnly: boolean } } | undefined;
      if (stateEntry?.data) currentOnly = stateEntry.data.currentOnly ?? true;

      ctx.ui.notify(`找到 ${workspaces.length} 个工作空间，正在获取待办...`, "info");
      await showTable(ctx, config, workspaces, currentOnly);
      pi.appendEntry(STATE_KEY, { currentOnly });
    },
  });

  pi.registerShortcut("ctrl+shift+t", {
    description: "打开 TAPD 待办",
    handler: async (ctx) => {
      const config = loadConfig();
      if (!config) { ctx.ui.notify("请先配置 ~/.pi/agent/tapd.json", "warning"); return; }
      const userInfo = await fetchUserInfo(config);
      if (!userInfo) { ctx.ui.notify("TAPD 连接失败", "error"); return; }
      const workspaces = await fetchWorkspaces(userInfo.nick, config);
      if (workspaces.length > 0) await showTable(ctx, config, workspaces, true);
    },
  });
}
