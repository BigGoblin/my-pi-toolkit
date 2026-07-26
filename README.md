# my-pi-toolkit

My personal pi coding agent toolkit — extensions, skills, prompts, and themes.

## Install

```bash
# From git (recommended)
pi install git:github.com/BigGoblin/my-pi-toolkit

# Or from npm (after publishing)
pi install npm:my-pi-toolkit@1.0.0
```

## Development

Clone and install locally — no push needed during development:

```bash
git clone git@github.com:BigGoblin/my-pi-toolkit.git
pi install ./my-pi-toolkit
```

Edit extensions, then `/reload` in pi to apply changes.

## Contents

- **extensions/** — Custom pi extensions
  - `hello` — smoke-test command
  - `tapd` — TAPD 待办树
  - `cursor-models` — 折叠 Cursor 扁平模型 + Fast 开关

### cursor-models

依赖已安装的 `npm:@open-cursor/pi-agent`。会把缓存里的扁平 ID（如 `cursor-grok-4.5-high-fast`）收成：

- `/model`：一个家族模型（如 `cursor-grok-4.5`）
- `Shift+Tab`：思考等级
- `/fast` 或 `Ctrl+Shift+F`：Fast 开/关（状态栏：`(cursor-agent) cursor-grok-4.5 • high • fast`）

状态保存在 `~/.pi/agent/cursor-fast.json`。改完后在 pi 里 `/reload`。

若默认模型仍是旧扁平 ID（如 `cursor-grok-4.5-high`），会话启动时会自动迁移到家族 ID；也可把 `settings.json` 的 `defaultModel` 改成家族名。
