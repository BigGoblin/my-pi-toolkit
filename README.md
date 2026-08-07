<div align="center">

# my-pi-toolkit

面向 [Pi](https://pi.dev/) coding-agent 的扩展包：会话模式、TAPD 工作流、Context7、Cursor 模型桥、主题与 Skills。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org/)
[![Pi](https://img.shields.io/badge/Pi-coding--agent-purple.svg)](https://pi.dev/)

安装后在任意项目启动 Pi 即可加载，无需按项目重复安装。

</div>

---

## Table of Contents

- [Features](#features)
- [Preview](#preview)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Components](#components)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

| 能力 | 说明 |
| --- | --- |
| 会话模式 | `Shift+Tab` 在 Build / Plan / Ask 间切换；Plan 支持选项确认式关键决策，配合任务清单与 Grok 风格工具时间线 |
| TAPD 工作流 | 待办 Overlay、需求分析 / 技术设计 / 协作评审、Bug 定位、子需求同步，以及关联分支 / 提交 / GitLab MR |
| Context7 | 为 Agent 提供第三方库最新文档，减少对训练数据的依赖 |
| 会话与分支门禁 | 恢复会话时校验 Git 分支，降低跨分支误操作 |
| 子 Agent 控制台 | `/subagents` 与 `Alt+A` 查看、管理并行任务过程 |
| 启动面板与主题 | M-PI Dashboard；推荐主题 `grok-build-dark` |

能力由三个扩展入口编排：`ming-core`、`tapd`、`context7`。通用模块细节见 [`extensions/README.md`](extensions/README.md)。

## Preview

<div align="center">

**M-PI Dashboard** — 启动面板：Context / Skills / Extensions / Themes

<img src="assets/dashboard.png" alt="M-PI Dashboard" width="900" />

**TAPD 待办** — `/tapd` Overlay：需求与 Bug 列表、键盘导航

<img src="assets/tapd.png" alt="TAPD todo overlay" width="900" />

**主对话区** — BUILD 模式、任务耗时与 Footer 状态栏

<img src="assets/chat.png" alt="Chat session with BUILD mode" width="900" />

**Subagents** — `/subagents`：Repo Search / TAPD Review 等任务列表

<img src="assets/subagents.png" alt="Subagents overlay" width="900" />

</div>

## Prerequisites

- Node.js `>= 22.19`
- 已安装 [Pi coding-agent](https://github.com/earendil-works/pi)（`pi` 可用）
- 调用 LLM 需通过 `/login` 配置 provider；外部 API（TAPD / Context7 / GitLab）按需配置，不影响扩展加载

## Install

### 从源码

```bash
git clone https://github.com/BigGoblin/my-pi-toolkit.git
cd my-pi-toolkit
npm install
pi install .
```

### 从 git

可钉分支 / commit：

```bash
pi install git:github.com/BigGoblin/my-pi-toolkit@main
```

### 本地 packages 路径

在 `~/.pi/agent/settings.json` 中指向本地路径：

```json
{
  "packages": ["~/path/to/my-pi-toolkit"]
}
```

本仓库已 vendored Open Cursor（Cursor ↔ Pi 桥），无需再单独安装 `npm:@open-cursor/pi-agent`。`pi-lens` 已内置；在 Termux 等无原生 binary 的环境会自动跳过，不影响其它扩展。

## Quick Start

```bash
cd /path/to/your-project
pi --no-session
```

首次启动若提示信任项目目录，选择 Trust。启动面板应列出三个扩展：`ming-core`、`tapd`、`context7`。

| 操作 | 说明 |
| --- | --- |
| `Shift+Tab` | 切换 Build / Plan / Ask |
| `/tapd` | 打开 TAPD 待办（需配置） |
| `/context7 <query>` | 查询第三方库文档 |
| `/subagents` | 管理子 Agent |
| `/settings` | 切换主题等设置 |
| `/helps` | 打开 [my-pi-toolkit](https://github.com/BigGoblin/my-pi-toolkit) 文档仓库 |
| `/reload` | 修改扩展后重新加载运行时 |

## Configuration

扩展本身可无凭证加载；下列配置仅在使用对应能力时需要：

| 能力 | 配置 |
| --- | --- |
| TAPD | `~/.pi/agent/tapd.json`（详见 [`extensions/tapd/README.md`](extensions/tapd/README.md)） |
| Context7 | `~/.pi/agent/context7.json` 或环境变量 `CONTEXT7_API_KEY` |
| GitLab（TAPD MR 等） | `tapd.json` 的 `gitlab.token` 或 `GITLAB_PERSONAL_ACCESS_TOKEN` |
| Cursor 模型 | Pi 内 `/login`（OAuth） |
| OpenAI 兼容模型自动发现 | `~/.pi/agent/models.json` 中省略 `models`（或 `[]`）；打开 `/model` 时刷新；详见 [`extensions/openai-compat-models/README.md`](extensions/openai-compat-models/README.md) |

## Components

### Extensions

| 扩展 | 简介 | 文档 |
| --- | --- | --- |
| ming-core | 通用能力编排：模型、Plan、子 Agent、Dashboard、Session Branch Guard、Pi Lens 等 | [`extensions/ming-core/README.md`](extensions/ming-core/README.md) |
| TAPD | 待办、需求分析、选项确认式技术设计、协作评审、Bug 定位与子需求同步 | [`extensions/tapd/README.md`](extensions/tapd/README.md) |
| Context7 | 第三方库最新文档查询 | [`extensions/context7/README.md`](extensions/context7/README.md) |

完整模块列表见 [`extensions/README.md`](extensions/README.md)。

### Themes

- `grok-build-dark`：推荐的 Grok Build 风格深色主题（消息、Markdown、工具状态与工作流配色）

通过 `/settings` 切换；不影响命令、快捷键或会话数据。

<details>
<summary><strong>Skills</strong></summary>

- [`skills/context7`](skills/context7/)：指导 Agent 查询第三方库最新文档
- [`.pi/skills/pi-package-bundler`](.pi/skills/pi-package-bundler/)：仅在本 toolkit 仓库内可用，将指定 Pi package 集成并随分发
- `node_modules/pi-lens/skills`：Pi Lens 自带的代码导航、AST 规则与诊断 Skills

给出 npm 包名、pi.dev 页面、npm 页面或 GitHub 链接即可触发 package bundler，也可执行 `/skill:pi-package-bundler`。

</details>

<details>
<summary><strong>Vendored provider</strong></summary>

[`vendor/open-cursor/`](vendor/open-cursor/) 是本地化的 Cursor ↔ Pi 桥，由 `ming-core` 内的 `cursor-models` 加载。协议或流式行为相关改动见该目录文档。

</details>

## Troubleshooting

<details>
<summary><strong>Termux / <code>@ast-grep/cli</code> 安装失败</strong></summary>

若出现 `Failed to locate @ast-grep/cli native binary`：`pi-lens` 依赖在 Android 上无对应原生包。仓库已用 `.npmrc`（`ignore-scripts=true`）规避整次 `npm install` 失败。

若 git 安装目录仍缺依赖（例如 `pi install` 显示已安装但缺少 `marked`），在缓存目录强制重装：

```bash
cd ~/.pi/agent/git/github.com/BigGoblin/my-pi-toolkit
rm -rf node_modules && npm install --omit=dev
```

或卸干净后重装：

```bash
pi remove git:github.com/BigGoblin/my-pi-toolkit
rm -rf ~/.pi/agent/git/github.com/BigGoblin/my-pi-toolkit
pi install git:github.com/BigGoblin/my-pi-toolkit@main
```

</details>

## Development

修改扩展或 vendored provider 后，在 Pi 中执行 `/reload`。依赖变更后于仓库根目录执行 `npm install`。

扩展入口与依赖版本统一维护在 [`package.json`](package.json)。

- [`AGENTS.md`](AGENTS.md)：仓库内 Agent / 扩展开发规范
- [`docs/tui-development-guidelines.md`](docs/tui-development-guidelines.md)：TUI、工具展示、Widget、Overlay、Footer 与 Theme 规范
- [`docs/tapd-api.md`](docs/tapd-api.md)：TAPD Open API 资料索引

---

## License

MIT · 欢迎 [Issue](https://github.com/BigGoblin/my-pi-toolkit/issues) 与 PR；较大行为或 API 变更请先开 Issue 讨论。
