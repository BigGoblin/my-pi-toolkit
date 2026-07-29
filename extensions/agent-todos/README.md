# Agent Todos

对标 Cursor `TodoWrite` 的任务清单扩展。复杂任务先拆分，完整进度常驻在输入框上方，不依赖 `/todos`，不做侧边栏。

## 行为

1. Agent 在多步骤任务中应先调用 `agent_todo_write` 拆分任务。
2. 成功后，editor **上方**出现完整 Todos 列表；footer 显示 `📋 completed/active`（分母不含 `cancelled`）。
3. 后续用 `merge: true` 按 `id` 更新状态；面板与 footer 即时刷新。
4. 状态保存在 `agent_todo_write` 的 tool result details 中，跟随会话分支（resume / fork）。

## Tool

### `agent_todo_write`

工具名刻意避开 Cursor 原生 `todo_write`，避免在 Open Cursor 桥接里被当成原生工具过滤掉。

```ts
agent_todo_write({
  merge: boolean,
  todos: Array<{
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
  }>;
})
```

| 规则 | 说明 |
| --- | --- |
| `merge: false` | 整表替换；`todos: []` 清空；恰好 1 条会被拒绝 |
| `merge: true` | 按 `id` 合并；可只传变更项 |
| `in_progress` | 合并后全表最多 1 条 |

## UI

- Widget 在 editor 上方，含：
  - 标题行：`📋 Todos` + 进度与各状态计数（🔄 / ⬜ / ⛔）
  - Unicode 进度条（`█` / `░`）
  - 条目：序号 + emoji 标记 + 文案（完成/取消带删除线）
- 状态 emoji：`⬜` pending · `🔄` in_progress · `✅` completed · `⛔` cancelled
- 超过 16 条时底部显示 `… 还有 n 项未显示`
- Footer：`📋 2/5` 或全部完成时 `✅ 5/5`
- print / json 模式跳过 UI，工具仍可用

**关于图片：** Pi TUI 支持 `Image`（Kitty / iTerm 协议），适合插图，不适合当每条 todo 的小图标；状态标记用 emoji 更稳、更省高度。

无 `/todos` 命令；查看不依赖斜杠命令。

## Cursor provider

- Cursor 原生工具名 `todo_write` 仍保留在 `CURSOR_NATIVE_TOOL_NAMES`（服务端原生 todo）。
- 本扩展使用 `agent_todo_write`，经 MCP 暴露，本地面板才会更新。
- Prompt 会要求模型优先用 `agent_todo_write`，不要用原生 `todo_write` 维护这份清单。

## 与其它扩展

| 扩展 | 关系 |
| --- | --- |
| 官方示例 `todo` | 工具名不同，可并存；优先用本扩展 |
| Cursor 原生 `todo_write` | 名称不同；面板只跟随 `agent_todo_write` |
| plan-mode / pi-codex-goal / TAPD | 正交，可同时安装 |

## Modules

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 注册 tool、prompt、会话事件 |
| `model.ts` | 校验、merge、计数、格式化 |
| `store.ts` | 内存状态与分支重建 |
| `ui.ts` | widget / footer |
| `render.ts` | 工具行渲染 |
| `prompt.ts` | 工具名常量、system prompt 与 guidelines |
