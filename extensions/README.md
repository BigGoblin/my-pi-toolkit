# Extensions

本目录包含 `my-pi-toolkit` 加载的 Pi 扩展。

`package.json` 的 `pi.extensions` 现为 **3 个入口**：

| 扩展 | 说明 | 文档 |
| --- | --- | --- |
| ming-core | 通用能力编排（模型、会话壳、子 Agent、Dashboard、Pi Lens 等） | [`ming-core/README.md`](ming-core/README.md) |
| TAPD | TAPD 待办、需求文档工作流、Bug 定位和子需求同步 | [`tapd/README.md`](tapd/README.md) |
| Context7 | 第三方库最新文档查询工具 | [`context7/README.md`](context7/README.md) |

## ming-core 内能力模块

实现仍在下列目录；由 `ming-core` 统一注册，启动面板扩展列表只显示 `ming-core`（外加 tapd / context7）。

| 模块 | 说明 | 文档 |
| --- | --- | --- |
| Repo Search Subagent | 面向当前本地仓库大规模文件检索的独立只读子 Agent及过程 Overlay | [`repo-search-subagent/README.md`](repo-search-subagent/README.md) |
| Subagent Console | 用 `/subagents` 列表快捷键查看、取消、终止和清理子 Agent，或用 `Alt+A` 进入最近任务 | `subagent-console/index.ts` |
| Agent Todos | Cursor TodoWrite 风格任务清单，editor 上方完整进度 | [`agent-todos/README.md`](agent-todos/README.md) |
| Chat Mode | 使用 `Alt+M` 切换 Build/Ask；Ask 仅允许 `.pi/**` 项目写入 | [`chat-mode/README.md`](chat-mode/README.md) |
| Cursor Models | Cursor 模型折叠、思考等级和 Fast 模式 | [`cursor-models/README.md`](cursor-models/README.md) |
| Model Manager | 为新对话应用可配置的默认模型和思考等级 | [`model-manager/README.md`](model-manager/README.md) |
| Pi Lens | LSP、AST 搜索、诊断和代码分析扩展加载入口 | [`pi-lens/README.md`](pi-lens/README.md) |
| M-PI Dashboard | M-PI 响应式启动面板、自定义 Header 与模型 Footer | [`startup-dashboard/README.md`](startup-dashboard/README.md) |
| Titlebar Working | Agent 工作时在终端标题显示 braille 动画 | `titlebar-working/index.ts` |
| Hello | 用于确认 toolkit 已加载的简单 smoke test（未注册） | `hello.ts` |

子 Agent 仍通过瘦路径单独加载 `cursor-models`（及 Repo Search 的 `gitignore-guard`），不要改为加载 `ming-core`。
