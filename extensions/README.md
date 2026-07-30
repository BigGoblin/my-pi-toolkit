# Extensions

本目录包含 `my-pi-toolkit` 加载的 Pi 扩展。

| 扩展 | 说明 | 文档 |
| --- | --- | --- |
| TAPD | TAPD 待办、需求文档工作流、Bug 定位和子需求同步 | [`tapd/README.md`](tapd/README.md) |
| Context7 | 第三方库最新文档查询工具 | [`context7/README.md`](context7/README.md) |
| Search Subagent | 面向大规模文件检索的独立只读子 Agent及过程 Overlay | [`search-subagent/README.md`](search-subagent/README.md) |
| Subagent Console | 按当前会话/所有会话查看、进入、取消和清理子 Agent（`Alt+A` / `/subagents`） | `subagent-console/index.ts` |
| Agent Todos | Cursor TodoWrite 风格任务清单，editor 上方完整进度 | [`agent-todos/README.md`](agent-todos/README.md) |
| Chat Mode | 使用 `Tab` 切换 Build/Ask；Ask 仅允许 `.pi/**` 项目写入 | [`chat-mode/README.md`](chat-mode/README.md) |
| Cursor Models | Cursor 模型折叠、思考等级和 Fast 模式 | [`cursor-models/README.md`](cursor-models/README.md) |
| Model Manager | 为新对话应用可配置的默认模型和思考等级 | [`model-manager/README.md`](model-manager/README.md) |
| Pi Lens | LSP、AST 搜索、诊断和代码分析扩展加载入口 | [`pi-lens/README.md`](pi-lens/README.md) |
| M-PI Dashboard | M-PI 响应式启动面板、自定义 Header 与模型 Footer | [`startup-dashboard/README.md`](startup-dashboard/README.md) |
| Titlebar Working | Agent 工作时在终端标题显示 braille 动画 | `titlebar-working/index.ts` |
| Hello | 用于确认 toolkit 已加载的简单 smoke test | `hello.ts` |

扩展加载列表定义在仓库根目录 `package.json` 的 `pi.extensions` 中。
