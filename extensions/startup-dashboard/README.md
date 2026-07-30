# M-PI Startup Dashboard

用原生终端字符构建 `M-PI` 启动面板，替换内置启动 Header，并提供匹配的模型 Footer。

## 功能

- `mpi` 首次启动时清理当前终端画面和回滚缓冲区，避免 Dashboard 上方残留 PowerShell 命令；`/reload` 和会话切换不会清屏。
- 宽屏显示品牌区、Tips、介绍卡片以及 Context / Skills / Extensions / Themes 四栏；Skills 使用两列展示。
- Context、Skills、Extensions 和 Themes 始终完整展示，不使用折叠或展开快捷键。
- 中屏自动变为两行双栏，窄屏变为紧凑单栏，避免内容超出终端宽度。
- 四类资源均动态发现；Skills 同时覆盖 toolkit、`~/.pi/agent/skills`、`~/.agents/skills` 及当前项目的 `.pi/.agents` 技能目录，Context 使用 `./`、`../` 相对路径区分同名文件。
- Footer 使用响应式双行布局显示项目名、当前 Git 分支、真实会话标题、`provider/model`、思考强度，以及 Cursor 模型的实时 Fast 状态；窄屏会按 segment 自动换行与紧凑化。
- Footer 汇总输入/输出 Token、缓存读写、会话花费，并显示上下文已用量、窗口、百分比和动态进度条；所有缺失字段都会连同图标与分隔符一起隐藏。

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

Toolkit 内置 `toolkit-midnight` 主题，使用更柔和、偏暗的青紫配色以降低长时间使用的视觉刺激。在 Pi 中打开 `/settings` 并选择该主题。扩展不会强制修改用户当前主题。

## 已知差异

终端使用字符网格，无法像 PNG 一样实现抗锯齿 Logo、像素级圆角、阴影和光晕。实际颜色也会受终端背景、字体和 TrueColor 支持影响。自定义 Footer 会替换 Pi 默认 Footer；如需恢复默认 Footer，请运行 `/dashboard-footer`。Token 与花费按完整会话累计，包含 assistant、tool result、分支摘要和压缩产生的 usage。
