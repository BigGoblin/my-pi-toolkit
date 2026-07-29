# TAPD Extension

TAPD 需求与缺陷工作流扩展。提供待办列表、会话关联、需求分析、技术设计、协作评审、Bug 定位，以及设计/开发子需求的创建与同步。

## Commands

| 命令 | 说明 |
| --- | --- |
| `/tapd` | 打开 TAPD 待办列表，支持需求与 Bug 视图 |
| `/tapd analyze [补充要求]` | 生成 `understanding.md` |
| `/tapd design [补充要求]` | 生成 `design.md` 和结构化开发子需求拆分 |
| `/tapd collaboration [补充要求]` | 生成供产品、后端和前端 Leader 评审的 `collaboration.md` |
| `/tapd sub-task` | 根据 `design.md` 创建或同步设计、开发子需求 |
| `/tapd bug` | 获取当前 Bug 完整信息并让 Agent 定位代码原因 |
| `/tapd git-status` | 查看当前会话关联事项、Git 分支、upstream 与工作区状态 |
| `/tapd branch [--base origin/dev]` | 获取 TAPD keyword，并从指定基础分支创建关联分支 |
| `/tapd commit [--no-push]` | 使用 TAPD keyword 生成提交信息，提交并默认推送；仓库检查、TAPD 请求、暂存、commit 和 push 阶段会实时显示在对话中 |
| `/tapd mr [--target dev] [--no-delete-source-branch]` | 创建或更新 GitLab MR，并回写全部关联 TAPD 事项；需求/任务一次执行完成，Bug 首次执行会先让 Agent 生成根因草稿，再次执行才创建 MR 和更新 TAPD |

工作流命令支持附加自然语言和 `@文件`：

```text
/tapd design @docs/api.md 重点考虑旧接口兼容
```

## Shortcuts

- `Ctrl+Shift+T`：打开 TAPD 待办。

需求待办中，标题前的 `📐` 表示当前项目或关联会话目录中已经存在对应的 `design.md`。标记会在每次打开待办时根据本地文件重新计算。

## Story workflow

```text
/tapd analyze
→ understanding.md
→ /tapd design
→ design.md
→ /tapd collaboration
→ collaboration.md
→ /tapd sub-task
```

- 开发任务拆分来源：`design.md`。
- 设计子需求描述来源：`collaboration.md`。
- 开发子需求描述包含自身开发范围、验收标准和依赖关系。
- 文档更新后再次执行 `/tapd sub-task` 会同步已有子需求并创建新增项；设计中移除的旧项不会自动删除。

## Session link cleanup

TAPD 会话关联保存在 `~/.pi/agent/tapd-links.json`。扩展会在会话启动和打开 `/tapd` 主界面时自动清理会话文件已不存在的关联，以及超过 10 分钟仍未完成创建的临时关联。

在 TAPD 主界面按 `c` 可以预览并确认清理失效关联。该操作只清理本地关联数据，不会删除 TAPD 需求、Bug、子需求或项目文档。

在关联会话列表按 `Ctrl+D` 删除会话时，只有会话文件删除成功后才会移除关联记录；如果文件本来已经不存在，则只清理对应关联。

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
  "gitlab": {
    "token": "可选；也可使用 GITLAB_PERSONAL_ACCESS_TOKEN",
    "baseUrl": "可选；默认从 origin 推导 https://host/api/v4"
  }
}
```

TAPD Open API 索引见 [`../../docs/tapd-api.md`](../../docs/tapd-api.md)。

## Git workflow

- 默认从 `origin/dev` 创建 `bug/{short_id}` 或 `feature/{short_id}`，并使用 `--no-track`。
- 工作区有未提交改动时会先弹出确认；确认后由 Git 尝试把当前改动带到从 `origin/dev` 创建的新分支。若与基础分支冲突，Git 会安全终止，不会自动 stash、丢弃改动或强制切换。
- Bug 提交为 `fix: {KEYWORD}`；需求/任务提交为 `feat: {KEYWORD}`。KEYWORD 原样保留。
- 没有 upstream 时首次推送使用 `git push -u origin HEAD`。
- 提交默认使用当前操作系统 PATH 中的 `git`。仅当运行于 WSL，且 Git hook 因 Windows CRLF shebang 报出 `sh\\r: No such file or directory` 时，才自动改用 Windows `git.exe` 重试；重试成功后将仓库记录在 `~/.pi/agent/tapd-git-runtime.json`，该仓库后续在 WSL 中提交时直接使用 Windows Git。原生 Windows、Linux 和 macOS 环境始终使用各自 PATH 中的 `git`。可用 `TAPD_WINDOWS_GIT_PATH` 指定 WSL 可执行的 `git.exe` 完整路径。
- MR 会扫描 `merge-base..HEAD` 的全部提交，不只处理第一条 TAPD 关联。
- Bug 默认标签为 `二组`、`迭代bug(每日发布)`，状态更新为 `已解决`，负责人为 `沈瑞昀`。
- 需求/任务默认标签为 `二组`、`迭代任务(随迭代发布)`。关联项是开发子需求或 TAPD 任务时直接更新为 `开发完成`；关联项是顶层功能需求时，仅在处理人为当前 Token 用户时更新功能需求本身，并同时把其下所有处理人为当前用户的直属开发子需求更新为 `开发完成`。其他处理人的需求不会被修改，所有更新均不修改负责人。
- 纯需求/任务的 `/tapd mr` 保持一次执行完成，不触发 Agent 根因分析。
- 含 Bug 的 `/tapd mr` 首次执行会先分析修复 diff 和 `git blame` 候选，允许 UI 选择或手动输入 commit，然后把 TAPD Bug、修复 patch 和已确认 commit 交给 Agent。Agent 只生成结构化根因草稿并保存在仓库 `.pi/tapd-root-cause/`，本次不创建 MR、不更新 TAPD。
- Agent 分析完成后再次执行 `/tapd mr`，扩展只接受与当前 `HEAD` 匹配的草稿，打开编辑器供用户最终确认，再创建或更新 MR 并回写 TAPD。TAPD 流转和备注写入成功后自动删除草稿；用户取消或流程失败时保留草稿以便重试。选择“未能定位”时使用 TAPD 真实候选值 `其他(历史缺陷)`。
- 引入 commit 经验证后，会拉取远端 tags，优先取直接指向 commit 的第一个 tag，否则取第一个包含该 commit 的 tag。
- 合入版本从 TAPD `/bugs/get_fields_info` 的“合入版本”候选值中选择。普通版本精确匹配；`.0` 等存在多个迭代候选时，根据引入 commit 中 TAPD keyword 关联事项的迭代唯一匹配；关联事项没有迭代时会列出候选值让用户手动选择。
- tag 在候选值中完全不存在时，按规则选择候选值中的 `其他(历史缺陷)`；若该选项也不存在则不修改合入版本。
- 工作流不会修改 git config，不会自动 stash、hard reset 或 force-push。

## Modules

| 目录/文件 | 职责 |
| --- | --- |
| `index.ts` / `types.ts` | 扩展组装入口与跨领域共享类型 |
| `core/` | 配置、HTTP 客户端、基础 TAPD API |
| `sessions/` | TAPD 会话关联、创建和失效清理 |
| `documents/` | analyze、design、collaboration 与 Bug 定位文档工作流 |
| `subtasks/` | 子需求解析、确认计划与 TAPD 同步 |
| `todo/` | 待办模型、列表和会话选择 UI |
| `git/` | Git 仓库、TAPD keyword、GitLab MR、状态回写和根因备注 |
