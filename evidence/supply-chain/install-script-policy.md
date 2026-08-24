# 安装脚本策略 readback

本项目使用 npm `strict-allow-scripts=true`，任何未被根 `package.json#allowScripts` 覆盖的依赖安装脚本都会使安装失败。

| 解析身份 | 来源 | 脚本处置 | 理由 |
| --- | --- | --- | --- |
| `fsevents@2.3.2` | `@playwright/test@1.62.1 → playwright@1.62.1` 的 macOS optional dependency | `fsevents: false`，禁止执行 | 已解析 tarball 随包提供 `fsevents.node`；研究构建、测试和静态服务不需要在安装时编译它 |
| `fsevents@2.3.3` | `vite@8.2.2` 的 macOS optional dependency | `fsevents: false`，禁止执行 | 已解析 tarball 随包提供 `fsevents.node`；安装时执行本地原生构建扩大供应链面但不增加本研究构建所需能力 |

根项目的 `preinstall` 只运行仓库内 `scripts/verify-toolchain.mjs`，检查 Node.js `24.19.0` 与 npm `11.17.0`；它不读取输入数据、不联网、不写持久状态。

本策略不批准其他依赖安装脚本。依赖图变化、新安装脚本或 `allowScripts` 变化必须 fail-closed 并重新 readback。
