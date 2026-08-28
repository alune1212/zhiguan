# 最大合成会话性能 readback

## 结论与边界

`2026-08-28` 的最小性能修复在固定 macOS 实验室环境中通过 `3s / 100ms / 500ms / 1s` 四项预算。修复只延迟挂载超长“个人价值期待”全文：默认显示前 `240` 个字符并明确说明完整值仍保留，用户可按需打开只读全文；会话值、计算输入和 JSON/Markdown 导出未截断。

最终性能交付单元来自主仓库实现 commit `0e1e38c2906b5aab0fa7c64add9d6c8e6dd7fc79` 的全新 clean clone；`npm ci`、构建 preflight、production build 与 artifact check 均通过，manifest SHA-256 为 `33ad07978340129e5bf5f7326452d5e48db552db138fd602d5a32e559dcc4700`。实际目标平台版本与人工结论见 [`manual-support-matrix-2026-08-28.md`](manual-support-matrix-2026-08-28.md)。

## 固定实验室配置

- 设备：MacBook Pro `Mac15,3`，Apple M3，8 核（4 performance + 4 efficiency），16 GB；接通电源，电量 `80%`。
- 系统：macOS `27.0`，build `26A5421a`。
- 工具链：Node.js `24.19.0`、npm `11.17.0`、Playwright `1.62.1`。
- 服务：production `vite preview`，`127.0.0.1:4173`，loopback-only，HTTP `200`，Service Worker blocked。
- 视口：`1280 × 900`；每个浏览器独立执行 `3` 轮。
- 合成会话：`SYN-02 + EDGE-REVISION-LIMIT + 64 KiB text`；`50` 条已确认修订、每条 `5` 个旧结果、已确认自由文本恰好 `65,536` UTF-8 bytes。
- 资源 readback：规范快照近似 `422,325` bytes（低于 `512 KiB`）；JSON `623,643` bytes、Markdown `625,677` bytes（均低于 `1 MiB`）；每轮 `3` 个 loopback 静态请求、`0` 个外部请求、无导出错误。

## 三轮最坏值

| 目标 | 实际版本 | 首个可用界面 | 输入计算与状态更新 | 导出预览 | 单格式生成 | 结果 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 本机 Google Chrome | `152.0.7977.65` | `137.9 ms` | `3.2 ms` | `1.6 ms` | `44.2 ms` | 通过 |
| Playwright WebKit | `26.5` | `80 ms` | `6 ms` | `2 ms` | `32 ms` | 通过 |
| 预算 | — | `≤ 3000 ms` | `≤ 100 ms` | `≤ 500 ms` | `≤ 1000 ms` | — |

修复前同一 `64 KiB` 合成文本的诊断重算为 `1180.3 ms`，超过 `100 ms`；最终 clean commit 在严格 `50 × 5` 最大修订会话中的三轮最坏重算为 `6 ms`。

## 可见与数据边界 readback

- production 页面默认不挂载 `65,536` 字符全文，显示保留说明与“查看完整内容”按钮。
- 用户打开全文后得到 `readOnly` textarea，实际 value 长度仍为 `65,536`；收起后可继续确认。
- 理解阶段存在 `5` 张结果卡；超长连续合成字符不会造成页面横向溢出。
- 自动测试覆盖“默认不挂载全文、用户可读取完整值、确认后重新保持收起”；`13` 个 Vitest 文件、`137` 个测试通过，delivery `44/44`、typecheck、scope guard 与 `git diff --check` 通过。

## 解释边界

- `6.4` 的固定实验室配置以同一台 MacBook Pro、同一 loopback 网络、同一 production artifact、实际 Chrome 渠道和 WebKit 引擎执行；没有真实用户遥测、分析事件或会话追踪。
- Windows Chrome 与 iOS Safari 的真实设备可完成性属于 `6.3` 用户确认矩阵。本记录不伪造它们的原始性能耗时，也不把 Playwright WebKit 写成真实 iOS Safari。
- 若未来把性能门禁改为“每个物理目标设备分别测量”，必须先固定各设备的电源、温控、网络与测量工具并补充新证据；本次归档不外推该结论。
