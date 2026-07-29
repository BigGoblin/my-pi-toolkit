# M-PI Startup Dashboard

用原生终端字符构建 `M-PI` 启动面板，替换内置启动 Header，并提供匹配的模型 Footer。

## 功能

- 宽屏显示品牌区、Tips、介绍卡片以及 Context / Skills / Extensions 三栏。
- 中屏自动变为 Context 单栏加 Skills / Extensions 双栏。
- 窄屏使用紧凑单栏，避免内容超出终端宽度。
- Context、Skills 和 Extensions 从当前项目及 toolkit manifest 动态发现；Context 使用 `./`、`../` 相对路径区分同名文件。
- Footer 显示项目名、当前 Git 分支、`provider/model`、思考强度，以及 Cursor 模型可用时的 Fast 状态。
- Footer 汇总上传/下载 Token、缓存读写、会话花费，并显示已用/最大上下文窗口和使用率。

## 使用

扩展由 toolkit 自动加载。为避免内置的 Context / Skills / Extensions / Themes 清单与 M-PI 面板重复，请在 `~/.pi/agent/settings.json` 中启用静默启动：

```json
{
  "quietStartup": true
}
```

该设置只隐藏内置启动 Header 和资源清单，不会隐藏扩展提供的 M-PI Header。修改扩展代码后执行 `/reload`；修改 `quietStartup` 后建议重启 Pi。

可选命令：

```text
/dashboard-header  # 在自定义和内置 Header 之间切换
/dashboard-footer  # 在自定义和内置 Footer 之间切换
```

切换状态仅在当前 Pi 进程中保存；重启或 `/reload` 后恢复自定义界面。

## 推荐主题

Toolkit 内置 `toolkit-midnight` 主题，使用更柔和、偏暗的青紫配色以降低长时间使用的视觉刺激。在 Pi 中打开 `/settings` 并选择该主题。扩展不会强制修改用户当前主题。

## 已知差异

终端使用字符网格，无法像 PNG 一样实现抗锯齿 Logo、像素级圆角、阴影和光晕。实际颜色也会受终端背景、字体和 TrueColor 支持影响。自定义 Footer 会替换 Pi 默认 Footer；如需恢复默认 Footer，请运行 `/dashboard-footer`。Token 与花费按完整会话累计，包含 assistant、tool result、分支摘要和压缩产生的 usage。
