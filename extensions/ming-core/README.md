# ming-core

本 toolkit 的通用能力编排入口。启动面板扩展列表显示为 `ming-core`。

## 编排内容

按加载顺序依次注册：

1. `cursor-models` — Cursor 模型折叠、思考等级、Fast 模式
2. `model-manager` — 新对话默认模型与思考等级
3. `pi-lens` — LSP / AST / 诊断（npm `pi-lens` 转发）
4. `chat-mode` — Build / Plan / Ask（`Shift+Tab`、`/plan`、`enter_plan_mode` / `exit_plan_mode`、`ask_user_choice`）
5. `built-in-tool-style` — 可选 Grok 风格 Pi 内置工具时间线（`/grok-tools`）
6. `agent-todos` — 任务清单工具与 UI
7. `multi-task` — 独立文件任务的后台并行 worker 编排
8. `repo-search-subagent` — 只读 Repo Search 子 Agent
9. `subagent-console` — `/subagents` 与 `Alt+A`，完整实时/历史消息和工具时间线
10. `session-branch-guard` — 会话与 Git 分支绑定门禁（`/session-branch`），恢复会话时校验分支，dirty 时提供 stash/直接切换/rebind
11. `task-duration` — 在最终回复下方持久显示首次 `agent_start` 到最终 `agent_settled` 的任务耗时，不进入 LLM 上下文
12. `startup-dashboard` — 启动面板与 Footer

实现仍在各自目录；本入口只做组合注册。新增或更新这些模块的终端 UI 时，必须遵循 [`docs/tui-development-guidelines.md`](../../docs/tui-development-guidelines.md)，并优先复用 `extensions/shared/tui/`。

`model-manager` 同时提供 `/effort`，用于唤起当前模型的思考等级选择器（`Shift+Tab` 已用于切换会话模式）。`built-in-tool-style` 默认启用七个工具的 Grok 展示；使用 `/grok-tools native` 可关闭，`/grok-tools readonly` 可只保留只读工具。切换后会 reload 扩展。

## 独立加载路径

子 Agent 禁止加载本入口。继续使用：

- `extensions/cursor-models/index.ts` — 仅注册 `cursor-agent` provider
- `extensions/repo-search-subagent/gitignore-guard.ts` — Repo Search 子进程 `.gitignore` 门禁
- `extensions/multi-task/path-guard.ts` — Multi Task worker 写入路径门禁

`extensions/shared/subagent/` 仍为 repo search / console / tapd 共享库。

## 独立扩展

- `tapd`、`context7` 仍在 `package.json` 的 `pi.extensions` 中单独注册。
