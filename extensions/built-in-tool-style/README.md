# Built-in Tool Style

使用 Pi `0.83.x` 的公共扩展 API，把 `read`、`write`、`edit`、`bash`、`grep`、`find`、`ls` 显示为与 toolkit 自定义工具一致的 Grok 时间线。

## 边界

Pi 没有 renderer-only 注册 API。本模块采用官方支持的同名 tool override：

1. 调用 Pi 导出的 `create*ToolDefinition(ctx.cwd)`；
2. 保留 factory 返回的 schema、execute、prompt metadata 和 execution mode；
3. 只替换 `renderShell`、`renderCall`、`renderResult`。

模块不会修改 Pi、patch `node_modules`、monkey patch `ToolExecutionComponent`，也不会自行实现文件或 shell 操作。

## 配置与命令

默认启用七个工具的 Grok 展示；不需要创建配置文件。配置保存在：

```text
~/.pi/agent/ming-core.json
```

显式保持完整启用：

```json
{
  "builtinToolStyle": "grok"
}
```

关闭或只启用只读工具：

```json
{
  "builtinToolStyle": "native"
}
```

```json
{
  "builtinToolStyle": ["read", "grep", "find", "ls"]
}
```

命令：

```text
/grok-tools                 显示当前配置和注册结果
/grok-tools native          禁用 override
/grok-tools readonly        只启用 read/grep/find/ls
/grok-tools grok            启用七个工具
```

切换配置后命令会调用 Pi 的 `ctx.reload()`。

## 冲突保护

注册前模块通过 `pi.getAllTools()` 检查有效来源：

- `sourceInfo.source === "builtin"`：允许覆盖；
- 已由其他扩展、SDK、SSH 或 sandbox 提供：跳过并通知；
- 当前 runtime 已由本模块注册：允许为新 session cwd 重建 definition。

因此第三方执行后端优先于视觉覆盖。

## 已知限制

- Pi 可能把同名注册显示为 built-in override 提示。
- 这是完整 definition override，不是真正的 renderer-only；模块通过公开的 `SettingsManager` 将 Pi 的 `shellPath`、`shellCommandPrefix` 和图片自动缩放设置传入官方 factory。
- SSH、sandbox 或 remote operations 不属于 SettingsManager 配置；发现对应第三方 tool source 时模块会跳过覆盖。
- Pi 升级后若 input/details 类型变化，需要同步 renderer。
- Edit 的 final diff 会保留；原生 renderer 在执行前异步读取文件生成的 preview 不会复制，避免视觉 renderer 自行做 I/O。

## 展示行为

- `renderShell: "default"`，复用 Pi 的状态背景：运行中 `toolPendingBg`、成功 `toolSuccessBg`、失败 `toolErrorBg`；状态同时使用 `●` / `✓` / `✗`。
- `Ctrl+O` 继续控制展开；提示由 `keyHint("app.tools.expand", ...)` 生成。
- Read/Write 展开时语法高亮。
- Edit 展开时显示带语义色的 diff。
- Bash 折叠时显示尾部输出、耗时、截断和 full output path。
- Grep/Find/Ls 显示计数、有限 preview 和 limit/truncation warning。

共享视觉实现位于 `extensions/shared/tui/`，本模块不得定义第二套状态字符或硬编码颜色。
