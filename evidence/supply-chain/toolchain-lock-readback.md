# 精确工具链与 lockfile readback

| 项目 | 已核验值 |
| --- | --- |
| Node.js | `24.19.0` |
| npm | `11.17.0` |
| 官方 macOS ARM64 归档 | `node-v24.19.0-darwin-arm64.tar.gz` |
| 官方归档 SHA-256 | `8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d` |
| package | `zhiguan-purchase-decision-workbench@0.1.0` |
| lockfile | `package-lock.json` / lockfile version `3` |
| runtime 直接依赖 | `react@19.2.8`、`react-dom@19.2.8` |
| dev 直接依赖 | 仅 ADR-0001 §5.1.1 批准的 13 项准确版本 |
| 安装方式 | 精确工具链下 `npm ci` |
| 安装脚本策略 | `strict-allow-scripts=true`；两版 optional `fsevents` 显式拒绝；根 preinstall 仅核对工具链 |

实施时从 Node.js 官方发布目录下载归档和 `SHASUMS256.txt`，先核对归档摘要，再只在 `/private/tmp` 解压使用；未修改 Homebrew、系统默认 Node、shell 初始化或用户级 npm 配置。`npm ci` 的仓库专用 cache 同样位于该临时目录。

`npm ci` 与 `npm ls --depth=0` 均通过。此记录完成 task 2.1 的准确版本与 lockfile 门禁；许可证、传递依赖、来源完整性和安全通告的完整 readback 仍由 task 2.5 单独验收。
