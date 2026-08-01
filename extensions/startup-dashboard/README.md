# M-PI Startup Dashboard

用原生终端字符构建 `M-PI` 启动面板，替换内置启动 Header，并提供匹配的模型 Footer。

本模块由 [`ming-core`](../ming-core/README.md) 编排加载，不再单独出现在 `pi.extensions` 中。

## 功能

- `mpi` 首次启动时清理当前终端画面和回滚缓冲区，避免 Dashboard 上方残留 PowerShell 命令；`/reload` 和会话切换不会清屏。
- 使用 Grok Build 风格的轻量品牌行、工作区说明、资源分栏和 Ready 快捷提示，减少装饰性卡片与重边框。
- Context、Skills、Extensions 和 Themes 始终完整展示，不使用折叠或展开快捷键。
- 中屏自动变为两行双栏，窄屏变为紧凑单栏，避免内容超出终端宽度。
- 四类资源均动态发现；Skills 同时覆盖 toolkit、`~/.pi/agent/skills`、`~/.agents/skills` 及当前项目的 `.pi/.agents` 技能目录，Context 使用 `./`、`../` 相对路径区分同名文件。
- Footer 使用响应式双行布局；第一行显示 Build/Plan/Ask、项目、Git 分支、会话标题、`provider/model`、思考强度、Fast 状态和活跃子 Agent。模式配色全部来自当前 Theme，窄屏按 segment 自动换行和紧凑化。
- 第二行优先显示上下文用量和进度条，再显示输入/输出 Token、缓存读写与会话花费；Context 在 70% 起使用 warning、90% 起使用 error。所有缺失字段都会连同分隔符一起隐藏。

## 使用

扩展由 toolkit 自动加载。为避免内置的 Context / Skills / Extensions / Themes 清单与 M-PI 面板重复，请在 `~/.pi/agent/settings.json` 中启用静默启动：

```json
{
  "quietStartup": true
}
```

该设置只隐藏内置启动 Header 和资源清单，不会隐藏扩展提供的 M-PI Header。Toolkit 安装不会覆盖用户设置，因此需要在实际运行 `mpi` 的用户配置中设置一次；Windows 默认为 `C:\\Users\\<用户名>\\.pi\\agent\\settings.json`。修改扩展代码后执行 `/reload`；修改 `quietStartup` 后请重启 Pi。

可选命令：

```text
/dashboard-header # 在自定义和内置 Header 之间切换
/dashboard-footer # 在自定义和内置 Footer 之间切换
```

切换状态仅在当前 Pi 进程中保存；重启或 `/reload` 后恢复自定义界面。

## 推荐主题

推荐在 `/settings` 选择 `grok-build-dark`，它统一了 Dashboard、消息、Markdown、工具时间线、Todo、Plan 与 Subagent 的状态颜色。原有 `toolkit-midnight` 仍保留；扩展不会强制修改用户当前主题。

## 已知差异

终端使用字符网格，无法像 PNG 一样实现抗锯齿 Logo、像素级圆角、阴影和光晕。实际颜色也会受终端背景、字体和 TrueColor 支持影响。自定义 Footer 会替换 Pi 默认 Footer；如需恢复默认 Footer，请运行 `/dashboard-footer`。Token 与花费按完整会话累计，包含 assistant、tool result、分支摘要和压缩产生的 usage。
