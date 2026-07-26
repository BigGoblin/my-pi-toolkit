/**
 * TAPD 待办扩展 — 树形交互表格
 *
 * 使用 TAPD Bearer Token 认证（只需个人令牌）。
 * 通过 /user_oauth/get_user_todo_story 获取当前用户待办。
 *
 * 配置 ~/.pi/agent/tapd.json：
 * { "token": "你的TAPD个人令牌" }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, Text, Input, visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

// ============ 配置 ============

interface TapdConfig { token: string; baseUrl?: string; }

function loadConfig(): TapdConfig | null {
  const p = join(getAgentDir(), "tapd.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")) as TapdConfig; } catch { return null; }
}

// ============ API 客户端 ============

const DEFAULT_BASE = "https://api.tapd.cn";

function apiUrl(c: TapdConfig, path: string, q?: Record<string, string>): string {
  const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  return base + path + (q ? "?" + new URLSearchParams(q).toString() : "");
}

async function tapdGet<T>(url: string, c: TapdConfig, s?: AbortSignal): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, signal: s });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j.status === 1 ? (j as T) : null;
  } catch (err: any) {
    if (err.name === "AbortError") return null;
    console.error("TAPD fetch error:", err.message);
    return null;
  }
}

interface TR<T> { status: number; data: T[]; }

// ============ 数据获取 ============

async function fetchUserInfo(c: TapdConfig, s?: AbortSignal): Promise<{ nick: string } | null> {
  const r = await tapdGet<{ status: number; data: { nick: string } }>(apiUrl(c, "/users/info"), c, s);
  return r?.data ?? null;
}

async function fetchWorkspaces(nick: string, c: TapdConfig, s?: AbortSignal): Promise<{ id: string; name: string }[]> {
  const r = await tapdGet<TR<{ Workspace: { id: string; name: string } }>>(apiUrl(c, "/workspaces/user_participant_projects", { nick }), c, s);
  if (!r?.data) return [];
  return r.data.map((d) => d.Workspace).filter(Boolean).map((w) => ({ id: w.id, name: w.name }));
}

async function fetchTodoIds(wsId: string, c: TapdConfig, s?: AbortSignal): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  while (true) {
    const r = await tapdGet<TR<{ Story: { id: string } }>>(apiUrl(c, "/user_oauth/get_user_todo_story", { workspace_id: wsId, limit: "200", page: String(page) }), c, s);
    if (!r?.data || r.data.length === 0) break;
    for (const row of r.data) if (row.Story?.id) ids.push(row.Story.id);
    if (r.data.length < 200) break;
    page++;
    if (page > 50) break;
  }
  return ids;
}

const STORY_FIELDS = "id,name,status,v_status,priority,priority_label,owner,developer,workspace_id,parent_id,ancestor_id,iteration_id,workitem_type_id,begin,due,effort,effort_completed,remain,modified";

async function fetchStories(wsId: string, ids: string[], c: TapdConfig, s?: AbortSignal): Promise<any[]> {
  const all: any[] = [];
  for (const chunk of chunkArr(ids, 50)) {
    const r = await tapdGet<TR<{ Story: any }>>(apiUrl(c, "/stories", { workspace_id: wsId, id: chunk.join(","), fields: STORY_FIELDS, with_v_status: "1", limit: "200" }), c, s);
    if (r?.data) for (const row of r.data) if (row.Story?.id) all.push(row.Story);
  }
  return all;
}

const STORY_DETAIL_FIELDS = "id,name,description,status,v_status,priority,priority_label,owner,developer,workspace_id";

async function fetchStoryDetail(wsId: string, storyId: string, c: TapdConfig, s?: AbortSignal): Promise<{ id: string; name: string; description?: string } | null> {
  const r = await tapdGet<TR<{ Story: any }>>(apiUrl(c, "/stories", {
    workspace_id: wsId,
    id: storyId,
    fields: STORY_DETAIL_FIELDS,
    with_v_status: "1",
    limit: "1",
  }), c, s);
  const story = r?.data?.[0]?.Story;
  return story?.id ? story : null;
}

/** 将 TAPD 描述 HTML 转为可读纯文本 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|tr|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkArr<T>(a: T[], sz: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < a.length; i += sz) r.push(a.slice(i, i + sz));
  return r;
}

async function fetchIterations(wsId: string, c: TapdConfig, s?: AbortSignal): Promise<{ id: string; name: string; startdate?: string; enddate?: string }[]> {
  const items: any[] = [];
  let page = 1;
  while (true) {
    const r = await tapdGet<TR<{ Iteration: any }>>(apiUrl(c, "/iterations", { workspace_id: wsId, status: "open", limit: "200", page: String(page) }), c, s);
    if (!r?.data || r.data.length === 0) break;
    for (const row of r.data) { const it = row.Iteration; if (it?.id) items.push({ id: it.id, name: it.name, startdate: it.startdate, enddate: it.enddate }); }
    if (r.data.length < 200) break;
    page++; if (page > 50) break;
  }
  return items;
}

async function fetchTypeNames(wsId: string, c: TapdConfig, s?: AbortSignal): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  let page = 1;
  while (true) {
    const r = await tapdGet<TR<{ WorkitemType: { id: string; name: string } }>>(apiUrl(c, "/workitem_types", { workspace_id: wsId, limit: "200", page: String(page) }), c, s);
    if (!r?.data || r.data.length === 0) break;
    for (const row of r.data) { const wt = row.WorkitemType; if (wt?.id) m.set(wt.id, wt.name); }
    if (r.data.length < 200) break;
    page++; if (page > 20) break;
  }
  return m;
}

function isCurrent(it: { startdate?: string; enddate?: string }): boolean {
  if (!it.startdate || !it.enddate) return false;
  const t = new Date().toISOString().slice(0, 10);
  return it.startdate <= t && it.enddate >= t;
}

// ============ 本地数据模型 ============

interface TapdItem {
  id: string; name: string; status: string; priority: string; owner: string;
  workspaceId: string; workspaceName: string; begin?: string; due?: string;
  iterationId?: string; iterationName?: string;
  parentId?: string; workitemTypeName?: string;
  children: TapdItem[]; depth: number; hasChildren: boolean;
}

// ============ 会话关联存储 ============

interface SessionLink {
  id: string;
  createdAt: string;
  title?: string;
  sessionFile?: string;
  projectPaths?: string[];
  understandingFile?: string;
}
interface TapdLinkRecord { workspaceId: string; storyId: string; name: string; sessions: SessionLink[]; }

const LINKS_PATH = join(getAgentDir(), "tapd-links.json");
const PATHS_HISTORY_PATH = join(getAgentDir(), "tapd-project-paths.json");
const MAX_PATH_HISTORY = 30;

function loadLinks(): Record<string, TapdLinkRecord> {
  try { if (existsSync(LINKS_PATH)) return JSON.parse(readFileSync(LINKS_PATH, "utf-8")); } catch {}
  return {};
}
function saveLinks(l: Record<string, TapdLinkRecord>) {
  try { writeFileSync(LINKS_PATH, JSON.stringify(l, null, 2), "utf-8"); } catch {}
}
function linkKey(wsId: string, storyId: string): string { return `${wsId}_${storyId}`; }
function getOrCreateLink(links: Record<string, TapdLinkRecord>, wsId: string, storyId: string, name: string): TapdLinkRecord {
  const k = linkKey(wsId, storyId);
  if (!links[k]) links[k] = { workspaceId: wsId, storyId, name, sessions: [] };
  return links[k];
}

function safeRequirementDirName(name: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120)
    .trim();
  return safe || "未命名需求";
}

function getUnderstandingDocPath(cwd: string, requirementName: string): string {
  return join(cwd, ".pi", "docs", safeRequirementDirName(requirementName), "understanding.md");
}

function loadPathHistory(): string[] {
  try {
    if (!existsSync(PATHS_HISTORY_PATH)) return [];
    const raw = JSON.parse(readFileSync(PATHS_HISTORY_PATH, "utf-8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  } catch {
    return [];
  }
}
function rememberProjectPaths(paths: string[]) {
  const cleaned = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (cleaned.length === 0) return;
  const hist = loadPathHistory().filter((p) => !cleaned.includes(p));
  try {
    writeFileSync(PATHS_HISTORY_PATH, JSON.stringify([...cleaned, ...hist].slice(0, MAX_PATH_HISTORY), null, 2), "utf-8");
  } catch {}
}

function removeProjectPathFromHistory(path: string) {
  const hist = loadPathHistory().filter((p) => p !== path);
  try {
    writeFileSync(PATHS_HISTORY_PATH, JSON.stringify(hist, null, 2), "utf-8");
  } catch {}
}

function storyUrl(wsId: string, storyId: string): string {
  return `https://www.tapd.cn/${wsId}/prong/stories/view/${storyId}`;
}

function buildUnderstandPrompt(opts: {
  title: string;
  storyId: string;
  url: string;
  description: string;
  projectPaths: string[];
  understandingFile: string;
}): string {
  const pathBlock = opts.projectPaths.length > 0
    ? opts.projectPaths.map((p) => `- ${p}`).join("\n")
    : "- （未指定，请在当前工作目录中查找相关代码）";
  const desc = opts.description.trim() || "（无描述）";
  return [
    "以下为 TAPD 需求上下文，供后续需求理解使用。",
    "",
    "## 需求",
    `标题：${opts.title}`,
    `链接：${opts.url}`,
    `ID：${opts.storyId}`,
    "",
    "## 需求描述",
    desc,
    "",
    "## 相关项目路径",
    pathBlock,
    "",
    "## 理解文档输出路径",
    opts.understandingFile,
  ].join("\n");
}

const ANALYZE_TRIGGER_PROMPT = [
  "请基于上文 TAPD 需求信息，结合相关项目代码完成需求理解，并输出文档。",
  "",
  "要求：",
  "1. 撰写需求理解文档，包含：目标、范围（做/不做）、与现有代码的关系、验收标准、风险/待确认项。",
  "2. 不要复述整篇 PRD，不要输出技术方案，不要修改代码。",
  "3. 将完整文档写入上文「理解文档输出路径」指定的文件。",
  "4. 写完后简要总结要点，并告知文档路径，等待我确认后再设计方案。",
].join("\n");

const DESIGN_TRIGGER_PROMPT = [
  "我已确认需求理解文档。请基于该文档和相关项目代码输出可执行的技术设计方案。",
  "",
  "要求：",
  "1. 先读取上文「理解文档输出路径」对应的 understanding.md；如果文件不存在，停止并提示我先执行 /tapd analyze。",
  "2. 设计方案应包含：方案概述、现状分析、总体设计、详细改动、数据与接口设计、边界与异常处理、兼容性与影响范围、测试方案、实施步骤、风险与待确认项。",
  "3. 详细改动按模块或文件说明修改目的、关键类/函数和主要逻辑；必要时使用 Mermaid 图。",
  "4. 建立“验收标准 → 设计改动 → 测试场景”的对应关系，确保没有遗漏。",
  "5. 不要修改业务代码，不要直接实施方案。",
  "6. 将完整方案写入 understanding.md 同目录下的 design.md。",
  "7. 写完后简要总结设计要点并告知文档路径，等待我确认后再实施。",
].join("\n");

const COLLABORATION_TRIGGER_PROMPT = [
  "请以前端视角编写一份精简的设计评审协作文档，供产品、后端和前端 Leader 共同评审。",
  "",
  "要求：",
  "1. 先读取上文「理解文档输出路径」对应的 understanding.md；如果文件不存在，停止并提示我先执行 /tapd analyze。",
  "2. 如果同目录存在 design.md，将其作为实现方案参考；如果不存在，仍可结合需求理解和项目代码完成文档。",
  "3. 根据需求复杂度控制篇幅：简单需求优先控制在 800～1500 个中文字符、1～2 页；只有确有必要时才展开。",
  "4. 不要包含“需求背景与目标”和“范围说明”，也不要重复 understanding.md 中已经明确的需求内容。",
  "5. 文档优先只保留四部分：产品与交互变化、前端实现思路、前后端协作点、评审与验收；没有实际内容的部分可以省略。",
  "6. 产品与交互变化用简短列表或一个表格说明受影响入口及预期表现，不逐项复述相同规则。",
  "7. 前端实现思路使用 3～6 条模块级说明，讲清主要改动、数据流转和能力复用；不要列具体文件、函数、代码或大段状态管理细节。",
  "8. 后端已提供接口资料时，只整理与本次改动直接相关的接口变化；后端未提供时，只列需要确认的业务能力，不推测字段、状态码、接口地址或示例报文。",
  "9. 评审与验收只保留关键场景以及会影响方案或验收的待确认问题，不要按参会角色重复罗列。",
  "10. 不要描述没有变化的 loading、权限、防重复提交等通用行为；“保持现状”只在容易误解时提一次。",
  "11. 简单流程不要生成 Mermaid 图；不要包含排期、负责人或上线计划；不要修改代码。",
  "12. 将完整文档写入 understanding.md 同目录下的 collaboration.md。",
  "13. 写完后用几句话总结评审重点并告知文档路径。",
].join("\n");

// ============ 树形构建 ============

function buildTree(raw: TapdItem[]): TapdItem[] {
  const m = new Map<string, TapdItem>();
  const roots: TapdItem[] = [];
  for (const it of raw) { m.set(it.id, it); it.children = []; it.depth = 0; it.hasChildren = false; }
  for (const it of raw) {
    let p: TapdItem | undefined;
    if (it.parentId && m.has(it.parentId)) p = m.get(it.parentId);
    if (p && p.id !== it.id) { p.children.push(it); p.hasChildren = true; } else roots.push(it);
  }
  function setD(n: TapdItem, d: number) { n.depth = d; for (const c of n.children) setD(c, d + 1); }
  for (const r of roots) setD(r, 0);
  return roots;
}

// ============ 格式化 ============

function tapdUrl(it: TapdItem): string {
  return `https://www.tapd.cn/${it.workspaceId}/prong/stories/view/${it.id}`;
}

function getTypeIcon(it: TapdItem): string {
  const n = it.workitemTypeName ?? "";
  if (n.includes("PR合并")) return "🔀";
  if (n.includes("文档") || n.includes("Doc")) return "📄";
  if (n.includes("搭建")) return "🏗️";
  if (n.includes("数据")) return "📊";
  if (n.includes("测试")) return "🧪";
  if (n.includes("设计") || n.includes("UI")) return "🎨";
  if (n.includes("开发") || n.includes("研发")) return "💻";
  if (n.includes("需求")) return "🎯";
  if (n.includes("缺陷") || n.includes("Bug")) return "🐛";
  if (n.includes("任务")) return "📝";
  if (n.includes("技术") || n.includes("架构")) return "🔧";
  if (n.includes("优化") || n.includes("改进")) return "✨";
  if (n.includes("运维") || n.includes("部署")) return "🚀";
  if (n.includes("调研") || n.includes("分析")) return "🔍";
  if (n.includes("重构")) return "♻️";
  return "📋";
}

function prioritySymbol(raw: string): string {
  const map: Record<string, string> = { "4": "紧急", "3": "高", "2": "中", "1": "低", "5": "紧急", "High": "高", "Middle": "中", "Low": "低", "Urgent": "紧急", "high": "高", "middle": "中", "low": "低", "urgent": "紧急", "紧急": "紧急", "高": "高", "中": "中", "低": "低" };
  return map[raw] ?? raw.slice(0, 2);
}

function padR(s: string, w: number): string {
  const v = visibleWidth(s);
  return v >= w ? truncateToWidth(s, w, "") : s + " ".repeat(w - v);
}

function fmtDate(d?: string): string { return d?.slice(0, 10) ?? ""; }

const sortOrder: Record<string, number> = { "紧急": 0, "高": 1, "中": 2, "低": 3 };
function sortFn(a: TapdItem, b: TapdItem): number {
  const pa = sortOrder[a.priority] ?? 99, pb = sortOrder[b.priority] ?? 99;
  return pa !== pb ? pa - pb : (a.due ?? "9999").localeCompare(b.due ?? "9999");
}

// ============ 树形列表组件 ============

interface FlatItem { item: TapdItem; indent: number; expandable: boolean; expanded: boolean; }

class TreeList {
  private roots: TapdItem[] = [];
  expandedIds = new Set<string>();
  private visible: FlatItem[] = [];
  selectedIdx = 0;
  private maxVisible = 20;

  onSelect?: (item: FlatItem) => void;
  onCancel?: () => void;

  getSelectedItem(): TapdItem | null {
    if (this.selectedIdx >= 0 && this.selectedIdx < this.visible.length) return this.visible[this.selectedIdx].item;
    return null;
  }

  setRoots(r: TapdItem[]) { this.roots = r; this.selectedIdx = 0; this.rebuild(); }

  private rebuild() {
    this.visible = [];
    const walk = (nodes: TapdItem[]) => {
      for (const n of nodes) {
        this.visible.push({ item: n, indent: n.depth, expandable: n.hasChildren, expanded: this.expandedIds.has(n.id) });
        if (n.hasChildren && this.expandedIds.has(n.id)) walk(n.children);
      }
    };
    walk(this.roots);
    if (this.selectedIdx >= this.visible.length) this.selectedIdx = Math.max(0, this.visible.length - 1);
  }

  toggleExpand(idx: number) {
    if (idx < 0 || idx >= this.visible.length) return;
    const fi = this.visible[idx];
    if (!fi.expandable) return;
    if (this.expandedIds.has(fi.item.id)) this.expandedIds.delete(fi.item.id); else this.expandedIds.add(fi.item.id);
    this.rebuild();
    const i = this.visible.findIndex((v) => v.item.id === fi.item.id);
    if (i >= 0) this.selectedIdx = i;
  }
  expand(idx: number) {
    if (idx < 0 || idx >= this.visible.length) return;
    const fi = this.visible[idx];
    if (!fi.expandable || fi.expanded) return;
    this.expandedIds.add(fi.item.id);
    this.rebuild();
    const i = this.visible.findIndex((v) => v.item.id === fi.item.id);
    if (i >= 0) this.selectedIdx = i;
  }
  collapse(idx: number) {
    if (idx < 0 || idx >= this.visible.length) return;
    const fi = this.visible[idx];
    if (!fi.expandable || !fi.expanded) return;
    this.expandedIds.delete(fi.item.id);
    this.rebuild();
    const i = this.visible.findIndex((v) => v.item.id === fi.item.id);
    if (i >= 0) this.selectedIdx = i;
  }

  handleInput(data: string): boolean {
    if (data === "\x1b[A" || data === "k") { if (this.selectedIdx > 0) this.selectedIdx--; return true; }
    if (data === "\x1b[B" || data === "j") { if (this.selectedIdx < this.visible.length - 1) this.selectedIdx++; return true; }
    if (data === "\x1b[5~") { this.selectedIdx = Math.max(0, this.selectedIdx - 10); return true; }
    if (data === "\x1b[6~") { this.selectedIdx = Math.min(this.visible.length - 1, this.selectedIdx + 10); return true; }
    if (data === " ") { this.toggleExpand(this.selectedIdx); return true; }
    if (data === "\x1b[C") { this.expand(this.selectedIdx); return true; }
    if (data === "\x1b[D") { this.collapse(this.selectedIdx); return true; }
    if (data === "\r" || data === "\n") { if (this.visible.length > 0 && this.selectedIdx < this.visible.length) this.onSelect?.(this.visible[this.selectedIdx]); return true; }
    if (data === "\x1b") { this.onCancel?.(); return true; }
    return false;
  }

  render(width: number, theme: any): string[] {
    const maxW = width - 2;
    if (this.visible.length === 0) return [theme.fg("dim", "  (无)")];
    const half = Math.floor(this.maxVisible / 2);
    let start = Math.max(0, this.selectedIdx - half);
    let end = Math.min(this.visible.length, start + this.maxVisible);
    if (end - start < this.maxVisible) start = Math.max(0, end - this.maxVisible);
    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      const fi = this.visible[i], item = fi.item;
      const indent = "  ".repeat(fi.indent);
      const marker = fi.expandable ? (fi.expanded ? "▾ " : "▸ ") : "  ";
      const icon = getTypeIcon(item);
      const prefixLen = visibleWidth(indent + marker + icon + " ");
      const titleW = Math.max(10, maxW - prefixLen - 10 - 8 - 12 - 12 - 4);
      let line = indent + marker + icon;
      line += " " + padR(truncateToWidth(item.name, titleW, "…"), titleW);
      line += " " + padR(truncateToWidth(item.status, 10, ""), 10);
      line += " " + padR(prioritySymbol(item.priority), 8);
      line += " " + padR(fmtDate(item.begin), 12);
      line += " " + padR(fmtDate(item.due), 12);
      lines.push(i === this.selectedIdx ? theme.fg("accent", truncateToWidth(line, maxW, "")) : truncateToWidth(line, maxW, ""));
    }
    if (this.visible.length > this.maxVisible) lines.push(theme.fg("dim", `  ${start + 1}-${end}/${this.visible.length}`));
    return lines;
  }
}

// ============ 主表格 UI ============

async function fetchWsData(ws: { id: string; name: string }, c: TapdConfig, scope: "current" | "all", s?: AbortSignal): Promise<{ items: TapdItem[]; errors: string[] }> {
  const items: TapdItem[] = [], errors: string[] = [];
  const todoIds = await fetchTodoIds(ws.id, c, s);
  if (todoIds.length === 0) return { items, errors };
  const detailed = await fetchStories(ws.id, todoIds, c, s);
  const iterations = await fetchIterations(ws.id, c, s);
  const iterName = new Map<string, string>();
  const currentIds = new Set<string>();
  for (const it of iterations) {
    iterName.set(it.id, it.name);
    if (isCurrent(it)) currentIds.add(it.id);
  }
  if (scope === "current" && currentIds.size === 0) return { items, errors };
  const typeNames = await fetchTypeNames(ws.id, c, s);

  for (const raw of detailed) {
    const iterId = raw.iteration_id ?? undefined;
    if (scope === "current" && !(iterId && currentIds.has(iterId))) continue;
    items.push({
      id: raw.id, name: raw.name, status: raw.v_status ?? raw.status,
      priority: raw.priority_label ?? raw.priority ?? "-", owner: raw.owner,
      workspaceId: raw.workspace_id, workspaceName: ws.name,
      begin: raw.begin?.slice(0, 10), due: raw.due?.slice(0, 10),
      iterationId: iterId, iterationName: iterId ? iterName.get(iterId) : undefined,
      parentId: raw.parent_id ?? undefined,
      workitemTypeName: raw.workitem_type_id ? (typeNames.get(raw.workitem_type_id) ?? undefined) : undefined,
      children: [], depth: 0, hasChildren: false,
    });
  }

  // 补充缺失的父需求
  const present = new Set(items.map((i) => i.id));
  const missing = [...new Set(items.filter((i) => i.parentId && !present.has(i.parentId)).map((i) => i.parentId!))];
  if (missing.length > 0) {
    const parents = await fetchStories(ws.id, missing, c, s);
    for (const raw of parents) {
      const iterId = raw.iteration_id ?? undefined;
      items.push({
        id: raw.id, name: raw.name, status: raw.v_status ?? raw.status,
        priority: raw.priority_label ?? raw.priority ?? "-", owner: raw.owner,
        workspaceId: raw.workspace_id, workspaceName: ws.name,
        begin: raw.begin?.slice(0, 10), due: raw.due?.slice(0, 10),
        iterationId: iterId, iterationName: iterId ? iterName.get(iterId) : undefined,
        parentId: raw.parent_id ?? undefined,
        workitemTypeName: raw.workitem_type_id ? (typeNames.get(raw.workitem_type_id) ?? undefined) : undefined,
        children: [], depth: 0, hasChildren: false,
      });
    }
  }
  return { items, errors };
}

async function fetchAll(workspaces: { id: string; name: string }[], c: TapdConfig, scope: "current" | "all", s: AbortSignal): Promise<{ items: TapdItem[]; errors: string[] }> {
  const results = await Promise.all(workspaces.map((ws) => fetchWsData(ws, c, scope, s)));
  const all: TapdItem[] = []; const errs: string[] = [];
  for (const r of results) { all.push(...r.items); errs.push(...r.errors); }
  return { items: all, errors: errs };
}

type CreateDraft = { title: string; projectPaths: string[] };
type PickerAction =
  | { type: "create"; draft: CreateDraft }
  | { type: "switch"; sessionFile: string };
type TableOutcome =
  | { kind: "done"; saveState: boolean }
  | { kind: "session_action"; action: PickerAction; itemKey: string; itemName: string };

async function showTable(ctx: ExtensionCommandContext, c: TapdConfig, workspaces: { id: string; name: string }[], _cur: boolean): Promise<TableOutcome> {
  const controller = new AbortController();

  ctx.ui.notify("正在获取当前迭代待办...", "info");
  const currResult = await fetchAll(workspaces, c, "current", controller.signal);
  let currentTree = buildTree(currResult.items);
  sortTree(currentTree);

  if (currResult.errors.length > 0) ctx.ui.notify(`部分工作空间获取失败: ${currResult.errors.join(", ")}`, "warning");

  let allTree: TapdItem[] = [];
  let allLoaded = false;
  let viewCurrent = true;
  let typeFilter: string | null = null;

  while (true) {
    const tree = viewCurrent ? currentTree : allTree;
    const viewLabel = viewCurrent ? "当前迭代" : "所有迭代";
    let display: TapdItem[];
    if (typeFilter) { display = flatFilter(tree, typeFilter); } else { display = tree; }

    const sel = await renderTable(ctx, display, viewLabel, typeFilter);
    if (!sel) break;

    if (sel.action === "toggle") {
      viewCurrent = !viewCurrent;
      if (!viewCurrent && !allLoaded) {
        ctx.ui.notify("正在获取所有迭代待办...", "info");
        const allR = await fetchAll(workspaces, c, "all", controller.signal);
        allTree = buildTree(allR.items); sortTree(allTree);
        allLoaded = true;
        if (allR.errors.length > 0) ctx.ui.notify(`部分工作空间获取失败: ${allR.errors.join(", ")}`, "warning");
      }
      continue;
    }
    if (sel.action === "type_filter") {
      const types = collectTypes(allLoaded && allTree.length > 0 ? allTree : currentTree);
      const pick = await ctx.ui.select("按类型筛选:", ["全部", ...types]);
      typeFilter = pick && pick !== "全部" ? pick : null;
      continue;
    }
    if (sel.action === "open" && sel.url) { openUrl(sel.url); ctx.ui.notify("已在浏览器中打开", "info"); continue; }
    if (sel.action === "link_view" && sel.itemKey) {
      const links = loadLinks();
      const [wsId, storyId] = sel.itemKey.split("_");
      const rec = links[sel.itemKey] ?? { workspaceId: wsId, storyId, name: sel.itemName!, sessions: [] };
      const action = await showSessionPicker(ctx, rec, sel.itemKey, sel.itemName!);
      if (action) {
        return { kind: "session_action", action, itemKey: sel.itemKey, itemName: sel.itemName! };
      }
      continue;
    }
    break;
  }
  return { kind: "done", saveState: true };
}

function openUrl(url: string) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.error("Failed to open URL:", err.message); });
}

function sortTree(nodes: TapdItem[]) { nodes.sort(sortFn); for (const n of nodes) sortTree(n.children); }

function collectTypes(forest: TapdItem[]): string[] {
  const seen = new Set<string>();
  const walk = (ns: TapdItem[]) => { for (const n of ns) { if (n.workitemTypeName) seen.add(n.workitemTypeName); walk(n.children); } };
  walk(forest);
  return [...seen].sort();
}

function flatFilter(forest: TapdItem[], tn: string): TapdItem[] {
  const r: TapdItem[] = [];
  const walk = (ns: TapdItem[]) => { for (const n of ns) { if (n.workitemTypeName === tn) r.push({ ...n, depth: 0, hasChildren: false, children: [] }); walk(n.children); } };
  walk(forest);
  r.sort(sortFn);
  return r;
}

function flattenItems(forest: TapdItem[]): TapdItem[] {
  const r: TapdItem[] = [];
  const walk = (ns: TapdItem[]) => { for (const n of ns) { r.push(n); walk(n.children); } };
  walk(forest);
  return r;
}

function searchFlat(forest: TapdItem[], query: string): TapdItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const r = flattenItems(forest).filter((it) => {
    return it.name.toLowerCase().includes(q)
      || it.id.includes(q)
      || it.status.toLowerCase().includes(q)
      || it.priority.toLowerCase().includes(q)
      || (it.owner?.toLowerCase().includes(q) ?? false)
      || (it.workitemTypeName?.toLowerCase().includes(q) ?? false)
      || it.workspaceName.toLowerCase().includes(q);
  }).map((it) => ({ ...it, depth: 0, hasChildren: false, children: [] }));
  r.sort(sortFn);
  return r;
}

/** 从会话文件读取名称 */
function readSessionTitle(f: string): string | null {
  try {
    if (!existsSync(f)) return null;
    for (const line of readFileSync(f, "utf-8").split("\n").reverse()) {
      try { const e = JSON.parse(line); if (e.type === "session_info" && e.name) return e.name; } catch {}
    }
    return null;
  } catch { return null; }
}

