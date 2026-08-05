# my-pi-toolkit

My personal Pi coding-agent toolkit：集中分发自定义扩展、Skills 和本地化 provider。

## Install

```bash
git clone git@github.com:BigGoblin/my-pi-toolkit.git
cd my-pi-toolkit
npm install
pi install .
```

或从 git 直接安装（可钉分支 / commit）：

```bash
pi install git:github.com/BigGoblin/my-pi-toolkit@cursor/chat-mode-plan-8ac0
```

`settings.json` 的 `packages` 只需配置本仓库路径，例如：

```json
{
  "packages": ["E:\\my-pi-toolkit"]
}
```

不要再单独安装 `npm:@open-cursor/pi-agent`，Open Cursor 已 vendored 到本仓库。

本包也已内置 `pi-lens`（可选：在 Termux 等无原生 binary 的环境会自动跳过，不影响其它扩展）。安装本包后，在任意项目启动 Pi 都会自动加载，无需在每个项目重复安装。

### Termux / 安装失败（`@ast-grep/cli`）

若看到 `Failed to locate @ast-grep/cli native binary`，是 `pi-lens` 的依赖在 Android 上没有对应原生包，旧版会让整次 `npm install` 失败。仓库已用 `.npmrc`（`ignore-scripts=true`）规避。

若本地 clone 已卡在失败状态（`pi install` 显示 Installed 但仍缺 `marked`），强制重装依赖：

```bash
cd ~/.pi/agent/git/github.com/BigGoblin/my-pi-toolkit
rm -rf node_modules
npm install --omit=dev
ls node_modules/marked node_modules/@open-cursor/client
pi
```

或卸干净再装：

```bash
pi remove git:github.com/BigGoblin/my-pi-toolkit
rm -rf ~/.pi/agent/git/github.com/BigGoblin/my-pi-toolkit
pi install git:github.com/BigGoblin/my-pi-toolkit@cursor/chat-mode-plan-8ac0
```

## Components

### Extensions

扩展总览见 [`extensions/README.md`](extensions/README.md)。`pi.extensions` 注册 **3 个入口**：`ming-core`、`tapd`、`context7`。通用能力由 [`ming-core`](extensions/ming-core/README.md) 编排；各模块实现仍在原目录。

| 扩展 | 简介 | 详细文档 |
| --- | --- | --- |
| ming-core | 通用能力编排（模型、带选项确认的 Plan、子 Agent、Dashboard、Session Branch Guard、Pi Lens 等） | [`extensions/ming-core/README.md`](extensions/ming-core/README.md) |
| TAPD | TAPD 待办、需求分析、选项确认式技术设计、协作评审、Bug 定位和子需求同步 | [`extensions/tapd/README.md`](extensions/tapd/README.md) |
| Context7 | 为 Agent 提供第三方库最新文档查询工具 | [`extensions/context7/README.md`](extensions/context7/README.md) |

### Themes

- `grok-build-dark`：推荐的 Grok Build 风格深色主题，统一消息、Markdown、工具状态与工作流配色。

可通过 `/settings` 切换主题；主题切换不影响命令、快捷键或会话数据。

### Skills

- [`skills/context7`](skills/context7/)：指导 Agent 查询第三方库最新文档。
- [`.pi/skills/pi-package-bundler`](.pi/skills/pi-package-bundler/)：仅在当前 toolkit 项目中可用，将指定 Pi package 集成并随本包分发。
- `node_modules/pi-lens/skills`：Pi Lens 自带的代码导航、AST 规则和诊断 Skills。

给出 npm 包名、pi.dev 页面、npm 页面或 GitHub 链接即可触发 package bundler，也可以使用：

```text
/skill:pi-package-bundler
```

### Vendored provider

[`vendor/open-cursor/`](vendor/open-cursor/) 是本地化的 Cursor ↔ Pi 桥，由 `ming-core` 内的 `cursor-models` 模块加载。

需要修改流式 usage、checkpoint 或协议行为时，编辑：

```text
vendor/open-cursor/pi-agent/src/
```

### Documentation

- [`docs/tui-development-guidelines.md`](docs/tui-development-guidelines.md)：所有 TUI、工具展示、Widget、Overlay、Footer 和 Theme 新增/更新必须遵循的开发规范。
- [`docs/tapd-api.md`](docs/tapd-api.md)：TAPD Open API 官方资料与接口索引。
- [`AGENTS.md`](AGENTS.md)：仓库内 Agent 开发规范；已将 TUI 规范列为强制要求。

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
