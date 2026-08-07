# Chat Mode

为 Pi 提供 `Build`、`Plan`、`Ask` 三种会话模式。新会话默认使用 Build；恢复会话或 `/reload` 时恢复当前分支最近保存的模式。

Plan Mode 对齐 [Grok Build](https://github.com/xai-org/grok-build) 的 `PlanModeTracker`、`enter_plan_mode` 和 `exit_plan_mode`：每个 session 固定一个 `plan.md`、进入时 seed 但不截断、重入继续同一方案、磁盘内容作为审批依据，并交替注入 full/sparse/reentry/exit reminder。

## 切换

按 `Shift+Tab` 循环：

```text
BUILD → PLAN → ASK → BUILD
```

也可使用 `/plan` 进入 Plan，使用 `/plan review` 随时重新打开当前 session 已写入的方案。Agent 运行时不能通过快捷键或命令切换模式；但 `/plan review` 是只读浏览，可在 Agent 运行中打开，不会暂停 Agent、触发审批、切换模式或修改 Plan。模型在运行中仍可调用 Enter/Exit Plan 工具。Pi 无法可靠地为已发出的模型请求动态替换工具集合，因此没有照搬 Grok 的 mid-turn toggle。

## Build

默认模式，不限制工具和项目写入。输入框顶边线显示：

```text
─ BUILD ───────
```

## Plan

Plan 用于实施前的只读调研与方案审批：

- 只启用登记的只读工具、Plan 生命周期工具、`ask_user_choice` 和受路径保护的 `write` / `edit`。
- 遇到会实质影响方案的待确认决策时，Agent 在写 Plan 前调用 `ask_user_choice`：展示 2～5 个候选方案，可标记一个推荐项，最后固定提供“其他（自定义输入）”；已有代码证据可以确认的内容不重复询问。
- 用户取消选择时停止规划，不推测答案，也不进入 Plan 审批。
- `write` / `edit` 只能修改本 session 固定的 `plan.md`。
- 禁止修改项目源码或其他 session 的 Plan。
- 输入框顶边线显示主题 warning 色的 `─ PLAN ─`。

### 固定 Plan 文件

与 Grok 一样，每个 session 只有一个固定 Plan：

```text
<pi-session-dir>/<session-id>/plan.md
```

默认位置类似：

```text
~/.pi/agent/sessions/<encoded-cwd>/<session-id>/plan.md
```

- 进入 Plan Mode 时创建空文件，文件已存在则绝不截断。
- 同一 session 再次进入时继续读取和修改同一个文件。
- 不提供 Plan ID、Plan 列表、`/plan new` 或多 Plan artifact。
- 不同 session 通过不同目录隔离。
- `--no-session` 等内存会话没有 session 存储目录，Plan 临时放在系统临时目录的 `pi-plan-sessions/<session-id>/plan.md`。
- 旧 `.pi/plan.md` 与 `.pi/plans/**` 不再读取或写入，也不会自动删除。

预创建空文件是 Grok 的原始行为：用于提前确定唯一可写路径；只有写入内容后才形成实际方案正文。

### Enter / Exit 工具

| 工具 | 作用 |
| --- | --- |
| `enter_plan_mode` | 征得同意后进入 Plan，seed 并返回本 session 固定的 `plan.md` |
| `exit_plan_mode` | 从磁盘读取 Plan，以带背景色的 Markdown 对话框展示全文，再显示审批选项 |
| `ask_user_choice` | 在写 Plan 前确认关键决策；提供推荐选项和最后一项自定义输入 |

TUI 中 Plan 正文和审批选择分开显示：先在 Grok 风格的 `PLAN REVIEW` 单线边框 Markdown overlay 中展示完整方案，底部单独显示滚动和关闭提示；关闭后选择组件只显示操作。overlay 有固定视口，高度预算与 Pi 的 `maxHeight`/margin 对齐，不会撑高终端内容。regular 模式支持鼠标滚轮、↑/↓、PageUp/PageDown、Home/End；Pi 0.84 fullscreen 会先消费 wheel，Overlay 因此只提供键盘滚动，Footer 会隐藏无效的 wheel 提示。Enter/Esc 关闭。Plan Markdown 继承 `markdown.mermaid` 设置并启用 Pi 0.84 Unicode LaTeX；`/plan review` 与审批前的 Plan Review 均支持 Mermaid/LaTeX。`/plan review` 仅重新打开该 overlay，不触发审批或切换模式；即使 Agent 正在运行也可只读浏览当前已写入的 Plan。

审批选项：

- **批准并实现**：切 Build；下一次模型请求只注入一次实现 kickoff，并过滤历史 Plan reminder，模型应立即使用 `write` / `edit` 开始实现。扩展不会直接代替模型修改文件。
- **批准但暂不实现**：切 Build 并结束当前 agent loop，等待后续明确的实施指令。
- **继续编辑**：留在 Plan，继续修改同一个 `plan.md`。
- **取消计划**：切 Build 并结束当前 agent loop，不实施；Plan 文件仍保留供同 session 重入。
- 无 UI 模式默认“批准并实现”。

## Lifecycle

用户进入时先进入 `pending`，下一次 agent prompt 注入 full/reentry reminder 后转为 `active`；模型通过工具进入时，工具结果本身是进入信号，直接 active。active 状态交替注入 full/sparse reminder。用户切换离开时下一轮注入一次 exit reminder；工具审批退出时，Build/Ask 请求会过滤历史 Plan reminder，批准并实现只追加一次实现 kickoff。压缩后下一次恢复 full reminder。

生命周期通过 session custom entry 保存，并按当前 session branch 恢复。

TAPD 的 `/tapd analyze`、`/tapd design`、`/tapd collaboration` 会写入 `chat-mode-ensure-ask-for-docs` 标记；本扩展在 `before_agent_start` 检测到尚未被助手回复消费的该标记时，若当前不是 Ask 则切到 Ask，以便写入项目 `.pi/docs/**`（Plan 仅允许 session `plan.md`，二者冲突）。

## Ask

Ask 用于问答、解释、诊断和只读调研：

- 只启用登记的只读工具及受路径保护的 `write` / `edit`。
- `write` / `edit` 只能修改当前项目 `.pi/**`。
- 禁止 bash、AST 替换及未登记工具。
- 可调用 `enter_plan_mode` 升级到规划阶段（TAPD 文档工作流的 prompt 会明确禁止该调用）。
- 输入框顶边线显示主题 success 色的 `─ ASK ─`。

## 安全边界

Ask / Plan 限制的是模型通过 Pi 工具进行的文件修改，不是操作系统沙箱。它不会阻止用户在其他终端修改文件，也无法限制恶意扩展直接调用 Node.js 文件 API。
