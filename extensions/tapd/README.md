# TAPD Extension

TAPD 需求与缺陷工作流扩展。提供待办列表、会话关联、需求分析、技术设计、协作评审、Bug 定位，以及设计/开发子需求的创建与同步。

## Commands

| 命令 | 说明 |
| --- | --- |
| `/tapd` | 在居中 Overlay 中打开 TAPD 待办列表，支持需求与 Bug 视图 |
| `/tapd analyze [补充要求]` | 生成 `understanding.md` |
| `/tapd design [补充要求]` | 调研后通过选项式提问确认关键决策，再生成 `design.md` 和结构化开发子需求拆分 |
| `/tapd collaboration [补充要求]` | 生成供产品、后端和前端 Leader 评审的 `collaboration.md` |
| `/tapd review [--base origin/dev] [补充要求]` | 选择“仅未提交”或“当前分支全部修改”后，启动只读子代理并将分级报告返回主 Agent |
| `/tapd sub-task` | 根据 `design.md` 创建或同步设计、开发子需求 |
| `/tapd bug` | 获取当前 Bug 完整信息并让 Agent 定位代码原因 |
| `/tapd git-status` | 直接执行 TAPD Git 工作流，并用对话区工具风格卡片显示关联事项、分支、upstream 与工作区状态 |
| `/tapd branch [--base origin/dev]` | 直接获取 TAPD keyword 并从指定基础分支创建关联分支；结果显示为对话区工具风格卡片 |
| `/tapd commit [--no-push]` | 直接使用 TAPD keyword 生成提交信息，提交并默认推送；结果显示为对话区工具风格卡片 |
| `/tapd mr [--draft] [--target dev] [--no-delete-source-branch]` | 直接创建或更新 GitLab MR 并回写 TAPD；结果显示为对话区工具风格卡片 |

工作流命令支持附加自然语言和 `@文件`：

```text
/tapd design @docs/api.md 重点考虑旧接口兼容
```

## Shortcuts

- `Ctrl+Shift+T`：打开 TAPD 待办。

`/tapd` 的待办、类型筛选、关联会话、select 和 confirm 页面统一显示在当前 TUI 上方的居中 Overlay 中，与 Subagent 共用单层 Header/viewport/Footer shell（宽度 `92%`、最大高度 `88%`）。主表在 `<80`、`80–119`、`>=120` 列下依次显示紧凑、普通、完整字段；长待办、会话和路径历史使用围绕当前选择的 viewport，并显示 `start-end/total`。`↑/↓`、`PageUp/PageDown`、`Home/End` 导航，`Esc` 返回、`Ctrl+C` 退出，页面 Footer 始终保留关闭提示。需求/Bug 和工作项类型使用 `[REQ]`、`[BUG]`、`[DEV]` 等稳定文本标签；`✓DES` 表示当前项目或关联会话目录中已经存在对应的 `design.md`，标记在每次打开待办时重新计算。新建关联会话时，“会话名称”默认使用 TAPD 标题，也可以在创建前编辑；创建后该名称会显示在 `/resume` 会话列表中。

## Story workflow

```text
/tapd analyze
→ understanding.md
→ /tapd design
→ 选项确认（如有关键待确认决策）
→ design.md
→ /tapd collaboration
→ collaboration.md
→ /tapd sub-task
```

- `/tapd design` 会先读取需求理解、检查相关代码，再识别影响范围、架构、兼容性、接口契约或验收标准的关键待确认决策。存在待确认项时，Agent 使用通用的 `ask_user_choice` 逐项提问：提供 2～5 个候选方案，可标记一个推荐项，最后固定提供“其他（自定义输入）”；用户取消时停止流程且不创建或覆盖 `design.md`。没有关键待确认项时直接生成设计。
- 开发任务拆分来源：`design.md`。
- 设计子需求描述来源：`collaboration.md`。
- 协作文档会包含 Design 方案 Mermaid 图，核对实际代码并列出关键函数或组件签名、出入参及相关接口信息；不再生成独立的“前后端协作点”和“评审与验收”章节。
- 开发子需求描述包含自身开发范围、验收标准和依赖关系。
- 文档更新后再次执行 `/tapd sub-task` 会同步已有子需求并创建新增项；设计中移除的旧项不会自动删除。

## Code review

