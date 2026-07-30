# my-pi-toolkit

My personal Pi coding-agent toolkit：集中分发自定义扩展、Skills 和本地化 provider。

## Install

```bash
git clone git@github.com:BigGoblin/my-pi-toolkit.git
cd my-pi-toolkit
npm install
pi install ./my-pi-toolkit
```

`settings.json` 的 `packages` 只需配置本仓库路径，例如：

```json
{
  "packages": ["E:\\my-pi-toolkit"]
}
```

不要再单独安装 `npm:@open-cursor/pi-agent`，Open Cursor 已 vendored 到本仓库。

本包也已内置 `pi-lens`。安装本包后，在任意项目启动 Pi 都会自动加载，无需在每个项目重复安装。

## Components

### Extensions

扩展总览见 [`extensions/README.md`](extensions/README.md)。每个主要扩展在自己的目录中维护详细 README。

| 扩展 | 简介 | 详细文档 |
| --- | --- | --- |
| TAPD | TAPD 待办、需求分析、技术设计、协作评审、Bug 定位和子需求同步 | [`extensions/tapd/README.md`](extensions/tapd/README.md) |
| Context7 | 为 Agent 提供第三方库最新文档查询工具 | [`extensions/context7/README.md`](extensions/context7/README.md) |
| Search Subagent | 为大规模跨文件检索提供独立、只读且可手动进入的 Search 子 Agent | [`extensions/search-subagent/README.md`](extensions/search-subagent/README.md) |
| Subagent Console | 使用 `/subagents` 按当前会话/所有会话管理子 Agent；列表中 `Enter` 查看详情、`C` 取消、`X` 终止、`D` 清理，`Alt+A` 进入当前会话最近的子 Agent | `extensions/subagent-console/index.ts` |
| Agent Todos | Cursor TodoWrite 风格任务清单，输入框上方完整进度 | [`extensions/agent-todos/README.md`](extensions/agent-todos/README.md) |
| Chat Mode | 使用 `Alt+M` 切换 Build/Ask；Ask 仅允许写当前项目 `.pi/**` | [`extensions/chat-mode/README.md`](extensions/chat-mode/README.md) |
| Cursor Models | 折叠 Cursor 模型家族并提供 Fast 模式 | [`extensions/cursor-models/README.md`](extensions/cursor-models/README.md) |
| Model Manager | 为新对话应用可配置的默认模型和思考等级 | [`extensions/model-manager/README.md`](extensions/model-manager/README.md) |
| Pi Lens | 随 toolkit 分发 LSP、诊断、AST 搜索和代码分析能力 | [`extensions/pi-lens/README.md`](extensions/pi-lens/README.md) |
| M-PI Dashboard | M-PI 响应式启动面板、自定义 Header 与模型 Footer | [`extensions/startup-dashboard/README.md`](extensions/startup-dashboard/README.md) |
| Titlebar Working | Agent 工作时在终端标题显示 braille 动画 | `extensions/titlebar-working/index.ts` |
| Hello | 简单的加载 smoke test | `extensions/hello.ts` |

### Themes

- `toolkit-midnight`：为 M-PI Dashboard 设计的低亮度深色青紫主题，可通过 `/settings` 选择。

### Skills

- [`skills/context7`](skills/context7/)：指导 Agent 查询第三方库最新文档。
- [`.pi/skills/pi-package-bundler`](.pi/skills/pi-package-bundler/)：仅在当前 toolkit 项目中可用，将指定 Pi package 集成并随本包分发。
- `node_modules/pi-lens/skills`：Pi Lens 自带的代码导航、AST 规则和诊断 Skills。

给出 npm 包名、pi.dev 页面、npm 页面或 GitHub 链接即可触发 package bundler，也可以使用：

```text
/skill:pi-package-bundler
```

### Vendored provider

[`vendor/open-cursor/`](vendor/open-cursor/) 是本地化的 Cursor ↔ Pi 桥，由 `package.json` 的 `pi.extensions` 直接加载。

需要修改流式 usage、checkpoint 或协议行为时，编辑：

```text
vendor/open-cursor/pi-agent/src/
```

### Documentation

- [`docs/tapd-api.md`](docs/tapd-api.md)：TAPD Open API 官方资料与接口索引。
- [`AGENTS.md`](AGENTS.md)：仓库内 Agent 开发规范。

## Development

修改扩展或 vendored provider 后，在 Pi 中重新加载运行时：

```text
/reload
```

拉取依赖变化后执行：

```bash
npm install
```

扩展加载列表和依赖版本统一维护在 [`package.json`](package.json)。
