# 合成 fixture / evidence 基线

状态：`已实施并自动验证`。本目录记录已归档 OpenSpec `build-single-purchase-decision-workbench` 的 task 1.3 声明式证据基线；它不是 `Prototype Accepted`、研究授权或运行时验收结论。

唯一测试数据入口是 [`tests/fixtures/synthetic/manifest.json`](../../tests/fixtures/synthetic/manifest.json)。每个会话 fixture 都有稳定的 `fixture_id`、非敏感 `evidence_label`、输入/边界描述、五项结果（可用时含精确值与展示值，不可用时为 `null`）、`evidence_status`、`primary_reason_code`、去重后的 `reason_codes` 以及 JSON/Markdown 导出语义；舍入 tie 与 129 位 rational 上限另作为 utility-only fixture，不伪装成五项财务结果、purchase-impact 或导出快照。

## 覆盖矩阵

| 组别 | fixture | 核心断言 |
| --- | --- | --- |
| 核心 | `SYN-01` | 收入速率 `62.5 → 62.50 CNY/小时`、工作时间等价 `16 → 16.00 小时`；无固定成本的余量显式数据不足 |
| 核心 | `SYN-02` | 基线余量 `4000 CNY user-confirmed`、购买后余量 `3000 CNY forecast`、购买影响 `-1000 CNY forecast`；两种导出共享冻结快照 |
| 核心 | `SYN-03` | 估算工时/固定成本传播为 `estimated`；未来情景仍为 `forecast` |
| 核心 | `SYN-04` | 缺少工时只使直接依赖项 `insufficient-data`；其余安全结果保留 |
| 核心 | `SYN-05` | 税前口径保留收入速率和工作时间等价；税后余量路径以 `tax-basis-not-after-tax` 停止 |
| 数值边界 | `EDGE-EMPTY`, `EDGE-ZERO`, `EDGE-NEGATIVE`, `EDGE-LIMITS` | 空、零、负数、上限和超限均不猜测、不截断、不填零 |
| 币种/上下文 | `EDGE-MINOR-UNIT`, `EDGE-PERIOD-CONFLICT`, `EDGE-CURRENCY-CONFLICT`, `EDGE-TAX-BASIS-CONFLICT` | 固定 minor unit（含 CLF 4 位与 XAU/N.A.）、周期 revision、币种和税口径冲突 fail-closed，不换汇、不跨期 |
| 展示 | `EDGE-ROUNDING-TIES`, `EDGE-NEGATIVE-MARGIN` | tie 是 utility 向量；正负 `half-away-from-zero`、非零小工时、低于零余量都保留精确语义 |
| 导出安全 | `EDGE-MARKDOWN-UNICODE`, `EDGE-UNICODE-REJECT` | 恶意 Markdown 仅字面显示；NUL/孤立 surrogate 同时阻止两种格式 |
| 生命周期/故障 | `EDGE-REVISION-LIMIT`, `EDGE-FAILURES` | 第 51 次修订在事件前阻止；计算、结构、资源、下载和清理故障均稳定失败 |

## 数据与证据边界

- 所有金额、工时、文字和修订均是合成合同向量，不代表任何个人、家庭、账户、机构或研究参与者。
- JSON 中的 `actual` 不作为产品财务状态使用；修订事件若需要 `actual`，仅属于独立系统事件语义。
- 无效 Unicode 不直接写成孤立 surrogate 或 NUL；`EDGE-UNICODE-REJECT` 使用字面 `\\u0000`、`\\uD800` 和 `\\uDC00` 描述待拒绝标量，测试在共同 `preflightUnicode` 前显式 decode/inject 实际 UTF-16 code unit。
- `EDGE-MARKDOWN-UNICODE` 中的 `example.invalid` 仅是恶意 Markdown 的字面测试文本；预期行为是 inert literal，不产生网络请求。
- `EDGE-MARKDOWN-UNICODE`、`EDGE-UNICODE-REJECT` 和 `EDGE-REVISION-LIMIT` 均通过 `baseline_ref` 指向可重放的 SYN fixture；Unicode 文本或修订序列只作为明确 overlay，不复制另一套计算基线。
- `EDGE-MINOR-UNIT` 以完整合成 `base_input` 加币种/minor-unit/金额覆盖重放每个精度案例；超精度、`XAU` 的 `N.A.` 和未知代码都在输入/工作流层失败，不进入快照。
- `EDGE-LIMITS` 与 `EDGE-MINOR-UNIT` 的每个非 utility case 都按固定五项公式顺序从完整 base replay 生成五项结果；`case_result_expectations` 是逐 case 的完整 exact/status/evidence/reason/dependency/export oracle，单项 `result_expectations` 仅为边界 spotlight。`EDGE-LIMITS` 中 work-hours 超限只使 income-rate/WTE 不可用，三个 margin 仍从有效依赖计算；金额或币种无效才使五项均不可用。129 位 rational 向量单独 utility-only，不进入五项结果或 purchase-impact。
- `EDGE-REVISION-LIMIT` 明确分离三个 revision 命名空间：`periodRef.revision`、`sessionRevision`（初始为 0，每次确认递增 1；冻结时以同一个最终数值复制为 `snapshot_revision`）和 `confirmed-input-revision.sequence`；sequence 1..50 使用确定性 UTC 毫秒时间、income before/after、五项 old-results 与固定 ruleset 生成，sequence 51 在事件前阻止；`snapshot_revision` 不是第四个计数器。
- `EDGE-PERIOD-CONFLICT`、`EDGE-CURRENCY-CONFLICT` 与 `EDGE-TAX-BASIS-CONFLICT` 仍可保留 calculation-only 的局部结果和完整证据状态，但 `pending-reconfirmation`/混合依赖阻止冻结快照；每个结果的导出语义统一为 calculation-only UI local result、no snapshot/JSON none；`export-pending-edit`、输入证据和下游 `insufficient-data` 不互相替代。
- 输入校验的 workflow error（如 `zero-not-allowed`、`negative-not-allowed`、`numeric-limit-exceeded`）与输入 `not-provided`、下游计算 `unavailable/insufficient-data`、导出资格/错误分层记录，不互相升级或替代；完整 base 上的 invalid replay 使用 `export-pending-edit` 且不得继承 base 快照，只有没有任何已提交可用输入的场景使用 `export-no-input`；无快照时的 null 结果只属于下游计算预期，不属于导出内容。
- `evidence/fixtures/coverage-matrix.json` 是可机器读取的覆盖索引；其中的“待实施”只表示夹具基线已声明，不代表规则内核、浏览器、VoiceOver、性能或供应链验证已经通过。

## 消费约定

后续 TypeScript 测试可先读取 manifest，再按 `file` 解析 JSON；不应依赖领域类型、React、DOM、网络、系统时钟或浏览器存储。测试应逐项比较 `exact`、`display`、`evidence_status`、`primary_reason_code`、`reason_codes` 和 `expected_export`，并保持失败输出不包含原始输入。