// ============ 会话选择器 ============

/** @returns 用户选择的会话操作；null 表示取消或返回列表 */
async function showSessionPicker(ctx: ExtensionContext, rec: TapdLinkRecord, itemKey: string, itemName: string): Promise<PickerAction | null> {
  const opts: { link?: SessionLink; label: string; isCreate: boolean }[] = [];
  for (const s of rec.sessions.slice().reverse()) {
    const time = new Date(s.createdAt).toLocaleString("zh-CN");
    let title = s.sessionFile ? (readSessionTitle(s.sessionFile) ?? s.title) : s.title;
    if (!title) title = "(无标题)";
    const pathHint = s.projectPaths?.length ? `  │  ${s.projectPaths.length} 项目` : "";
    opts.push({ link: s, label: `${title}  │  ${time}${pathHint}${s.sessionFile ? " ◆" : ""}`, isCreate: false });
  }
  opts.push({ isCreate: true, label: "📝 创建新会话" });

  const action = await ctx.ui.custom<PickerAction | null>((tui, theme, _kb, done) => {
    let container = new Container();
    let selectedIdx = 0;
    let pendingDelete: SessionLink | null = null;
    let pendingDeletePath: string | null = null;

    // 创建流程：直接填写表单
    let isCreating = false;
    let selectedPaths: string[] = [];
    let pathHistory = loadPathHistory();
    let focus = 0; // form: 0=名称 1..=历史路径 pathHistory.length+1=路径输入 +2=创建
    const nameInput = new Input();
    const pathInput = new Input();

    function focusCount(): number {
      return pathHistory.length + 3; // name + histories + pathInput + submit
    }
    function histFocusStart(): number { return 1; }
    function pathInputFocus(): number { return pathHistory.length + 1; }
    function submitFocus(): number { return pathHistory.length + 2; }

    function finishCreate() {
      const title = nameInput.getValue().trim() || itemName;
      const pendingPath = pathInput.getValue().trim();
      const paths = [...selectedPaths];
      if (pendingPath && !paths.includes(pendingPath)) paths.push(pendingPath);
      done({
        type: "create",
        draft: { title, projectPaths: paths },
      });
    }

    nameInput.onSubmit = () => {
      focus = Math.min(focus + 1, focusCount() - 1);
      syncInputFocus();
      rebuild();
      tui.requestRender();
    };
    nameInput.onEscape = () => {
      exitCreate();
    };

    pathInput.onSubmit = (value) => {
      const p = value.trim();
      if (p) {
        if (!selectedPaths.includes(p)) selectedPaths.push(p);
        rememberProjectPaths([p]);
        pathHistory = loadPathHistory();
        pathInput.setValue("");
        (pathInput as any).cursor = 0;
        focus = pathInputFocus();
      }
      syncInputFocus();
      rebuild();
      tui.requestRender();
    };
    pathInput.onEscape = () => {
      exitCreate();
    };

    function syncInputFocus() {
      nameInput.focused = isCreating && focus === 0;
      pathInput.focused = isCreating && focus === pathInputFocus();
    }

    function enterCreate() {
      isCreating = true;
      pendingDelete = null;
      pendingDeletePath = null;
      const currentPath = ctx.cwd.trim();
      if (currentPath) {
        // Keep the current project visible in the history list so its checked
        // state is explicit and can still be toggled off by the user.
        rememberProjectPaths([currentPath]);
        pathHistory = loadPathHistory();
        selectedPaths = [currentPath];
      } else {
        selectedPaths = [];
        pathHistory = loadPathHistory();
      }
      focus = 0;
      nameInput.setValue(itemName);
      (nameInput as any).cursor = itemName.length;
      pathInput.setValue("");
      (pathInput as any).cursor = 0;
      syncInputFocus();
      rebuild();
      tui.requestRender();
    }

    function exitCreate() {
      isCreating = false;
      syncInputFocus();
      rebuild();
      tui.requestRender();
    }

    function applyDelete(link: SessionLink) {
      if (link.sessionFile) {
        exec(`trash "${link.sessionFile}"`, (err) => {
          if (err) exec(`del /f /q "${link.sessionFile}"`, () => {});
        });
      }
      const l2 = loadLinks();
      for (const k of Object.keys(l2)) {
        l2[k].sessions = l2[k].sessions.filter((s: any) => s.id !== link.id);
        if (l2[k].sessions.length === 0) delete l2[k];
      }
      saveLinks(l2);
      const idx = opts.findIndex((o) => o.link?.id === link.id);
      if (idx >= 0) opts.splice(idx, 1);
      if (selectedIdx >= opts.length) selectedIdx = Math.max(0, opts.length - 1);
      ctx.ui.notify("已删除", "info");
    }

    function togglePathAt(histIdx: number) {
      const p = pathHistory[histIdx];
      if (!p) return;
      const i = selectedPaths.indexOf(p);
      if (i >= 0) selectedPaths.splice(i, 1);
      else selectedPaths.push(p);
    }

    function applyDeletePath(path: string) {
      const histIdx = pathHistory.indexOf(path);
      if (histIdx < 0) return;
      removeProjectPathFromHistory(path);
      selectedPaths = selectedPaths.filter((p) => p !== path);
      pathHistory = loadPathHistory();
      if (focus > histFocusStart() + histIdx) focus--;
      else if (focus === histFocusStart() + histIdx) {
        focus = pathHistory.length > 0
          ? Math.min(histFocusStart() + histIdx, histFocusStart() + pathHistory.length - 1)
          : pathInputFocus();
      }
      syncInputFocus();
      ctx.ui.notify("已删除历史路径", "info");
    }

    const HINT_INDENT = "    ";
    const SECTION_INDENT = "  ";

    function cursor(active: boolean): string {
      return active ? theme.fg("accent", "> ") : SECTION_INDENT;
    }

    function mark(active: boolean, text: string): string {
      return cursor(active) + text;
    }

    function addBlankLine() {
      container.addChild(new Text("", 1, 0));
    }

    function addCreatePageHeader() {
      container.addChild(new Text(theme.bold("创建新会话"), 1, 0));
      addBlankLine();
    }

    function addSectionTitle(label: string, optional = false) {
      const suffix = optional ? theme.fg("muted", "（可选）") : "";
      container.addChild(new Text(theme.bold(label) + suffix, 1, 0));
    }

    function addSubmitAction(active: boolean) {
      const label = active
        ? theme.fg("accent", theme.bold("[ 创建会话 ]"))
        : theme.fg("dim", "[ 创建会话 ]");
      container.addChild(new Text(SECTION_INDENT + label, 1, 0));
    }

    function addHelp(text: string) {
      addBlankLine();
      container.addChild(new Text(theme.fg("dim", text), 1, 0));
    }

    function rebuild() {
      container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(new Text(theme.bold(`「${itemName}」关联会话`) + theme.fg("muted", `  │  ${opts.length} 项`), 1, 0));

      if (pendingDelete) {
        addBlankLine();
        container.addChild(new Text(theme.fg("error", theme.bold(`确认删除「${pendingDelete.title || "会话"}」？`)), 1, 0));
        addHelp("Enter 确认  Esc/Ctrl+C 取消");
      } else if (pendingDeletePath) {
        addBlankLine();
        container.addChild(new Text(theme.fg("error", theme.bold("确认从历史中删除该路径？")), 1, 0));
        container.addChild(new Text(HINT_INDENT + pendingDeletePath, 1, 0));
        addHelp("Enter 确认  Esc/Ctrl+C 取消");
      } else if (isCreating) {
        addBlankLine();
        addCreatePageHeader();

        addSectionTitle("会话名称", true);
        if (focus === 0) {
          container.addChild(nameInput);
        } else {
          const title = nameInput.getValue().trim() || itemName;
          container.addChild(new Text(SECTION_INDENT + theme.fg("text", title), 1, 0));
        }
        addBlankLine();

        addSectionTitle("项目路径", true);
        container.addChild(new Text(SECTION_INDENT + theme.fg("muted", "可多选历史路径，或添加新路径；Ctrl+D 删除历史项"), 1, 0));
        if (selectedPaths.length > 0) {
          container.addChild(new Text(HINT_INDENT + theme.fg("muted", `已选 ${selectedPaths.length} 项: ${selectedPaths.join(" | ")}`), 1, 0));
        }
        for (let i = 0; i < pathHistory.length; i++) {
          const p = pathHistory[i];
          const checked = selectedPaths.includes(p) ? "[x]" : "[ ]";
          const active = focus === histFocusStart() + i;
          const row = active ? theme.bold(`${checked} ${p}`) : theme.fg("text", `${checked} ${p}`);
          container.addChild(new Text(cursor(active) + row, 1, 0));
        }
        if (focus === pathInputFocus()) {
          container.addChild(pathInput);
        } else {
          const pending = pathInput.getValue().trim();
          const hint = pending || "添加路径…";
          const row = pending ? theme.fg("text", hint) : theme.fg("muted", hint);
          container.addChild(new Text(cursor(focus === pathInputFocus()) + row, 1, 0));
        }
        addBlankLine();

        addSubmitAction(focus === submitFocus());
        addHelp("↑↓ 切换  Space 勾选  Enter 确认  Ctrl+D 删历史  Esc 返回  Ctrl+C 退出\n    创建后输入 /tapd analyze 开始需求理解");
      } else {
        addBlankLine();
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i];
          const active = i === selectedIdx;
          const label = active ? theme.bold(o.label) : theme.fg("text", o.label);
          container.addChild(new Text(cursor(active) + label, 1, 0));
        }
        addHelp("Enter 选择  Ctrl+D 删除  Esc/Ctrl+C 返回");
      }

      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    }

    rebuild();

    return {
      render(w: number) { return container.render(w); },
      invalidate() { container.invalidate(); },
      handleInput(data: string) {
        // 页内删除确认：禁止再嵌套 ctx.ui.confirm，否则取消后 custom 无法 done() 会堵死主循环
        if (pendingDelete) {
          if (data === "\r" || data === "\n") {
            applyDelete(pendingDelete);
            pendingDelete = null;
            rebuild();
            tui.requestRender();
            return;
          }
          if (data === "\x1b" || data === "\x03") {
            pendingDelete = null;
            rebuild();
            tui.requestRender();
            return;
          }
          return;
        }

        if (pendingDeletePath) {
          if (data === "\r" || data === "\n") {
            applyDeletePath(pendingDeletePath);
            pendingDeletePath = null;
            rebuild();
            tui.requestRender();
            return;
          }
          if (data === "\x1b" || data === "\x03") {
            pendingDeletePath = null;
            rebuild();
            tui.requestRender();
            return;
          }
          return;
        }

        if (data === "\x03") { done(null); return; }

        if (isCreating) {
          if (data === "\x1b") {
            exitCreate();
            return;
          }

          // 输入框聚焦时：↑↓ 切焦点，其余交给 Input
          if (focus === 0 || focus === pathInputFocus()) {
            if (data === "\x1b[A" || data === "\x1b[B") {
              if (data === "\x1b[A" && focus > 0) focus--;
              if (data === "\x1b[B" && focus < focusCount() - 1) focus++;
              syncInputFocus();
              rebuild();
              tui.requestRender();
              return;
            }
            if (focus === 0) nameInput.handleInput(data);
            else pathInput.handleInput(data);
            tui.requestRender();
            return;
          }

          if (data === "\x1b[A" || data === "k") {
            if (focus > 0) { focus--; syncInputFocus(); rebuild(); tui.requestRender(); }
            return;
          }
          if (data === "\x1b[B" || data === "j") {
            if (focus < focusCount() - 1) { focus++; syncInputFocus(); rebuild(); tui.requestRender(); }
            return;
          }
          if (data === " ") {
            if (focus >= histFocusStart() && focus < pathInputFocus()) {
              togglePathAt(focus - histFocusStart());
              rebuild();
              tui.requestRender();
            }
            return;
          }
          if (data === "\x04") {
            if (focus >= histFocusStart() && focus < pathInputFocus()) {
              const p = pathHistory[focus - histFocusStart()];
              if (p) {
                pendingDeletePath = p;
                rebuild();
                tui.requestRender();
              }
            }
            return;
          }
          if (data === "\r" || data === "\n") {
            if (focus >= histFocusStart() && focus < pathInputFocus()) {
              togglePathAt(focus - histFocusStart());
              rebuild();
              tui.requestRender();
            } else if (focus === submitFocus()) {
              finishCreate();
            }
            return;
          }
          return;
        }

        if (data === "\x1b[A" || data === "k") { if (selectedIdx > 0) { selectedIdx--; rebuild(); tui.requestRender(); } return; }
        if (data === "\x1b[B" || data === "j") { if (selectedIdx < opts.length - 1) { selectedIdx++; rebuild(); tui.requestRender(); } return; }

        if (data === "\r" || data === "\n") {
          const o = opts[selectedIdx];
          if (o.isCreate) {
            enterCreate();
          } else if (o.link?.sessionFile) {
            done({ type: "switch", sessionFile: o.link.sessionFile });
          } else {
            ctx.ui.notify("无可恢复文件", "warning");
          }
          return;
        }

        if (data === "\x04") {
          const o = opts[selectedIdx];
          if (o.isCreate || !o.link) return;
          const link = o.link;
          const curFile = ctx.sessionManager.getSessionFile();
          if (curFile && link.sessionFile === curFile) {
            ctx.ui.notify("不能删除当前会话", "warning");
            return;
          }
          pendingDelete = link;
          rebuild();
          tui.requestRender();
          return;
        }

        if (data === "\x1b") { done(null); return; }
      },
    };
  });

  return action;
}

