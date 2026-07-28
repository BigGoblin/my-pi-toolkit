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

工作流命令支持附加自然语言和 `@文件`：

```text
/tapd design @docs/api.md 重点考虑旧接口兼容
```

## Shortcuts

- `Ctrl+Shift+T`：打开 TAPD 待办。

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
  "baseUrl": "可选的 API Base URL"
}
```

TAPD Open API 索引见 [`../../docs/tapd-api.md`](../../docs/tapd-api.md)。

## Modules

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 命令、快捷键和扩展入口 |
| `api.ts` | TAPD API、认证与数据获取 |
| `model.ts` | TAPD 条目模型、树构建与格式化 |
| `storage.ts` | 会话关联、文档路径和项目路径历史 |
| `cleanup.ts` | 失效关联扫描、会话文件删除和关联清理 |
| `prompts.ts` | analyze、design、collaboration、Bug 工作流提示词 |
| `session.ts` | 创建 TAPD 关联会话 |
| `subtask-parser.ts` | 解析 `design.md` 中的子需求 JSON |
| `subtask-plan.ts` | 子需求计划确认、工时输入和同步计划 |
| `subtasks.ts` | 创建及同步 TAPD 子需求 |
| `workflows.ts` | 工作流消息发送与 Bug 定位 |
| `ui.ts` | 待办列表、Tab、筛选与会话选择器 |
| `types.ts` | 共享类型 |
