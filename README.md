# my-pi-toolkit

My personal pi coding agent toolkit — extensions, skills, prompts, and themes.

## Install

```bash
git clone git@github.com:BigGoblin/my-pi-toolkit.git
cd my-pi-toolkit
npm install
pi install ./my-pi-toolkit
```

`settings.json` 的 `packages` 只需：

```json
"packages": ["E:\\my-pi-toolkit"]
```

不要再装 `npm:@open-cursor/pi-agent`（已 vendored 进本仓库）。

## Development

Edit extensions or `vendor/open-cursor/pi-agent`, then `/reload` in pi.

```bash
npm install   # after pulling dependency changes
```

## Contents

- **extensions/** — Custom pi extensions
  - `hello` — smoke-test command
  - `tapd` — TAPD 待办树
  - `cursor-models` — 折叠 Cursor 扁平模型 + Fast 开关
- **vendor/open-cursor/** — 本地化的 Cursor↔Pi 桥（源自 open-cursor，可自行修改）

### vendor/open-cursor

从 `@open-cursor/pi-agent` + `client` + `protocol` 拷贝而来，由本仓库的
`package.json` → `pi.extensions` 直接加载：

`./vendor/open-cursor/pi-agent/src/index.ts`

改流式 usage / checkpoint / 协议行为：编辑 `vendor/open-cursor/pi-agent/src/`。

### cursor-models

叠在 vendored provider 之上，把扁平 ID（如 `cursor-grok-4.5-high-fast`）收成：

- `/model`：一个家族模型（如 `cursor-grok-4.5`）
- `Shift+Tab`：思考等级
- `/fast` 或 `Ctrl+Shift+F`：Fast 开/关

状态保存在 `~/.pi/agent/cursor-fast.json`。
