# Agent Todos 设计方案

对标 Cursor `TodoWrite` 的 Pi 扩展设计：**先拆任务、常驻完整进度、会话分支持久化**。  
**不做侧边栏**（Pi 无正式占列侧栏 API；overlay 会盖对话，成本高收益低）。

状态：MVP 已实现，入口：`extensions/agent-todos/`。

---

## 1. 目标与非目标

### 1.1 目标

1. Agent 在复杂任务开始执行前先拆成结构化 todo。
2. 用户在执行过程中**无需命令**即可看到完整任务列表与状态变化。
3. 工具语义对齐 Cursor `TodoWrite`：`merge`、四态、按 `id` 合并。
4. 状态跟随 Pi 会话分支（resume / fork / tree），不依赖外部数据库。
5. 随本 toolkit 分发，开箱可用。

### 1.2 非目标

| 不做 | 原因 |
| --- | --- |
| 侧边栏 / overlay 右栏 | Pi 无 `setSidePanel`；公开 API 无法占列 |
| `/todos` 作为查看主路径 | 进度必须常驻可见 |
| `pi-codex-goal` 式自动续跑 | 职责不同；本扩展只管 checklist |
| plan-mode 只读规划门禁 | 正交；可另装 |
| 依赖图、用户手改勾选 | MVP 复杂度过高 |
| 与 TAPD 事项双向同步 | 范围外；后续可选 |

---

## 2. 用户体验

### 2.1 主流程

```
用户提出非琐碎任务
        │
        ▼
Agent 第一次改代码 / 跑有副作用命令之前
        │
        ▼
调用 agent_todo_write（≥2 条；通常 1 条 in_progress，其余 pending）
        │
        ▼
输入框上方立刻出现完整 Todos 面板（无命令）
        │
        ▼
Agent 边做边 merge 更新 status
        │
        ▼
面板实时刷新；footer 显示 2/5
        │
        ▼
全部 completed / cancelled 后：面板保留最终态片刻，或清空并去掉 footer
```

### 2.2 可见性规则

| 条件 | UI |
| --- | --- |
| 无 todo 或列表为空 | 不显示面板，不显示 footer 摘要 |
| 存在任意非空列表 | **完整列表**显示在 editor **上方** widget |
| 有进行中任务 | footer：`📋 2/5`（completed / 有效总数） |
| 全部完成 | footer：`✓ 5/5`；下一轮新任务或用户清空后消失 |

**完整列表定义：** 显示当前会话中全部 todo 条目（含 `cancelled`），不截断为「仅 in_progress + 3 条 pending」。  
当终端高度不足时，面板组件在内部滚动或按终端可用高度裁剪并在底部显示 `↑↓ n more`，但逻辑上仍持有全量数据；**禁止**依赖 `/todos` 才能看全。

### 2.3 可选快捷键（非主路径）

| 绑定 | 行为 |
| --- | --- |
| `Ctrl+Shift+O`（暂定） | 仅切换面板显隐；默认显示 |
| 无 `/todos` 命令 | 避免把查看做成命令驱动 |

若后续用户强烈需要，可加 `/todos clear` 清空；**查看仍不以命令为准**。

### 2.4 与对话流的关系

- 工具调用行用紧凑 `renderCall` / `renderResult`（变更摘要），避免对话区再刷一整份列表。
- **唯一完整进度面**：editor 上方 widget + footer 计数。

---

## 3. 工具契约

### 3.1 `agent_todo_write`

工具名避开 Cursor 原生 `todo_write`，以免在 Open Cursor 中被 `CURSOR_NATIVE_TOOL_NAMES` 过滤。

```ts
agent_todo_write({
  merge: boolean,
  todos: Array<{
    id: string;       // 稳定短 id，建议 kebab-case
    content: string;  // 任务描述，单行语义
    status: "pending" | "in_progress" | "completed" | "cancelled";
  }>;
});
```

对齐 Cursor：

- `merge: false` → 用本次 `todos` **整表替换**。
- `merge: true` → 按 `id` 合并；未出现的字段保留；新 `id` 追加；已有 `id` 覆盖传入字段。
- 四态语义与 Cursor 一致。

### 3.2 校验（失败返回 error，不改状态）

