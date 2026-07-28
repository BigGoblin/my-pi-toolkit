# Permission Modes Extension

项目内的 `pi-permission-modes` 加载入口。

实际实现由 npm 依赖 `pi-permission-modes` 提供，本目录通过 `index.ts` 转发扩展入口，使其随 `my-pi-toolkit` 一起加载和分发。

该扩展提供可切换的权限模式与命令执行沙箱，用于替代原有的 project-guard 方案。

## Source

- 本地入口：`extensions/permission-modes/index.ts`
- 实际实现：`node_modules/pi-permission-modes/src/index.js`
- 版本：查看仓库根目录 `package.json`

具体命令、模式和配置以对应版本的 `pi-permission-modes` 包文档为准。
