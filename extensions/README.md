# Extensions

本目录包含 `my-pi-toolkit` 加载的 Pi 扩展。

`package.json` 的 `pi.extensions` 现为 **3 个入口**：

| 扩展 | 说明 | 文档 |
| --- | --- | --- |
| ming-core | 通用能力编排（模型、会话壳、子 Agent、Dashboard、Pi Lens 等） | [`ming-core/README.md`](ming-core/README.md) |
| TAPD | TAPD 待办、需求文档工作流、Bug 定位和子需求同步；待办 Overlay 与 Subagent 共用响应式单层 shell | [`tapd/README.md`](tapd/README.md) |
| Context7 | 第三方库最新文档查询工具 | [`context7/README.md`](context7/README.md) |

## ming-core 内能力模块

实现仍在下列目录；由 `ming-core` 统一注册，启动面板扩展列表只显示 `ming-core`（外加 tapd / context7）。

| 模块 | 说明 | 文档 |
| --- | --- | --- |
| Multi Task | 对独立、非重叠文件任务运行后台并行 worker，并提供状态、收集和取消操作 | [`multi-task/README.md`](multi-task/README.md) |
| Repo Search Subagent | 面向当前本地仓库大规模文件检索的独立只读子 Agent及过程 Overlay | [`repo-search-subagent/README.md`](repo-search-subagent/README.md) |
| Subagent Console | 用 `/subagents` 查看和管理子 Agent、用 `Alt+A` 进入最近任务；实时与历史详情复用主界面消息/工具样式，并在 Footer 显示活跃数量 | [`subagent-console/README.md`](subagent-console/README.md) |
| Agent Todos | Cursor TodoWrite 风格任务清单，editor 上方完整进度 | [`agent-todos/README.md`](agent-todos/README.md) |
| Chat Mode | 使用 `Shift+Tab` 循环 Build/Plan/Ask；Plan 仅可写 `.pi/plan.md`，含 enter/exit_plan_mode 审批 | [`chat-mode/README.md`](chat-mode/README.md) |
| Built-in Tool Style | 通过官方 tool factory 为 Pi 七个内置工具提供可选 Grok 时间线；`/grok-tools` 配置 | [`built-in-tool-style/README.md`](built-in-tool-style/README.md) |
| Cursor Models | Cursor 模型折叠、思考等级和 Fast 模式 | [`cursor-models/README.md`](cursor-models/README.md) |
| Model Manager | 为新对话应用可配置的默认模型和思考等级；`/effort` 选择当前模型思考等级 | [`model-manager/README.md`](model-manager/README.md) |
| Pi Lens | LSP、AST 搜索、诊断和代码分析扩展加载入口 | [`pi-lens/README.md`](pi-lens/README.md) |
| M-PI Dashboard | M-PI 响应式启动面板、自定义 Header 与模型 Footer | [`startup-dashboard/README.md`](startup-dashboard/README.md) |
| Titlebar Working | Agent 工作时在终端标题显示 braille 动画 | `titlebar-working/index.ts` |
| Hello | 用于确认 toolkit 已加载的简单 smoke test（未注册） | `hello.ts` |

子 Agent 仍通过瘦路径单独加载 `cursor-models`（以及 Repo Search 的 `gitignore-guard` 或 Multi Task 的 `path-guard`），不要改为加载 `ming-core`。

## TUI 视觉层

`shared/tui/visual-language.ts` 统一状态字符、模式 badge、间距与行宽处理；`overlay-shell.ts` 统一复杂 Overlay 的 Header/viewport/Footer、高度预算和边框；`tool-render.ts` 和 `tool-format.ts` 为 toolkit 工具提供运行/成功/失败时间线。`built-in-tool-style` 可选择性覆盖仍由 Pi builtin 提供的工具 definition；它不替换 Pi 内置主对话 renderer，也不承诺主对话区鼠标点击。Plan 与 Subagent overlay 仅使用扩展层已有的 SGR 鼠标滚轮支持。

新增模块或更新任何 TUI 功能时，必须遵循 [`docs/tui-development-guidelines.md`](../docs/tui-development-guidelines.md)，包括共享视觉语义、响应式宽度、overlay 高度预算、输入与资源释放、工具 renderer、文档和验证清单。
