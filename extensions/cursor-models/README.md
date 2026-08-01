# Cursor Models Extension

在 vendored Open Cursor provider 之上整理 Cursor 模型展示，并增加 Fast 模式切换。

## Features

- 将 Cursor 扁平模型 ID 折叠成模型家族。
- `/model` 中只展示家族模型，例如 `cursor-grok-4.5`。
- Fast 状态独立保存，并在 Cursor 模型请求时生效。
- 会话启动时迁移旧的扁平模型选择。

思考等级请使用 `/effort`（由 model-manager 提供）；`Shift+Tab` 用于切换 Build/Plan/Ask 会话模式。

## Command and shortcut

```text
/fast
```

切换 Cursor Fast 模式。

- `Ctrl+Shift+F`：切换 Cursor Fast 模式。

状态文件：

```text
~/.pi/agent/cursor-fast.json
```

## Modules

- `index.ts`：加载 Open Cursor provider、注册命令和生命周期事件。
- `collapse.ts`：折叠模型列表和家族元数据。
- `parse.ts`：解析 Cursor 模型 ID、思考等级和 Fast 后缀。
- `fast-state.ts`：读取和保存 Fast 状态。

Open Cursor provider 源码位于 [`../../vendor/open-cursor/`](../../vendor/open-cursor/)。
