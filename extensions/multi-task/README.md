# Multi Task

`multi_task` 是后台多任务编排工具。主 Agent 已经确认多个实现任务彼此独立、写入路径不重叠，并且不需要立即等待结果时，可以一次启动多个隔离的 Pi worker。

## 工作流

工具提供四个 action：

1. `start`：校验任务与路径，创建批次并立即返回 `batchId`
2. `status`：查看批次和各 worker 状态
3. `collect`：收集每个 worker 的最终报告或错误
4. `cancel`：取消正在运行和排队的 worker

批次完成后，扩展会向主 Agent 排队一条 follow-up，要求调用 `collect`、整合结果并执行项目级验证。运行过程也会出现在 `/subagents` 和 `Alt+A` 子 Agent 控制台中。

## 启动示例

```json
{
  "action": "start",
  "tasks": [
    {
      "id": "auth-errors",
      "task": "完善认证错误映射并保持现有公共 API",
      "paths": ["src/auth/errors.ts"]
    },
    {
      "id": "logger-fields",
      "task": "补充结构化日志字段",
      "paths": ["src/logger.ts"]
    }
  ],
  "maxConcurrency": 2
}
```

查询或收集：

```json
{ "action": "status", "batchId": "..." }
{ "action": "collect", "batchId": "..." }
{ "action": "cancel", "batchId": "..." }
```

`model` 可选；默认继承主 Agent 当前模型。单批最多 8 个任务，并发数范围为 1–6，默认 3。

## 调度边界

适合：

- 修改互不相交文件的独立实现任务
- 主 Agent 同时还有其他不依赖 worker 结果的工作
- 每个任务都有明确目标和授权路径

不适合：

- 多个任务修改相同文件或父子目录
- 后一个任务依赖前一个任务
- 尚未完成架构决策的重构
- 需要共同修改公共类型、锁文件或中央导出文件

`start` 会规范化路径并拒绝：

- 空任务或重复任务 ID
- 当前项目之外的路径
- 同一批或其他运行中批次里相同、父子包含或目录重叠的路径

路径会解析到最近存在的真实父目录，因此不能借助符号链接或尚未创建的子目录逃出项目边界。主 Agent 在批次运行期间也不能通过 `edit` 或 `write` 修改 worker 已锁定的路径。

## Worker 安全边界

每个 worker 使用独立 RPC 子进程、会话和上下文，固定工具为：

```text
read, grep, find, ls, edit, write
```

worker 没有 `bash`，不能执行任意命令。子进程只显式加载 Cursor provider 和 `path-guard.ts`；守卫在每次 `edit`、`write` 前对目标进行规范化，并阻止声明范围外的写入。worker 可以读取仓库以理解上下文，但只能写入任务声明的路径。

这是共享工作区模式，不是 Git worktree 隔离。路径锁可以避免已声明范围之间的竞争，但主 Agent 仍应只并行派发真正独立的任务，并在收集后检查整体 diff、运行诊断与测试。

## 生命周期

- `start` 不等待 worker 完成，因此不会阻塞主 Agent 后续工作。
- 默认最多同时运行 3 个 worker，其余保持 `queued`。
- 单个 worker 失败不会取消其他独立 worker；批次最终状态为 `failed`。
- 主会话关闭、切换或 reload 时，该会话启动的运行中批次会被取消。
- `collect` 返回主 Agent 的文本最多 50 KB 或 2000 行；完整 worker 输出仍保存在工具 `details` 中。
- worker 正常结束但没有返回文本时会标记失败，不会让批次永久停留在运行中。
- 批次记录保存在当前 Pi 进程内；重启 Pi 后不能再通过旧 `batchId` 收集，但子 Agent transcript 仍由共享运行目录和控制台管理。