async function createTapdSession(
  ctx: ExtensionCommandContext,
  config: TapdConfig,
  itemKey: string,
  itemName: string,
  draft: CreateDraft,
): Promise<void> {
  const [wsId, storyId] = itemKey.split("_");
  const { title, projectPaths } = draft;
  rememberProjectPaths(projectPaths);

  const url = storyUrl(wsId, storyId);
  const detail = await fetchStoryDetail(wsId, storyId, config);
  const description = detail?.description ? htmlToText(String(detail.description)) : "";
  const requirementTitle = detail?.name || title;
  const understandingFile = getUnderstandingDocPath(ctx.cwd, requirementTitle);
  mkdirSync(dirname(understandingFile), { recursive: true });

  const requirementPrompt = buildUnderstandPrompt({
    title: requirementTitle,
    storyId,
    url,
    description,
    projectPaths,
    understandingFile,
  });

  const links = loadLinks();
  const rec2 = getOrCreateLink(links, wsId, storyId, itemName);
  const linkId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    setup: (sm) => {
      sm.appendMessage({
        role: "user",
        content: [{ type: "text", text: requirementPrompt }],
        timestamp: Date.now(),
      });
    },
    withSession: async (replacementCtx) => {
      const sf = replacementCtx.sessionManager.getSessionFile?.() ?? "";
      const links3 = loadLinks();
      const rec3 = getOrCreateLink(links3, wsId, storyId, itemName);
      if (sf) {
        const lk = rec3.sessions.find((s) => s.id === linkId);
        if (lk) lk.sessionFile = sf;
      }
      saveLinks(links3);
      replacementCtx.ui.notify("会话已创建，输入 /tapd analyze 开始需求理解", "info");
    },
  });

  if (result.cancelled) {
    throw new Error("创建会话已取消");
  }
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

  // This command is registered by the extension instance bound to the current
  // session, so use its current pi. Never retain the ReplacedSessionContext
  // from the newSession() callback for a later command invocation.
  pi.sendUserMessage(prompt);
}

