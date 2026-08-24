# AC / VAL 实施证据矩阵

状态：`实施中，尚未达到 Prototype Accepted`

日期：`2026-08-24`（Asia/Shanghai）
OpenSpec：[`build-single-purchase-decision-workbench`](../../openspec/changes/build-single-purchase-decision-workbench/proposal.md)
实施基线：[`3c0af839da21c95cd35667c87cfee50f2dd00343`](../../evidence/implementation/baseline-2026-08-24.md)；clean 候选 commit：`aff13047346cd4ceeba02299e13c3db5557fc165`

本矩阵只记录 clean 候选可追溯的实施证据和仍缺的验收证据。它不替代 PRD、ADR、OpenSpec spec 或 tasks，也不把 OpenSpec 批准、类型检查、静态检查或某一次测试计数当作原型验收。

当前自动化 readback 已覆盖：Vitest `129/129`、delivery `44/44`、dev 与 production Playwright Chromium 桌面/窄屏各 `10/10`，以及 19 个合成 fixture 的 76 个 case oracle、655 个结果 oracle 和 1 个 utility oracle；其中包含 `SYN-02`、`SYN-04` 与 malicious export chain 的 freeze/JSON/Markdown/跨格式/decode 回放。clean build、manifest、产物扫描和 live headers 见 [`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)。导出合同与 fixture 合同的最终只读终审已完成，已发现的问题均已修复并纳入自动链路，未发现 P1/P2 阻塞。

## 治理状态与判定规则

| 门禁 | 当前状态 | 证据 |
| --- | --- | --- |
| `PRD Approved` | 已通过 | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:484) |
| `Implementation Authorized` | 已通过 | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:489)、[`implementation baseline`](../implementation/baseline-2026-08-24.md:8) |
| `ADR-0001` / `ADR-0002` / `ADR-0003` | `Accepted` | [`PRD-0001 §10.2`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:552)、各 ADR 的验收表 |
| `Prototype Accepted` | `false` | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:490) |
| 研究协议 | `Draft`，未作为本 change 的实现证据 | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:15) |
| `Recruitment Authorized` | `false` | [`PRD-0001 §8.1`](../../docs/product/prd/PRD-0001-single-purchase-decision-workbench.md:491) |

状态列只使用以下四个值：

- `已实现并自动验证`：已有可重复自动断言覆盖该行的核心合同，且没有仍属该行的人工/构建门禁。
- `部分验证`：已有实现、单元/组件/静态证据，但还缺集成重跑、独立终审、运行时或其他验收证据。
- `待人工验收`：自动检查只能作补充，必须在指定浏览器、设备、读屏或键盘路径人工核验。
- `被门禁阻塞`：存在当前硬门禁未通过或缺失，不能把局部证据当作该行通过。

“证据/命令”列中的命令是可复现入口，不表示本次矩阵写入时已经获得最终通过结论。没有注明 `通过` 的命令，父代理必须在最终收口时重跑并保留非敏感 readback。

## AC-01–AC-17、AC-20–AC-26

| ID | 当前状态 | 实际证据 / 命令 | 尚缺证据 | 任务映射 |
| --- | --- | --- | --- | --- |
| AC-01 | 部分验证 | [`App` 隐私边界测试](../../tests/app/workbench.test.tsx:309)；[`browser readback`](../browser/browser-readback.md:1)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；`npm run typecheck` | 目标浏览器可访问性树、受控 LAN 会话前后的人工 readback；不能用 Chromium 自动结果代替全部运行证据 | 4.2、6.2、6.3、6.5、6.7 |
| AC-02 | 部分验证 | [`App` 最小输入/确认测试](../../tests/app/workbench.test.tsx)；[`browser readback`](../browser/browser-readback.md:1)；[`workbench spec`](../../openspec/changes/build-single-purchase-decision-workbench/specs/purchase-decision-workbench/spec.md:56)；`npm test -- --run tests/app/workbench.test.tsx` | 桌面/移动实际流程、完整字段标签和人工可理解性；Chromium 自动流程已执行，仍需独立人工/跨浏览器 readback | 4.2、4.3、6.1、6.3 |
| AC-03 | 部分验证 | [`App` 状态摘要测试](../../tests/app/workbench.test.tsx:116)；[`calculation rules tests`](../../tests/domain/calculation/rules.test.ts:336)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；`npm test -- --run tests/app/workbench.test.tsx tests/domain/calculation/rules.test.ts` | 全部确认/近似输入的端到端确认路径、人工状态文案和跨浏览器一致性 | 3.2、3.6、4.3、6.1、6.3 |
| AC-04 | 部分验证 | [`App` 固定成本覆盖错误关联测试](../../tests/app/workbench.test.tsx:136)；[`SYN-01` fixture 基线](../fixtures/synthetic-fixture-baseline.md:12)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1) | 完整/部分/未知覆盖的人工路径、完整覆盖说明为空时的实际阻断，以及目标浏览器辅助技术反馈 | 1.3、4.3、4.4、6.1、6.3 |
| AC-05 | 部分验证 | [`calculation rules` 输入边界测试](../../tests/domain/calculation/rules.test.ts:352)；[`currency table` fail-closed 测试](../../tests/domain/calculation/currency-table.test.ts:142)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；`npm test -- --run tests/domain/calculation/rules.test.ts tests/domain/calculation/currency-table.test.ts` | fixture 结果/原因矩阵已完成终审；仍缺组件级修正路径、跨浏览器规范向量和人工确认不换算/不填默认值 | 1.3、3.2、3.3、3.5、3.9、4.3、4.4 |
| AC-06 | 部分验证 | [`calculation rules` 精确舍入测试](../../tests/domain/calculation/rules.test.ts:482)；[`SYN-01` fixture 基线](../fixtures/synthetic-fixture-baseline.md:12)；[`ADR-0002 VAL-01/02/05/07`](../../docs/adr/ADR-0002-calculation-and-rules.md:380)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1) | 计算/fixture 终审已完成；仍缺 UI 人工查看依据和 WebKit/Safari 规范向量；不得把历史测试计数当永久证据 | 1.3、3.4、3.5、3.6、3.9、4.4、6.1 |
| AC-07 | 部分验证 | [`App` 固定成本局部结果测试](../../tests/app/workbench.test.tsx:96)；[`calculation rules` 局部可用性测试](../../tests/domain/calculation/rules.test.ts:592)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；`npm test -- --run tests/app/workbench.test.tsx tests/domain/calculation/rules.test.ts` | 覆盖状态全组合、原因优先级的独立终审、人工文案/依据检查和目标浏览器行为 | 1.3、3.5、3.6、3.9、4.4、6.1 |
| AC-08 | 部分验证 | [`App` 缺失工时局部降级测试](../../tests/app/workbench.test.tsx:152)；[`SYN-04` fixture 基线](../fixtures/synthetic-fixture-baseline.md:15)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；`npm test -- --run tests/app/workbench.test.tsx tests/domain/calculation/rules.test.ts` | 逐字段缺失/异常组合的独立复审，及人工修正路径和辅助技术反馈 | 1.3、3.2、3.5、3.6、4.4、6.1 |
| AC-09 | 部分验证 | [`SYN-02` fixture 基线](../fixtures/synthetic-fixture-baseline.md:13)；[`calculation rules` margin tests](../../tests/domain/calculation/rules.test.ts:641)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；`npm test -- --run tests/domain/calculation/rules.test.ts` | `SYN-02` 完整结果/状态/依赖的独立复审、结果依据人工复核和跨浏览器运行证据；不把预测写成承诺 | 1.3、3.5、3.6、3.9、4.4、6.1 |
| AC-10 | 部分验证 | [`App` 依据展开测试](../../tests/app/workbench.test.tsx)；[`browser readback`](../browser/browser-readback.md:1)；[`workbench spec` 依据要求](../../openspec/changes/build-single-purchase-decision-workbench/specs/purchase-decision-workbench/spec.md:138)；`npm test -- --run tests/app/workbench.test.tsx` | 所有五项结果的输入/公式/单位/周期/时间/假设/限制人工逐项 readback，跨浏览器和读屏顺序 | 3.6、4.4、6.1、6.3 |
| AC-11 | 部分验证 | [`session reducer` 失效/取消/修订测试](../../tests/domain/session/reducer.test.ts:106)；[`session lifecycle` 测试](../../tests/domain/session/lifecycle.test.ts:23)；[`export` stale 测试](../../tests/domain/export/export.test.ts:106)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1) | App、计算和导出三层独立终审；刷新/关闭真实页面不可恢复；50/51 修订与最终导出字段的人工复核 | 3.8、4.1、5.1、5.5、6.1、6.2 |
| AC-12 | 部分验证 | [`App` 五种决定测试](../../tests/app/workbench.test.tsx:437)；[`session reducer` 决定测试](../../tests/domain/session/reducer.test.ts:380)；[`browser readback`](../browser/browser-readback.md:1)；`npm test -- --run tests/app/workbench.test.tsx tests/domain/session/reducer.test.ts` | 五种决定的桌面/移动/键盘人工路径、低刺激文案审查，以及不排序/不推荐的最终 readback | 4.5、4.6、6.1、6.3 |
| AC-13 | 部分验证 | [`App` 决定与产品外复盘条件测试](../../tests/app/workbench.test.tsx:437)；[`browser readback`](../browser/browser-readback.md:1)；[`workbench spec` 复盘边界](../../openspec/changes/build-single-purchase-decision-workbench/specs/purchase-decision-workbench/spec.md:185) | 真实页面网络/存储/URL/日志检查和产品外人工交接边界；不创建研究记录或提醒的浏览器证据已形成，仍需人工复核 | 4.5、6.2、6.3 |
| AC-14 | 部分验证 | [`App` 退出清理测试](../../tests/app/workbench.test.tsx)；[`session reducer` 清理测试](../../tests/domain/session/reducer.test.ts:459)；[`browser readback`](../browser/browser-readback.md:1)；[`rollback readback`](../rollback/first-withdrawal-readback.md:1) | production Chromium 已覆盖刷新、退出与持久状态 readback；仍缺完整版本恢复和已下载文件边界的人工确认 | 3.8、4.1、4.2、6.2、6.3、6.6 |
| AC-15 | 部分验证 | [`scope guard` 交付测试](../../tests/delivery/scope-guard.test.mjs:34)；[`dependency readback`](../supply-chain/dependency-readback.md:1)；[`browser readback`](../browser/browser-readback.md:1)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；`npm run scope:check`、`npm run check:dependencies` | clean artifact、manifest、release headers，以及 Chromium 网络/存储/console 与临时预览终端输出边界已核验；仍缺托管访问日志生命周期、WebKit/跨浏览器、受控 LAN 人工 readback 和完整恢复演练 | 1.2、2.2、2.3、2.4、2.5、6.2、6.5、6.6 |
| AC-16 | 待人工验收 | [`App` 键盘焦点测试](../../tests/app/workbench.test.tsx)；[`browser readback`](../browser/browser-readback.md:1)；[`OpenSpec 支持矩阵要求`](../../openspec/changes/build-single-purchase-decision-workbench/design.md:170)；`npm test -- --run tests/app/workbench.test.tsx` | 记录版本的 macOS/Windows Chrome、macOS Safari、iOS Safari，桌面键盘、macOS/iOS VoiceOver、窄屏和减少动态的人工记录；Chromium/axe 自动化不能替代这些结论 | 4.6、6.2、6.3、6.7 |
| AC-17 | 部分验证 | [`implementation visual spec` 低刺激文案边界](../design/implementation-spec.md:35)；[`App` 决定测试](../../tests/app/workbench.test.tsx:437)；[`browser readback`](../browser/browser-readback.md:1)；`npm test -- --run tests/app/workbench.test.tsx` | 全部用户可见文案的人工清单审查，含数据不足、失败、退出、导出和负余量文本；不能只由组件存在断言代替 | 4.5、4.6、6.1、6.3 |
| AC-20 | 部分验证 | [`synthetic fixture coverage`](../fixtures/coverage-matrix.json:1)；[`synthetic contract tests`](../../tests/fixtures/synthetic-contract.test.ts:34)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；[`calculation rules` 状态测试](../../tests/domain/calculation/rules.test.ts:592)；`npm test -- --run tests/fixtures/synthetic-contract.test.ts tests/domain/calculation/rules.test.ts` | 自动回放与导出合同终审已完成；仍缺研究层事件不传播的人工集成复核和 UI 断言 | 1.3、3.6、3.9、4.4、6.1 |
| AC-21 | 部分验证 | [`SYN-02` fixture 基线](../fixtures/synthetic-fixture-baseline.md:13)；[`session reducer` revision tests](../../tests/domain/session/reducer.test.ts:173)；[`export` SYN-style tests](../../tests/domain/export/export.test.ts:36)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1) | 购买周期取消后的跨浏览器人工 UI/导出复核、4000/3000/16 的独立复审、stale/重新确认人工路径 | 1.3、3.5、3.8、5.1、5.5、6.1 |
| AC-22 | 部分验证 | [`export serializer tests`](../../tests/domain/export/export.test.ts:12)；[`download adapter tests`](../../tests/domain/export/download.test.ts:36)；[`fixture coverage`](../fixtures/coverage-matrix.json:1)；[`browser readback`](../browser/browser-readback.md:1)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；`npm test -- --run tests/domain/export` | 导出 domain/UI、clean Chromium 合成链与独立合同终审已完成；仍缺跨格式人工离线审查与非 Chromium 运行证据；不能宣称两格式人工验收已通过 | 1.3、5.1–5.8、6.1、6.2、6.3 |
| AC-23 | 部分验证 | [`download adapter` 状态/清理测试](../../tests/domain/export/download.test.ts:36)；[`export` 失败/Unicode/资源限额测试](../../tests/domain/export/export.test.ts:73)；[`browser readback`](../browser/browser-readback.md:1)；[`session-snapshot-export spec` 预览边界](../../openspec/changes/build-single-purchase-decision-workbench/specs/session-snapshot-export/spec.md:124) | Chromium 自动化已覆盖取消、失败、临时资源、网络/存储和下载链；读屏、设备保存、跨格式人工审查及完整回滚仍待证据 | 4.1、4.6、5.6、5.7、5.8、6.2、6.3 |
| AC-24 | 部分验证 | [`SYN-05` fixture 基线](../fixtures/synthetic-fixture-baseline.md:16)；[`calculation conflict tests`](../../tests/domain/calculation/rules.test.ts:606)；[`currency table tests`](../../tests/domain/calculation/currency-table.test.ts:142)；`npm test -- --run tests/domain/calculation/rules.test.ts tests/domain/calculation/currency-table.test.ts` | 税前/税后与周期/币种冲突的最终计算终审、结果卡片文案和人工确认“不自动转换” | 1.3、3.3、3.5、3.6、3.9、4.4、6.1 |
| AC-25 | 部分验证 | [`scope guard`](../../tests/delivery/scope-guard.test.mjs:34)；[`preview policy tests`](../../tests/delivery/preview-policy.test.mjs:20)；[`browser readback`](../browser/browser-readback.md:1)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；`npm run scope:check`、`npm run test:delivery` | 默认 loopback artifact、live headers 和临时预览终端输出边界已核验；仍缺托管访问日志生命周期、受控 LAN 的目标设备/网络 readback 和完整恢复演练，继续禁止参与者分发 | 1.2、2.2、2.3、2.4、6.2、6.5、6.6 |
| AC-26 | 被门禁阻塞 | [`fixture coverage` 最大/边界声明](../fixtures/synthetic-fixture-baseline.md:14)；[`export resource limit tests`](../../tests/domain/export/export.test.ts:270)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；`npm test -- --run tests/domain/export tests/domain/calculation/rules.test.ts` | 记录目标设备、网络、最大合成会话和四项耗时（`3s/100ms/500ms/1s`）的性能报告；不能把本机自动测试、Chromium 结果或未记录设备当作 AC-26 | 1.3、5.8、6.4、6.5、6.7 |

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
| VAL-03 loopback 与 LAN 模式 | 部分验证 | [`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；[`browser readback`](../browser/browser-readback.md:1)；[`rollback readback`](../rollback/first-withdrawal-readback.md:1)；[`preview policy tests`](../../tests/delivery/preview-policy.test.mjs:20)；命令：`npm run preview`、`npm run preview:lan` | clean loopback、strictPort、live headers 与停止已通过；仍缺受控 LAN 的实际目标设备/网络/日志边界和完整恢复演练 | 2.3、6.2、6.3、6.6 |
| VAL-04 PRD 合成状态矩阵 | 部分验证 | [`calculation rules`](../../tests/domain/calculation/rules.test.ts:592)；[`synthetic contract`](../../tests/fixtures/synthetic-contract.test.ts:34)；[`App` 局部不足/状态测试](../../tests/app/workbench.test.tsx:152)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；命令：`npm test -- --run tests/domain/calculation tests/fixtures/synthetic-contract.test.ts tests/app/workbench.test.tsx` | 自动回放与导出合同终审已覆盖状态/fixture oracle；仍缺研究/system actual 隔离的人工集成复核和手工界面断言 | 1.3、3.6、3.9、4.3、4.4、6.1 |
| VAL-05 导出与失败路径 | 部分验证 | [`export serializer`](../../tests/domain/export/export.test.ts:12)；[`download adapter`](../../tests/domain/export/download.test.ts:36)；[`browser readback`](../browser/browser-readback.md:1)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；命令：`npm test -- --run tests/domain/export` | 导出 domain/UI/clean Chromium 合成链与独立合同终审已完成；仍缺跨格式人工离线审查和 WebKit/设备失败清理 | 5.1–5.8、6.1、6.2、6.3 |
| VAL-06 正式支持矩阵 | 待人工验收 | [`workbench accessibility tests`](../../tests/app/workbench.test.tsx)；[`browser readback`](../browser/browser-readback.md:1)；[`OpenSpec 支持矩阵要求`](../../openspec/changes/build-single-purchase-decision-workbench/design.md:170)；命令：`npm test -- --run tests/app/workbench.test.tsx` | 记录实际版本的 macOS/Windows Chrome、macOS Safari、iOS Safari，桌面键盘、macOS/iOS VoiceOver、焦点、状态、错误和减少动态人工证据；Chromium 自动化只能作补充 | 4.6、6.3、6.7 |
| VAL-07 固定实验室性能配置 | 被门禁阻塞 | [`fixture baseline` 说明固定最大会话边界](../fixtures/synthetic-fixture-baseline.md:14)；[`export resource limit tests`](../../tests/domain/export/export.test.ts:270)；命令（待执行）：固定目标设备上的性能 harness | 尚无目标设备/网络/最大会话的报告，缺少 `3s/100ms/500ms/1s` 四项实际测量；不能用开发机瞬时结果替代 | 1.3、5.8、6.4、6.7 |
| VAL-08 停止与恢复演练 | 被门禁阻塞 | [`session lifecycle tests`](../../tests/domain/session/lifecycle.test.ts:23)；[`rollback readback`](../rollback/first-withdrawal-readback.md:1)；[`static preview readback`](../delivery/static-preview-readback.md:1)；命令：`npm run preview` 后显式停止并复核端口 | 首次撤下/端口关闭已有局部 readback；仍缺浏览器/终端/工作目录清理、上一份完整构建单元恢复和重新 readback；已下载文件不可召回的人工记录 | 2.3、3.8、4.1、5.7、5.8、6.6 |
| VAL-09 限额与确定性 | 部分验证 | [`calculation limit/rounding tests`](../../tests/domain/calculation/rules.test.ts:352)；[`export resource limit tests`](../../tests/domain/export/export.test.ts:270)；[`fixture contract`](../../tests/fixtures/synthetic-contract.test.ts:249)；[`final automated readback`](../implementation/final-automated-readback-2026-08-24.md:1)；命令：`npm test -- --run tests/domain/calculation/rules.test.ts tests/domain/export/export.test.ts tests/fixtures/synthetic-contract.test.ts` | fixture、计算自动回放与导出合同终审已完成；仍缺目标设备性能上限、跨浏览器规范向量和最大会话运行证据 | 1.3、3.2、3.4、3.9、5.8、6.4 |
| VAL-10 最大会话跨浏览器/VoiceOver | 待人工验收 | [`session revision limit tests`](../../tests/domain/session/reducer.test.ts:323)；[`download adapter tests`](../../tests/domain/export/download.test.ts:124)；命令：固定矩阵浏览器人工流程 | macOS/Windows Chrome、macOS Safari、iOS Safari、键盘与 VoiceOver 的 50 修订/导出路径；自动测试不能替代人工可理解性 | 3.8、4.6、5.8、6.3 |
| VAL-11 断网和 API/存储/console 检查 | 部分验证 | [`scope guard`](../../tests/delivery/scope-guard.test.mjs:34)；[`browser readback`](../browser/browser-readback.md:1)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；[`runtime source policy`](../../tests/delivery/preview-policy.test.mjs:96)；[`session cleanup tests`](../../tests/domain/session/reducer.test.ts:459)；命令：`npm run scope:check`、Browser 断网主流程 | clean Chromium 已覆盖 network/storage/URL/clipboard/console、导出路径与临时预览终端输出边界；仍缺托管访问日志生命周期、WebKit/跨浏览器及人工设备记录 | 1.2、2.3、4.1、5.7、6.2、6.6 |
| VAL-12 版本、产物和供应链审查 | 部分验证 | [`dependency readback`](../supply-chain/dependency-readback.md:1)；[`build-manifest tests`](../../tests/delivery/build-manifest.test.mjs:87)；[`clean release readback`](../delivery/clean-release-readback-2026-08-24.md:1)；[`rollback readback`](../rollback/first-withdrawal-readback.md:1)；[`scope guard`](../../tests/delivery/scope-guard.test.mjs:34)；命令：`npm run check:dependencies`、`npm run check:artifact`、`npm run build` | clean artifact、manifest/载荷摘要、preview guard 及 Node/npm/lock/config/rules/currency/schema/format 已完成；仍缺上一份已接受完整交付单元的恢复与重新 readback | 2.2、2.4、2.5、5.8、6.5、6.6 |

## 当前剩余门禁

clean build、manifest、live loopback headers、production Chromium 和首次停止已经形成证据。后续仍需：

1. WebKit/Safari 规则规范向量；在完成前 OpenSpec 3.9 保持未完成。
2. 记录版本的 Windows Chrome、macOS Safari、iOS Safari、macOS/iOS VoiceOver、键盘与减少动态人工矩阵；在完成前 4.6、6.3、AC-16、VAL-06/10 保持待人工验收。
3. 固定目标设备、网络和最大合成会话的 `3s/100ms/500ms/1s` 性能报告；在完成前 6.4、AC-26、VAL-07 保持被门禁阻塞。
4. 在存在上一份已接受完整交付单元后，演练发布、撤下、恢复和重新 readback，并人工确认已下载文件不可召回边界；在完成前 6.6、VAL-08 不得闭环。

在这些证据补齐并由 Alune 完成最终 readback 前，`Prototype Accepted=false`、研究协议仍非 `Accepted`、`Recruitment Authorized=false`；不得招募、分发、公开发布或把本地原型描述为正式产品。