`/tapd review` 会先显示审核范围选择器：

- **仅审核未提交修改**：以 `HEAD` 为比较起点，只审核暂存、未暂存和未跟踪文件，不包含只存在于既有 commit 中的修改。
- **审核当前分支全部修改**：审核指定基础分支的 merge-base 到工作区的全部修改，包括已提交、暂存、未暂存和未跟踪文件；`--base`（默认 `origin/dev`）仅影响此选项。

按 `Esc` 取消选择不会启动 Agent 或 Review 子代理。命令要求当前需求已有非空的 `understanding.md` 和 `design.md`，并使用只开放 `read`、`grep`、`find`、`ls` 的隔离子代理检查代码风格、文件拆分、需求满足度、设计满足度和隐藏 Bug；存在组件改动时，还会检查组件 Props/参数、默认值、事件、状态归属、数据流、组合方式、子结构和拆分边界是否合理及兼容。

命令会让主 Agent 调用原生 `tapd_review` 工具；执行进度、Review 子代理最近的工具调用和最终报告均显示在对话工具框中，可用 `Ctrl+O` 在运行期间展开全部已记录调用，并在完成后展开完整 Markdown 报告。审核期间按 `Esc` 或 `Ctrl+C` 会通过工具的 AbortSignal 终止子代理。报告使用 `P0 Blocker`、`P1 High`、`P2 Medium`、`P3 Suggestion` 问题等级及 `LOW`、`MEDIUM`、`HIGH`、`BLOCKED` 总体风险等级。工具结果会直接进入主 Agent 上下文，主 Agent 只总结问题，不会自动修改代码。

Review 默认使用持久 RPC 子 Agent，不会自动打开分屏。按 `Alt+A` 可在当前 TUI 上方打开居中的大尺寸只读 Overlay，以主 Agent 相同的消息、Markdown、思考块和工具组件查看最近子 Agent 的过程；Overlay 不提供输入框，支持鼠标滚轮以及 `↑`、`↓`、`PageUp`、`PageDown`、`Home`、`End` 滚动，并使用 `Ctrl+O` 展开或折叠工具输出。按 `Esc` 返回主 Agent且不终止审核。使用 `/subagents` 可以管理指定子 Agent：列表中按 `Enter` 进入实时过程或查看历史详情；completed/exited 历史会从子 Agent session 重建完整消息、思考块和工具时间线，并继续使用主界面组件样式；thinking 可用 `app.thinking.toggle`（默认 `Ctrl+T`）折叠，built-in 工具遵循当前 `/grok-tools` 配置。只有旧记录缺少或损坏 session 时，才回退到最终 Markdown 或 transcript 文本摘要。按 `C` 请求取消，按 `X` 强制终止活跃任务，按 `D` 清理已退出的任务记录。列表默认只显示当前主会话创建的子 Agent，按 `Tab` 可切换到所有会话记录；操作后会刷新列表。首轮审核完成后报告自动返回主 Agent。公共行为由 `~/.pi/agent/subagents.json` 配置；如需 Windows Terminal 自动分屏，可设置 `presentation: "split"` 或 `"tab"`。Review 的 Git 上下文会复制进子 Agent 任务目录，避免主工具返回后丢失审核证据。

## Session links

TAPD 会话关联保存在 Pi session 自身的 custom entry（`tapd-session-link`）中，不再维护 `tapd-links.json`。每个 TAPD 会话保存 `workspaceId / itemId / kind / itemName / title / projectPaths / understandingFile / subtaskPlan / subtasks` 快照；子任务计划与结果每次更新都会追加新快照，恢复会话时读取最后一条。`/tree` 导航不影响会话关联。

事项 → 历史会话列表由 `SessionManager.listAll()` + 有界并发扫描会话 custom entries 构建内存目录（`sessions/catalog.ts`），首次打开关联会话 picker 时扫描并在进程内缓存；创建或删除会话后失效重建。大量会话时 picker 会显示扫描进度，单个损坏 JSONL 跳过，不阻断待办列表。

旧版 `~/.pi/agent/tapd-links.json` 的关联已在迁移时写入各会话 custom entry，迁移完成后原文件归档为带时间戳的 `.migrated.bak`；迁移逻辑已移除，不再读取或维护该文件。