1. `todos` 必须是数组；每项 `id`、`content` 非空字符串。
2. 同一次调用内 `id` 唯一。
3. `merge: false` 时：`todos.length === 0` 允许（清空）；`1 <= length < 2` **拒绝**（单任务不必建清单；清空走 length 0）。
4. `merge: true` 时：允许只传变更子集；合并后全表仍须满足「最多一个 `in_progress`」。
5. 合并/替换后的全表：`in_progress` 数量 ≤ 1。
6. 未知 `status` → 拒绝。

### 3.3 成功返回（给模型）

文本摘要，例如：

```text
Todos updated (merge=true): 5 total · 1 in_progress · 2 completed · 1 pending · 1 cancelled

[in_progress] auth-middleware — 实现鉴权中间件
[pending] unit-tests — 补单测
[pending] readme — 更新 README
[completed] survey-routes — 摸清现有路由
[cancelled] plan-a — 废弃方案 A
```

`details`：

```ts
{
  action: "write";
  merge: boolean;
  todos: TodoItem[];      // 合并后的完整列表
  counts: TodoCounts;
  error?: undefined;
}
```

### 3.4 不做 `todo_read`（MVP）

完整列表已在 widget 与每次 `agent_todo_write` 返回中；减少工具面。v2 若模型频繁「失忆」再加。

---

## 4. UI 设计

### 4.1 主面板：`ctx.ui.setWidget`（aboveEditor）

依据 Pi 文档：`setWidget` 支持字符串数组或 **component factory**。  
字符串数组有 **10 行硬截断**；因此必须用 **factory 自定义组件**，自行 `render(width)` 输出完整行。

```ts
ctx.ui.setWidget("agent-todos", (tui, theme) => new TodoPanel(store, theme, tui), {
  placement: "aboveEditor",
});
```

面板布局示例：

```
Todos  2/5 · 1 in progress
▸ 实现鉴权中间件
○ 补单测
○ 更新 README
✓ 摸清现有路由
× 废弃方案 A
```

视觉约定：

| status | 前缀 | 样式 |
| --- | --- | --- |
| `pending` | `○` | muted / dim |
| `in_progress` | `▸` | accent / bold |
| `completed` | `✓` | success；content dim |
| `cancelled` | `×` | dim + 删除线感（dim 即可） |

行为：

- `agent_todo_write` 成功 → 更新内存 store → `setWidget` 刷新（或组件持有 store 引用 + `tui.requestRender()`）。
- 空列表 → `setWidget("agent-todos", undefined)`。
- `hasUI === false`（print/json）→ 跳过一切 UI，仅保留工具语义。

### 4.2 Footer：`ctx.ui.setStatus`

```ts
ctx.ui.setStatus("agent-todos", "📋 2/5");
// clear
ctx.ui.setStatus("agent-todos", undefined);
```

有效总数 = 非 `cancelled` 条目数（或含 cancelled 的总数，实现时固定一种并在 README 写明；**建议分母不含 cancelled**，与「还剩多少活」一致）。

### 4.3 工具行渲染

- `renderCall`：`agent_todo_write merge` + 变更条数。
- `renderResult`：默认一行摘要（如 `+2 · ~1 · ✓1`）；expanded 时列出完整列表。

---

## 5. Agent 行为引导

### 5.1 `systemPromptAppend`（短、可执行）

要点：

1. 多步骤、易漏步骤、跨文件改动的任务：在第一次写文件或执行有副作用命令前调用 `agent_todo_write`。
2. 拆成可验证的小步；首次通常 ≥2 条。
3. 同一时刻最多一个 `in_progress`；开始某步时把它标为 `in_progress`，完成立即 `completed`，放弃标 `cancelled`。
4. 增量用 `merge: true`；整体重规划用 `merge: false`。
5. 单次简单问答、纯解释、单文件小改：**不要**建 todo。

### 5.2 可选硬约束（v1.1）

在 `tool_call` 上拦截内置 `write` / `edit`（及可选危险 `bash`）：

- 若当前无 active todo（空列表或全完成），且本轮用户消息像「实现/修复/重构」类任务 → `{ block: true, reason: "先调用 agent_todo_write 拆分任务" }`。
- 默认 **关闭**，配置项 `enforceSplit: boolean` 打开；避免误伤探索性对话。

MVP **只做 prompt 引导**，不做拦截。

---

## 6. 状态与持久化

### 6.1 单一真相

