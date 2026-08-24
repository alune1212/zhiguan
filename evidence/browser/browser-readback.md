# 浏览器实施 readback

状态：`2026-08-24` 实施期自动与本机浏览器证据；不是 `Prototype Accepted`、正式支持矩阵或参与者分发授权。

## 锁定环境与范围

- Node.js：`24.19.0`
- npm：`11.17.0`
- Playwright：`1.62.1`
- 自动浏览器：Chromium desktop `1280×900` 与 Chromium narrow `390×844`
- 应用内浏览器：Codex In-app Browser，loopback `127.0.0.1:4173`
- 数据：仅固定合成输入；未使用真实收入、购买、身份、联系人或研究记录

本轮浏览器证据只覆盖 Chromium 和当前 macOS 本机。它不替代 Windows Chrome、macOS Safari、iOS Safari、macOS/iOS VoiceOver、真实目标设备或人工可理解性验收。

## Playwright 最终结果

命令：

```text
npm run test:e2e
```

dev 与 clean production preview 分别得到 `10/10 passed`。production 命令显式设置 loopback base URL 和 `PLAYWRIGHT_REQUIRE_RELEASE_HEADERS=1`；桌面和窄屏各覆盖以下五类路径：

1. 隐私入口、标题、loopback 请求和 axe 自动检查。
2. 合成主流程、键盘、五项结果、决定、`pagehide` 清理和刷新后空白会话。
3. 空输入与非法输入的局部失败降级。
4. `390×844` 下无水平溢出。
5. 已验证构建 gate 下的 JSON 下载请求、Markdown 取消和临时资源清理。

每条路径同时断言 Cookie、localStorage、sessionStorage、IndexedDB、Cache Storage、URL 查询/片段和剪贴板写入为空，console 无非预期 warning/error，页面无未捕获异常，所有 HTTP/WebSocket 请求只到 `127.0.0.1:4173` 或 `localhost:4173`。

dev 运行明确读取到“无 release CSP/响应头”和“未验证实现预览，不能导出”的开发边界。production 运行直接访问 commit `aff13047346cd4ceeba02299e13c3db5557fc165` 的 clean artifact，强制校验 `no-store`、CSP、`nosniff`、`no-referrer`，并确认真实 build carrier 使导出入口可用；显式下载路径仍只使用合成数据。完整产物与响应头见 [`clean release readback`](../delivery/clean-release-readback-2026-08-24.md)。

## 应用内浏览器最终流程

在新建的干净标签中完成：

```text
隐私说明 → 合成输入 → 口径确认 → 五项结果 → 决定交接 → 退出清理
```

本机 readback：

- 页面标题为“值观 · 购买决策工作台”。
- 合成输入 `CNY 10000 / 160 小时 / 800` 得到 Income Rate `62.50 CNY/小时`、Work-time Equivalent `12.80 小时`；未提供固定成本时三项余量保持“数据不足”。
- 编辑购买价格为 `900` 后，旧结果立即失效；重新确认后 Work-time Equivalent 为 `14.40 小时`。
- dev 构建明确显示“未验证实现预览，不能导出”，导出按钮禁用；没有绕过 BuildIdentityGate。
- “暂不决定”与合成条件可记录；退出后页面只显示“当前页面内存已清除”，并明确已下载文件不可召回。
- 干净标签日志只有 Vite 连接 debug 与 React 开发提示，没有业务 warning/error。

## 视觉对照

最终桌面和 `390×844` 截图与批准概念同轮检查。实现保留了暖白背景、深绿重点、纸张式分区、清晰阶段层级和低刺激文案；窄屏内容单列排列、正文可读且无水平溢出。隐私入口比概念中的工作阶段更克制，先完整展示数据边界，符合首次进入门禁。概念图不是像素级规格，本 readback 不把视觉接近写成人工无障碍或产品验收。

## 尚缺门禁

- WebKit/Safari 的规则规范向量。
- Windows Chrome、macOS Safari、iOS Safari、macOS/iOS VoiceOver 和减少动态的人工支持矩阵。
- 固定目标设备上的 `3s / 100ms / 500ms / 1s` 性能预算。

上述缺口关闭前，`Prototype Accepted=false`、`Recruitment Authorized=false`，不得对参与者分发或公开发布。
