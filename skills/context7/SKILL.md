---
name: context7
description: 查询第三方库、框架、SDK 的最新官方文档。当用户询问库/API 用法、配置步骤、迁移指南或版本差异时使用。
---

# Context7 文档查询

通过 Pi 扩展提供的 Context7 工具，获取最新、版本化的库文档，避免依赖过时的训练数据。

## 何时使用

- 用户询问某个库/框架/API 的用法、配置或最佳实践
- 需要确认 API 是否存在、参数是否正确
- 涉及特定版本（如 Next.js 15、Prisma 6）的实现细节
- 用户提到 `use context7` 或要求查官方文档

第三方库、SDK、外部 API 和官方文档调研优先使用 Context7，不要调用 `repo_search`；只有用户还要求检查当前仓库如何使用或集成该库时，才同时使用 `repo_search`。

## 工具

### 1. `resolve-library-id`

将库名解析为 Context7 库 ID。

- `libraryName`：库名称（如 `next.js`、`prisma`）
- `query`：用户的具体问题（用于相关性排序）

若用户已给出库 ID（如 `/vercel/next.js`），跳过此步。

### 2. `query-docs`

按库 ID 拉取文档片段。

- `libraryId`：精确 ID，例如 `/vercel/next.js`、`/supabase/supabase`
- `query`：要查询的主题或完整问题

指定版本示例：`/vercel/next.js/v15.1.8`

## 推荐流程

1. 不确定库 ID → `resolve-library-id`
2. 从结果中选最匹配的 ID（优先高 trustScore / benchmarkScore）
3. `query-docs` 获取文档
4. 结合文档回答用户，注明引用的库 ID

## 配置

API Key（可选，无 key 有速率限制）：

- 文件：`~/.pi/agent/context7.json` → `{ "apiKey": "ctx7sk_..." }`
- 环境变量：`CONTEXT7_API_KEY`
- 申请：<https://context7.com/dashboard>

## 注意

- 不要把 API Key 写入代码仓库
- Context7 文档由社区维护，关键生产决策仍需交叉验证
- 纯业务逻辑、本地代码调试、不涉及外部库时不必调用
