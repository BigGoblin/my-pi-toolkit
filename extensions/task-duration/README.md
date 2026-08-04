# Task Duration

在 Pi TUI 的每次最终回复下方显示本次任务执行时长。本模块由 [`ming-core`](../ming-core/README.md) 编排加载。

## 展示

```text
本次任务耗时 2m 18s
```

耗时行使用低强调的 Theme 语义色，不带缩进与层级字符，不与最终回复竞争。秒级任务显示 `Xs`，分钟任务显示 `Xm SSs`，小时任务显示 `Xh MMm SSs`。

## 计时边界

- 从一次运行首次触发 `agent_start` 开始计时。
- 到最终 `agent_settled` 停止计时，因此包含工具调用、自动重试、自动压缩恢复，以及 settle 前的队列续接。
- 自动恢复过程中再次触发 `agent_start` 不会重置起点。
- 排队的 steering / follow-up 如果属于同一个 settle 周期，会合并计入同一条耗时记录。

## 持久化与范围

耗时通过 Pi 的 custom entry 写入 session，并由 entry renderer 显示；它不会发送给 LLM，也不会占用模型上下文。恢复历史会话或执行 `/reload` 后，已保存的耗时行仍可显示。

本功能仅在交互式 TUI 会话中记录。Print、JSON、RPC 模式以及使用瘦加载路径的子 Agent 不写入主对话耗时记录。会话在任务结束前关闭时只清理内存计时状态，不追加不完整记录。
