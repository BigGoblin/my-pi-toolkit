---
name: pi-package-bundler
description: 将用户指定的 Pi package 集成到当前 my-pi-toolkit 中并随扩展分发。用户给出 npm 包名、pi.dev 页面、npm 页面或 GitHub 链接并要求安装、接入、像 pi-lens 一样使用时加载此技能。
---

# Pi Package Bundler

## 目标

默认把第三方 Pi package **内置到当前 `my-pi-toolkit`**，使任何安装了这个 toolkit 的项目都能使用它。不要只创建当前项目的 `.pi/settings.json`，那只对单个项目生效。

仅当用户明确说“只在当前业务项目使用”时，才使用 `pi install -l` 做 project-local 安装。

## 安全边界

Pi package 的扩展和依赖安装脚本拥有很高权限。安装前检查包的名称、来源、版本、`package.json` 的 `pi` manifest 和 README；发现可疑来源、包名不明确或不是 Pi package 时先询问用户，不要猜测。

## 输入解析

支持以下输入：

- npm 包名：`pi-lens`、`@scope/package`
- pi.dev 页面：从页面或 `?name=` 参数取得 canonical npm 包名
- npm 页面：取得 `/package/<name>`
- GitHub URL：检查仓库 `package.json`，确认它是 Pi package，再使用 git dependency

对于网页链接，优先使用 Defuddle：

```bash
defuddle parse <url> --md
```

如果 Defuddle 不可用，使用 `npm view`、仓库 `package.json` 或 package tarball 元数据验证来源。npm 包优先使用已发布版本，并固定到明确版本。

## 工作目录确认

1. 找到 toolkit 根目录（应包含 `package.json`，且其中存在 `pi` 字段）。
2. 确认这是 `my-pi-toolkit`，不要在用户要分析的业务项目中误改文件。
3. 记录包名、来源和最终版本；有同名包时以项目现有配置为准。

## 集成流程

### 1. 安装运行时依赖

npm package：

```bash
npm install --save-exact <package-name>@<version>
```

Git package：使用仓库 package.json 中的真实 `name`，例如：

```bash
npm install --save-exact git+https://github.com/<owner>/<repo>.git#<ref>
```

不要只把包放进 `peerDependencies`。它必须是当前 toolkit 的直接 `dependencies`，并加入：

```json
"bundledDependencies": ["<package-name>"]
```

保留已有的 bundled dependencies，并使用 npm 更新 `package-lock.json`，不要手工伪造 lockfile。

### 2. 接入 Pi manifest

在 toolkit 的 `package.json` 的 `pi` 字段中，把第三方资源引用为 toolkit 根目录下的 `node_modules` 路径：

```json
{
  "pi": {
    "extensions": ["./node_modules/<package-name>/dist/index.js"],
    "skills": ["./node_modules/<package-name>/skills"],
    "prompts": [],
    "themes": []
  }
}
```

实际操作时：

- 读取第三方 package.json 的 `pi.extensions`、`pi.skills`、`pi.prompts`、`pi.themes`。
- 将每个有效入口转换为 `./node_modules/<package-name>/...`，保留多个入口，不要只取第一个。
- 先检查转换后的路径确实存在；不存在时使用包内实际的 convention 目录（`extensions/`、`skills/`、`prompts/`、`themes/`）。
- 第三方 manifest 中类似 `../../skills` 的越界或错误路径不要原样复制；如果包内存在 `<package>/skills`，引用 `./node_modules/<package>/skills`。
- 去重并保留现有 toolkit 资源。
- 不要把第三方包的源码复制到 `extensions/`；通过 `node_modules` 引用，保证 bundled package 的模块解析隔离。

### 3. 文档

在 README 的安装/内容部分说明该 package 已随 toolkit bundled，用户安装 toolkit 后不需要在每个项目重复 `pi install npm:<package>`。

### 4. 验证

完成修改后至少执行：

```bash
npm install
npm pack --dry-run --json
```

检查 pack 清单包含：

- `node_modules/<package-name>/package.json`
- 所有已加入 `pi` manifest 的 extension/skill/prompt/theme 入口
- 第三方 package 的运行时依赖（`bundledDependencies` 生效）

然后从 toolkit 根目录执行 Pi smoke test：

```bash
pi --approve --no-session --mode rpc < /dev/null
```

退出码必须为 0；检查输出或 Pi 日志，确认第三方扩展已加载。若有资源路径错误、peer dependency 错误或 npm install 脚本失败，修复后再报告成功。

## 例外：只安装到单个项目

用户明确要求 project-local 时才执行：

```bash
pi install -l npm:<package-name>@<version>
```

这会写入目标项目 `.pi/settings.json`，只影响该项目；不要同时修改 toolkit 的 `package.json`。

## 完成报告

报告以下内容：

- 集成的包名和版本/ref
- `package.json`、`package-lock.json` 和 README 的变化
- 使用的 Pi manifest 入口
- 验证结果
- 如果 npm audit 有漏洞，单独说明，不要把有漏洞误报成完全无风险
