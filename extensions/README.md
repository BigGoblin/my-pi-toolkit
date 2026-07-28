# Extensions

本目录包含 `my-pi-toolkit` 加载的 Pi 扩展。

| 扩展 | 说明 | 文档 |
| --- | --- | --- |
| TAPD | TAPD 待办、需求文档工作流、Bug 定位和子需求同步 | [`tapd/README.md`](tapd/README.md) |
| Context7 | 第三方库最新文档查询工具 | [`context7/README.md`](context7/README.md) |
| Search Subagent | 面向大规模文件检索的独立只读子 Agent | [`search-subagent/README.md`](search-subagent/README.md) |
| Cursor Models | Cursor 模型折叠、思考等级和 Fast 模式 | [`cursor-models/README.md`](cursor-models/README.md) |
| Permission Modes | 可切换权限模式与沙箱扩展加载入口 | [`permission-modes/README.md`](permission-modes/README.md) |
| Pi Lens | LSP、AST 搜索、诊断和代码分析扩展加载入口 | [`pi-lens/README.md`](pi-lens/README.md) |
| Hello | 用于确认 toolkit 已加载的简单 smoke test | `hello.ts` |

扩展加载列表定义在仓库根目录 `package.json` 的 `pi.extensions` 中。
