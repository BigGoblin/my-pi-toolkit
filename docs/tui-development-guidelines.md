# M-PI TUI 开发规范

本规范适用于仓库内所有新增或修改终端 UI 的功能，包括 Header、Footer、Widget、Overlay、Editor、工具调用结果、状态提示和 Theme。关键词 **必须**、**不得**、**应当** 表示合并前必须满足；“建议”允许在说明理由后偏离。

目标是保持 Grok Build 风格的信息层级，同时遵守 Pi 扩展 API 和 inline terminal 的边界。

## 1. 设计原则

1. **正文优先**：辅助状态使用 `muted` / `dim`，不得与用户内容或最终答复竞争。
2. **状态一致**：相同状态必须使用相同字符和语义色。
3. **键盘优先**：所有操作必须可通过键盘完成；鼠标只能作为补充。
4. **响应式降级**：终端变窄时先隐藏低价值元数据，不得截掉主要动作、错误或关闭提示。
5. **扩展层优先**：优先使用 Pi 公共扩展 API，不得依赖未公开的 internal layout 状态。
6. **终端兼容**：核心状态不得依赖 emoji、图片、特定 Nerd Font 或双宽字符。

## 2. 共享视觉语言

### 2.1 强制复用

新模块不得重新定义状态图标、模式颜色或时间线格式，必须复用：

- `extensions/shared/tui/visual-language.ts`
- `extensions/shared/tui/tool-render.ts`
- `extensions/shared/tui/tool-format.ts`

需要新增视觉语义时，先扩展共享模块，再由业务模块调用；不得复制 helper 到模块目录。

### 2.2 状态映射

| 状态 | 字符 | Theme token | 用途 |
| --- | --- | --- | --- |
| active | `●` | `accent` | 运行中、当前焦点 |
| success | `✓` | `success` | 成功、完成 |
| error | `✗` | `error` | 失败、取消、阻塞错误 |
| pending | `○` | `dim` | 待处理、未开始 |

层级字符固定为：`›` 动作、`└` 次级摘要、`│` 时间线、`…` 省略。

### 2.3 颜色

- 必须使用 `Theme.fg()`、`Theme.bg()`、`Theme.bold()` 等语义 API。
- 不得在 TypeScript 中写 RGB ANSI 转义或硬编码十六进制颜色。
- 颜色值只放在 `themes/*.json`；默认推荐主题是 `grok-build-dark`。
- 业务逻辑不得读取主题 JSON 的自定义 `export` 字段建立第二套色彩系统。
- 颜色不能是唯一状态信号，必须同时提供字符或文本。

## 3. 布局与宽度

### 3.1 宽度计算

- 含 ANSI 的字符串必须用 `visibleWidth()` 计算显示宽度。
- 截断必须使用 `truncateToWidth()`；需要补齐边框时使用共享 `fitLine()`。
- 不得使用 `string.length` 计算终端列宽。
- 所有 `repeat()` 参数必须经过 `Math.max(0, value)` 或由已验证的非负宽度产生。
- 最窄宽度下也不得产生负 padding、断裂边框或异常。

### 3.2 响应式档位

Dashboard 和复杂 Widget 应至少验证：

- `< 80`：单栏或紧凑模式；
- `80–119`：双栏/普通模式；
- `>= 120`：宽屏模式。

提交前必须人工抽查 60、80、120、160 列。新模块可采用不同断点，但需在模块 README 说明理由。

### 3.3 Overlay 高度

Overlay 返回的总行数必须包含全部固定行：

```text
总高度 = 顶边框 + Header + 分隔线 + Viewport + 分隔线/状态行 + 底边框
```

计算 viewport 时，必须逐项扣除固定行，不得使用未同步的魔法数字。新增或删除 Header、Footer、分隔线时必须同时更新高度预算。

示例：包含顶边框、标题、分隔线、内容、Footer、底边框时：

```ts
const chromeRows = title.length + 4;
viewportHeight = Math.max(1, panelHeight - chromeRows);
```

