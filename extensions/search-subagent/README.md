# Search Subagent

`search` 是面向大规模代码库检索的只读子 Agent。主 Agent 判断任务需要跨多个目录、多个文件或梳理分散调用关系时，会自动调用它；用户也可以通过 `/search <检索任务>` 明确唤起。`@` 继续保留给文件引用，不作为子 Agent 前缀。

## 能力与安全边界

子 Agent 在独立的 Pi 进程和上下文窗口中运行，并固定使用以下工具：

```text
read, grep, find, ls
```

它不能使用 `bash`、`edit`、`write`，也不能由工具调用方临时扩大权限、切换目录或覆盖模型。子进程禁用普通扩展自动发现，只显式加载 toolkit 自带的 Cursor provider 和 `.gitignore` 访问守卫，并通过 `--tools read,grep,find,ls` 强制工具白名单；同时禁用 Skills、提示模板和上下文文件。

适合：

- 涉及至少约 5 个文件或多个目录的检索
- 全仓库定位分散实现
- 架构、入口、依赖关系和调用流侦察
- 收集带文件路径、行号的实现证据

不适合：

- 已知单个文件的读取
- 一个简单 `grep` 即可完成的精确查询
- 修改文件、运行测试或执行命令

## 模型配置

用户级配置：

```text
~/.pi/agent/search-subagent.json
```

```json
{
  "model": "anthropic/claude-haiku-4-5",
  "presentation": "manual"
}
```

受信任项目可以覆盖用户配置：

```text
.pi/search-subagent.json
```

```json
{
  "model": "openai/gpt-5-mini",
  "presentation": "inline"
}
```

优先级：

1. 受信任项目的 `.pi/search-subagent.json`
2. 用户级 `~/.pi/agent/search-subagent.json`
3. 当前主 Agent 模型

未受信任项目的项目配置不会被读取。配置文件不是合法 JSON、`model` 为空或 Pi 无法解析/使用指定模型时，工具会明确失败，不会静默换用其他模型。

子进程禁用全部普通扩展，只显式加载本 toolkit 的 `extensions/cursor-models/index.ts` 和 `extensions/search-subagent/gitignore-guard.ts`；前者注册 `cursor-agent` provider，后者在每次文件工具调用前使用 `git check-ignore --no-index` 执行项目 `.gitignore` 规则。最终可调用工具仍被 `--tools read,grep,find,ls` 限定。若指定模型依赖其他未加载的自定义 provider 或凭据，工具会返回模型启动错误。

## 使用

通常无需手动操作：工具描述会指导主 Agent 在广泛检索时自动调用。

也可以通过 Slash Command 明确要求：

```text
/search 查找所有权限校验入口，并梳理调用关系
```

命令会要求主 Agent 立即调用 `search` 工具；检索进度和结果仍显示在原生工具框中。任务为空或主 Agent 正在执行时，命令会提示后退出。

工具参数只有一个：

```json
{
  "task": "查找所有权限校验入口，给出文件、行号和主要调用关系"
}
```

运行期间，主对话等待工具完成，并在工具区域流式显示最近的 `read`、`grep`、`find`、`ls` 调用；按 `Ctrl+O` 可在运行期间查看全部已记录调用。所有路径是否允许访问由当前 Git 项目的 `.gitignore` 决定：被忽略的文件或目录会在工具执行前直接阻止；未被忽略的路径可以正常检索。非 Git 项目没有 `.gitignore` 守卫。按 Escape 会取消主任务并终止子进程。完成后，主 Agent只接收压缩后的检索报告；展开工具结果可以查看更完整的信息。

## 后台子 Agent 与只读 Overlay

默认使用 `presentation: "manual"`：Search 子 Agent 在持久 RPC Session 中后台运行，不会自动抢占焦点或创建分屏。按 `Alt+A` 可在当前 TUI 上方打开居中的大尺寸只读 Overlay，以主 Agent 相同的消息、Markdown、思考块和工具组件查看最近子 Agent 的过程；Overlay 不提供输入框，支持鼠标滚轮以及 `↑`、`↓`、`PageUp`、`PageDown`、`Home`、`End` 滚动，并使用 `Ctrl+O` 展开或折叠工具输出。按 `Esc` 返回主 Agent，但不会终止子 Agent。也可用 `/subagents` 管理指定子 Agent：列表中按 `Enter` 进入实时过程或查看历史详情；历史任务的最终报告会直接显示为 Markdown 预览。按 `C` 请求取消，按 `X` 强制终止活跃任务，按 `D` 清理已退出的任务记录。列表默认只显示当前主会话创建的子 Agent，按 `Tab` 可切换到所有会话记录；操作后会刷新列表。首轮任务完成后报告仍会自动返回主 Agent。

如需原来的 Windows Terminal 行为，可显式设置 `presentation: "split"` 或 `"tab"`；`"auto"` 会在原生 Windows Terminal 中自动分屏，在其他环境回退到内联模式。

全局配置位于 `~/.pi/agent/subagents.json`：

```json
{
  "presentation": "manual",
  "fallback": "inline",
  "keepOpen": true,
  "retainCompletedMinutes": 60,
  "windowsTerminal": {
    "size": 0.45,
    "shell": "pwsh.exe"
  }
}
```

`presentation` 支持 `manual`、`auto`、`inline`、`split` 和 `tab`。`manual` 是默认值并提供最接近 OpenCode 的手动进入/退出体验；`inline` 使用一次性 JSON 子进程；`split` 和 `tab` 自动打开 Windows Terminal；`auto` 根据环境决定。Search 的用户级或受信任项目配置可以覆盖全局值。所有模式都严格保留只读工具白名单、扩展隔离和 `.gitignore` 守卫。

## 输出限制

返回主 Agent 的文本最多约 50 KB 或 2000 行，超出部分会截断，以避免挤占主会话上下文。完整最终输出仍保存在工具结果的 `details` 中。
