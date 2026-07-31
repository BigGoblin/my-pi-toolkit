# Context7 Extension

为 Agent 提供最新第三方库文档查询能力，避免仅依赖模型训练数据。

## Tools

- `resolve-library-id`：将库名解析为 Context7 库 ID。
- `query-docs`：使用精确库 ID 查询最新文档片段。

标准调用顺序：

```text
resolve-library-id("next.js")
→ query-docs("/vercel/next.js", "问题")
```

如果已经知道库 ID，可以直接调用 `query-docs`。版本可写入 ID，例如 `/vercel/next.js/v15.1.8`。

第三方库、SDK、外部 API、官方文档、配置步骤和版本能力调研应优先使用 Context7，而不是 `repo_search`。只有用户还要求检查当前仓库如何使用或集成该库时，才同时调用 `repo_search`。

## Command

```text
/context7
```

显示 API Key 配置状态。

```text
/context7 react server components
```

搜索相关库，并展示最匹配的结果。

## Configuration

配置文件：`~/.pi/agent/context7.json`

```json
{
  "apiKey": "ctx7sk_..."
}
```

也可以使用环境变量：

```text
CONTEXT7_API_KEY
```

API Key 可选；未配置时会使用 Context7 的无 Key 访问额度。

## Modules

- `index.ts`：工具和命令注册。
- `api.ts`：Context7 HTTP API 调用与结果格式化。
- `config.ts`：配置文件和环境变量读取。
