# AC / VAL 实施证据矩阵

状态：`原型验收证据闭环，待 Alune 明确批准 Prototype Accepted`

日期：`2026-08-28`（Asia/Shanghai）
OpenSpec：[`build-single-purchase-decision-workbench`](../../openspec/changes/archive/2026-08-28-build-single-purchase-decision-workbench/proposal.md)（38/38，`2026-08-28` 已归档）
实施基线：[`3c0af839da21c95cd35667c87cfee50f2dd00343`](../../evidence/implementation/baseline-2026-08-24.md)；上一 clean 候选 commit：`aff13047346cd4ceeba02299e13c3db5557fc165`；最终性能实现 commit：`0e1e38c2906b5aab0fa7c64add9d6c8e6dd7fc79`；3.9 规则规范向量证据 commit：`463cd72ba35a5119d0019fff011d1722ccf5647b`

本矩阵只记录 clean 候选可追溯的实施与验收证据。它不替代 PRD、ADR、OpenSpec spec 或 tasks，也不把 OpenSpec 批准、类型检查、静态检查或某一次测试计数单独当作原型验收。

当前验收汇总见 [`Prototype Accepted 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)：Vitest `137/137`、delivery `44/44`、当前 Chromium 桌面/移动 E2E `15 passed / 1 conditional skip`、19 个合成 fixture 的 76 个 case oracle/655 个结果 oracle/1 个 utility oracle、Chromium/WebKit 同 digest，以及 `SYN-02`/`SYN-04` 两组 JSON/Markdown 真实下载与离线内容核对均通过。3.9 规则规范向量、4.6 无障碍实现、目标设备人工矩阵、固定实验室性能和当前候选整单元回滚/关闭/恢复均已链接；本轮关键隐私/信任事件为 `0`，未发现 P1/P2 阻塞。

## 治理状态与判定规则

| 门禁 | 当前状态 | 证据 |
| --- | --- | --- |
| `PRD Approved` | 已通过 | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:484) |
| `Implementation Authorized` | 已通过 | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:489)、[`implementation baseline`](../implementation/baseline-2026-08-24.md:8) |
| `ADR-0001` / `ADR-0002` / `ADR-0003` | `Accepted` | [`PRD-0001 §10.2`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:552)、各 ADR 的验收表 |
| `Prototype Accepted` | `false` | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:490) |
| 研究协议 | `Draft`，未作为本 change 的实现证据 | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:15) |
| `Recruitment Authorized` | `false` | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:491) |

状态列使用以下判定：

- `已实现并自动验证`：已有可重复自动断言覆盖该行的核心合同，且没有仍属该行的人工/构建门禁。
- `已实现并自动/人工验证`：自动断言与指定人工/运行时 readback 共同覆盖该行合同。
- `已实现并人工验证` / `已人工验证`：该行主要依赖目标设备或人工可理解性证据，自动化只作补充。
- `部分验证`：已有实现、单元/组件/静态证据，但还缺集成重跑、独立终审、运行时或其他验收证据。
- `待人工验收`：自动检查只能作补充，必须在指定浏览器、设备、读屏或键盘路径人工核验。
- `被门禁阻塞`：存在当前硬门禁未通过或缺失，不能把局部证据当作该行通过。

“证据/命令”列中的命令是可复现入口，不表示本次矩阵写入时已经获得最终通过结论。没有注明 `通过` 的命令，父代理必须在最终收口时重跑并保留非敏感 readback。

## AC-01–AC-17、AC-20–AC-26

| ID | 当前状态 | 实际证据 / 命令 | 尚缺证据 | 任务映射 |
| --- | --- | --- | --- | --- |
| AC-01 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1)；[`App` 隐私边界测试](../../tests/app/workbench.test.tsx:309) | 无；隐私入口、目标设备可访问性/退出和 production 边界已核对 | 4.2、6.2、6.3、6.5、6.7 |
| AC-02 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 最小输入/确认测试](../../tests/app/workbench.test.tsx)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1) | 无；完整字段、状态、最小输入负担和桌面/移动主流程已核对 | 4.2、4.3、6.1、6.3 |
| AC-03 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 状态摘要测试](../../tests/app/workbench.test.tsx:116)；[`rule-vector readback`](../browser/rule-vector-readback-2026-08-24.md:1) | 无；确认/近似输入、状态传播和跨引擎一致性已闭合 | 3.2、3.6、4.3、6.1、6.3 |
| AC-04 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 覆盖错误关联测试](../../tests/app/workbench.test.tsx:136)；[`SYN-01` 基线](../fixtures/synthetic-fixture-baseline.md:12) | 无；完整/部分/未知覆盖、说明阻断和局部不足已闭合 | 1.3、4.3、4.4、6.1、6.3 |
| AC-05 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`calculation rules`](../../tests/domain/calculation/rules.test.ts:352)；[`currency fail-closed`](../../tests/domain/calculation/currency-table.test.ts:142) | 无；冲突、未知币种、不换算、不填默认值和修正路径已闭合 | 1.3、3.2、3.3、3.5、3.9、4.3、4.4 |
| AC-06 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`ADR-0002 VAL`](../../docs/adr/ADR-0002-calculation-and-rules.md:380)；[`rule-vector readback`](../browser/rule-vector-readback-2026-08-24.md:1) | 无；五项 UI 依据、单位、精度和舍入已逐项核对 | 1.3、3.4、3.5、3.6、3.9、4.4、6.1 |
| AC-07 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 局部结果测试](../../tests/app/workbench.test.tsx:96)；[`rules` 局部可用性](../../tests/domain/calculation/rules.test.ts:592) | 无；覆盖组合、原因优先级、依据和目标浏览器行为已闭合 | 1.3、3.5、3.6、3.9、4.4、6.1 |
| AC-08 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`SYN-04` 基线](../fixtures/synthetic-fixture-baseline.md:15)；[`App` 局部降级测试](../../tests/app/workbench.test.tsx:152) | 无；缺失/异常输入、局部不足、修正路径和离线导出已闭合 | 1.3、3.2、3.5、3.6、4.4、6.1 |
| AC-09 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`SYN-02` 基线](../fixtures/synthetic-fixture-baseline.md:13)；[`rules` margin tests](../../tests/domain/calculation/rules.test.ts:641) | 无；`4000/3000/-1000/16`、依赖状态和预测非承诺文案已核对 | 1.3、3.5、3.6、3.9、4.4、6.1 |
| AC-10 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 依据展开测试](../../tests/app/workbench.test.tsx)；[`workbench spec`](../../openspec/specs/purchase-decision-workbench/spec.md:93) | 无；五项结果的输入、公式、单位、周期、时间、假设、限制和修正路径已逐项展开核对 | 3.6、4.4、6.1、6.3 |
| AC-11 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`session reducer`](../../tests/domain/session/reducer.test.ts:106)；[`export stale`](../../tests/domain/export/export.test.ts:106) | 无；修改立即失效、取消不恢复、50/51 修订、退出/刷新不可恢复和导出 stale 已闭合 | 3.8、4.1、5.1、5.5、6.1、6.2 |
| AC-12 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 五种决定测试](../../tests/app/workbench.test.tsx:437)；[`session reducer`](../../tests/domain/session/reducer.test.ts:380) | 无；五种决定均实选核对，且不排序、不推荐、不催促 | 4.5、4.6、6.1、6.3 |
| AC-13 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 决定/复盘测试](../../tests/app/workbench.test.tsx:437)；[`workbench spec`](../../openspec/specs/purchase-decision-workbench/spec.md:135) | 无；产品外复盘、零提醒/研究记录和网络/存储/URL/console 边界已闭合 | 4.5、6.2、6.3 |
| AC-14 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`App` 退出清理测试](../../tests/app/workbench.test.tsx)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1) | 无；刷新/退出清理、当前候选整单元恢复和不可召回边界均有证据 | 3.8、4.1、4.2、6.2、6.3、6.6 |
| AC-15 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`scope guard`](../../tests/delivery/scope-guard.test.mjs:34)；[`dependency readback`](../supply-chain/dependency-readback.md:1)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1) | 无；clean artifact、身份 carrier、release headers、受控 LAN、网络/存储/console 和完整恢复均有证据；仍禁止公开 URL 和参与者分发 | 1.2、2.2、2.3、2.4、2.5、6.2、6.5、6.6 |
| AC-16 | 已人工验证 | [`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1)；[`App` 键盘焦点测试](../../tests/app/workbench.test.tsx)；[`accessibility implementation readback`](../browser/accessibility-implementation-readback-2026-08-24.md:1)；[`browser readback`](../browser/browser-readback.md:1)；`npm run test:e2e` | Alune 已在记录版本的 macOS/Windows Chrome、macOS Safari 与 iOS Safari 完成人工矩阵；自动化与 axe 仅作补充 | 4.6、6.2、6.3、6.7 |
| AC-17 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`implementation visual spec`](../design/implementation-spec.md:35)；[`accessibility readback`](../browser/accessibility-implementation-readback-2026-08-24.md:1) | 无；隐私、空/错输入、数据不足、负影响、失败、退出、导出与五种决定文案已核对，未发现羞辱/恐吓/催促/排名 | 4.5、4.6、6.1、6.3 |
| AC-20 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`fixture coverage`](../fixtures/coverage-matrix.json:1)；[`synthetic contract`](../../tests/fixtures/synthetic-contract.test.ts:34) | 无；五类状态、局部传播、研究层事件不传播和 UI 结果状态已闭合 | 1.3、3.6、3.9、4.4、6.1 |
| AC-21 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`session revisions`](../../tests/domain/session/reducer.test.ts:173)；[`export tests`](../../tests/domain/export/export.test.ts:36) | 无；`4000/3000/16`、修改失效、取消不恢复、重新确认和导出修订合同已闭合 | 1.3、3.5、3.8、5.1、5.5、6.1 |
| AC-22 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`export serializer`](../../tests/domain/export/export.test.ts:12)；[`fixture coverage`](../fixtures/coverage-matrix.json:1) | 无；`SYN-02`/`SYN-04` 的 JSON 与 Markdown 均已真实下载、关闭浏览器后离线解析并核对语义 | 1.3、5.1–5.8、6.1、6.2、6.3 |
| AC-23 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`download adapter`](../../tests/domain/export/download.test.ts:36)；[`export` 失败/限额测试](../../tests/domain/export/export.test.ts:73)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1) | 无；提示、取消、成功、失败、临时资源、网络/存储、退出和不可召回边界已闭合 | 4.1、4.6、5.6、5.7、5.8、6.2、6.3 |
| AC-24 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`SYN-05` 基线](../fixtures/synthetic-fixture-baseline.md:16)；[`conflict tests`](../../tests/domain/calculation/rules.test.ts:606) | 无；税前/税后、周期/币种冲突和“不自动转换”已闭合 | 1.3、3.3、3.5、3.6、3.9、4.4、6.1 |
| AC-25 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`scope guard`](../../tests/delivery/scope-guard.test.mjs:34)；[`preview policy`](../../tests/delivery/preview-policy.test.mjs:20)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1) | 无；loopback/受控 LAN、live headers、目标设备访问、停止和当前候选完整恢复已闭合；继续禁止参与者分发 | 1.2、2.2、2.3、2.4、6.2、6.5、6.6 |
| AC-26 | 已实现并自动验证 | [`最大会话性能 readback`](../browser/max-session-performance-readback-2026-08-28.md:1)；[`fixture coverage` 最大/边界声明](../fixtures/synthetic-fixture-baseline.md:14)；[`export resource limit tests`](../../tests/domain/export/export.test.ts:270)；`npm test -- --run tests/domain/export tests/domain/calculation/rules.test.ts` | 实现 commit 的 clean artifact 已在固定 MacBook Pro M3、loopback、实际 Chrome 与 WebKit 引擎上完成三轮 50×5 修订/64 KiB 最大会话，四项预算、资源上限与零外连均通过；不声称采集 Windows/iPhone 原始耗时 | 1.3、5.8、6.4、6.5、6.7 |

