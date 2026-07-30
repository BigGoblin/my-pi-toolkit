# ming-core

本 toolkit 的通用能力编排入口。启动面板扩展列表显示为 `ming-core`。

## 编排内容

按加载顺序依次注册：

1. `cursor-models` — Cursor 模型折叠、思考等级、Fast 模式
2. `model-manager` — 新对话默认模型与思考等级
3. `pi-lens` — LSP / AST / 诊断（npm `pi-lens` 转发）
4. `chat-mode` — Build / Ask 模式（`Alt+M`）
5. `agent-todos` — 任务清单工具与 UI
6. `search-subagent` — 只读 Search 子 Agent
7. `subagent-console` — `/subagents` 与 `Alt+A`
8. `titlebar-working` — 工作中标题栏动画
9. `startup-dashboard` — 启动面板与 Footer

实现仍在各自目录；本入口只做组合注册。

## 独立加载路径

子 Agent 禁止加载本入口。继续使用：

- `extensions/cursor-models/index.ts` — 仅注册 `cursor-agent` provider
- `extensions/search-subagent/gitignore-guard.ts` — Search 子进程 `.gitignore` 门禁

`extensions/shared/subagent/` 仍为 search / console / tapd 共享库。

## 独立扩展

- `tapd`、`context7` 仍在 `package.json` 的 `pi.extensions` 中单独注册。