在关联会话列表按 `Ctrl+D` 删除会话时，直接删除（优先 trash）session 文件；关联信息随会话文件消失，无需额外清理。`tapd-project-paths.json`（项目路径输入历史）继续保留。

文档默认位于：

```text
.pi/docs/story-{storyId}/
```

## Configuration

配置文件：`~/.pi/agent/tapd.json`

```json
{
  "token": "TAPD 个人令牌",
  "baseUrl": "可选的 TAPD API Base URL",
  "review": {
    "model": "可选；例如 lumilegend/gpt-5.6-sol:max；默认继承主 Agent 当前模型",
    "presentation": "兼容保留；Review 固定使用 manual RPC，以接入子 Agent 状态栏、Overlay 和 /subagents"
  },
  "gitlab": {
    "token": "可选；也可使用 GITLAB_PERSONAL_ACCESS_TOKEN",
    "baseUrl": "可选；默认从 origin 推导 https://host/api/v4"
  }
}
```

TAPD Open API 索引见 [`../../docs/tapd-api.md`](../../docs/tapd-api.md)。

## Git workflow

- `git-status`、`branch`、`commit`、`mr` 由 slash command handler 直接执行，不经过模型，也不会插入工具触发提示词。执行期间在 footer 显示当前阶段；完成或失败后在对话区追加一张使用共享工具视觉语言的结果卡片，保留提交哈希、MR URL、TAPD 流转结果或错误信息。
- 默认从 `origin/dev` 创建 `bug/{short_id}` 或 `feature/{short_id}`，并使用 `--no-track`。
- 工作区有未提交改动时，创建分支前会打开迁移方式选择器（标题显示当前分支、目标分支与基础分支）：
  - **stash 后迁移（推荐）**：`git stash push --include-untracked` 保存全部改动（含未跟踪文件）→ 从 `--base` 创建目标分支 → `git stash pop` 恢复；
  - **WIP commit 后迁移**：`git add --all` 并以 `chore: WIP before creating {目标分支}` 自动提交（正常执行 Git hooks，不自动 `--no-verify`）→ 从 `--base` 创建目标分支 → `git cherry-pick` 该 WIP commit；WIP commit 会保留在原分支；
  - **从当前 HEAD 创建**：直接以当前 HEAD 创建目标分支并保留未提交改动，**不再基于 `--base` 指定的基础分支**；
  - **取消**（Esc）：不执行 stash、commit 或分支创建，工作区保持不变。
