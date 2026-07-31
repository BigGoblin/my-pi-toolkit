# Chat Mode

为 Pi 提供 `Build`、`Plan`、`Ask` 三种会话模式。新会话默认使用 Build；恢复已有会话或执行 `/reload` 时，会恢复该会话最近保存的模式。

设计参考 [Grok Build plan mode](https://github.com/xai-org/grok-build)：Plan 是实现前的结构化规划阶段——只读探索，唯一可写产物是计划文件；模型可通过 `enter_plan_mode` / `exit_plan_mode` 发起进入与交卷审批。

## 切换

按 `Alt+M` 在三种模式间循环：

```text
BUILD → PLAN → ASK → BUILD
```

也可使用 `/plan` 直接进入 Plan。Agent 正在运行时不能用快捷键/命令切换，需等待当前运行结束（工具内的 enter/exit 不受此限制）。`Tab` 保持 Pi 原有的自动补全行为。

## Build

Build 与 Pi 当前默认行为一致，不限制工具和项目文件写入。Footer 左侧使用 `#316DDD` 蓝色显示：

```text
● BUILD
```

任务方案不明确时，模型可调用 `enter_plan_mode`；用户确认后进入 Plan。

## Plan

Plan 用于有歧义或改动面较大的任务：先摸清现状、写方案，再经审批切到 Build 落地。

- 仅启用明确登记的只读工具、计划生命周期工具，以及受路径保护的 `write` / `edit`。
- `write` / `edit` **只能**修改项目本地的 `.pi/plan.md`（计划产物）。
- 禁止 `bash`、AST 替换及未登记工具。
- 系统提示要求按 Context / Approach / Critical files / Verification 结构写入计划。
- Footer 左侧使用当前主题的 `warning` 颜色显示：

```text
◇ PLAN
```

### `enter_plan_mode` / `exit_plan_mode`

| 工具 | 作用 |
| --- | --- |
| `enter_plan_mode` | 征得用户同意后进入 Plan，并种子化 `.pi/plan.md`（不截断已有内容） |
| `exit_plan_mode` | 读取 `.pi/plan.md`，弹出审批：批准实现 / 要求修改 / 放弃 |

- **批准**：切到 Build，工具结果指示模型按计划实现。
- **要求修改**：留在 Plan，可附反馈；模型改计划后再次 `exit_plan_mode`。
- **放弃**：退出 Plan 回到 Build，不实现。
- 无 UI（print 等）时：进入自动确认，退出自动批准。

## Ask

Ask 用于问答、解释、诊断和只读调研：

- 仅启用明确登记的只读工具，以及受路径保护的 `write` / `edit`。
- `write` / `edit` 只能修改当前项目的 `.pi/**`。
- 禁止 `bash`、AST 替换及未登记工具，防止绕过文件限制。
- 仍可调用 `enter_plan_mode` 升级到规划阶段。
- Footer 左侧使用当前主题的 `success` 颜色显示：

```text
◆ ASK
```

路径检查会规范化绝对路径、`..` 和已有符号链接，避免通过 `.pi` 内链接写到项目其他位置。

## 安全边界

Ask / Plan 限制的是模型通过 Pi 工具进行的项目文件修改，不是操作系统沙箱。它不会阻止用户在其他终端修改文件，也无法限制恶意扩展直接调用 Node.js 文件 API。全局 `~/.pi/agent/**` 不在允许写入范围内。
