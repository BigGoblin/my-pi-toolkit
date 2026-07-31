# Pi Lens Extension

项目内的 `pi-lens` 加载入口。

实际实现由 npm 依赖 `pi-lens` 提供，本目录软加载已构建的扩展入口。若安装失败（例如 Termux 上 `@ast-grep/cli` 无原生 binary），会跳过 Pi Lens，其它 toolkit 扩展仍可加载。

Pi Lens 提供：

- LSP 导航与诊断
- AST-aware 搜索和替换
- 项目、模块与符号报告
- Tree-sitter、ast-grep 和安全规则
- lint、复杂度及项目级诊断聚合

## Source

- 本地入口：`extensions/pi-lens/index.js`
- 实际实现：`node_modules/pi-lens/dist/index.js`
- Skills：`node_modules/pi-lens/skills/`
- 版本：查看仓库根目录 `package.json`

具体工具和配置以当前安装版本的 `pi-lens` 文档为准。
