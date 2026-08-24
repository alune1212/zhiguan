# 实施期自动验证 readback

状态：`2026-08-24` clean commit 的自动验证、production artifact 与 loopback runtime readback 已通过；仍不是 `Prototype Accepted` 或分发授权。

## 锁定工具链

```text
Node.js 24.19.0
npm 11.17.0
```

`npm run check:toolchain` 返回：

```text
toolchain-ok node=24.19.0 npm=11.17.0
```

## 当前通过结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 12 files，129/129 tests 通过 |
| `npm run test:delivery` | 44/44 tests 通过 |
| 构建前 `npm run scope:check` | `SCOPE_GUARD_PASS files=70 skipped=6` |
| 构建后 `npm run scope:check` | `SCOPE_GUARD_PASS files=74 skipped=4` |
| dev `npm run test:e2e` | Chromium desktop/mobile 10/10 通过；未验证 build fail-closed |
| production `npm run test:e2e` | Chromium desktop/mobile 10/10 通过；强制校验 release headers |
| `git diff --check` | 通过 |

fixture 合同的自动 replay 直接读取 19 个合成 fixture，执行 76 个 case oracle、655 个结果 oracle和 1 个 utility oracle；50 条确认修订的旧结果来自前一次真实计算结果。SYN-02、SYN-04 和恶意 Unicode/Markdown fixture 直接执行 freeze、JSON、Markdown、跨格式等价和解码链路。

最终只读终审也已收口：导出冻结、结构验证、JSON/Markdown、跨格式等价、下载生命周期和资源上限对应的 5.1–5.8 全部通过，未发现 P1/P2 阻塞；fixture 合同的 1.3 通过，3.9 仅保留 WebKit/Safari 规范向量缺口；workbench/application 集成除人工支持矩阵 4.6 外通过。终审没有替代下列人工、跨浏览器、性能与完整回滚门禁。

Playwright 完成后，其临时 loopback web server 已退出；`curl` 无法连接 `127.0.0.1:4173`，`lsof` 也没有发现 4173 监听进程。详细浏览器边界见 [`browser-readback.md`](../browser/browser-readback.md)。

## Clean production build

经批准实现与 E2E 修复形成 commit `aff13047346cd4ceeba02299e13c3db5557fc165` 后，在一次性 clean clone 执行 `npm ci`、全部自动测试和 `npm run build`。构建 preflight 返回：

```text
ARTIFACT_PREFLIGHT_PASS mode=release worktree=clean
ARTIFACT_MANIFEST_CHECK_PASS sha256=766aea6267f8f7636f6eae6aeec1e9f9cacd4260b0d051b90f034cc7e7f7e38f
```

manifest 固定 `app_version=0.1.0`、批准的配置版本、上述 Git SHA、clean release 模式和 75 个输入条目。`dist` 仅有 HTML、同源 JS/CSS，产物后 scope guard 通过。live preview 的完整 headers、strictPort、production Playwright 和停止证据见 [`clean release readback`](../delivery/clean-release-readback-2026-08-24.md)。

## 自动验证不能替代的事项

- WebKit/Safari 规则规范向量。
- Windows Chrome、macOS Safari、iOS Safari、macOS/iOS VoiceOver 与减少动态人工验收。
- 固定目标设备/网络上的四项性能预算。
- 在存在上一份已接受完整交付单元后的恢复与重新 readback 演练。

因此仍保持 `Prototype Accepted=false`、研究协议非 Accepted、`Recruitment Authorized=false`；不招募、不分发、不公开发布。