// ============ 表格渲染 ============

async function renderTable(_ctx: ExtensionContext, forest: TapdItem[], viewLabel: string, typeFilter: string | null): Promise<{ action: string; url?: string; itemKey?: string; itemName?: string } | null> {
  function countAll(ns: TapdItem[]): number { let c = 0; for (const n of ns) { c++; c += countAll(n.children); } return c; }
  const total = countAll(forest);

  return await _ctx.ui.custom<{ action: string; url?: string; itemKey?: string; itemName?: string } | null>((tui, theme, _kb, done) => {
    const treeList = new TreeList();
    treeList.setRoots(forest);
    treeList.onCancel = () => done(null);

    const searchInput = new Input();
    let focusSearch = false;
    let searching = false;
    let shownCount = total;
    let curW = 80, container: Container;

    function applySearch() {
      const q = searchInput.getValue().trim();
      searching = q.length > 0;
      if (!searching) {
        treeList.setRoots(forest);
        shownCount = total;
      } else {
        const matched = searchFlat(forest, q);
        treeList.setRoots(matched);
        shownCount = matched.length;
      }
    }

    function clearSearch() {
      searchInput.setValue("");
      (searchInput as any).cursor = 0;
      applySearch();
    }

    searchInput.onEscape = () => {
      clearSearch();
      focusSearch = false;
      rebuildAll();
      tui.requestRender();
    };

    function rebuildAll() {
      const titleW = Math.max(10, curW - 2 - 5 - 10 - 8 - 12 - 12 - 4);
      container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(new Text(
        theme.fg("accent", theme.bold(`TAPD 待办 - ${viewLabel}`))
          + theme.fg("dim", `  │  ${shownCount}${searching ? "/" + total : ""} 项`)
          + (typeFilter ? theme.fg("warning", `  [${typeFilter}]`) : "")
          + (searching ? theme.fg("warning", "  [搜索]") : ""),
        1, 0,
      ));

      searchInput.focused = focusSearch;
      if (focusSearch) {
        container.addChild(new Text(theme.fg("accent", "搜索"), 1, 0));
        container.addChild(searchInput);
      } else {
        const q = searchInput.getValue();
        container.addChild(new Text(theme.fg("dim", q ? `搜索: ${q}` : "搜索: (按 / 输入)"), 1, 0));
      }

      container.addChild(new Text("     " + theme.fg("dim", padR("标题", titleW)) + " " + theme.fg("dim", padR("状态", 10)) + " " + theme.fg("dim", padR("优先", 8)) + " " + theme.fg("dim", padR("开始", 12)) + " " + theme.fg("dim", padR("结束", 12)), 1, 0));
      for (const line of treeList.render(curW, theme)) container.addChild(new Text(line, 1, 0));

      const hint = focusSearch
        ? "输入过滤  ↑↓ 选中  Enter 关联会话  Esc 清除并返回  Ctrl+C 退出"
        : searching
          ? "↑↓ 导航  Enter 关联会话  o 浏览器打开  / 搜索  Esc 清除搜索  Ctrl+C 退出"
          : "↑↓ 导航  Space/→/← 展开收起  Enter 关联会话  o 浏览器打开  / 搜索  Tab 切换迭代  t 类型  Esc/Ctrl+C 退出";
      container.addChild(new Text(theme.fg("dim", hint), 1, 0));
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    }
    rebuildAll();

    return {
      render(w: number) { if (w !== curW) { curW = w; rebuildAll(); } return container.render(w); },
      invalidate() { container.invalidate(); },
      handleInput(data: string) {
        if (focusSearch) {
          if (data === "\x03") { done(null); return; }
          if (data === "\x1b[A" || data === "\x1b[B" || data === "\x1b[5~" || data === "\x1b[6~") {
            treeList.handleInput(data);
            rebuildAll();
            tui.requestRender();
            return;
          }
          if (data === "\r" || data === "\n") {
            const it = treeList.getSelectedItem();
            if (it) done({ action: "link_view", itemKey: linkKey(it.workspaceId, it.id), itemName: it.name });
            return;
          }
          searchInput.handleInput(data);
          applySearch();
          rebuildAll();
          tui.requestRender();
          return;
        }

        if (data === "\x03") { done(null); return; }
        if (data === "\x1b") {
          if (searchInput.getValue()) {
            clearSearch();
            rebuildAll();
            tui.requestRender();
            return;
          }
          done(null);
          return;
        }
        if (data === "/") {
          focusSearch = true;
          rebuildAll();
          tui.requestRender();
          return;
        }
        if (data === "\t" || data === "\x1b[Z") { done({ action: "toggle" }); return; }
        if (data === "t") { done({ action: "type_filter" }); return; }
        if (data === "\r" || data === "\n") {
          const it = treeList.getSelectedItem();
          if (it) done({ action: "link_view", itemKey: linkKey(it.workspaceId, it.id), itemName: it.name });
          return;
        }
        if (data === "o") {
          const it = treeList.getSelectedItem();
          if (it) done({ action: "open", url: tapdUrl(it) });
          return;
        }
        if (treeList.handleInput(data)) { rebuildAll(); tui.requestRender(); }
      },
    };
  });
}

