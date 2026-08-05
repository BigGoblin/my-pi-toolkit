# Session Branch Guard

将会话与 Git 分支关联的安全门禁：恢复会话时校验当前分支，避免「会话 A 在分支 1 编辑，却在分支 2 打开」后继续错误操作。

由 `ming-core` 注册加载。绑定数据保存在会话自身的 custom entry（`session-branch-binding`）中，**不创建额外索引文件**。

## 行为

- 会话首次在 Git 仓库中使用时，记录仓库根与当前分支（新会话 `created`，历史会话首次升级 `adopted`）。
- 恢复会话 A 时，若当前工作区在另一个分支：
  1. **切回会话分支** —— clean 直接 `git switch`；dirty 时先询问 stash / 直接尝试 / 取消；
  2. **留在当前分支继续** —— 二次确认后把 A 重新绑定（rebind）到当前分支；
  3. **取消** —— 保持当前会话与分支不变。
- 每次交互输入前做轻量漂移校验；用户在会话运行期间外部切分支会被拦截并提示 `/session-branch resolve`。
- 其他扩展（如 TAPD 的 `/tapd branch`）创建并切换到新分支后，会自动复用 binding API（`readBinding`/`createBinding`/`appendBindingCurrent`）把会话绑定 rebind 到新分支，避免下一次输入被漂移门禁拦截。
- `pi --session` / `pi -r` / `-c` 等无法前置拦截的路径，在 `session_start` 补偿校验；无 UI（print/json）环境只报错并阻塞，**不自动执行任何 Git 变更**。

## 安全边界

- 切分支只用普通 `git switch`，绝不使用 `--force`、`reset --hard` 或清理文件。
- stash 使用 `git stash push --include-untracked`，包含 staged/unstaged/untracked；切换成功后**不自动 pop**，避免把其他分支的改动污染会话分支。恢复方式见下方提示（`git stash apply <ref>`）。
- stash 成功但 switch 失败时保留 stash 并停留在原分支，报告 ref 供手动恢复。
- 目标分支不存在、detached HEAD、跨仓库、Git 命令失败均安全降级：取消或阻塞，不猜测、不强制。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/session-branch` / `/session-branch status` | 查看会话 ID、仓库、绑定分支、当前分支、工作区 dirty 摘要与阻塞状态 |
| `/session-branch resolve` | 重新打开「切回 / rebind / 取消」解决流程（阻塞解除） |
| `/session-branch rebind` | 二次确认后将当前仓库/分支写成新绑定；跨仓库或 detached HEAD 拒绝 |

## 数据模型

```ts
interface SessionBranchBinding {
  version: 1;
  repoRoot: string;   // realpath 规范化仓库根
  gitBranch: string;  // symbolic 分支名
  head?: string;      // 记录时 commit，仅诊断
  boundAt: string;
  source: "created" | "adopted" | "rebound";
}
```

- 读取 `getEntries()` 中最后一条合法记录（`/tree` 不影响），每次 rebind 追加新 entry，不修改历史。
- 注意区分：Pi 的 `getBranch()` 是对话树分支，本模块的 Git 分支字段命名为 `gitBranch`。

## 生命周期

| 事件 | 行为 |
| --- | --- |
| `session_start` | 无绑定则创建/adopt；有绑定则比较，不匹配走解决流程 |
| `session_before_switch` (`resume`) | 打开目标会话读取绑定，不匹配时拦截：可切回 / 写目标会话 rebind / 取消 |
| `input` | 分支漂移门禁：不匹配返回 `handled` 阻止 agent，提示 resolve |
| `session_shutdown` | 清理 `session-branch` footer status 与内存阻塞态 |

## 已知限制

- 不自动创建/回收 Git worktree（后续可沿 Grok Build 模式扩展）。
- 不支持跨仓库 rebind；detached HEAD 不自动创建 binding。
- 多个 Pi 进程同时写入同一 session 无跨进程事务；不要同时恢复同一会话。
- 并发、锁与 stash 恢复依赖 Git 自身行为，模块不做跨进程强制解锁。