## 研究治理排除项：AC-18、AC-19、AC-27

这三项不是本 OpenSpec implementation 的实现范围，不能用原型测试或合成 fixture 伪装为已完成。它们继续作为 `Recruitment Authorized` 的门禁，当前状态均为 `被门禁阻塞`。

| ID | 当前状态 | 实际证据 / 命令 | 尚缺证据 | 任务映射 |
| --- | --- | --- | --- | --- |
| AC-18 | 被门禁阻塞 | [`PRD §8.1/§10.3`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:558)；[`scope guard` 明确排除研究对象](../../tests/delivery/scope-guard.test.mjs:34) | 产品外研究表 schema、合成演练、重识别风险复核和独立治理 readback；本 change 不创建研究存储或观察记录 | 1.2、6.7（仅治理追踪） |
| AC-19 | 被门禁阻塞 | [`PRD §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:15) 当前研究协议门禁未通过 | 产品外准入、正式同意/退出/撤回、双存储和删除 readback；原型内边界确认不能替代这些步骤 | 1.2、4.2、6.7（仅治理追踪） |
| AC-27 | 被门禁阻塞 | [`PRD §8.1 四道门禁`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:484)；[`implementation baseline`](../implementation/baseline-2026-08-24.md:8) | `Prototype Accepted` 先通过；再完成独立人类挑战、研究协议/操作控制/日历和 Alune 最终 readback | 6.6、6.7（仅治理追踪） |

## VAL-01–VAL-12

| VAL | 当前状态 | 实际证据 / 命令 | 尚缺证据 | 任务映射 |
| --- | --- | --- | --- | --- |
| VAL-01 锁定依赖并构建 | 已实现并自动验证 | [`toolchain lock readback`](../supply-chain/toolchain-lock-readback.md:1)；[`dependency readback`](../supply-chain/dependency-readback.md:1)；[`build-manifest tests`](../../tests/delivery/build-manifest.test.mjs:87)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；命令：`npm ci`、`npm run typecheck`、`npm run test:all`、`npm run build` | 本 VAL 的 clean 安装、测试、build、manifest 与摘要范围已闭合；不等于原型验收或完整回滚 | 2.1、2.2、2.4、2.5、6.5 |
| VAL-02 合成主流程和失败流程 | 已实现并自动验证 | [`App` 主流程测试](../../tests/app/workbench.test.tsx)；[`browser readback`](../browser/browser-readback.md:1)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；[`preview policy`](../../tests/delivery/preview-policy.test.mjs:96)；命令：`npm run test:e2e` | dev 与 production Chromium 的主流程/失败流程、headers、网络、Cookie、存储、URL、剪贴板、下载、console 和页面生命周期已闭合；正式跨浏览器支持另见 VAL-06 | 2.3、4.1、4.2、5.6、5.7、6.2 |
| VAL-03 loopback 与 LAN 模式 | 已实现并自动/人工验证 | [`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1)；[`whole-unit rollback readback`](../rollback/whole-unit-rollback-readback-2026-08-27.md:1)；[`preview policy tests`](../../tests/delivery/preview-policy.test.mjs:20)；命令：`npm run preview`、`npm run preview:lan` | clean loopback、strictPort、live headers、受控私有 LAN 目标设备、停止和完整恢复均通过；无公共 URL 或长期服务 | 2.3、6.2、6.3、6.6 |
| VAL-04 PRD 合成状态矩阵 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`calculation rules`](../../tests/domain/calculation/rules.test.ts:592)；[`synthetic contract`](../../tests/fixtures/synthetic-contract.test.ts:34)；[`App` 局部不足/状态测试](../../tests/app/workbench.test.tsx:152) | 无；`SYN-01`–`SYN-05`、五类状态、局部降级、研究/system actual 隔离和 UI readback 已闭合 | 1.3、3.6、3.9、4.3、4.4、6.1 |
| VAL-05 导出与失败路径 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`export serializer`](../../tests/domain/export/export.test.ts:12)；[`download adapter`](../../tests/domain/export/download.test.ts:36)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1) | 无；两场景双格式实际下载、离线语义、取消/失败、临时资源、网络/存储和目标设备反馈均已闭合 | 5.1–5.8、6.1、6.2、6.3 |
| VAL-06 正式支持矩阵 | 已人工验证 | [`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1)；[`workbench accessibility tests`](../../tests/app/workbench.test.tsx)；[`accessibility implementation readback`](../browser/accessibility-implementation-readback-2026-08-24.md:1)；`npm run test:e2e` | Alune 已确认记录版本的 macOS/Windows Chrome、macOS Safari、iOS Safari、桌面键盘、macOS/iOS VoiceOver、焦点、状态、错误、窄屏和减少动态均通过；自动化只作补充 | 4.6、6.3、6.7 |
| VAL-07 固定实验室性能配置 | 已实现并自动验证 | [`最大会话性能 readback`](../browser/max-session-performance-readback-2026-08-28.md:1)；[`fixture baseline`](../fixtures/synthetic-fixture-baseline.md:14)；[`export resource limit tests`](../../tests/domain/export/export.test.ts:270)；命令：固定设备最大会话性能 harness | 最终实现 commit 的 clean artifact 在固定设备/loopback、实际 Chrome 与 WebKit 引擎三轮最大会话中满足 `3s/100ms/500ms/1s`，无外部请求或真实遥测 | 1.3、5.8、6.4、6.7 |
| VAL-08 停止与恢复演练 | 已实现并自动验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`session lifecycle tests`](../../tests/domain/session/lifecycle.test.ts:23)；[`历史 whole-unit readback`](../rollback/whole-unit-rollback-readback-2026-08-27.md:1) | `0e1e38c` 撤下、`e27c3e2` 完整恢复/E2E、当前候选全新 clean clone 恢复/E2E、最终关端口与不可召回边界已闭合 | 2.3、3.8、4.1、5.7、5.8、6.6 |
| VAL-09 限额与确定性 | 已实现并自动验证 | [`最大会话性能 readback`](../browser/max-session-performance-readback-2026-08-28.md:1)；[`calculation limit/rounding tests`](../../tests/domain/calculation/rules.test.ts:352)；[`export resource limit tests`](../../tests/domain/export/export.test.ts:270)；[`fixture contract`](../../tests/fixtures/synthetic-contract.test.ts:249)；[`rule-vector readback`](../browser/rule-vector-readback-2026-08-24.md:1)；命令：`npm test -- --run tests/domain/calculation/rules.test.ts tests/domain/export/export.test.ts tests/fixtures/synthetic-contract.test.ts` | fixture、精确计算、跨引擎规则向量、导出限额、50×5 修订与 64 KiB 最大会话均通过 | 1.3、3.2、3.4、3.9、5.8、6.4 |
| VAL-10 最大会话跨浏览器/VoiceOver | 已人工验证 | [`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1)；[`session revision limit tests`](../../tests/domain/session/reducer.test.ts:323)；[`download adapter tests`](../../tests/domain/export/download.test.ts:124)；命令：固定矩阵浏览器人工流程 | Alune 已确认目标 Chrome/Safari、键盘、窄屏与 VoiceOver 路径可完成；最大修订和导出资源边界由自动测试/性能 readback 补充，不替代人工可理解性 | 3.8、4.6、5.8、6.3 |
| VAL-11 断网和 API/存储/console 检查 | 已实现并自动/人工验证 | [`Prototype 候选 readback`](./prototype-acceptance-readback-2026-08-28.md:1)；[`scope guard`](../../tests/delivery/scope-guard.test.mjs:34)；[`人工支持矩阵`](../browser/manual-support-matrix-2026-08-28.md:1)；[`rule-vector readback`](../browser/rule-vector-readback-2026-08-24.md:1)；[`runtime source policy`](../../tests/delivery/preview-policy.test.mjs:96) | 无；production Chromium 实际下载链、跨引擎离线规则、目标设备人工流程和静态边界共同证明外部请求/持久化/敏感 URL/clipboard/console 为零 | 1.2、2.3、4.1、5.7、6.2、6.6 |
| VAL-12 版本、产物和供应链审查 | 已实现并自动验证 | [`dependency readback`](../supply-chain/dependency-readback.md:1)；[`build-manifest tests`](../../tests/delivery/build-manifest.test.mjs:87)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；[`whole-unit rollback readback`](../rollback/whole-unit-rollback-readback-2026-08-27.md:1)；[`scope guard`](../../tests/delivery/scope-guard.test.mjs:34)；命令：`npm run check:dependencies`、`npm run check:artifact`、`npm run build` | clean artifact、manifest/载荷摘要、preview guard、Node/npm/lock/config/rules/currency/schema/format 和上一完整交付单元恢复已闭合；不等于 `Prototype Accepted` | 2.2、2.4、2.5、5.8、6.5、6.6 |

## 当前剩余门禁

OpenSpec 38/38 已归档；原型验收组 AC-01–AC-17、AC-20–AC-26 的证据、关键隐私/信任事件 `0` 记录，以及当前候选的回滚、关闭和恢复均已闭环。当前唯一剩余的 `Prototype Accepted` 步骤是 Alune 查看 readback 与 diff 后明确批准该门禁。

OpenSpec 完成与归档不自动改变上位研究门禁：`Prototype Accepted=false`、研究协议仍非 `Accepted`、`Recruitment Authorized=false`；不得招募、向参与者分发、公开发布或把本地原型描述为正式产品。