底边框和关闭提示必须在最大高度下可见；不得依赖 overlay 容器替组件修正溢出。

## 4. 组件规范

### 4.1 Component 生命周期

- `render(width)` 必须是无副作用的确定性渲染；订阅、终端模式和定时器在 constructor/open 阶段建立。
- 缓存渲染结果时，`invalidate()` 必须清除所有相关缓存。
- 订阅、计时器、mouse tracking 等资源必须在 `dispose()` 或 session shutdown 中释放。
- 关闭路径和异常路径必须幂等，重复释放不得报错。
- 长类或高复杂度输入处理应按事件解析、状态更新、渲染拆分，源文件尽量不超过 300 行。

### 4.2 输入与帮助

- `Esc` 应关闭非破坏性 overlay；滚动视图应支持 ↑/↓、PageUp/PageDown、Home/End。
- 可展开工具结果保持 Pi 的 `Ctrl+O` 习惯。
- Footer/help 行必须展示主要键位，窄屏允许截掉次要提示但必须保留关闭方式。
- 新快捷键不得覆盖 Pi 或已有 toolkit 快捷键；新增前检查相关模块 README。

### 4.3 鼠标

- 鼠标支持必须是可选增强，不得成为唯一操作路径。
- Overlay 滚轮必须复用 `extensions/shared/tui/mouse.ts` 的 `acquireMouseTracking()` 和 `mouseWheelDirection()`。
- 必须保存并调用 release 函数，确保关闭、异常和 `/reload` 后终端鼠标模式被释放。
- 不得在普通组件中直接发送 enable/disable 序列，避免多个组件互相关闭捕获。
- 扩展层没有稳定的绝对布局 rect；未修改 Pi 核心前不得宣称支持通用点击命中。

## 5. 工具调用展示

Toolkit 注册的新工具必须实现 `renderCall` 和 `renderResult`，并优先使用共享 helper：

```ts
renderCall(args, theme) {
  return toolCall(theme, "tool_name", "action", "short detail");
}

renderResult(result, { expanded }, theme) {
  return toolResult(theme, {
    status: result.isError ? "error" : "success",
    title: "tool_name",
    summary: "short outcome",
    body: expanded ? fullOutput : preview,
    hint: expanded ? undefined : "Ctrl+O details",
  });
}
```

要求：

- 第一行只放状态、工具名和短摘要。
- 参数和进度放在 `└` 次级行；详细正文放在 `│` 时间线中。
- 折叠态必须有边界，长输出应预览并提示 `Ctrl+O`。
- 错误不得渲染为 success；partial update/running 使用 active。
- 路径、查询和用户文本必须压缩或截断，避免单行撑破终端。
- Markdown 报告可在 expanded 状态使用 `Container` / `Markdown`，但 Header 仍应使用 `toolHeader()`。
- Pi 内置工具视觉覆盖只能使用 Pi 导出的 `create*ToolDefinition()` factory，并完整保留其 schema、execute、prompt metadata 和 execution mode；不得手写或复制执行逻辑。
- 同名内置工具覆盖必须遵循 Pi 的扩展加载顺序并检查最终 `sourceInfo`。若 reload 会在 `session_start` 前重建历史 transcript，可在 extension load 阶段预注册 renderer，但必须在 session start 后报告冲突，并提供关闭开关；不得宣称能绕过 Pi 的 first-registration-wins 规则。
- 不得复制、patch 或 monkey patch 内部 `ToolExecutionComponent`。如果公开 factory 无法保留宿主执行配置，该工具必须保持 native，并在模块 README 说明限制。

## 6. 信息层级

### Dashboard

- 品牌区最多 1–2 行；首屏优先显示项目、能力和运行时信息。
- 避免每个区域都使用完整盒子；优先标题、分隔线和留白。
- 动态列表必须处理空数组、长名称和多列降级。

### Footer