- 迁移失败不会强制回滚或丢弃改动：stash 成功但创建分支失败时改动保留在 stash，提示 stash ref 与 `git stash apply` 恢复命令；stash pop 冲突时停留在目标分支的冲突工作区，stash 条目未被删除时仍可在 `git stash list` 找到；cherry-pick 冲突时停留在标准 cherry-pick 冲突状态，提示 `git cherry-pick --continue` / `--abort`；WIP commit 成功但创建分支失败时 commit 保留在原分支，提示 commit hash。
- 无交互界面（print/json 等）且工作区有未提交改动时直接报错，不会默认选择会改写 Git 状态的方案。
- Bug 提交为 `fix: {KEYWORD}`；需求/任务提交为 `feat: {KEYWORD}`。KEYWORD 原样保留。
- 没有 upstream 时首次推送使用 `git push -u origin HEAD`。
- 提交默认使用当前操作系统 PATH 中的 `git`。仅当运行于 WSL，且 Git hook 因 Windows CRLF shebang 报出 `sh\\r: No such file or directory` 时，才自动改用 Windows `git.exe` 重试；重试成功后将仓库记录在 `~/.pi/agent/tapd-git-runtime.json`，该仓库后续在 WSL 中提交时直接使用 Windows Git。原生 Windows、Linux 和 macOS 环境始终使用各自 PATH 中的 `git`。可用 `TAPD_WINDOWS_GIT_PATH` 指定 WSL 可执行的 `git.exe` 完整路径。
- `git commit` 失败（例如 pre-commit hook 未通过）时，会显示原始错误并询问是否使用 `git commit --no-verify` 重新暂存后提交；确认后会跳过 pre-commit、commit-msg 等校验 hooks，取消则保留原失败结果。
- MR 会扫描 `merge-base..HEAD` 的全部提交，不只处理第一条 TAPD 关联。
- `/tapd mr --draft` 会创建或更新 Draft MR。当前关联项是功能需求时，功能需求本身和测试需求保持原状态，但其下所有处理人为当前 Token 用户的直属开发子需求会更新为“开发完成”；直接关联开发子需求时也照常更新为“开发完成”。这些实际流转的开发子需求会将完成工时同步为各自的有效预估工时。TAPD 任务和 Bug 不流转，Bug 也不会触发根因分析。后续执行不带 `--draft` 的 `/tapd mr` 会把同一开放 MR 更新为 Ready：当前用户负责的功能需求和开发子需求更新为“开发完成”，当前用户负责的测试需求更新为“已通过”；其他处理人的需求不流转。
- Bug 默认标签为 `二组`、`迭代bug(每日发布)`，状态更新为 `已解决`，负责人为 `沈瑞昀`。
- 需求/任务默认标签为 `二组`、`迭代任务(随迭代发布)`。Ready MR 中，关联项是开发子需求或 TAPD 任务时更新为 `开发完成`；关联项是测试需求时，仅在处理人为当前 Token 用户时更新为 `已通过`；关联项是顶层功能需求时，仅更新当前用户负责的功能需求本身及其直属开发、测试需求，其中功能需求和开发子需求更新为 `开发完成`，测试需求更新为 `已通过`。每个实际流转的 TAPD 任务、功能需求、开发子需求和测试需求都会将完成工时同步为自身的有效预估工时；预估工时缺失、为零或无效时只更新状态，不写完成工时，也不阻断 MR。其他处理人的需求不会被修改，所有更新均不修改负责人。
- 纯需求/任务的 `/tapd mr` 保持一次执行完成，不触发 Agent 根因分析。
- 含 Bug 的 `/tapd mr` 首次执行会先分析修复 diff 和 `git blame` 候选，允许 UI 选择或手动输入 commit，然后把 TAPD Bug、修复 patch 和已确认 commit 交给 Agent。Agent 只生成结构化根因草稿并保存在仓库 `.pi/tapd-root-cause/`，本次不创建 MR、不更新 TAPD。
- Agent 分析完成后再次执行 `/tapd mr`，扩展只接受与当前 `HEAD` 匹配的草稿，打开编辑器供用户最终确认，再创建或更新 MR 并回写 TAPD。TAPD 流转和备注写入成功后自动删除草稿；用户取消或流程失败时保留草稿以便重试。选择“未能定位”时使用 TAPD 真实候选值 `其他(历史缺陷)`。
- 引入 commit 经验证后，会拉取远端 tags，优先取直接指向 commit 的第一个 tag，否则取第一个包含该 commit 的 tag。
- 合入版本从 TAPD `/bugs/get_fields_info` 的“合入版本”候选值中选择。普通版本精确匹配；`.0` 等存在多个迭代候选时，根据引入 commit 中 TAPD keyword 关联事项的迭代唯一匹配；关联事项没有迭代时会列出候选值让用户手动选择。
- tag 在候选值中完全不存在时，按规则选择候选值中的 `其他(历史缺陷)`；若该选项也不存在则不修改合入版本。
- 工作流不会修改 git config，不会 hard reset、clean、force switch 或 force-push；stash、WIP commit 与 cherry-pick 仅在用户明确选择后执行。

## Modules

| 目录/文件 | 职责 |
| --- | --- |
| `index.ts` / `types.ts` | 扩展组装入口与跨领域共享类型 |
| `core/` | 配置、HTTP 客户端、基础 TAPD API |
| `sessions/` | TAPD 会话 custom entry 状态、事项→会话目录（catalog）、legacy `tapd-links.json` 幂等迁移、项目路径历史与会话文件删除 |
| `documents/` | analyze、design、collaboration 与 Bug 定位文档工作流，以及 Design 关键决策提问工具 |
| `subtasks/` | 子需求解析、确认计划、TAPD 同步（`api-sync.ts`）与 append-only 状态更新（`state.ts`） |
| `todo/` | 待办编排与 Overlay；`tree-list.ts`、`table-view.ts`、`session-picker*.ts` 分别负责树表、响应式主表和会话/路径 viewport |
| `review/` | 需求实现审核上下文、只读子代理、进度和报告渲染 |
| `git/` | Git 仓库、TAPD keyword、GitLab MR、状态回写和根因备注 |