// ============ 扩展入口 ============

export default function tapdExtension(pi: ExtensionAPI) {
  const STATE_KEY = "tapd-view-state";

  pi.registerCommand("tapd", {
    description: "查看 TAPD 待办；生成需求理解、技术设计或协作评审文档",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items: AutocompleteItem[] = [
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
      ];
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const config = loadConfig();
      if (!config) { ctx.ui.notify('请先配置 ~/.pi/agent/tapd.json:\n{ "token": "你的TAPD个人令牌" }', "error"); return; }

      const sub = args.trim().split(/\s+/)[0];
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

      ctx.ui.notify("正在连接 TAPD...", "info");
      const user = await fetchUserInfo(config);
      if (!user) { ctx.ui.notify("TAPD 连接失败，请检查令牌", "error"); return; }

      ctx.ui.notify(`已连接 (${user.nick})，正在获取工作空间...`, "info");
      const workspaces = await fetchWorkspaces(user.nick, config);
      if (workspaces.length === 0) { ctx.ui.notify("没有找到工作空间", "error"); return; }

      let curOnly = true;
      const entries = ctx.sessionManager.getEntries();
      const se = entries.filter((e: any) => e.type === "custom" && e.customType === STATE_KEY).pop() as any;
      if (se?.data) curOnly = se.data.currentOnly ?? true;

      ctx.ui.notify(`找到 ${workspaces.length} 个工作空间，正在获取待办...`, "info");
      const outcome = await showTable(ctx, config, workspaces, curOnly);
      if (outcome.kind === "session_action") {
        const { action, itemKey, itemName } = outcome;
        try {
          if (action.type === "switch") {
            await ctx.switchSession(action.sessionFile);
          } else {
            await createTapdSession(ctx, config, itemKey, itemName, action.draft);
          }
        } catch {
          // 会话可能已替换，勿再使用旧 ctx
        }
        return;
      }
      if (outcome.saveState) pi.appendEntry(STATE_KEY, { currentOnly: curOnly });
    },
  });

  pi.registerShortcut("ctrl+shift+t", {
    description: "打开 TAPD 待办",
    handler: async (ctx) => {
      const config = loadConfig();
      if (!config) { ctx.ui.notify("请先配置 ~/.pi/agent/tapd.json", "warning"); return; }
      const user = await fetchUserInfo(config);
      if (!user) { ctx.ui.notify("TAPD 连接失败", "error"); return; }
      const workspaces = await fetchWorkspaces(user.nick, config);
      if (workspaces.length > 0) await showTable(ctx, config, workspaces, true);
    },
  });
}
