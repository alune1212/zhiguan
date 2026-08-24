# Clean release artifact 与 live preview readback

状态：`2026-08-24` 实施后 clean 候选证据；不是 `Prototype Accepted`、参与者分发授权或正式产品发布。

## 受信输入与工具链

- Git commit：`aff13047346cd4ceeba02299e13c3db5557fc165`
- 分支：`codex/prd-single-purchase-decision`
- 构建起点：一次性 clean clone；安装前无 `node_modules`、`dist` 或 artifact manifest
- Node.js：`24.19.0`
- npm：`11.17.0`
- Vite：`8.2.2`
- ISO 4217 fixture SHA-256：`838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9`

`npm ci` 从锁文件安装 115 个 package。dependency policy、货币快照、严格类型检查、OpenSpec strict validation、delivery 测试、Vitest 和构建前 scope guard 均通过：

| 检查 | 实际结果 |
| --- | --- |
| dependency policy | lockfile v3；packages=158；engines=110；peers=14；无未说明的直接依赖漂移 |
| `npm run test:delivery` | 44/44 passed |
| `npm test` | 12 files，129/129 passed |
| 构建前 `npm run scope:check` | `SCOPE_GUARD_PASS files=70 skipped=6` |
| OpenSpec strict validation | `build-single-purchase-decision-workbench` valid |

## Production artifact

`npm run build` 先确认 `mode=release worktree=clean`，再生成纯静态 `dist`。artifact manifest 的 SHA-256 为：

```text
766aea6267f8f7636f6eae6aeec1e9f9cacd4260b0d051b90f034cc7e7f7e38f
```

manifest readback：

- `manifest_version=1.0.0`
- `app_version=0.1.0`
- `config_version` 与批准的固定构建 carrier 一致
- `build_mode=release`
- `worktree_state=clean`
- `git_commit_sha=aff13047346cd4ceeba02299e13c3db5557fc165`
- 75 个输入条目，包含 `.gitattributes` 与固定 ISO 4217 fixture

`dist` 只包含 `index.html`、一份同源 JS 和一份同源 CSS；没有 symlink、source map、PWA manifest、Service Worker、Wasm 或远程资源。构建后 scope guard 返回 `SCOPE_GUARD_PASS files=74 skipped=4`。

| 文件 | SHA-256 |
| --- | --- |
| `dist/index.html` | `3b42053b3e7f14c928b7c5f0ca49189e8453f53fde4259910ef77a83f4aa93f6` |
| `dist/assets/index-C4DBdl0A.js` | `6215bcb12972b6942b1b7d21d7fb11157c8017dc81b0165a3eaadd644c66759d` |
| `dist/assets/index-DaYhKsSC.css` | `f1f0bbfd4c4a8ca34c745e5ec9c6828cd930277fd2a21dd1deffee57260860cf` |

`dist/index.html` 的四项 carrier 与 manifest 一致，包括上述 commit、manifest SHA、`0.1.0` 和批准的固定配置版本。

## Live loopback 边界

固定工具链下的 `npm run preview` 先通过 artifact check，再只监听 `127.0.0.1:4173`。HTML 与 JS 均返回 `200`，并包含：

- `Cache-Control: no-store`
- `Content-Security-Policy: default-src 'self'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; child-src 'none'; font-src 'self'; img-src 'self'; media-src 'none'; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; worker-src 'none'; manifest-src 'none'`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

第二个同配置实例先再次通过 artifact check，然后以退出码 `1` 和 `Port 4173 is already in use` 拒绝启动，没有自动换端口。预览终端在浏览器验收期间没有输出请求路径、输入或其他业务值。

## Production Chromium 验收与停止

以 `PLAYWRIGHT_BASE_URL=<loopback-origin>` 和 `PLAYWRIGHT_REQUIRE_RELEASE_HEADERS=1` 运行 Playwright：desktop `1280×900` 与 narrow `390×844` 合计 `10/10 passed`。覆盖合成主流程、失败降级、键盘、axe、无水平溢出、release build gate、显式下载请求、`pagehide` 清理，以及 Cookie、Web Storage、IndexedDB、Cache Storage、URL、剪贴板、console 和网络边界。

验收后显式停止 preview；随后 `curl` 返回连接失败，`lsof` 无 4173 监听。没有启动 LAN、公共 URL、云托管或长期服务。

## 尚未关闭的门禁

- WebKit/Safari 规则规范向量。
- Windows Chrome、macOS Safari、iOS Safari、macOS/iOS VoiceOver 与减少动态人工验收。
- 固定目标设备、网络和最大合成会话的四项性能预算。
- 在存在上一份已接受完整交付单元后执行恢复与重新 readback；当前只能证明首次停止与撤下。

因此保持 `Prototype Accepted=false`、研究协议非 `Accepted`、`Recruitment Authorized=false`；不招募、不分发、不公开发布。
