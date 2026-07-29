# Agent Todos

对标 Cursor `TodoWrite` 的任务清单扩展。复杂任务先拆分，完整进度常驻在输入框上方，不依赖 `/todos`，不做侧边栏。

设计文档：[`docs/agent-todos-design.md`](../../docs/agent-todos-design.md)。

## 行为

1. Agent 在多步骤任务中应先调用 `todo_write` 拆分任务。
2. 成功后，editor **上方**出现完整 Todos 列表；footer 显示 `📋 completed/active`（分母不含 `cancelled`）。
3. 后续用 `merge: true` 按 `id` 更新状态；面板与 footer 即时刷新。
4. 状态保存在 `todo_write` 的 tool result details 中，跟随会话分支（resume / fork）。

## Tool

### `todo_write`

```ts
todo_write({
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

- Widget：完整列表（`○` / `▸` / `✓` / `×`）；超过 16 条时底部显示 `… n more`
- Footer：`📋 2/5` 或全部完成时 `✓ 5/5`
- print / json 模式跳过 UI，工具仍可用

无 `/todos` 命令；查看不依赖斜杠命令。

## 与其它扩展

| 扩展 | 关系 |
| --- | --- |
| 官方示例 `todo` | 工具名不同（`todo_write`），可并存；优先用本扩展 |
| plan-mode / pi-codex-goal / TAPD | 正交，可同时安装 |

## Modules

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 注册 tool、prompt、会话事件 |
| `model.ts` | 校验、merge、计数、格式化 |
| `store.ts` | 内存状态与分支重建 |
| `ui.ts` | widget / footer |
| `render.ts` | 工具行渲染 |
| `prompt.ts` | system prompt 与 guidelines |
