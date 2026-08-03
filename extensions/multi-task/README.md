# Multi Task

`multi_task` 是多任务编排工具。默认的 `run` 模式保持当前工具调用打开，并在同一张工具卡片中显示聚合进度；主 Agent 不需要轮询。一个 Batch 可以平级混合两类 worker：默认的 `implementation` worker 负责受限路径内的实现，`research` worker 直接复用只读 Repo Search 子 Agent。`research` 不会先启动通用 worker，因此不会形成嵌套子 Agent。`start` 保留为高级后台模式，适用于主 Agent 已经有其它不依赖 worker 结果的工作。所有任务都必须彼此独立。

## 工作流

工具提供五个 action：

1. `run`：启动批次并等待全部 worker 结束；通过 `onUpdate` 在当前工具卡片中显示 queued/running/完成进度，最终一次性返回所有报告
2. `start`：创建后台批次并立即返回 `batchId`；完成后自动发送 follow-up，**不要主动轮询**
3. `status`：按需查看批次和各 worker 状态，包含最近工具调用摘要
4. `collect`：收集后台批次的最终报告或错误
5. `cancel`：取消正在运行和排队的 worker

`run` 不需要再调用 `collect`，也不会发送重复完成 follow-up。`start` 完成后，扩展会向主 Agent 排队一条 follow-up，要求调用 `collect`、整合结果并执行项目级验证。所有模式的运行过程也会出现在 `/subagents` 和 `Alt+A` 子 Agent 控制台中；worker 完成或退出后，历史详情仍会按主界面样式显示完整消息、可折叠思考块和工具时间线，并遵循当前 `/grok-tools` 配置。

## 默认实时模式

```json
{
  "action": "run",
  "tasks": [
    {
      "id": "auth-flow-research",
      "kind": "research",
      "task": "梳理认证入口、错误映射和主要调用关系，给出文件与行号证据",
      "paths": ["src/auth", "src/api"]
    },
    {
      "id": "logger-fields",
      "kind": "implementation",
      "task": "补充结构化日志字段",
      "paths": ["src/logger.ts"]
    }
  ],
  "maxConcurrency": 2
}
```

`run` 会在一张工具卡片中显示每个 worker 的类型、状态和最近工具调用，完成后直接返回报告。`kind` 可省略，默认是 `implementation`，因此旧调用保持兼容。只有纯只读、跨多文件或目录的探索任务才应使用 `research`；如果任务最终需要修改文件，即使前置步骤需要搜索，也应使用 `implementation`。

## 后台模式

```json
{
  "action": "start",
  "tasks": [
    {
      "id": "auth-errors",
      "task": "完善认证错误映射并保持现有公共 API",
      "paths": ["src/auth/errors.ts"]
    }
  ]
}
```

`start` 立即返回 `batchId`。不要循环调用 `status`；继续做其它独立工作，等待完成 follow-up 后再调用：

```json
{ "action": "status", "batchId": "..." }
{ "action": "collect", "batchId": "..." }
{ "action": "cancel", "batchId": "..." }
```

`status` 适合用户明确要求查看或排错，不是后台进度通知机制。`model` 可选，控制 implementation worker，默认继承主 Agent 当前模型。research worker 沿用 Repo Search 的模型优先级：受信任项目配置、用户配置、当前主 Agent 模型。Batch 内 research 强制使用内联 RPC/manual 执行并在聚合卡片中更新，不采用 Repo Search 的 split/tab 展示配置。单批最多 8 个任务，并发数范围为 1–6，默认 3；两类 worker 共用同一个并发上限。

## 调度边界

适合：

- 修改互不相交文件的独立 implementation 任务
- 跨多个文件或目录、只需证据报告的独立 research 任务
- 同一 Batch 中平级混合互不依赖的实现与检索
- 主 Agent 同时还有其他不依赖 worker 结果的工作
- 每个任务都有明确目标和路径范围

不适合：

- 多个 implementation 任务修改相同文件或父子目录
- research 范围与并发 implementation 写入范围重叠
- 后一个任务依赖前一个任务
- 尚未完成架构决策的重构
- 需要共同修改公共类型、锁文件或中央导出文件

`start` 会规范化路径并拒绝：

- 空任务、重复任务 ID 或无效 `kind`
- 当前项目之外的路径
- implementation/implementation 或 implementation/research 之间相同、父子包含或目录重叠的路径

research/research 可以重叠，因为两者都是只读；research 的 `paths` 是检索 scope，implementation 的 `paths` 是授权写入范围。跨运行中 Batch 也应用相同冲突规则，避免 research 在并发写入中读取不一致状态。路径会解析到最近存在的真实父目录，因此不能借助符号链接或尚未创建的子目录逃出项目边界。主 Agent 在批次运行期间不能通过 `edit` 或 `write` 修改 implementation worker 已锁定的路径；research 不持有写锁。

## Worker 安全边界

每个 worker 使用独立 RPC 子进程、会话和上下文，但按类型采用不同权限：

```text
implementation: read, grep, find, ls, edit, write, lsp_diagnostics, lens_diagnostics
research:       read, grep, find, ls
```

implementation worker 没有 `bash`，不能执行任意命令。它只显式加载瘦路径：`cursor-models`、`pi-lens` 和 `path-guard.ts`，不会加载整个 `ming-core`。Pi Lens 会在 `edit`/`write` 后提供自动格式化、lint、结构、安全和类型反馈；worker 结束前还必须对实际修改文件运行有界的 `lsp_diagnostics` 与 `lens_diagnostics(mode=all)`。守卫在每次 `edit`、`write` 前规范化目标，并阻止声明范围外的写入。

research worker 由 Batch manager 直接调用 Repo Search runner，与 implementation worker 平级；它只加载 Cursor provider 和 `.gitignore` guard，不能写文件、运行 shell 或调用另一个 `repo_search`。任务声明的 `paths` 会写入搜索请求作为范围，报告应包含文件、行号和调用关系证据。

这是共享工作区模式，不是 Git worktree 隔离。路径锁可以避免已声明范围之间的竞争，但主 Agent 仍应只并行派发真正独立的任务，并在收集后检查整体 diff、运行诊断与测试。

## 生命周期

- `run` 等待 worker 完成；进度只在当前工具调用仍运行时通过 partial result 更新，不产生 Agent 轮询。
- `start` 不等待 worker 完成，因此不会阻塞主 Agent 后续工作；完成 follow-up 是后台模式的通知渠道。
- 默认最多同时运行 3 个 worker，两类 worker 共用并发槽，其余保持 `queued`。
- 单个 worker 失败不会取消其他独立 worker；批次最终状态为 `failed`。
- 主会话关闭、切换或 reload 时，该会话启动的运行中批次会被取消。
- `run` 和 `collect` 返回主 Agent 的文本最多 50 KB 或 2000 行；完整 worker 输出仍保存在工具 `details` 中。
- 进度卡片只聚合每个 worker 最近最多 8 个工具调用，避免多 worker 并发时撑爆终端或上下文。
- worker 正常结束但没有返回文本时会标记失败，不会让批次永久停留在运行中。
- 批次记录保存在当前 Pi 进程内；重启 Pi 后不能再通过旧 `batchId` 收集，但子 Agent transcript 仍由共享运行目录和控制台管理。

## 选择建议

- 默认使用 `run`：需要当前任务结果，想让工具卡片持续显示进度。
- 使用 `start`：主 Agent 能继续处理完全独立的工作，并愿意等待完成 follow-up。
- 不要用 `status` 轮询模拟实时进度；Pi 工具在 `execute()` 返回后不能再更新原工具卡片。
