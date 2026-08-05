# TAPD Open API 资料索引

本文件集中维护 TAPD 扩展后续开发所需的官方 API 入口。新增 TAPD 能力前，优先从这里查找接口和字段说明。

## 官方文档入口

- [TAPD 开放平台文档首页](https://open.tapd.cn/document/)
- [API 文档目录](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/)
- [API 配置指南与鉴权说明](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/API%E9%85%8D%E7%BD%AE%E6%8C%87%E5%BC%95.html)
- [用户 API 目录](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/)
- [需求 Story API 目录](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/)
- [缺陷 Bug API 目录](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/bug/)
- [迭代 Iteration API 目录](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/iteration/)
- [工作项类型 API 目录](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/workitem_type/)

## 当前扩展已使用的接口

| 能力 | 接口文档 | API 地址 |
| --- | --- | --- |
| 获取用户信息 | [用户信息](https://open.tapd.cn/document/api-doc/API文档/api_reference/user/get_user_info.html) | `GET /users/info` |
| 获取参与项目 | [用户参与项目](https://open.tapd.cn/document/api-doc/API文档/api_reference/workspace/get_user_participant_projects.html) | `GET /workspaces/user_participant_projects` |
| 获取用户待办需求 | [待办需求](https://open.tapd.cn/document/api-doc/API文档/api_reference/user/get_user_todo_story.html) | `GET /user_oauth/get_user_todo_story` |
| 获取需求列表/详情 | [获取需求](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/get_stories.html) | `GET /stories` |
| 获取开放迭代 | [获取迭代](https://open.tapd.cn/document/api-doc/API文档/api_reference/iteration/get_iterations.html) | `GET /iterations` |
| 获取工作项类型 | [获取工作项类型](https://open.tapd.cn/document/api-doc/API文档/api_reference/workitem_type/get_workitem_types.html) | `GET /workitem_types` |
| 创建需求/子需求 | [新增需求](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/add_story.html) | `POST /stories` |
| 获取源码提交关键字 | TAPD SCM 提交关联接口 | `GET /svn_commits/get_scm_copy_keywords` |
| 更新需求或任务 | [更新需求](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/update_story.html) | `POST /stories` / `POST /tasks` |
| 更新缺陷 | [更新缺陷](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/update_bug.html) | `POST /bugs` |
| 新增评论/流转备注 | [新增评论](https://open.tapd.cn/document/api-doc/API文档/api_reference/comment/add_comment.html) | `POST /comments` |

> 部分历史文档路径可能因 TAPD 文档站目录调整而变化；如果链接失效，从对应 API 目录按中文标题查找。

## Bug Tab 相关接口

这是本次需求和后续缺陷能力开发的重点：

- [获取用户待办缺陷](https://open.tapd.cn/document/api-doc/API文档/api_reference/user/get_user_todo_bug.html)
  - `GET https://api.tapd.cn/user_oauth/get_user_todo_bug`
  - 必填：`workspace_id`
  - 常用：`limit`、`page`、`order`、`fields`
  - 返回对象：`data[].Bug`
- [获取项目缺陷列表](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/get_bugs.html)
  - `GET https://api.tapd.cn/bugs`
  - 常用字段：`id`、`title`、`priority_label`、`severity`、`status`、`v_status`、`iteration_id`、`current_owner`、`begin`、`due`、`description`、`workspace_id`
- [缺陷字段说明](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/bug.html)
- [获取缺陷数量](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/get_bugs_count.html)
- [新增缺陷](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/add_bug.html)
- [更新缺陷](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/update_bug.html)
- [获取缺陷变更记录](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/get_bug_changes.html)
- [获取关联需求](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/get_related_stories.html)
- [获取需求关联缺陷](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/get_story_related_bugs.html)
- [缺陷筛选转查询 Token](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/filter_to_query_token.html)

### Bug 字段映射约定

扩展内部统一使用 `TapdItem`，Bug 映射如下：

| TAPD Bug 字段 | 扩展字段 |
| --- | --- |
| `title` | `name` |
| `current_owner` | `owner` |
| `v_status` / `status` | `status` |
| `priority_label` / `priority` | `priority` |
| `severity` | `severity` |
| `iteration_id` | `iterationId` |
| `begin` / `due` | `begin` / `due` |

## Git 工作流接口约定

- `GET /svn_commits/get_scm_copy_keywords` 使用 `workspace_id`、`object_id`、`type=story|task|bug`，返回的 `data` 必须原样用于 commit keyword。
- 短 ID 调用需求/缺陷详情、子需求查询、SCM、更新和评论接口时转换为 TAPD 云环境长 ID：`11 + workspace_id + 9 位左补零 object_id`；已经是长 ID 时不再转换。
- 更新状态优先传 `v_status`，允许使用项目中的中文状态名称。
- Bug 流转备注使用 `entry_type=bug_remark`；`author` 从 keyword 的 `--user=...` 提取，不能用报告人替代。
- `GET /bugs/get_fields_info` 返回 Bug 标准字段及候选值；合入版本字段必须按 `label=合入版本` 动态定位，当前项目字段名为 `version_fix`。
- Git tag 与合入版本先精确匹配；同一基础版本有多个迭代候选时，读取引入 commit 的 TAPD keyword、关联事项 `iteration_id` 和迭代名称中的 `148-1` 形式编号进行唯一匹配。关联事项没有迭代时必须把真实候选值展示给用户手动选择。
- tag 没有任何基础版本候选时，使用选项源中真实存在的 `其他(历史缺陷)`；不能自行构造候选值。关联多个冲突迭代或其他无法验证的情况不修改合入版本。
- 备注正文使用 `<br/>` 或段落标签，避免 TAPD 将裸换行渲染为同一段。

## 子需求描述格式约定

Story 创建和更新 Open API 只支持 `description`，不支持 Wiki API 中的 `markdown_description` 或 `is_rich`。`/tapd sub-task` 使用 `marked`（GFM）把 `collaboration.md` 或生成的开发子需求 Markdown 转成 HTML，再写入 `description`。

`marked` 只会把 Mermaid 围栏转换为带 `language-mermaid` 类名的代码块，不会生成图，因此 TAPD 子需求详情中会以代码块显示 Mermaid。

## 鉴权与请求注意事项

- 当前扩展配置：`~/.pi/agent/tapd.json`，使用 Bearer Token。
- TAPD 官方示例大量使用 Basic Auth；开发时以当前扩展实际可用的 OAuth Bearer Token 为准。
- 列表接口默认分页 30 条，最大 `limit=200`，必须处理 `page`。
- 需求标题字段是 `name`，Bug 标题字段是 `title`，不能直接复用原始字段读取逻辑。
- 需求和 Bug 的待办接口是两个独立接口，不要通过工作项类型名称推断 Bug。

## 参考来源

- 官方 TAPD 开放平台：<https://open.tapd.cn/document/>
- Context7 library ID：`/websites/open_tapd_cn_document`
- 本仓库扩展实现：[`extensions/tapd/index.ts`](../extensions/tapd/index.ts)
