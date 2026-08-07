# OpenAI Compat Models

读取 `~/.pi/agent/models.json`，对「有 `baseUrl` / `apiKey` 但未手写 `models`」的 OpenAI 兼容 provider，注册带 `refreshModels` 的动态 provider。

- **启动**：只注册 provider，不联网
- **`/model`**：Pi 触发刷新时请求 `{baseUrl}/models` 并更新列表
- **缓存**：刷新成功后通过 `context.publish({ persist })` 写入 Pi models store；下次启动离线阶段可先恢复上次列表

由 `ming-core` 在启动早期挂载。

## 触发条件

同时满足时才会注册动态发现：

1. `models` 缺失或为空数组 `[]`
2. 有非空 `baseUrl`、`apiKey`
3. `api` 为 `openai-completions` / `openai-responses`，或未写 `api`（按 `openai-completions`）

已手写非空 `models` 的 provider **不会**被本模块改写，仍由 Pi 使用 `models.json` 中的列表。

> Pi 规定 `models.json` 覆盖扩展注册。若要自动发现，必须删掉该 provider 下的手写 `models`（或改成 `[]`）。

## 配置示例

```json
{
  "providers": {
    "gzxsy": {
      "name": "Gzxsy Codex",
      "baseUrl": "https://gzxsy.vip/v1",
      "api": "openai-completions",
      "apiKey": "$GZXSY_API_KEY",
      "modelDefaults": {
        "reasoning": true,
        "input": ["text", "image"],
        "contextWindow": 272000,
        "maxTokens": 16384
      }
    }
  }
}
```

### `modelDefaults`（可选）

`/models` 通常只返回 `id`。未返回的字段用 `modelDefaults`，否则使用：

| 字段 | 默认 |
| --- | --- |
| `reasoning` | 见下方思考等级 |
| `input` | `["text"]` |
| `contextWindow` | `128000` |
| `maxTokens` | `4096` |
| `cost` | 全 `0` |
| `thinkingLevelMap` | 不设置（Pi 默认等级） |
| `compat` | 不设置 |

若远端返回 `context_window` / `max_tokens` / `name`，优先使用远端值。

### 思考等级

`/effort` 等能力依赖模型的 `reasoning: true`。解析顺序：

1. `modelDefaults.reasoning` 显式 `true` / `false`（整站强制）
2. 否则按模型 `id` 启发式：包含 `gpt-5`、`o1`、`o3`、`o4`、`reason`、`thinking` 等 → `true`
3. 否则 `false`

ID 不在启发式内、又需要思考等级时，在该 provider 写 `"modelDefaults": { "reasoning": true }`。可选同时配置 `thinkingLevelMap` / `compat`。

### `apiKey`

- 字面量，或 `$ENV_VAR` / `${ENV_VAR}`
- 刷新时由本模块解析；注册给 Pi 时仍传原始字符串，由 Pi 在请求时再解析
- 刷新失败（含 8s 超时）由 Pi 提示并保留已缓存列表

## 迁移

对手动维护过模型列表的 provider：

1. 删除 `models` 数组（或设为 `[]`）
2. 按需补 `modelDefaults`
3. 建议将明文 key 改为环境变量引用
4. `/reload` 后执行 `/model` 触发刷新并验证列表