内存 `TodoStore.todos: TodoItem[]`。  
每次成功的 `agent_todo_write` 把**完整列表**写入 `toolResult.details.todos`。

### 6.2 重建

在 `session_start` / `session_tree` 中扫描 `ctx.sessionManager.getBranch()`：

- 找到 `toolName === "agent_todo_write"`（兼容旧名 `todo_write`）的 `toolResult`；
- 取时间序上最后一次带合法 `details.todos` 的结果重建；
- 然后 `refreshUI(ctx)`。

与官方 `examples/extensions/todo.ts` 同源模式，保证 fork / resume 正确。

### 6.3 不做

- 不写 `~/.pi/...` 外部文件。
- 不双写 `appendEntry`（避免与 tool details 两套真相）。自定义 entry 仅当需要「非 LLM 上下文的 TUI 卡片」时再考虑；本方案不需要。

---

## 7. 模块结构

遵守仓库「源文件尽量 ≤300 行」：

```text
extensions/agent-todos/
  index.ts       # 注册 tool / prompt / events / shortcut；组装
  model.ts       # TodoItem、merge、validate、counts（纯函数）
  store.ts       # 内存 store + 从 branch 重建
  ui.ts          # TodoPanel 组件、setWidget / setStatus 刷新
  render.ts      # renderCall / renderResult
  prompt.ts      # systemPromptAppend 文案
  README.md      # 用法与行为说明
```

`package.json` → `pi.extensions` 增加 `./extensions/agent-todos/index.ts`。  
`extensions/README.md` 与根 `README.md` 扩展表同步一行。

导出面：仅 `index.ts` 的 `default` 扩展工厂；`model` 等保持模块私有。

---

## 8. 配置（可选，MVP 可硬编码默认）

`~/.pi/agent/agent-todos.json`（若做配置时）：

```json
{
  "enforceSplit": false,
  "panelVisibleByDefault": true,
  "hidePanelWhenAllDone": true
}
```

MVP 可用常量，配置文件放到 v1.1。

---

## 9. 与其它扩展关系

| 扩展 | 关系 |
| --- | --- |
| 官方示例 `todo.ts` | 能力弱于本方案；工具名用 `agent_todo_write` 避免与 Cursor 原生冲突 |
| plan-mode | 正交；plan 管只读规划，本扩展管执行 checklist |
| pi-codex-goal | 正交；goal 管单目标续跑 |
| TAPD | 正交；TAPD 是产品待办，不是 Agent 步骤 |

可同时安装；若检测到示例 `todo` 工具并存，README 注明优先用 `agent_todo_write`。

---

## 10. 验收标准

1. 复杂任务下 Agent 会在写代码前调用 `agent_todo_write` 拆出 ≥2 条。
2. 调用成功后，**无需任何命令**，editor 上方出现完整列表。
3. merge 更新后面板与 footer 立即反映新状态。
4. 同时两个 `in_progress` 被拒绝，状态不变。
5. fork 会话后 todo 与该分支一致。
6. print 模式无 UI 崩溃，工具仍可用。
7. 单文件行数符合仓库规范；文档已更新。

---

## 11. 实现分期

| 阶段 | 内容 |
| --- | --- |
| **MVP** | `agent_todo_write` + merge/校验 + widget 完整列表 + footer + prompt + 分支持久化 + README |
| **v1.1** | 显隐快捷键、`enforceSplit`、全部完成后自动收起策略、配置文件 |
| **v2** | `todo_read`、与 goal/TAPD 弱联动（可选） |

---

## 12. 明确否决的交互（备忘）

- 侧边栏 / 右侧 overlay 作为主 UI  
- `/todos` 才能看全列表  
- 字符串数组 `setWidget`（10 行截断）作为完整列表载体  
- 把进度主要塞进工具结果展开区  

---

## 13. Cursor provider 兼容

Open Cursor 会把名为 `todo_write` 的工具当成 Cursor 原生工具，**不作为 MCP 下发**。

处理：

1. 本扩展工具命名为 **`agent_todo_write`**，与原生名错开。
2. `CURSOR_NATIVE_TOOL_NAMES` **保留** Cursor 原生 `todo_write`。
3. Prompt 要求模型用 `agent_todo_write` 维护本地面板清单。

## 14. 下一步

用真实 Pi TUI（cursor-agent）验证 `agent_todo_write` → 上方完整面板 → merge 刷新。
