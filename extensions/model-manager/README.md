# Model Manager

用于集中管理 Pi 模型相关行为。当前提供“新对话固定默认模型”与 `/thinking` 思考等级选择器。

## `/thinking`

打开当前模型支持的思考等级选择器（与 Pi 内置 Thinking Level UI 一致）。`Shift+Tab` 已用于 Build/Plan/Ask 模式切换，因此用本命令代替循环切换。

```text
/thinking
```

- 仅交互（TUI）模式可用。
- 选项列表由当前模型的 `thinkingLevelMap` / reasoning 能力决定。
- 确认后立即调用 `pi.setThinkingLevel()`，并更新 Footer。

## 新对话默认模型

扩展会在以下场景应用配置：

- 启动 Pi 并创建空白新对话；
- 在 Pi 中执行 `/new`。

以下场景不会强制改模型：

- `/resume` 恢复已有对话；
- `/fork` 或 `/clone` 创建带历史记录的对话；
- `/reload` 重新加载扩展；
- 启动 Pi 时直接恢复已有会话。

因此，已有会话会保留其模型记录，而真正的新对话会回到配置的模型。

## 配置

用户级配置：

```text
~/.pi/agent/model-manager.json
```

项目级配置（仅可信项目生效）：

```text
<project>/.pi/model-manager.json
```

项目级 `newConversation` 字段会覆盖用户级同名字段；未提供的字段继续继承用户配置。

示例：

```json
{
  "newConversation": {
    "enabled": true,
    "model": "lumilegend/gpt-5.6-sol",
    "thinkingLevel": "medium"
  }
}
```

字段：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `enabled` | 否 | 是否启用；配置了 `newConversation` 时默认为 `true` |
| `model` | 启用时是 | 使用 `provider/model-id` 格式；模型 ID 本身可以包含 `/` |
| `thinkingLevel` | 否 | `off`、`minimal`、`low`、`medium`、`high`、`xhigh` 或 `max` |

修改配置后，新对话会自动读取最新内容，无需重启。若要在当前对话立即应用，可执行：

```text
/model-manager apply
```

查看当前解析到的配置及来源：

```text
/model-manager
```

若要临时禁用：

```json
{
  "newConversation": {
    "enabled": false
  }
}
```
