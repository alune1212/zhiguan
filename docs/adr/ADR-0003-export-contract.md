# ADR-0003：单案例购买决策研究原型的本地 JSON/Markdown 导出合同

| 字段 | 填写 |
| --- | --- |
| 状态 | `Proposed` |
| 日期 | `2026-08-21` |
| 负责人 | Alune |
| 评审人/决策人 | Alune（兼任产品、工程、数据/隐私、设计/可理解性正式角色）；AI 仅提供起草、规范核验与证据整理，不是签字主体 |
| 相关 PRD / RFC / Issue | [`PRD-0001`](../product/prd/PRD-0001-single-purchase-decision-workbench.md)；[`ADR-0001`](ADR-0001-delivery-form-and-technology-stack.md)（`Accepted`）；[`ADR-0002`](ADR-0002-calculation-and-rules.md)（`Accepted`）；[`RESEARCH-0001`](../research/RESEARCH-0001-single-purchase-decision-protocol.md)（当前为 `Draft`）；[Experiment Issue #1](https://github.com/alune1212/zhiguan/issues/1)；RFC：不需要，本提案不改变上位产品边界 |
| 取代 / 被取代 | 无 |
| 复审条件/日期 | 若获批准，首次定期复审为 `2026-09-21`；schema/格式语义、导出范围、浏览器下载机制、持久化/分享边界、资源限额、目标浏览器或上位产品合同任一变化时提前复审 |

## 1. 决策摘要

**待决策，推荐方案：**`PRD-0001` 的研究原型建立一份框架无关、只存在于当前浏览器内存的不可变 `ExportSnapshotV1`。用户在预览并确认后，原型从同一冻结快照分别生成自描述 JSON 与安全 GFM 子集 Markdown；两种文件共享相同的当前输入、结果、解释、决定和本次会话已确认修订语义，只允许格式名、格式版本、文件生成时点和文件名等表示层元数据不同。

JSON 使用版本化、字段全显式的本地 wire contract；领域数字只使用规范十进制字符串或分子/分母字符串，不使用裸 `BigInt` 或会丢失精度的 JSON number。Markdown 是同一语义模型的用户可读投影，不直接执行用户文本中的 Markdown/HTML/链接语法。文件只由明确用户动作通过浏览器 `Blob`、短时 object URL 和临时 `<a download>` 分格式请求下载；界面只能声明页面已发起 `download-requested`，不能把请求发起冒充为浏览器接管或文件已经成功保存。

本提案不增加服务器、云端分享、导入、恢复、ZIP、File System Access、Web Share、剪贴板、浏览器持久化、外部 schema、远程资源或新运行时依赖。它当前保持 `Proposed`；即使以后转为 `Accepted`，也只完成三项架构前置决策中的第三项，仍需另行批准 OpenSpec proposal/tasks 才可能达到 `Implementation Authorized`。

## 2. 背景与问题

[`PRD-0001`](../product/prd/PRD-0001-single-purchase-decision-workbench.md) 已要求用户能把**当前会话当前快照**分别导出为 JSON 和 Markdown，并固定了以下不可由实现放宽的边界：

- 至少存在一项已提交到当前稳定会话状态的用户输入，且用户明确选择格式、预览字段和敏感类别并再次确认后，才可生成该格式；该输入的证据状态可以是 `user-confirmed` 或 `estimated`，用户可取消；
- 两种格式覆盖同一语义范围，包含当前输入、来源、证据状态、单位、币种、比较周期、税口径、精确/展示结果、公式/规则、版本、假设、限制、不足原因、价值期待、决定、依据、复盘条件和本次会话已确认修订；
- 缺失值必须显式为 `null` 并带独立可用性，不能省略或写成零；`estimated`、`forecast` 与 `insufficient-data` 不能为简洁而丢失；
- 导出不包含过去会话、未确认按键过程、实际购买结果、研究编号、联系人、同意/撤回记录、脱敏研究观察或遥测；
- 内容只在当前内存生成，不外发、不进入浏览器持久化、URL、剪贴板、普通日志、分析或错误上报；
- 两种格式分别报告页面可观测状态；取消、局部失败或浏览器/设备落盘结果未知时不能笼统显示“导出完成”，也不能清空会话、自动重试或通过网络兜底；
- 文件离线自包含，下载后由用户及其设备控制；原型不能召回、删除、恢复、同步或约束其后续复制、备份与分享。

[`ADR-0001`](ADR-0001-delivery-form-and-technology-stack.md) 已固定 React/DOM 之外的纯 TypeScript 序列化边界和无后端、无持久化、无新增浏览器运行时依赖的技术栈。[`ADR-0002`](ADR-0002-calculation-and-rules.md) 已固定精确数字、五类证据状态、工作流可用性、规则/货币快照、完整时间上下文及本次会话确认修订语义，但刻意没有决定 schema、MIME、文件名、下载与兼容合同。

本 ADR 需要在不初始化框架、不写实现的前提下关闭第三项架构问题：如何让两种文件既可追溯、等价和离线自包含，又不把用户文本变成可执行 Markdown，不制造浏览器保存成功的虚假保证，也不为一次性本地导出引入服务器、宽权限或长期兼容负担。

当前证据状态如下：

| 状态 | 当前证据 |
| --- | --- |
| `actual` | 上位治理文档、已批准的 `PRD-0001`/`ADR-0001`/`ADR-0002`、仓库当前尚无应用或导出实现的事实，以及 WHATWG、W3C、IETF/IANA 与 GFM 的公开规范 |
| `user-confirmed` | Alune 已批准 PRD 与前两项 ADR，并要求继续下一步；尚未明确批准本 ADR 的完整导出合同 |
| `estimated` | 一份冻结语义模型、双投影和有限资源预算预计能降低跨格式漂移、内存放大与注入风险；具体上限仍需实现期合成验证 |
| `forecast` | 推荐方案预计能满足 AC-11、AC-14–AC-16、AC-22、AC-23 和 AC-26；当前不能写成已通过 |
| `insufficient-data` | 目标浏览器中的下载请求行为、object URL 生命周期、最大快照性能、跨格式等价、Unicode/Markdown 安全和无网络/存储副作用均尚无运行时证据；页面无法证明浏览器/设备最终落盘 |

## 3. 决策驱动因素

- [x] **产品任务与价值循环对齐：**只帮助用户带走单案例 `Capture → Normalize → Understand → Simulate → Decide` 的当前会话快照，不扩张为账户、历史、分享或备份产品。
- [x] **隐私与数据主权：**敏感内容只在当前内存短时生成，唯一出口是用户明确请求的本地文件；下载前可预览、取消，下载后边界诚实可见。
- [x] **可解释性与用户控制：**文件自描述字段、状态、公式、版本、来源、时间、假设、限制和纠正路径；缺失不伪装成零，估算/预测不伪装成事实。
- [x] **历史口径与可重现性：**当前快照、本次会话已确认修订、规则版本、货币快照与构建版本分开记录；格式版本不可原地改写。
- [x] **可迁移、可导出与退出：**JSON 可由普通工具读取，Markdown 可离线人工阅读；不依赖运行中的原型、外部 schema 或私有 ID。
- [x] **安全边界与最小权限：**不执行用户文本、不引入远程资源或新 API 权限，不通过服务器、Web Share、剪贴板或持久化兜底。
- [x] **可靠性与资源边界：**快照冻结、单格式串行生成、显式限额、稳定错误码、局部失败和及时资源释放，避免陈旧结果、双格式漂移和无界内存放大。
- [x] **无障碍与反焦虑：**每个格式有独立、可读的键盘/VoiceOver 状态；错误不羞辱、不催促，不把导出或购买决定变成任务完成评分。

## 4. 候选方案

### 4.1 语义来源与格式组合

| 方案 | 满足驱动因素 | 用户/数据影响 | 复杂度/成本 | 兼容/迁移/回滚 | 风险 |
| --- | --- | --- | --- | --- | --- |
| A. **一个冻结的规范快照 + JSON/Markdown 双投影（推荐）** | 一个语义来源，易于证明同字段、状态和修订一致；支持机器与人工阅读 | 用户可分别下载；同一次预览下两种格式指向同一快照 | 中；需定义规范模型和两个纯序列化器 | 模型与 UI 解耦；可独立停用某格式并整体回滚 | 投影测试不足仍可能遗漏字段；必须做跨格式语义断言 |
| B. JSON 与 Markdown 各自直接读取页面状态 | 初期接线少 | 两次读取可能跨越编辑或重算，产生不同快照 | 低起步、高维护 | 格式逻辑与 UI 状态耦合，难以迁移 | 高概率字段/状态漂移或导出陈旧结果，拒绝 |
| C. 只导出 JSON 或只导出 Markdown | 单一格式简单 | 机器可迁移性或用户可读性缺失 | 低 | 将来补另一格式会再定义合同 | 违反 FR-22/AC-22，拒绝 |
| D. ZIP 同时打包 JSON、Markdown 与 schema | 可把多文件放在一起 | 增加一次性下载和压缩处理；用户不能分别选择 | 高；新增依赖或自建 ZIP | 包格式和内容再多一层版本 | 超出已批准范围且增加攻击面，拒绝 |
| 不做/依赖复制页面 | 无新代码 | 丢失精确值、状态、版本和修订语义 | 表面为零 | 不可可靠解析或复核 | 违反用户主动导出承诺，拒绝 |

### 4.2 JSON 合同与验证方式

| 方案 | 自描述/精确性 | 依赖与成本 | 失败行为 | 结论 |
| --- | --- | --- | --- | --- |
| A. **版本化固定结构 + 内嵌字典 + 纯 TS 结构验证（推荐）** | 所有字段显式；精确数值使用字符串；断网可解释 | 无新增依赖或外部 schema；需维护类型、运行时断言和 fixture | 缺字段、未知必需语义或非法 Unicode 时 fail-closed | 选择 |
| B. 内嵌或随附 JSON Schema | 可用通用验证器 | 需要批准验证器依赖或自建完整 JSON Schema 解释；还要解决 schema 与文件配对 | 验证器/草案差异可能产生兼容分歧 | 本期不选；正式交换或导入需要时另行 ADR |
| C. 远程 JSON Schema URL | 中心化更新 | 违反离线自包含与零网络；远端可静默改变解释 | 断网或远端变化使文件不可解释 | 拒绝 |
| D. 未版本化的普通对象/JSON number | 最省设计 | 数字可能失真，缺失与变更不可判断 | 消费方只能猜测 | 拒绝 |

### 4.3 Markdown 表示

| 方案 | 可读性 | 安全/互操作 | 复杂度 | 结论 |
| --- | --- | --- | --- | --- |
| A. **`GFM` 标识的安全子集（推荐）**：固定标题、表格、列表和字面代码块；禁用原始 HTML、用户生成链接/图片/autolink | 离线阅读清楚，固定章节便于人工比较 | 用户文本不进入活动语法上下文；需严格转义和 fixture | 中 | 选择 |
| B. 完整 GFM，直接拼接用户文本 | 表达自由 | 原始 HTML、链接、图片、控制字符和表格分隔可能改变文档结构或触发外部访问 | 低 | 拒绝 |
| C. HTML 或 PDF 摘要 | 版式控制更强 | 增加脚本/样式或生成器边界，迁移性较差 | 高 | 超出 PRD 指定格式，拒绝 |
| D. 无结构纯文本 | 风险较低 | 字段/状态/层级难以完整映射，不能声明 Markdown 合同 | 低 | 拒绝 |

### 4.4 浏览器文件交付

| 方案 | 权限/兼容 | 隐私与失败边界 | 成本 | 结论 |
| --- | --- | --- | --- | --- |
| A. **内存 `Blob` + 短时 object URL + 临时 `<a download>`（推荐）** | 不请求文件系统或分享权限；适合现有浏览器静态应用边界 | 内容不需上传；浏览器仍可拒绝、改名或不落盘，故只报告已请求 | 低至中；需严谨撤销临时 URL | 选择 |
| B. File System Access API | 可选择路径并观察写入结果 | 权限更宽、支持范围不同，扩大浏览器合同 | 中 | 当前不选；未来若需要可控保存/覆盖另行 ADR |
| C. Web Share / 剪贴板 | 便于发往其他应用 | 从“本地下载”扩大为分享/复制，目的地和保留不可控 | 中 | 拒绝 |
| D. 服务器生成/邮件/云盘 | 可集中处理 | 原始会话数据外发并产生服务端副本、身份与删除义务 | 高 | 违反本期隐私边界，拒绝 |
| E. `data:` URL | 无 Blob 生命周期 | 大内容内存放大、URL 暴露和长度/兼容风险 | 低 | 拒绝 |

### 4.5 当前外部规范依据

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html) 规定 JSON 的媒体类型为 `application/json`，开放系统交换应使用 UTF-8，且对象名称应唯一；它也指出孤立 UTF-16 surrogate 会造成不可预测的互操作行为。
- [RFC 7763](https://www.rfc-editor.org/rfc/rfc7763.html) 为 Markdown 定义 `text/markdown`、`charset` 和可选 `variant` 参数；[IANA Markdown Variants](https://www.iana.org/assignments/markdown-variants) 登记了 `GFM`，其语法由 [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) 描述。GFM 允许原始 HTML 等结构，因此本提案仍需限制为安全子集，不能把“符合 GFM”误作内容净化证明。
- [W3C File API](https://w3c.github.io/FileAPI/) 定义 `Blob` URL 及撤销行为：object URL 会让 `Blob` 保持可访问，使用后应释放；撤销后新的解引用应失败，已经开始的请求不应因此中止。
- [WHATWG HTML 下载算法](https://html.spec.whatwg.org/multipage/links.html#downloading-resources) 将 `download` 文件名视为建议，并允许用户代理基于安全和本地约束调整或中止下载。因此页面不能可靠声称文件已经保存到指定名称或路径。

这些资料只证明建议机制和格式合同有公开依据，不是本原型已经通过目标浏览器、可访问性、性能或隐私验证的证据。

## 5. 决定

### 5.1 选择（Proposed）

本 ADR 提议选择方案 4.1A、4.2A、4.3A 与 4.4A：一个不可变规范快照、两种纯 TypeScript 投影、固定且自描述的 JSON、受限 GFM Markdown，以及由明确用户动作触发的内存 Blob 下载请求。

规范数据流为：

```text
已确认的当前会话状态 + 当前有效结果 + 最小已确认修订
                         │
                         ▼
               冻结 ExportSnapshotV1
                 │               │
                 ▼               ▼
          JSON serializer   Markdown serializer
                 │               │
                 └──────┬────────┘
                        ▼
         用户逐格式确认 → Blob → object URL → 浏览器下载请求

禁止：重新读取可变 UI 状态、网络、持久化、剪贴板、分享 API、ZIP、远程 schema
```

#### 5.1.1 快照冻结、资格与失效

- 导出入口只有在至少一个当前输入已提交到稳定会话状态且可用性不是 `not-provided` 时开放；该输入可以保留 `user-confirmed` 或 `estimated` 证据状态。只有未确认草稿、默认值或旧结果时不满足入口条件。
- 用户进入预览时，从领域状态一次性复制并冻结 `ExportSnapshotV1`；预览列出全部纳入字段、敏感类别、格式、当前快照/历史范围和下载后边界。预览不会创建 Blob、object URL 或文件。
- 有任何字段处于 `pending-reconfirmation`、存在未确认编辑、当前结果仍引用旧依赖，或快照构造过程中状态修订号发生变化时，禁止生成并返回稳定错误；不能导出“当前值 + 旧结果”的混合快照。
- 已确认但未填写的可选字段，以及合法的 `insufficient-data` 结果，可以进入快照：字段显式为 `null`，并用独立可用性和原因说明为什么没有值。
- 预览后任何确认、修改、重算、周期/币种/时区变化、规则/构建变化都会把快照标为 `stale` 并作废；用户必须重新预览和确认。不能悄悄刷新快照或继续下载旧预览。
- 冻结前执行一次**双格式共用**的 Unicode 预检：所有文本必须是 Unicode scalar sequence；CRLF/CR 规范为 LF；孤立 surrogate 和 NUL 直接使整个快照构造失败，因此 JSON 与 Markdown 都不可生成，不能只让其中一种格式成功。
- 同一份未失效快照可分别生成 JSON 与 Markdown。两种格式的语义比较排除 `format_name`、`format_version`、`file_generated_at` 与文件名后必须相同；`snapshot_revision` 和 `snapshot_captured_at` 必须相同。

#### 5.1.2 顶层 schema 与固定集合

JSON wire contract 使用 `snake_case`，首个版本固定为：

- `schema_name: "zhiguan.purchase-decision.session-snapshot"`
- `schema_version: "1.0.0"`
- `format_name: "json"`
- `format_version: "1.0.0"`
- `snapshot_scope: "current-session-current-snapshot"`
- `history_scope: "current-session-confirmed-revisions"`

顶层字段按以下顺序全部出现；不存在的可选内容写 `null` 或空数组，不能省略：

| 字段 | 必需内容 |
| --- | --- |
| `schema_name` / `schema_version` | schema 身份与语义版本 |
| `format_name` / `format_version` | 当前表示层身份；Markdown 顶部以同名元数据表达 `markdown-gfm / 1.0.0` |
| `snapshot_scope` / `history_scope` | 明确只含当前会话当前快照和本次会话已确认修订 |
| `snapshot_revision` | 冻结时的会话修订序号；不是跨会话 ID |
| `snapshot_captured_at` / `file_generated_at` | 分别记录冻结和该格式生成时的完整时间上下文；均为设备时钟，不宣称权威时间 |
| `application_build` | 应用版本、Git commit SHA、构建产物摘要与配置版本；未知不得猜测，研究构建缺任一必需项则失败 |
| `ruleset` / `currency_table` | `purchase-decision-rules@1.0.0`、公式版本、ISO 4217 固定快照 ID、来源/发布日期/读取日/bytes/SHA-256 |
| `dictionaries` | schema 字段、固定输入/结果、五类证据状态、可用性、原因码、决定类别、时间/舍入和提示语义 |
| `comparison_context` | 周期引用、币种、税口径和完整时区来源/确认元数据 |
| `inputs` | 固定输入记录数组；每个定义字段恰有一条记录 |
| `results` | 五个固定公式结果各一条，即使不可用也不能省略 |
| `decision` / `review` | 价值期待、决定类别、依据/待确认条件、复盘条件或日期；缺失显式表示 |
| `confirmed_revisions` | 本次会话已确认事件；没有事件时为空数组，不生成虚构历史 |
| `notices` | 敏感性、范围、非备份/非分享、设备时间、非财务建议及下载后控制边界 |

所有时间对象沿用 `ADR-0002` 并转换为 wire `snake_case`：`occurred_at_utc`、`recorded_at_utc`、`clock_source`、`time_zone_id`、`utc_offset`、`time_zone_source`、`time_zone_confirmation`；任何字段都不能从本地化展示字符串反推。`application_build` 固定包含 `app_version`、`git_commit_sha`、`artifact_manifest_sha256` 和 `config_version`；`ruleset` 固定包含 `ruleset_id`、`ruleset_version` 和合并引用；`currency_table` 固定包含快照 ID、来源字面文本、发布日期、读取日、bytes 和 SHA-256。缺少研究构建的任一必需版本或摘要时导出失败，不以 `unknown`、空字符串或当前日期补齐。

固定输入至少包括收入、工作小时、币种、比较周期、税口径、购买价格、购买周期归属、固定成本汇总、固定成本覆盖状态/说明和个人价值期待；固定结果为 `income-rate`、`work-time-equivalent`、`coverage-available-margin`、`purchase-after-margin` 与 `purchase-impact`。决定、依据和复盘字段单列，不能混入财务证据状态。

每个输入记录必须显式包含：`field_id`、`availability`、`value`、`source`、`evidence_status`、`unit`、`currency_code`、`currency_table_snapshot_id`、`period_ref`、`tax_basis`、`confirmed_at`、`assumptions` 和 `limitations`。不适用字段为 `null`；未提供时 `value: null`、`availability: not-provided`，证据状态也为 `null`，不新增第六类状态。

输入 `available` 时 `value`、`source: user-input`、适用的证据状态和 `confirmed_at` 必须非 null；输入 `not-provided` 时 `value / source / evidence_status / confirmed_at` 必须为 null，适用上下文不得残留旧值。输入的 `assumptions`、`limitations` 都是有序、去重的 `{ id: 非空固定代码, text: 非空构建内说明 }` 数组，ID 必须存在于对应 `field_definitions` 的允许集合，不能包含用户自由文本；无内容时为空数组。字段定义决定 unit/currency/period/tax 哪些可为 null，不能由 serializer 临时猜测。

首个 schema 的 wire code 固定如下，并在 `dictionaries` 中同时提供稳定 ID、中文标签、定义和允许位置：

| 字典 | 固定代码与约束 |
| --- | --- |
| 证据状态 | `actual / user-confirmed / estimated / forecast / insufficient-data`；财务输入/结果不得产生 `actual`，系统修订事件的 actual 使用独立 `event_status` 字段 |
| 可用性 | `available / not-provided / unavailable`；输入只用前两项，结果只用 `available / unavailable`；工作流中的 invalid、pending-reconfirmation、stale 不进入可导出的冻结模型 |
| 来源 | `user-input / ruleset-derived / system-event`；不得出现研究编号、研究者观察或远程来源 |
| 周期 | `week / month / year / custom`，并显式携带 `custom_label` 和 `revision`；非自定义时 `custom_label: null` |
| 税口径 | `before-tax / after-tax`；不适用或未提供时为 `null`，不得推断 |
| 固定成本覆盖 | `complete / partial / unknown`；覆盖说明作为独立文本字段 |
| 决定类别 | `buy / wait / adjust-conditions / do-not-buy / undecided`；决定本身为用户确认，不由结果推断 |
| 舍入 | `half-away-from-zero`，并显式给出 `display_digits` 和 `rounded` |

`value` 使用带 `kind` 的固定联合结构，而不是无类型字符串：金额为 `money`（`minor_units` 十进制字符串、`minor_unit`、ISO 代码），工时/派生比率为 `rational`（`numerator`/`denominator` 十进制字符串和单位），自由文本为 `text`，封闭选项为 `enum`，确认项为 `boolean`，精确复盘日期为 `local-date`（`YYYY-MM-DD`），比较周期引用为 `period-ref`。缺失时整个 `value` 为 `null`；不能只留下半个 value 对象。`comparison_context` 只引用并汇总这些已确认记录，重复字段必须结构相等，不能成为第二个可变真值源。

各 `value.kind` 的对象键也固定：`money` 恰含 `kind / minor_units / minor_unit / currency_code`；`rational` 恰含 `kind / numerator / denominator / unit`；`text` 恰含 `kind / text / text_encoding: "unicode-scalar-v1"`；`enum` 恰含 `kind / code`；`boolean` 恰含 `kind / value`；`local-date` 恰含 `kind / value`；`period-ref` 恰含 `kind / period_kind / custom_label / revision`。字符串不得用空字符串代替缺失，布尔值不得用 `0/1`，联合对象不得出现其 kind 之外的键。

`notices` 至少使用固定代码 `sensitive-local-file`、`current-session-only`、`not-a-backup-or-share`、`device-time-not-authoritative`、`not-financial-advice` 和 `downloaded-file-user-controlled`；提示正文可以做不改变含义的文案修订，但代码及其定义受 schema 版本约束。

首个版本进一步封闭以下对象和基数；表中字段全部必需出现，`null` 只允许用于明确写出的可选值：

| 对象 | 精确字段与基数 |
| --- | --- |
| `application_build` | 恰含 `app_version: string`、`git_commit_sha: 40 位小写十六进制`、`artifact_manifest_sha256: 64 位小写十六进制`、`config_version: string`；均非空 |
| `ruleset` | 恰含 `ruleset_id: "purchase-decision-rules"`、`ruleset_version: "1.0.0"`、`ruleset_ref: "purchase-decision-rules@1.0.0"` |
| `currency_table` | 恰含 `snapshot_id`、`source`、`published_on`、`read_on`、`bytes`、`sha256`；值必须与 `ADR-0002` 固定快照一致，`source` 是字面文本而非活动依赖 |
| `comparison_context` | 恰含 `period_ref`、`currency_code`、`currency_table_snapshot_id`、`tax_basis`、`time_zone_id`、`utc_offset`、`time_zone_source`、`time_zone_confirmation`、`source_input_ids`；`period_ref` 为前述联合对象或 null，未知上下文值显式为 `null`，引用必须与 `inputs` 对应记录相等 |
| `decision` | 恰含 `availability`、`decision_code`、`evidence_status`、`rationale`、`confirmed_at`；`decision_code` 为封闭 enum 或 null，`rationale` 为 `text` value 对象或 null；未提供时除 availability 外均为 `null` |
| `review` | 恰含 `availability`、`kind`、`local_date`、`condition_text`、`evidence_status`、`confirmed_at`；`kind` 只可为 `local-date / condition / null`，内容分别使用 `local-date`/`text` value 对象，且两个内容字段至多一个非 null |
| `notice` 条目 | 恰含 `code`、`text`；`notices` 恰有六条并按本节固定代码顺序出现 |

`decision` 只允许 `available / not-provided`：available 时 `decision_code`、`evidence_status: user-confirmed`、非空 `text` rationale 和 `confirmed_at` 均非 null；not-provided 时四项均为 null。`review` 同样只允许这两个 availability：available 时 `kind`、`evidence_status: user-confirmed` 和 `confirmed_at` 非 null；`kind: local-date` 要求 `local_date` 非 null 且 `condition_text: null`，`kind: condition` 要求相反；not-provided 时 kind、两个内容字段、evidence_status 和 confirmed_at 全部为 null。任何其他组合使 schema 失败。

`inputs` 恰有以下 11 个 `field_id`，按表中顺序各出现一次：

```text
comparison-period
currency
income
income-tax-basis
work-hours
purchase-price
purchase-period-inclusion
fixed-cost-total
fixed-cost-coverage
fixed-cost-coverage-description
value-expectation
```

所有 11 条记录都使用前述完整输入 envelope。产品流程要求的字段在尚未填写时仍可作为 `not-provided + null` 导出；schema “必需出现”不等于把缺失内容伪装成已完成。`results` 恰有五条，按 `income-rate`、`work-time-equivalent`、`coverage-available-margin`、`purchase-after-margin`、`purchase-impact` 顺序各出现一次。

`dictionaries` 恰含 `schema_fields`、`value_kinds`、`field_definitions`、`formula_definitions`、`evidence_statuses`、`availability_codes`、`source_codes`、`reason_codes`、`decision_codes` 和 `notice_codes` 十个数组。通用代码条目恰含 `id / label / definition`；字段定义另含 `value_kind / product_requirement / unit_semantics / sensitive`；公式定义另含 `expression / dependency_field_ids / result_unit_semantics`。每个允许代码必须且只能出现一次，数组顺序由本 ADR 和 `ADR-0002` 的固定顺序决定；未知代码、缺项或重复项使 schema 失败。

`confirmed_revisions` 为 0～50 条，按 `sequence` 严格递增。每条恰含：`sequence`、`event_type: "confirmed-input-revision"`、`event_status: "actual"`、`actor: "user"`、`time_context`、`field_id`、`before`、`after`、`raw_decimal_before`、`raw_decimal_after`、`confirmed_at`、`invalidated_result_ids`、`old_results` 和 `ruleset_ref`。`before`/`after` 恰含 `availability / value / evidence_status / unit / currency_code / period_ref`；受限原始十进制只对数值字段非 null。`invalidated_result_ids` 去重且最多五项；`old_results` 与之逐项对应，每项恰含 `formula_id / exact_value / display_value / unit / currency_code / period_ref / tax_basis / evidence_status / dependency_ids / rounding / ruleset_ref / currency_table_snapshot_id / generated_at`，不得复制自由文本或整页状态。

所有 `*_ids`、`*_codes` 和 `reason_codes` 都是有序、去重的字符串数组，成员必须存在于相应封闭字典；`source_input_ids`、依赖和失效 ID 不接受自由文本。所有 `{ id, text }` 条目恰含两个非空字符串键；字典/提示的 text 是构建内固定文案，假设/限制 text 来自规则内核固定说明，均不是用户自由文本。`raw_decimal_before/after` 只允许 ADR-0002 已限制长度的规范字符串或 null。

每个结果记录必须承接 `ADR-0002` 的：`formula_id`、`source: ruleset-derived`、`availability`、精确值/`null`、展示值、单位、币种/货币快照、周期、税口径、证据状态、依赖引用、估算依赖、全部原因码与 primary reason、假设、限制、规则版本、完整生成时间和舍入元数据。`insufficient-data` 的值保持 `null`，不能携带旧值。

具体而言，结果对象恰含 `formula_id / source / availability / exact_value / display_value / unit / currency_code / currency_table_snapshot_id / period_ref / tax_basis / evidence_status / dependency_field_ids / estimated_dependency_field_ids / reason_codes / primary_reason_code / assumptions / limitations / ruleset_ref / generated_at / rounding`。`source` 固定为 `ruleset-derived`。`display_value` 非 null 时恰含 `text / decimal / display_digits / relation`，其中 `relation` 为 `exact / rounded / less-than`；`rounding` 非 null 时恰含 `mode: "half-away-from-zero" / display_digits / rounded`。`assumptions` 与 `limitations` 是有序的 `{ id, text }` 数组。结果 `available` 时精确/展示值非 null；结果 `unavailable` 时二者为 null、证据状态固定为 `insufficient-data`、原因列表非空且 primary reason 是首项。

每个 `confirmed-input-revision` 必须承接 `ADR-0002` 第 5.1.7 节：顺序号、`event_status: actual`、用户触发者、完整时间上下文、字段、修改前后规范值与受限原始十进制文本、各自证据状态、周期/币种/单位、确认时点、被失效结果 ID、每项旧结果最小快照和规则版本。事件状态只证明确认动作发生，不把财务值升级为 `actual`。

#### 5.1.3 JSON 编码与数值合同

- MIME 为 `application/json`，文件内容使用 UTF-8、无 BOM、LF 换行、两空格缩进并以一个 LF 结束；不附加非标准 `charset` 参数。
- 对象键必须唯一且使用固定顺序，数组使用领域定义顺序；禁止 `undefined`、稀疏数组、`NaN`、`Infinity`、裸 `BigInt` 和承载领域金额/工时/派生财务值的 JSON number。
- 定点金额的精确值使用规范十进制 `minor_units` 字符串并同时给出 `currency_code`/`minor_unit`；有理数使用约分后的 `numerator`/`denominator` 十进制字符串，分母为正。展示字符串、位数、`half-away-from-zero` 和 `rounded` 与精确值同时保留。
- 计数、schema 版本组成和受限修订序号只有在结构验证证明处于安全整数范围内时才可使用 JSON number；它们不得参与领域财务计算。
- 序列化只接受已经通过快照级 Unicode 预检的文本；C0/C1 控制符、双向控制符、U+2028/U+2029 在 JSON 源文本中使用规范 `\u` 转义，解析后的值仍是冻结模型中的同一 Unicode scalar sequence，且不能进入日志或错误上下文。
- 输出前必须通过独立于 UI 的 `ExportSnapshotV1` 结构断言和 JSON round-trip 断言；解析后的精确字符串、状态和修订必须与冻结模型一致。失败时不创建下载对象。

#### 5.1.4 Markdown 结构与内容安全

- MIME 为 `text/markdown;charset=UTF-8;variant=GFM`，UTF-8、无 BOM、LF 换行并以一个 LF 结束；`format_name` 为 `markdown-gfm`，`format_version` 为 `1.0.0`。
- 固定章节顺序为：文件范围与敏感提示、版本/时间、状态与字段字典、比较上下文、当前输入、当前结果与依据、价值期待与决定、复盘、本次会话已确认修订、假设/限制、下载后边界。空章节仍出现并明确“未提供/无已确认修订”。
- 只生成固定标题、段落、列表、表格和字面代码块。模板不生成原始 HTML、脚本、样式、图片、可点击链接、自动链接或远程资源；来源 URL 如需保留只能作为不激活的字面文本。
- 字段名、固定代码和短标量在表格内使用严格转义；反斜线、管道、反引号、尖括号、`&`、换行和控制字符不能改变表格结构。用户自由文本不得拼接进标题、列表标记、表格或链接上下文。
- 用户自由文本以独立字面代码块呈现；逐行保持内容顺序并选择不会与内容冲突的围栏。Markdown 使用可逆 `unicode-visible-escape-v1`，编码顺序固定为：冻结阶段先规范换行为 LF；随后从左到右把原始反斜线写为 `\\`，TAB 写为 `\t`，C0/C1（TAB/LF 除外）、双向控制符、U+2028/U+2029 写为 `\u{大写十六进制码点}`，LF 保持分行。解码器从左到右只接受 `\\`、`\t`、`\u{有效 Unicode scalar}` 三种 escape，按其含义还原，原始 LF 保持 LF；未知、不完整或非 scalar escape 使验证失败。跨格式验证先解码该表示再与 JSON 解析值和冻结快照比较，不能静默删除、替换或把它解释成 Markdown。
- Markdown 的每个语义字段都有与 JSON 相同的稳定字段 ID；人工可读标签不能替代 ID。跨格式 fixture 按 ID 比较值、状态、单位、依赖、原因和修订，不以视觉相似代替等价。

#### 5.1.5 文件名、下载状态与临时对象

- 文件名只使用固定 ASCII 品牌/范围和冻结时 UTC：`zhiguan-purchase-decision-YYYYMMDDTHHMMSSZ.json` 或 `.md`。不含金额、商品、价值期待、决定、研究编号、时区名称或其他用户文本。
- 同一快照的两种建议文件名共享时间 stem。浏览器可调整建议名；界面不得承诺最终名称、路径或覆盖行为。
- 每种格式独立执行：用户选择一个格式、查看同一快照预览、再次确认后，序列化并创建一个 Blob/object URL；一次明确动作只请求一个文件。要下载另一格式，用户再次明确触发，但在快照未失效时无需重输数据。
- 创建 Blob 前先证明 UTF-8 字节长度大于零且不超上限，并证明 `Blob.size` 与预检一致；否则不创建 object URL。临时 anchor 不持久加入页面，`click()` 必须在该格式的明确用户激活动作内同步调用。
- 若创建、绑定或 `click()` 调用出现页面可观测异常/阻止，状态转为 `failed`，在当前任务移除 anchor、撤销 URL 和释放生成资源；`export-download-request-failed` 只表示这个**请求发起步骤**失败，不表示浏览器或操作系统落盘失败。
- 若 `click()` 正常返回，页面转为 `download-requested`，文案固定表达“页面已发起下载请求；是否保存、名称和位置由浏览器/设备决定”。随后立即移除 anchor，并在下一 macrotask（不得在同一调用栈）幂等撤销 object URL、Blob 与格式字符串引用；页面没有可用的“浏览器已接管/已保存”事件。
- 若 `pagehide`/卸载先于该清理任务，立即执行同一幂等清理并结束应用状态；不延迟离开页面、不重试，也不推断文件是否落盘。取消、序列化/Blob/请求发起失败以及下一次生成前同样清理；任何路径都不得为等待未知落盘结果长期保留 URL。
- 任一时刻最多存在一个生成中的格式字符串、一个 Blob 和一个 object URL。撤销后不复用 URL；用户重试时从仍有效的冻结快照重新生成。
- 下载交互状态与五类证据状态分离，固定为 `idle / previewing / ready / generating / download-requested / failed / cancelled`。`download-requested` 只表示页面的请求发起调用已正常返回；不能显示“浏览器已接管”“已保存”“已写入下载目录”或同义保证。
- JSON 与 Markdown 分别保留状态和错误。一个格式为 `download-requested`、另一格式失败时，界面明确列出两者；不得显示汇总成功、自动下载另一格式、清空会话或后台重试。
- 预览值只存在于当前可见导出流的 view model 和必要 DOM/ARIA 文本。取消、退出、快照失效或 `pagehide` 时移除预览副本、动态节点、ARIA live 内容和隐藏字段；不得用 `hidden`/CSS 保留敏感副本。发起一个格式后，冻结快照只可在导出流仍明确可见时短时保留供另一格式或用户主动重试，离开导出流即释放。

#### 5.1.6 稳定失败合同

错误码不包含用户输入、派生值、文件内容、路径、堆栈或浏览器指纹，至少包括：

```text
export-no-input
export-pending-edit
export-snapshot-stale
export-schema-mismatch
export-required-metadata-missing
export-invalid-unicode
export-resource-limit-exceeded
export-serialization-failed
export-blob-creation-failed
export-download-request-failed
export-resource-cleanup-failed
export-unsupported-browser
```

- 预期失败只显示稳定码映射出的本地、可操作、非羞辱文案；意外异常在边界转为 `export-serialization-failed` 或相应阶段码，不把异常对象写入界面、console、网络或持久化。
- 失败保持当前会话不变；应用不得主动发起已知零字节、超限或截断 Blob，不降级为复制、分享、服务器或 `data:` URL，不自动重试。页面无法证明浏览器/操作系统是否留下部分文件；只能建议用户检查并自行删除异常下载。用户可返回修正、重新预览、主动重试或退出。
- `export-resource-cleanup-failed` 是隐私/资源异常：停止新的导出请求并要求刷新或关闭会话；不能为了继续下载而保留未知 object URL。
- 检测到任何外发、持久化、敏感日志、跨格式语义漂移、陈旧结果、静默截断或不安全 Markdown 时，按 `export-contract-breach` 关键隐私/信任事件暂停整个研究构建，而不是只隐藏导出按钮。

#### 5.1.7 资源限额（实施前估算）

为让 PRD 的 `500ms` 预览、`1s` 单格式生成预算和内存最小化可以被机械验证，首个版本提议以下硬上限：

本节 `KiB/MiB` 分别按 `1024/1,048,576` bytes；文本在快照级 Unicode/换行规范化后用 UTF-8 `TextEncoder` 计数。规范快照大小使用字段固定顺序、无缩进的 JSON 等价表示计数，最终文件使用实际 Blob UTF-8 bytes；不能用 UTF-16 code unit、字符数或压缩后大小替代。

| 资源 | 上限 | 达限行为 |
| --- | --- | --- |
| 本次会话已确认修订事件 | 50 条 | 第 51 次确认前明确提示本原型会话已达上限；不丢弃旧事件、不静默截断，用户可先导出后刷新开始新会话 |
| 每条修订的旧结果最小快照 | 5 条 | 固定覆盖五个公式；发现更多或重复不一致项时 schema 失败 |
| 已确认用户自由文本 UTF-8 总量 | 64 KiB | 字段确认前阻止超限并说明范围；不能到导出时才静默丢失 |
| 冻结规范快照估算 UTF-8 大小 | 512 KiB | 预览 fail-closed，不创建格式字符串或 Blob |
| 单一格式最终 UTF-8 文件 | 1 MiB | 生成 fail-closed，不截断、不压缩、不拆包 |
| 并发导出资源 | 1 个格式字符串 + 1 个 Blob + 1 个 object URL | 新请求前完成旧资源清理；不并行生成两格式 |

这些值是 `estimated` 工程边界，不是已经通过的性能事实。转为 `Accepted` 前须由 Alune 明确接受其用户影响；实现期必须用最大合成会话在全部目标浏览器验证。若合法会话在上限内仍无法满足性能预算，先暂停并修订 OpenSpec/ADR，不得用截断、采样、压缩、遥测或服务器生成掩盖问题。

#### 5.1.8 版本与兼容

- `schema_version` 与两种 `format_version` 分开使用语义版本。删除/改名字段、改变类型/含义/必需性/null 语义、精确数值表示、状态/原因码含义或修订解释提升 major；只新增可忽略字段、代码或章节且不改变既有解释提升 minor；不改变语义的标签、拼写或排版修正提升 patch。
- 已获批准并用于研究构建的版本不可原地改写。同一构建只提供一组固定 schema/JSON/Markdown 版本，文件同时记录构建、规则和货币表版本。
- 1.x 消费方可以忽略未知字段，但不能为缺失的既有必需字段填默认值；遇到不支持的 major、重复键、未知必需语义或非法精确值必须拒绝解释。
- 本期没有导入器、服务器接收方或跨会话恢复，故不承诺应用能重新打开导出文件。若未来需要导入、批量交换、签名/校验或正式长期归档，必须创建新 PRD/ADR，不能从本合同外推。
- 本期不增加自定义内容摘要。`snapshot_revision + snapshot_captured_at + application_build + ruleset + currency_table` 用于解释同一快照，不是防篡改证明；未来若需要真实性/完整性验证，另行决定规范化与签名合同。

### 5.2 为什么选择它

- 冻结一次再双投影，把“同一语义范围”变成可测试的不变量，避免用户在两个下载动作之间修改输入后得到看似成对、实际不同的文件。
- 固定 schema、内嵌字典和精确字符串让文件在断网、没有应用或没有外部 schema 时仍能解释，也直接承接 `ADR-0002` 的 BigInt/有理数与状态合同。
- 安全 GFM 子集保留 Markdown 的可读性，同时把用户自由文本从可执行 HTML、链接、图片和表格语法中隔离；只写 `.md` 并不能自动获得这项安全性。
- Blob/object URL 不需要服务器、广泛文件权限或新依赖，符合研究原型的纯客户端边界；把状态限定为 `download-requested` 则避免承诺浏览器和操作系统没有向页面证明的保存结果。
- 显式限额和单格式串行生成使内存、性能和失败可以在合成数据上复核；拒绝截断确保“成功文件”不会静默缺失敏感或不确定性信息。

### 5.3 适用边界

本提案只适用于：

- `PRD-0001` 的单案例、单浏览器、单页面内存会话；
- 当前确认输入、当前有效/数据不足结果、价值期待、决定/依据、复盘条件和本次会话已确认修订；
- 用户逐格式主动请求的一个 JSON 与一个 Markdown 本地文件；
- `ADR-0001` 的桌面 Chrome、macOS Safari、iOS Safari 和 Windows Chrome 研究支持矩阵；
- 当前批准的 `purchase-decision-rules@1.0.0`、ISO 4217 快照及固定研究构建。

本提案不适用于：

- 导入、恢复、跨会话历史、自动备份、同步、批量导出、账户迁移、公开分享、协作或第三方连接；
- 服务器/云端生成、邮件、云盘、Web Share、剪贴板、File System Access、PWA/Service Worker 或浏览器持久化；
- 研究同意、联系人、研究编号、封闭字段观察、原话、录音、录像、截图或研究材料导出；
- 数字签名、加密容器、密码保护、长期档案、法定记录、会计交换或正式财务建议；
- 正式产品的导出 schema、API、数据库、移动原生应用或多用户边界。

进入上述范围前必须按上位文档判断新 PRD、RFC、ADR 或本 ADR 修订；不能把研究原型文件称为备份、证明、账本或正式产品数据包。

## 6. 产品、数据与信任影响

### 6.1 数据状态与历史口径

- 导出文件本身是设备时钟下生成的快照，不获得产品财务 `actual`。每个字段和结果保留原证据状态；系统修订事件的 `event_status: actual` 只描述确认事件。
- `availability` 与证据状态分开；未提供、待重新确认、不可用和 schema 失败都不能通过新增证据状态表达。只有稳定、冻结的当前状态能生成文件。
- `history_scope` 只包含当前页面内存里已确认的最小修订事件；不声称包含未确认按键、过去会话、刷新前数据、购买执行结果或产品外研究活动。
- 规则、货币、构建、schema 和格式分别版本化。新版本不重解释已经下载的旧文件；原型没有旧文件回读或迁移能力。

### 6.2 可解释性与用户操作

- 用户生成前能看到：将包含的字段和敏感类别、当前/历史范围、目标格式、文件名建议、缺失/不足如何表示，以及下载后的控制边界。
- 用户可取消、返回修改、重新确认、重新预览、逐格式下载或退出；任何一步都不自动下载另一格式、清空会话或发起分享。
- 导出始终可跳过，不阻塞用户完成 Decide 或退出；界面不以提醒、红点、完成率或成功反馈催促用户下载。
- JSON 为机器可读事实载体，Markdown 为同一语义的人工摘要；二者都展示字段 ID、标签、状态、单位、公式、版本、假设和限制，不能让可读标签覆盖稳定语义。
- 文案明确“这是你当前输入下的会话快照，不是购买建议、资产证明、正式账簿、云端备份或跨会话恢复文件”。错误只解释技术范围和下一步，不评价金额、工时或选择。

### 6.3 隐私与安全边界

- 原型只读取当前内存中完成导出所需的字段，冻结后短时保留规范快照和单格式资源；不读取研究层、联系人、文件系统、浏览历史或其他页面数据。
- 除用户请求的下载响应外，不把会话内容写入 Cookie、localStorage、sessionStorage、IndexedDB、Cache Storage、URL、DOM 调试属性、剪贴板、Service Worker、服务端、console、普通日志、分析、遥测或错误上报。
- 文件不依赖远程 schema、脚本、字体、图片、CDN、链接解析或内部系统。打开 Markdown 不应因模板本身触发网络；用户文本不能生成活动链接、图片或 HTML。
- 文件名、错误码和可访问性状态不含敏感内容。浏览器/操作系统、下载目录索引、云备份、杀毒软件或用户后续分享可能处理已下载文件；原型必须在确认前披露，但不能虚假声称能检测、阻止或删除这些副本。
- 内存清理只表示移除应用引用、DOM 节点和 object URL；JavaScript 不能保证即时法证级擦除。刷新、关闭或退出后“应用不可恢复”不等于设备内存绝对不可取证。

## 7. 后果

### 正面后果

- JSON 与 Markdown 共享一个冻结语义来源，跨格式一致性和陈旧快照可被机械验证。
- 精确字符串、显式 `null`/可用性、字典和版本承接现有计算/信任合同，避免浮点和默认值重解释。
- 文件离线自包含，用户不依赖值观服务即可阅读或迁移当前快照。
- 不新增运行时依赖、服务器、宽权限或持久化，维持现有最小技术栈和零产品数据外发边界。
- 安全 Markdown、稳定错误码、单格式状态和资源清理减少注入、误报成功和内存泄漏风险。

### 负面后果与接受的取舍

- schema、字典、双序列化器和等价测试增加实现与评审工作，明显高于直接 `JSON.stringify` 或拼接文本。
- Markdown 为安全牺牲部分排版自由；用户文本以字面形式显示，不能保留其自带 Markdown 富文本效果。
- 浏览器下载 API 不提供可靠的最终落盘确认，界面只能显示“页面已发起下载请求”，用户仍需在设备上自行确认和保管。
- 文件不加密、不签名，也不支持应用回读；敏感文件一旦下载，后续设备、备份和分享风险由用户控制。
- 硬限额可能要求长会话先导出再刷新；这是避免静默截断和无界内存的取舍，仍需实现期验证其可接受性。

### 未决风险

| 风险 | 可能性 | 影响 | 缓解/监测 | 触发新 ADR 的条件 |
| --- | --- | --- | --- | --- |
| JSON/Markdown 字段或修订漂移 | 中/待测 | 高 | 单一冻结模型、稳定字段 ID、SYN-02/SYN-04 跨格式语义断言 | 需要第三种格式、外部交换或独立 schema 包 |
| 用户文本改变 Markdown 结构或触发外部内容 | 中/待测 | 高 | 安全子集、字面代码块、Unicode/HTML/链接/表格注入 fixture | 需要富文本、链接、图片或 HTML |
| 浏览器/设备落盘不可观测、改名或异常文件却被误报成功 | 中 | 高 | 只报告页面 `download-requested`、逐格式状态和人工文件 readback | 需要可靠路径选择、覆盖或写入确认 |
| object URL/Blob 未释放造成敏感内容停留更久 | 低/待测 | 高 | 单资源上限、下一 macrotask 撤销和多路径幂等清理、生命周期测试 | 浏览器机制变化或需要并行/后台下载 |
| 资源限额过低阻塞合理会话或过高导致卡顿 | 中/待测 | 中 | 最大合成会话、目标设备的 500ms/1s 测量；无真实用户遥测 | 需更长历史、批量导出、压缩或后台 worker |
| 下载文件进入云同步、索引或被用户误分享 | 中 | 高 | 预览前敏感提示、非敏感文件名、明确设备边界 | 产品需要加密、受控分享、撤回或组织策略 |
| 设备时钟错误让两个文件看似错配 | 中 | 中 | 显示 device-clock、时区来源、快照修订和构建/规则版本 | 需要权威时间或跨设备审计 |
| 已下载旧文件含错误 schema/规则 | 低/待测 | 高 | 停止构建、记录受影响版本、清晰通知；不声称代码回滚能召回 | 需要自动升级、撤回或长期兼容服务 |

## 8. 迁移、兼容与回滚

### 8.1 迁移/回填

无。当前没有应用、导出代码、产品数据、旧文件消费者、schema 或格式版本需要迁移/回填。本提案不授权创建导入器、转换器、服务器接收端、数据库或历史恢复工具。

未来若批准新 major，只对新生成文件生效；已经下载的旧文件保持原版本和原语义。若需要转换旧文件，必须先建立新的导入/迁移产品合同和安全边界。

### 8.2 兼容策略

- 纯 TypeScript 规范模型和序列化器不依赖 React/DOM；DOM adapter 只负责用户动作、Blob/object URL、anchor 和可访问状态。
- 同一研究构建固定 schema/JSON/Markdown/规则/货币版本；不能按浏览器、会话或远端配置静默切换格式。
- 目标浏览器缺少 Blob、object URL、可靠 anchor 下载或合同所需行为时，显示 `export-unsupported-browser` 并阻止导出；不回退到服务器、剪贴板、分享或 data URL。
- 文件扩展名、MIME 和建议名一致，但浏览器最终命名不作为 schema 识别依据；消费者必须读取文件内版本。
- 1.x 扩展遵循第 5.1.8 节；不支持的 major 必须明确拒绝，不能以“尽量读取”补齐缺失字段。

### 8.3 回滚与恢复

1. 首次实现若 schema、跨格式等价、Unicode/Markdown 安全、下载状态、临时对象、限额、性能或零外发任一验证失败，立即停止分发并撤下构建；不存在产品数据迁移。
2. 后续问题必须恢复上一份**整体已验证**的 Git commit、静态产物、依赖锁、配置、规则/货币版本、schema/格式版本和构建摘要；不能只替换 serializer 或文案。
3. 若仅一个格式出现非隐私缺陷，可以在同一构建中 fail-closed 禁用该格式并明确不可用，但不能把另一格式描述为等价替代；在重新验收前，该构建不满足 AC-22，也不能进入研究。
4. 出现 `export-contract-breach` 时暂停整个研究构建，定位并删除应用可控制的意外副本/临时资源，复核浏览器存储、网络和日志；无法证明边界恢复时不得重新开放。
5. 已下载文件不能由代码回滚召回、删除或改写。必须记录受影响的构建、schema/格式、规则和货币快照版本，向已接触者说明范围和处置建议；不得声称新文件自动修复旧文件。
6. 恢复后重新执行 SYN-02/SYN-04、最大会话、恶意文本、目标浏览器、VoiceOver、网络/存储/日志、部分失败和 object URL 生命周期 readback；证据未通过前保持暂停。

## 9. 验证与验收

### 9.1 转为 `Accepted` 的决议条件

`PRD-0001` 要求三项 ADR 先 `Accepted`，再批准 OpenSpec proposal/tasks，才能实现。本节只列实施前可取得的设计、规范和正式 readback 证据；第 9.2 节运行验证不能倒置为本次架构批准的循环前提。当前全部保持待确认。

| 编号 | 场景/前置条件 | 操作/评审 | 转为 `Accepted` 所需证据 | 当前结果 |
| --- | --- | --- | --- | --- |
| ADR-E-01 | 完整 Proposed 文档 | Alune 以产品、工程、数据/隐私、设计/可理解性角色完成 readback | 唯一推荐、候选取舍、范围、风险与无 RFC 冲突均明确 | 待确认 |
| ADR-E-02 | 冻结快照与双投影 | 复核入口、预览、失效、待重新确认、合法数据不足和跨格式等价 | 不导出草稿/旧结果；同一快照可机械证明同语义 | 待确认 |
| ADR-E-03 | JSON wire contract | 复核顶层结构、固定记录、精确值、null/可用性、字典、版本和 Unicode | 完整承接 PRD 与 ADR-0002，不用外部 schema 或失真 number | 待确认 |
| ADR-E-04 | Markdown 与内容安全 | 复核 MIME/GFM、安全子集、自由文本、控制字符、HTML/链接/图片边界 | 可离线阅读且用户内容不能改变模板结构或触发远程内容 | 待确认 |
| ADR-E-05 | 下载与状态语义 | 复核逐格式确认、Blob/object URL、建议文件名、撤销和部分失败 | 只报告 `download-requested`；无自动/网络/分享/剪贴板兜底 | 待确认 |
| ADR-E-06 | 隐私与用户控制 | 复核纳入/排除字段、敏感提示、下载后设备边界和内存声明 | 不含研究层数据；不虚假承诺召回、删除、保存成功或法证擦除 | 待确认 |
| ADR-E-07 | 资源与失败合同 | 明确接受 50 条修订、64 KiB 自由文本、512 KiB 快照、1 MiB/格式和单资源上限 | 无截断/压缩/自动重试；上限用户影响被正式接受 | 待确认 |
| ADR-E-08 | 版本、兼容与回滚 | 复核 SemVer、不可原地改写、无导入承诺、整体构建恢复与旧文件边界 | 变更/停止/通知路径清晰；不把快照元数据称为防篡改证明 | 待确认 |
| ADR-E-09 | 计划验证充分性 | 将 SYN-02/SYN-04、恶意文本、最大会话、目标浏览器/VoiceOver、隐私和恢复映射到第 9.2 节 | 能覆盖 AC-11、AC-14–16、AC-22、AC-23、AC-26；计划不冒充结果 | 待确认 |
| ADR-E-10 | 最终决议 | Alune 查看完整 diff 后明确批准 | 状态、ADR 索引、`ARCHITECTURE.md` 和 PRD 同步；仍未创建 OpenSpec/实现 | 待确认 |

只有 ADR-E-01～ADR-E-10 全部完成且 Alune 明确批准，才可把状态改为 `Accepted`。接受本 ADR 不等于运行时验证通过，也不自动批准 OpenSpec 或实现。

### 9.2 批准后、实现阶段的计划验证

以下均为计划，不是当前证据，也不授权实现：

| 编号 | 场景/前置条件 | 操作/测试 | 预期证据 | 结果 |
| --- | --- | --- | --- | --- |
| VAL-01 | `ExportSnapshotV1` 全字段和缺失组合 | 结构断言、JSON round-trip、重复键/未知 major/缺必需字段 fixture | 固定字段全部出现；null、可用性和五类状态不混用；不接受失真数值 | 待实施 |
| VAL-02 | SYN-02 与 SYN-04，补充合成决定/复盘并确认一次修订 | 分别生成 JSON/Markdown，按字段 ID 规范化比较 | 当前值、4000 CNY user-confirmed、3000 CNY forecast、insufficient-data 原因和修订前后语义一致 | 待实施 |
| VAL-03 | 编辑中、取消编辑、重新确认、预览后再修改 | 执行导出状态机 | 草稿/混合/陈旧快照被阻止；合法数据不足可导出；未确认动作不生成修订 | 待实施 |
| VAL-04 | 管道、围栏、HTML/script、链接/图片、autolink、换行、NUL、孤立 surrogate、C0/C1、双向字符、U+2028/U+2029 | 生成并用目标 Markdown 渲染器/文本查看器审查 | 文档结构固定，无活动外部内容；NUL/孤立 surrogate 在快照阶段同时阻止两格式；合法控制字符按固定 escape 解码后与 JSON/快照逐 scalar 相等 | 待实施 |
| VAL-05 | 空、零、负数、极小非零、最大精确值、各种 minor unit 和有理数 | 比较领域模型、JSON 和 Markdown | 精确/展示/舍入/单位/币种/税口径无损；无 JSON number 精度回退 | 待实施 |
| VAL-06 | 用户取消、Blob 创建失败、请求发起调用可观测失败、一个格式发起成功另一个失败 | 检查逐格式状态、应用生成物和会话 | 应用不发起已知零字节/超限/截断 Blob；无汇总成功、自动重试、会话清除或替代出口；设备落盘结果始终标为未知 | 待实施 |
| VAL-07 | 重复生成、取消、失败、快照失效、页面隐藏/卸载、下一次请求 | 观测 preview view model、动态 DOM/ARIA、anchor、Blob 引用和 object URL 生命周期 | 同时最多一个生成资源；下一 macrotask 或提前离开时幂等清理；无隐藏预览副本，且不在同一调用栈提前撤销 | 待实施 |
| VAL-08 | 断网运行完整导出并检查网络/存储/URL/clipboard/console | 浏览器自动化与人工审查 | 除静态资源外零请求；零浏览器持久化、剪贴板、敏感日志、研究数据和外部依赖 | 待实施 |
| VAL-09 | 0/1/50 条修订、64 KiB 文本、512 KiB 快照与 1 MiB 边界上下 | 在固定设备测量 | 上限内预览 ≤500ms、单格式生成 ≤1s；上限外明确失败且无截断/卡死 | 待实施 |
| VAL-10 | 桌面 Chrome、macOS Safari、iOS Safari、Windows Chrome；键盘与 VoiceOver | 逐格式预览、确认、取消、请求和错误恢复 | 文件名/MIME/内容可读；焦点和状态公告清楚；不把请求说成保存成功 | 待实施 |
| VAL-11 | 恢复上一份已验证构建 | 对比 commit、产物/配置摘要、schema/格式、规则/货币版本并重跑关键 fixture | 错误构建不再分发；新旧文件边界说明准确；未声称召回旧文件 | 待实施 |
| VAL-12 | 静态代码/产物审查 | 搜索服务器、Web Share、clipboard、Storage、service worker、data URL、外部 schema/资源和新依赖 | 未出现未批准出口、权限、持久化或依赖 | 待实施 |

- [ ] 产品对齐与用户结果验证
- [ ] 数据状态、来源、单位、时间和规则版本验证
- [ ] 隐私、权限、临时资源和日志脱敏验证
- [ ] 导出、取消、失败、兼容和回滚验证
- [ ] 故障降级、数据不足、部分失败和陈旧快照验证
- [ ] 性能、资源限额、目标浏览器和无障碍验证

## 10. 实施与后续

- 实现 PR/提交：未开始；本 ADR 为 `Proposed`，不授权初始化框架或编写实现
- 配置/文档/培训：本提案及 ADR 索引、`ARCHITECTURE.md`、`PRD-0001` 的评审状态引用；无配置或培训材料
- 迁移演练记录：无迁移；回滚与临时对象清理演练待实现后执行
- 监测指标与复审日期：不采集真实用户遥测；只使用合成性能、跨格式 fixture、浏览器网络/存储检查和人工 readback；若获批准，首次复审 `2026-09-21`
- 后续任务：先由 Alune 完成 ADR-E-01～ADR-E-10 readback 并决定是否转为 `Accepted`；若批准，随后才能另行创建并评审 OpenSpec proposal/tasks。本文件不创建 OpenSpec、框架、实现或其他 ADR

## 11. 决议记录

| 日期 | 决策人/评审人 | 结论或条件 | 文档变更 |
| --- | --- | --- | --- |
| `2026-08-21` | AI 起草；Alune 待正式评审 | `Proposed`；ADR-E-01～ADR-E-10 全部完成且 Alune 明确批准前不得转为 `Accepted` | 创建本提案并登记为评审中；同步架构与 PRD 的 Proposed 状态；未创建 OpenSpec、实现或其他 ADR |