- 第一层：模式、项目/分支/会话、模型/思考、子 Agent。
- 第二层：context、token、cache、cost。
- Context `<70%` 使用 muted，`70–89%` warning，`>=90%` error。
- 缺失字段必须连同图标和分隔符一起隐藏。
- 跨模块 status key 是契约；修改 `chat-mode`、`subagent` 等 key 时必须同步所有消费者。

### Todo、Plan、Subagent

- Todo 同时最多一个 active；完成项降噪，不依赖删除线。
- Plan review 必须保留完整 Markdown、滚动位置、关闭提示和底边框。
- Subagent overlay 必须区分 live/historical、running/completed/error，并在关闭时取消订阅和 mouse tracking。

## 7. 架构与兼容性

- 公共视觉 helper 放在 `extensions/shared/tui/`；业务数据和执行逻辑留在模块目录。
- 不得让 `shared/tui` 依赖具体业务模块，避免循环依赖。
- 子 Agent 仍走瘦加载路径，不得加载整个 `ming-core`。
- 保持现有命令、快捷键、tool name、status key 和 session custom entry 兼容；破坏性变化必须提供迁移说明。
- 不得为视觉改造改变工具权限、Plan 生命周期、worker 隔离或安全门禁。
- 内置 tool override 必须默认可关闭，并验证包装前后除 `renderShell`、`renderCall`、`renderResult` 外的 definition 字段保持一致。
- 新功能若受 Pi 公共 API 限制，必须在文档中明确能力边界，不得以脆弱 hack 冒充正式支持。

## 8. 文档要求

每次 TUI 功能变更必须同步检查：

- 模块 README 的 UI、命令、快捷键和已知限制；
- 根 `README.md` 的主题和组件索引；
- 本规范是否需要补充新的共享约定；
- 配置示例和截图/文本草图是否仍与实现一致。

新增模块必须在 `extensions/README.md` 登记，并说明其视觉组件、输入方式、生命周期资源和响应式行为。

## 9. 合并前检查清单

### 代码

- [ ] 复用共享 glyph、颜色与工具 renderer，没有复制视觉常量。
- [ ] 没有 TypeScript 硬编码颜色或手写 ANSI 色彩。
- [ ] ANSI 宽度使用 `visibleWidth` / `truncateToWidth` / `fitLine`。
- [ ] Overlay 高度逐项扣除固定行，顶边框、Footer、底边框均可见。
- [ ] 键盘可完成所有操作，帮助行包含关闭方式。
- [ ] 订阅、timer、mouse tracking 在所有关闭路径释放。
- [ ] 源文件尽量不超过 300 行，新增依赖不形成循环。

### 状态验证

- [ ] tool running / success / error / empty result 均正确。
- [ ] `Ctrl+O` 折叠与展开正确，长路径和长错误不会越界。
- [ ] 60、80、120、160 列下人工 resize 验证。
- [ ] Plan、Todo、Subagent 的打开、更新、滚动、关闭和 `/reload` 正常。
- [ ] Windows Terminal；条件允许时抽查 tmux/SSH/Termux。

### 自动检查

- [ ] 对所有修改的 TypeScript 文件运行 LSP diagnostics。
- [ ] 使用 Pi Lens `mode=all`，确保无阻塞错误和新增可修复警告。
- [ ] 运行 `git diff --check`。
- [ ] 仓库没有根测试脚本时，不得声称 `npm test` 已通过；记录实际执行的验证。

## 10. 评审红线

出现以下任一情况不得合并：

- 状态只靠颜色或 emoji 表达；
- Overlay 底边框、关闭提示或主要内容被最大高度裁剪；
- mouse tracking、timer 或订阅没有可靠释放；
- 工具错误显示为成功，或折叠态无展开提示；
- 窄终端出现负 padding、异常、断裂布局；
- 为视觉效果绕过 Plan/Ask 工具权限或子 Agent 隔离；
- 功能已变化但相关文档仍描述旧 UI 或旧键位。
