/**
 * TAPD 待办扩展 — 树形交互表格
 *
 * 使用 TAPD Bearer Token 认证（只需个人令牌）。
 * 通过 /user_oauth/get_user_todo_story 获取当前用户待办。
 *
 * 配置 ~/.pi/agent/tapd.json：
 * { "token": "你的TAPD个人令牌" }
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { marked } from "marked";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  apiUrl, fetchBugDetail, fetchStoryDetail, fetchUserInfo, fetchWorkspaces,
  htmlToText, loadConfig, tapdGet, tapdPost,
} from "./api.js";
import { bugUrl, storyUrl } from "./model.js";
import {
  findSessionLink, getCollaborationDocPath, getOrCreateLink, getTapdDocPath,
  loadLinks, parseItemKey, rememberProjectPaths, saveLinks,
} from "./storage.js";
import { showTable } from "./ui.js";
import { ANALYZE_TRIGGER_PROMPT, COLLABORATION_TRIGGER_PROMPT, DESIGN_TRIGGER_PROMPT, buildUnderstandPrompt } from "./prompts.js";
import type { CreateDraft, TapdConfig, TapdResponse } from "./types.js";

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

  const url = parsed.kind === "bug" ? bugUrl(wsId, itemId) : storyUrl(wsId, itemId);
  const detail = parsed.kind === "bug"
    ? await fetchBugDetail(wsId, itemId, config)
    : await fetchStoryDetail(wsId, itemId, config);
  const description = detail?.description ? htmlToText(String(detail.description)) : "";
  const requirementTitle = parsed.kind === "bug" ? ((detail as any)?.title || title) : ((detail as any)?.name || title);
  // Use the TAPD story ID as the stable directory name so renaming the
  // requirement does not create a second document directory.
  const understandingFile = getTapdDocPath(ctx.cwd, `${parsed.kind}-${itemId}`, "understanding.md");
  mkdirSync(dirname(understandingFile), { recursive: true });

  const requirementPrompt = buildUnderstandPrompt({
    title: requirementTitle,
    storyId: itemId,
    url,
    description,
    projectPaths,
    understandingFile,
  });

  const links = loadLinks();
  const rec2 = getOrCreateLink(links, wsId, itemId, itemName, parsed.kind);
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
    setup: async (sm: SessionManager) => {
      sm.appendMessage({
        role: "user",
        content: [{ type: "text", text: requirementPrompt }],
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
      replacementCtx.ui.notify("会话已创建，输入 /tapd analyze 开始需求理解", "info");
    },
  });

  if (result.cancelled) {
    throw new Error("创建会话已取消");
  }
}

async function createDesignSubtask(ctx: ExtensionCommandContext, config: TapdConfig, effortArg?: string): Promise<void> {
  const current = findSessionLink(ctx.sessionManager.getSessionFile?.() ?? "");
  if (!current) {
    ctx.ui.notify("当前会话没有关联 TAPD 需求，请先从 TAPD 创建或切换关联会话", "warning");
    return;
  }
  if (current.record.kind === "bug") {
    ctx.ui.notify("Bug 暂不支持创建设计子需求，请切换到需求会话", "warning");
    return;
  }
  if (current.session.designSubtaskId) {
    ctx.ui.notify(`当前会话已创建设计子需求：${current.session.designSubtaskUrl ?? current.session.designSubtaskId}`, "info");
    return;
  }

  const collaborationFile = getCollaborationDocPath(ctx.cwd, `story-${current.record.storyId}`);
  if (!existsSync(collaborationFile)) {
    ctx.ui.notify(`未找到协作文档，请先执行 /tapd collaboration：${collaborationFile}`, "warning");
    return;
  }
  const markdown = readFileSync(collaborationFile, "utf-8").trim();
  if (!markdown) {
    ctx.ui.notify("协作文档为空，无法创建设计子需求", "warning");
    return;
  }

  let effort = effortArg?.trim() ?? "";
  if (!effort) {
    const input = await ctx.ui.input("预估工时", "请输入 TAPD 工作量数值，例如 2");
    if (input === undefined || input === null) return;
    effort = input.trim();
  }
  const effortValue = Number(effort);
  if (!Number.isFinite(effortValue) || effortValue <= 0) {
    ctx.ui.notify("预估工时必须是大于 0 的数字", "error");
    return;
  }

  const title = `前端-${current.record.name}设计`;
  const confirmed = await ctx.ui.confirm(
    "创建 TAPD 设计子需求",
    `标题：${title}\n父需求：${current.record.name} (${current.record.storyId})\n预估工时：${effort}\n内容：${collaborationFile}`,
  );
  if (!confirmed) return;

  ctx.ui.notify("正在创建 TAPD 设计子需求...", "info");
  const [parentStory, user, workitemTypes] = await Promise.all([
    fetchStoryDetail(current.record.workspaceId, current.record.storyId, config),
    fetchUserInfo(config),
    tapdGet<TapdResponse<{ WorkitemType: { id: string; name: string; english_name?: string } }>>(
      apiUrl(config, "/workitem_types", { workspace_id: current.record.workspaceId, english_name: "design", status: "3", limit: "200" }),
      config,
    ),
  ]);
  if (!parentStory) {
    ctx.ui.notify("获取父需求详情失败，无法继承需求字段", "error");
    return;
  }
  if (!user?.nick) {
    ctx.ui.notify("获取当前 TAPD 用户失败，无法设置处理人和开发人员", "error");
    return;
  }
  const designType = workitemTypes?.data?.map((row) => row.WorkitemType).find((type) => type?.english_name === "design")
    ?? workitemTypes?.data?.map((row) => row.WorkitemType).find((type) => type?.name === "设计子需求");
  if (!designType?.id) {
    ctx.ui.notify("当前工作空间未找到“设计子需求”类型", "error");
    return;
  }

  const description = await marked.parse(markdown, { gfm: true, breaks: false });
  const inheritedFields = Object.fromEntries(
    ["priority_label", "iteration_id", "category_id", "release_id", "module", "version", "source", "feature", "label", "cc", "begin", "due"]
      .map((field) => [field, parentStory[field as keyof typeof parentStory]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
  );
  const created = await tapdPost<{ status: number; data?: { Story?: { id: string } } }>(
    apiUrl(config, "/stories"),
    config,
    {
      workspace_id: current.record.workspaceId,
      name: title,
      description,
      parent_id: current.record.storyId,
      workitem_type_id: designType.id,
      effort: String(effortValue),
      owner: user.nick,
      developer: user.nick,
      ...inheritedFields,
    },
  );
  const childId = created?.data?.Story?.id;
  if (!childId) {
    ctx.ui.notify("创建设计子需求失败，请检查 TAPD 权限和接口返回", "error");
    return;
  }

  const childUrl = storyUrl(current.record.workspaceId, childId);
  current.session.designSubtaskId = childId;
  current.session.designSubtaskUrl = childUrl;
  saveLinks(current.links);
  ctx.ui.notify(`设计子需求已创建：${childUrl}`, "success");
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
        {
          value: "design-sub",
          label: "design-sub",
          description: "根据 collaboration.md 创建设计子需求",
        },
      ];
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
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
      if (sub === "design-sub") {
        await createDesignSubtask(ctx, config, args.trim().split(/\s+/)[1]);
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
    handler: async (ctx: ExtensionCommandContext) => {
      const config = loadConfig();
      if (!config) { ctx.ui.notify("请先配置 ~/.pi/agent/tapd.json", "warning"); return; }
      const user = await fetchUserInfo(config);
      if (!user) { ctx.ui.notify("TAPD 连接失败", "error"); return; }
      const workspaces = await fetchWorkspaces(user.nick, config);
      if (workspaces.length > 0) await showTable(ctx, config, workspaces, true);
    },
  });
}
