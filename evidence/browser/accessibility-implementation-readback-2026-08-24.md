# OpenSpec 4.6 无障碍实现 readback

日期：`2026-08-24`（Asia/Shanghai）
OpenSpec：[`build-single-purchase-decision-workbench`](../../openspec/changes/build-single-purchase-decision-workbench/proposal.md)
任务：`4.6` 响应式、键盘、焦点、ARIA、VoiceOver 可解释语义与 `prefers-reduced-motion` 实现

## 判定边界

本记录只证明任务 4.6 的实现和自动化/本机浏览器回归已经完成。它不等于记录版本的 macOS/Windows Chrome、macOS Safari、iOS Safari、macOS/iOS VoiceOver 人工支持矩阵；该人工验收仍由任务 6.3 单独约束。当前工作树未形成 clean release artifact，也未改变 `Prototype Accepted=false`、研究协议非 `Accepted`、`Recruitment Authorized=false`。

## 实现 readback

- 表单控件使用明确的可访问名称；“必填/可选”视觉提示不再污染名称。原生 `required`、`aria-invalid` 与 `aria-describedby` 将字段提示和错误关联到实际需要修正的控件。
- 自定义周期名称和四项 evidence 状态使用独立错误键；提交失败时只产生一个汇总 alert，并把焦点移到第一项实际错误。逐项修正不会反复抢夺焦点。
- 四阶段导航同时提供“当前阶段/已完成/未开始”文本和 `aria-current="step"`；阶段切换、返回修改、决定/复盘错误、退出及导出预览/取消/下载请求/失败均有稳定焦点落点。
- 结果、决定、复盘、导出和退出的状态均有文字表达；导出状态不再暴露原始英文内部状态值。状态与错误不只依赖颜色、位置或动画。
- `320px` 窄屏下阶段导航、表单、结果、决定、复盘、导出与退出均无水平溢出；减少动态偏好会把非必要 transition/animation 降到近零，同时保留状态文本。

## 自动与浏览器证据

- `npm test -- --pool=forks --maxWorkers=1`：13 个测试文件、`136/136` 通过。
- `npm run test:e2e`：16 个 Chromium 桌面/移动用例中 `15 passed`、`1 skipped`；跳过项是桌面项目对仅在 `chromium-mobile` 执行的 `320px` 全状态重复用例，移动项目已实际执行并通过。
- E2E 覆盖键盘主流程、字段错误聚焦、阶段文本状态、依据展开、决定与复盘、导出焦点、退出、`320px` 全阶段无溢出、`prefers-reduced-motion`、axe 和浏览器持久化/console 边界。
- 应用内 Browser 在 `1280px` 与 `320px` 本机视口复核了可访问名称、空表单错误焦点、阶段焦点、合成主流程、导出禁用边界、退出与无水平溢出；未观察到 console warning/error 或遮挡交互的 overlay。
- `npm run typecheck`、`npm run test:delivery`（`44/44`）、`npm run scope:check`（`SCOPE_GUARD_PASS files=77 skipped=4`）、`npx openspec validate build-single-purchase-decision-workbench --strict` 和 `git diff --check` 均通过。

## 未关闭门禁

1. OpenSpec 6.3：在记录实际版本的 Windows Chrome、macOS Safari、iOS Safari、macOS/iOS VoiceOver 上完成人工键盘、焦点、状态、错误、敏感提示、窄屏和减少动态矩阵；自动 Chromium/axe 只能作补充。
2. OpenSpec 6.4：固定目标设备、网络和最大合成会话的 `3s/100ms/500ms/1s` 性能报告。
3. OpenSpec 6.6：存在上一份已接受完整交付单元后，执行完整恢复和重新 readback。

在这些门禁完成并获 Alune 最终 readback 前，不得向参与者分发、部署、招募或把本地原型描述为正式产品。
