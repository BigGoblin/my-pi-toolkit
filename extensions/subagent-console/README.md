# Subagent Console

`subagent-console` 由 `ming-core` 注册，为 Repo Search、TAPD Review 和 Multi Task 等共享 RPC 子 Agent 提供统一的管理列表与只读详情 Overlay。

## 命令与键位

- `/subagents`：打开任务列表。默认显示当前主会话创建的任务，`Tab` 切换全部会话。
- `Alt+A`：直接进入当前会话最近的活跃子 Agent；没有活跃任务时打开列表。
- 列表：`↑/↓` 选择，`Enter` 执行默认动作，`C` 请求取消，`X` 终止活跃任务，`D` 清理已退出记录，`Esc` 关闭。
- 详情：`←/→` 按列表排序循环切换上一个/下一个子 Agent，Header 显示当前位置；`↑/↓`、`PageUp/PageDown`、`Home/End` 或鼠标滚轮滚动；`app.thinking.toggle`（默认 `Ctrl+T`）折叠/恢复 thinking，`app.tools.expand`（默认 `Ctrl+O`）展开工具结果，`Esc` 返回列表。Footer 会显示当前配置的实际键位。详情切换范围沿用打开时的 `CURRENT`/`ALL` 列表范围；`Alt+A` 打开的详情只在当前会话的活跃子 Agent 间切换。

## 实时与历史详情

运行中的任务直接订阅内存 registry，并复用 Pi 的 `UserMessageComponent`、`AssistantMessageComponent` 和 `ToolExecutionComponent`，显示完整 user、assistant/thinking 与工具时间线。thinking 在 Overlay 中默认折叠，可用 `app.thinking.toggle` 恢复显示；折叠不会从 transcript 删除内容。

任务完成或退出后，控制台从运行目录的 `sessions/*.jsonl` 读取当前 session branch，重建全部消息与工具调用/结果，并继续使用同一组 Pi 组件渲染。因此 completed 历史不再只显示最后一条 assistant 输出，只有 `exited.json` 的任务也不会退化为无样式的 transcript 摘要。

built-in 工具 renderer 遵循 `~/.pi/agent/ming-core.json` 的 `builtinToolStyle`：默认 `grok` 时复用 `built-in-tool-style` 的 read/write/edit/bash/grep/find/ls 时间线；`native` 或部分工具配置会与主界面一致地回退原生 renderer。配置损坏时只回退原生，不阻止 Overlay 打开。

为兼容旧记录，如果 session 文件缺失、损坏或无法读取，详情会回退到 `result.json` 的最终 Markdown；仍无结果时再显示 `transcript.jsonl` 文本摘要或明确的空记录提示。

## TUI 与生命周期

Overlay 使用主题语义色和共享 `fitLine()`，宽度由终端响应式计算；固定 Header、Footer 与边框计入高度预算。键盘可完成全部操作，鼠标滚轮仅为增强。

实时详情打开时订阅 run 更新并获取共享 mouse tracking；左右切换时会取消旧 run 订阅、按需加载新详情并订阅新的 live run，同时重置滚动和 auto-follow。组件关闭、异常销毁或 reload 时会幂等取消当前订阅并释放 mouse tracking。关闭 Overlay 不会终止子 Agent。

运行记录默认位于系统临时目录的 `my-pi-toolkit-subagents/`，保留时间由 `~/.pi/agent/subagents.json` 的 `retainCompletedMinutes` 控制。
