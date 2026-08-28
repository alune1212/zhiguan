## Purpose

为单案例购买决策研究原型提供一个可审查、可解释、可离线阅读且不扩张隐私边界的当前会话导出能力；它让用户在明确预览和确认后带走同一份冻结快照的机器可读 JSON 与人类可读 Markdown 表示，同时诚实区分生成、下载请求和设备最终保存结果。

## ADDED Requirements

### Requirement: Export eligibility and immutable snapshot lifecycle

系统 MUST 只在当前会话至少有一项已提交到稳定状态、可用性不是 `not-provided` 的输入时开放导出；该输入可以是 `user-confirmed` 或 `estimated`。未确认草稿、默认值、旧结果、`pending-reconfirmation`、`invalid-input` 或混合新旧依赖不得构成可导出快照。系统 SHALL 在预览进入时一次性冻结 `ExportSnapshotV1`，冻结开始与结束时的 `sessionRevision` MUST 相同，否则整个构造 fail-closed；冻结值 MUST 复制为 `snapshot_revision`，不得与比较周期 `periodRef.revision` 或修订事件 `sequence` 共用命名空间。预览 SHALL 列出纳入字段、敏感类别、格式、快照范围和下载后控制边界，且预览阶段不得创建导出文件或临时下载对象。

冻结前系统 MUST 对 JSON 与 Markdown 共用的全部文本执行一次 Unicode 预检：文本必须是 Unicode scalar sequence，CRLF/CR MUST 规范为 LF；孤立 surrogate 或 NUL MUST 使整个快照失败，两个格式均不得生成。预览后的确认、修改、重算、周期/币种/时区变化、规则或构建变化 MUST 使快照失效，用户必须重新预览和确认；系统不得静默刷新或继续使用陈旧快照。合法的 `insufficient-data` 结果和已确认但未填写的可选字段可以进入快照，但其值必须显式为空并保留原因。

映射：FR-22、FR-23；AC-11、AC-22、AC-23；ADR-0003 ADR-E-02、ADR-0003 §5.1.1。

#### Scenario: SYN-02 is frozen for two format requests

- **WHEN** 用户使用 `SYN-02` 完成输入确认并进入导出预览，随后先确认 JSON，再在快照未失效时确认 Markdown
- **THEN** 两次请求都引用同一 `snapshot_revision` 与 `snapshot_captured_at`，且每次只从该冻结快照生成所选格式；任何未确认编辑不得混入其中

#### Scenario: SYN-04 preserves legal insufficiency

- **WHEN** 用户使用 `SYN-04`，收入和购买价格有效但工作小时缺失，并确认导出
- **THEN** 快照可以生成，相关字段使用显式 `null` 和 `insufficient-data` 原因；系统不得用零、旧结果、默认工时或猜测补齐，也不得因结果不可用而阻止仍可安全表达的快照

#### Scenario: Preview becomes stale after a confirmed change

- **WHEN** 用户完成预览后确认修改收入或重新计算任一依赖结果
- **THEN** 原预览转为 `stale`/不可用，原格式确认不得生成文件；用户重新预览并确认后才可获得新快照

#### Scenario: Invalid Unicode blocks both projections

- **WHEN** 任一待导出的文本包含 NUL 或孤立 surrogate
- **THEN** 快照级 Unicode 预检失败，JSON 和 Markdown 均不生成，页面显示不含原文的稳定错误，且不创建 Blob 或下载请求

### Requirement: Versioned JSON wire contract with explicit semantics

JSON 导出 MUST 使用 `application/json`（不得附加 `charset` 参数）、UTF-8、无 BOM、两空格缩进、LF 换行并以单个 LF 结束；对象键 MUST 唯一且使用固定顺序。顶层 MUST 固定包含以下语义：`schema_name: "zhiguan.purchase-decision.session-snapshot"`、`schema_version: "1.0.0"`、`format_name: "json"`、`format_version: "1.0.0"`、`snapshot_scope: "current-session-current-snapshot"`、`history_scope: "current-session-confirmed-revisions"`、`snapshot_revision`、`snapshot_captured_at`、`file_generated_at`、`application_build`、`ruleset`、`currency_table`、`dictionaries`、`comparison_context`、`inputs`、`results`、`decision`、`review`、`confirmed_revisions` 和 `notices`。这些字段 MUST 全部出现；不存在的可选内容 MUST 使用 `null` 或空数组，不能省略或写成零。C0/C1、双向控制符、U+2028/U+2029 MUST 在 JSON 源文本中使用规范 `\u` escape，解析后仍与冻结的 Unicode scalar sequence 相同。

JSON MUST 自描述状态、可用性、来源、字段、公式、时间/舍入语义和原因字典；`dictionaries` MUST 包含 `schema_fields`、`value_kinds`、`field_definitions`、`formula_definitions`、`evidence_statuses`、`availability_codes`、`source_codes`、`reason_codes`、`decision_codes` 和 `notice_codes` 十个固定数组，未知代码、重复代码或必需字典缺项 MUST 使验证失败。首版输入 MUST 按固定顺序各出现一次：`comparison-period`、`currency`、`income`、`income-tax-basis`、`work-hours`、`purchase-price`、`purchase-period-inclusion`、`fixed-cost-total`、`fixed-cost-coverage`、`fixed-cost-coverage-description`、`value-expectation`；结果 MUST 按固定顺序各出现一次：`income-rate`、`work-time-equivalent`、`coverage-available-margin`、`purchase-after-margin`、`purchase-impact`。

`application_build` MUST 恰含非空的 `app_version`、40 位小写十六进制 `git_commit_sha`、64 位小写十六进制 `artifact_manifest_sha256` 与 `config_version`；`ruleset` MUST 恰含 `ruleset_id: "purchase-decision-rules"`、`ruleset_version: "1.0.0"` 与 `ruleset_ref: "purchase-decision-rules@1.0.0"`。`currency_table` MUST 携带 `snapshot_id: "iso4217-list-one@2026-01-01#sha256:838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9"`、来源字面文本、发布日期、读取日、字节数和 SHA-256；缺少研究构建所需的版本或摘要 MUST 失败，不得以 `unknown`、空字符串或当前日期补齐。财务数字 MUST 以规范十进制字符串或分子/分母字符串表达，不得使用会失真的 JSON number、裸 `BigInt`、`NaN` 或 `Infinity`。

`value` MUST 是封闭联合：`money` 恰含 `kind / minor_units / minor_unit / currency_code`，`rational` 恰含 `kind / numerator / denominator / unit`，`text` 恰含 `kind / text / text_encoding: "unicode-scalar-v1"`，`enum` 恰含 `kind / code`，`boolean` 恰含 `kind / value`，`local-date` 恰含 `kind / value`，`period-ref` 恰含 `kind / period_kind / custom_label / revision`；联合对象不得带其 kind 之外的键。`decision` 必须使用 `available / not-provided`：available 时封闭 `decision_code`、`evidence_status: user-confirmed`、非空 text `rationale` 和 `confirmed_at` 均非 null，not-provided 时其余字段全为 null。`review` 同样只允许这两个可用性；available 时只允许 `local-date` 或 `condition` 二选一并携带 `user-confirmed` 与 `confirmed_at`，not-provided 时内容与状态全为 null。

`comparison_context` MUST 恰含 `period_ref / currency_code / currency_table_snapshot_id / tax_basis / time_zone_id / utc_offset / time_zone_source / time_zone_confirmation / source_input_ids`；未知上下文显式为 `null`，`period_ref` 为完整 `period-ref` 联合对象或 `null`，重复值必须与所引用输入结构相等。`source_input_ids` MUST 按前述 11 个输入的领域固定顺序筛选、去重，并且每个成员都引用 `inputs` 中对应记录，不能成为第二个可变真值源。

每个结果 MUST 恰含 `formula_id / source / availability / exact_value / display_value / unit / currency_code / currency_table_snapshot_id / period_ref / tax_basis / evidence_status / dependency_field_ids / estimated_dependency_field_ids / reason_codes / primary_reason_code / assumptions / limitations / ruleset_ref / generated_at / rounding`，且 `source` 固定为 `ruleset-derived`。非 null 的 `display_value` MUST 恰含 `text / decimal / display_digits / relation`，`relation` 只允许 `exact / rounded / less-than`；非 null 的 `rounding` MUST 恰含 `mode: "half-away-from-zero" / display_digits / rounded`。`available` 结果的精确值和展示值必须非 null；`unavailable` 结果的二者必须为 `null`、状态必须为 `insufficient-data`、原因列表必须非空且 `primary_reason_code` 必须等于首项。

`confirmed_revisions` MUST 包含 0～50 条按 `sequence` 严格递增的 `confirmed-input-revision`，每条恰含 `sequence / event_type / event_status / actor / time_context / field_id / before / after / raw_decimal_before / raw_decimal_after / confirmed_at / invalidated_result_ids / old_results / ruleset_ref`；`event_type` 固定为 `confirmed-input-revision`、`event_status` 固定为 `actual`、`actor` 固定为 `user`。`time_context` MUST 恰含 `occurred_at_utc / recorded_at_utc / clock_source / time_zone_id / utc_offset / time_zone_source / time_zone_confirmation`；`before` 和 `after` MUST 各恰含 `availability / value / evidence_status / unit / currency_code / period_ref`。`raw_decimal_before/after` 只允许 ADR-0002 长度限制内的规范十进制字符串或 `null`。

所有 `*_ids`、`*_codes` 和 `reason_codes` 数组 MUST 按各自领域固定顺序去重，成员必须存在于对应封闭字典。`invalidated_result_ids` MUST 按前述五个结果的固定顺序筛选、去重且最多五项；`old_results` MUST 与其数量、ID 和顺序逐项对应，每项恰含 `formula_id / exact_value / display_value / unit / currency_code / period_ref / tax_basis / evidence_status / dependency_ids / rounding / ruleset_ref / currency_table_snapshot_id / generated_at`，不得复制自由文本或整页状态。来源代码只允许 `user-input / ruleset-derived / system-event`；任何未知、重复、越界字段或组合 MUST 使内部 wire-contract structural validator fail-closed。

映射：FR-22；AC-06、AC-21、AC-22、AC-24；ADR-0003 ADR-E-03、ADR-0003 §5.1.2–§5.1.3。

#### Scenario: Complete JSON contains fixed sets and dictionaries

- **WHEN** 用户使用完整、有效的 `SYN-02` 请求 JSON
- **THEN** 文件包含全部固定顶层字段、11 个输入记录、5 个结果记录、10 个字典数组及版本/规则/货币快照元数据，数组顺序和代码唯一性可被离线验证

#### Scenario: Missing value is explicit rather than zero

- **WHEN** 用户没有提供可选固定成本或复盘条件但确认导出
- **THEN** 对应字段仍出现，`value` 为 `null`、`availability` 为 `not-provided` 并保留允许的上下文为空；文件不得省略字段或把缺失解释为零

#### Scenario: Exact financial values survive JSON parsing

- **WHEN** `SYN-02` 的收入、价格和结果包含定点金额或有理数并完成 JSON round-trip
- **THEN** 解析后的精确字符串、单位、币种、证据状态、公式、舍入元数据和结果原因与冻结快照逐字段相等，且不发生浮点精度回退

### Requirement: Separate availability, evidence, source, and value kinds

每个输入记录 MUST 显式包含 `field_id`、`availability`、`value`、`source`、`evidence_status`、`unit`、`currency_code`、`currency_table_snapshot_id`、`period_ref`、`tax_basis`、`confirmed_at`、`assumptions` 和 `limitations`；结果 MUST 显式包含 `formula_id`、`source`、`availability`、`exact_value`、`display_value`、`unit`、`currency_code`、`currency_table_snapshot_id`、`period_ref`、`tax_basis`、`evidence_status`、依赖字段、原因码、假设、限制、规则版本、生成时间和舍入信息。输入可用性 MUST 仅使用 `available` 或 `not-provided`，结果可用性 MUST 仅使用 `available` 或 `unavailable`。字典 MUST 保留 `actual / user-confirmed / estimated / forecast / insufficient-data` 五类代码，但产品财务输入只可使用 `user-confirmed / estimated`，产品财务结果只可使用 `user-confirmed / estimated / forecast / insufficient-data`；修订事件的 `actual` 只能出现在独立 `event_status`，导出动作不得改变任何财务状态。

可用输入的 `value`、来源、适用证据状态和确认时间 MUST 非空；`not-provided` 输入的值、来源、证据状态和确认时间 MUST 全为 `null`。`value` MUST 使用受限的 `money`、`rational`、`text`、`enum`、`boolean`、`local-date` 或 `period-ref` 联合结构；缺失时整个 `value` 为 `null`，不得留下半个对象、空字符串或用 `0/1` 代替布尔值。不可用结果的精确值和展示值 MUST 都为 `null`，证据状态为 `insufficient-data`，原因码非空且首项为主要原因。

映射：FR-03、FR-08–FR-13、FR-22；AC-03、AC-07–AC-10、AC-20–AC-24；ADR-0002、ADR-0003 ADR-E-03。

#### Scenario: SYN-04 keeps missing dependency semantics

- **WHEN** `SYN-04` 的工作小时缺失而用户导出当前会话
- **THEN** `income-rate` 和 `work-time-equivalent` 的 `availability` 为 `unavailable`，精确值/展示值为 `null`，`evidence_status` 为 `insufficient-data` 且原因指出缺少工作小时；不得错误标为 `forecast` 或使用旧结果

#### Scenario: Forecast and estimated states remain distinct

- **WHEN** 用户使用含近似工时或固定成本的有效购买情景确认导出
- **THEN** 非未来结果保留 `estimated`，购买后情景保留 `forecast` 并列出估算依赖；导出确认动作不会把任一结果升级为 `actual`

### Requirement: Safe GFM Markdown is a reversible projection

Markdown 导出 MUST 使用 `text/markdown;charset=UTF-8;variant=GFM`、无 BOM、LF 换行并以一个 LF 结束，`format_name` 为 `markdown-gfm`、`format_version` 为 `1.0.0`。文件 MUST 只生成固定标题、段落、列表、表格和字面代码块，按固定顺序包含范围/敏感提示、版本/时间、状态与字段字典、比较上下文、输入、结果与依据、价值期待与决定、复盘、已确认修订、假设/限制及下载后边界；空章节也 MUST 明确“未提供”或“无已确认修订”。

系统 MUST 禁止原始 HTML、脚本、样式、图片、可点击链接、自动链接、远程资源和用户文本改变标题、列表、表格或链接结构；用户自由文本 MUST 置于独立字面代码块，并按确定性规则选择至少三个且长度严格大于内容中同类连续标记的围栏，确保任意反引号或波浪号序列都不能提前闭合代码块。文本编码 MUST 使用可逆的 `unicode-visible-escape-v1`：冻结时先把 CRLF/CR 规范为 LF，再把原始反斜线编码为 `\\`、TAB 编码为 `\\t`、C0/C1（TAB/LF 除外）、双向控制符、U+2028/U+2029 编码为 `\\u{大写十六进制码点}`，LF 保持换行。解码只接受这三类 escape 和有效 Unicode scalar；未知、不完整或非 scalar escape MUST 失败，不能静默删除、替换或执行内容。

映射：FR-22、FR-23；AC-17、AC-22、AC-23；ADR-0003 ADR-E-04、ADR-0003 §5.1.4。

#### Scenario: Malicious text remains inert and reversible

- **WHEN** 用户的价值期待或决定依据包含管道、反引号、围栏、HTML/script、链接、图片、autolink、反斜线、TAB、双向控制符、U+2028/U+2029 或换行
- **THEN** Markdown 仍保持固定章节和表格结构，文本以字面代码块和规定 escape 表示；解码后与 JSON 及冻结快照逐 scalar 相等，且打开文件不触发外部内容

#### Scenario: Invalid text cannot be selectively emitted

- **WHEN** 用户自由文本在 Markdown 预检中含 NUL 或孤立 surrogate
- **THEN** 快照级失败同时阻止 Markdown 和 JSON，页面不产生仅“安全格式”成功的部分结果

### Requirement: JSON and Markdown preserve one semantic snapshot

同一未失效的 `ExportSnapshotV1` 生成的 JSON 与 Markdown MUST 覆盖完全相同的语义范围，并通过每个稳定字段 ID 对齐当前输入、结果、来源、证据状态、可用性、单位、币种、比较周期、税口径、依赖、公式/规则、假设、限制、决定、复盘和 `confirmed_revisions`。跨格式比较 MUST 排除仅表示层的 `format_name`、`format_version`、`file_generated_at` 和文件名；`snapshot_revision` 与 `snapshot_captured_at` MUST 相同。Markdown 解码后与 JSON 解析值及冻结模型不一致、遗漏字段、改变状态或原因、把 `null` 变成零，均 MUST 使导出验证失败。

系统 MUST 保留当前值与本次会话已确认修订的前后值/状态/时间和失效结果语义，但不得虚构未确认按键、过去会话、实际购买结果、产品外研究活动或研究字段。`SYN-02` 的 4000 CNY `user-confirmed` 基线、3000 CNY `forecast` 购买后余量和 16 小时 Work-time Equivalent，以及 `SYN-04` 的 `insufficient-data` 原因，均 MUST 在两种格式中保持等价。

映射：FR-13、FR-22；AC-11、AC-21、AC-22；ADR-0003 ADR-E-02、ADR-E-09、ADR-0003 §5.1.1–§5.1.4。

#### Scenario: Cross-format SYN-02 equivalence

- **WHEN** 用户分别生成 `SYN-02` 的 JSON 与 Markdown，并按稳定字段 ID 解析和比较
- **THEN** 两种文件保留相同的 4000 CNY `user-confirmed`、3000 CNY `forecast`、16 小时结果、来源/公式/限制及当前快照范围，差异仅限批准的格式元数据

#### Scenario: Cross-format SYN-04 equivalence

- **WHEN** 用户分别生成 `SYN-04` 的 JSON 与 Markdown，并按稳定字段 ID 比较
- **THEN** 两种文件都保留工作小时缺失、相关结果 `insufficient-data` 及其原因，不能由 Markdown 的可读摘要改写成确定数值

### Requirement: Preview, explicit confirmation, and per-format download request state

系统 MUST 在每种格式生成前分别展示同一冻结快照的目标格式、将导出的字段与敏感类别、缺失/不足表示、建议文件名和下载后由用户控制的边界；用户 MUST 再次明确确认该格式后才能生成。建议文件名 MUST 仅使用冻结时 UTC 的共同 ASCII stem：`zhiguan-purchase-decision-YYYYMMDDTHHMMSSZ.json` 或 `.md`。JSON 与 Markdown MUST 分别拥有 `idle / previewing / ready / generating / download-requested / failed / cancelled` 交互状态，且这些状态 MUST 与五类证据代码分离；产品财务结果仍不得使用 `actual`。一次明确用户动作最多请求一种格式；下载另一格式需要用户再次触发，但在快照未失效时无需重新填写会话输入。

生成 MUST 只在当前浏览器内存中完成，使用短时 Blob、object URL 和不持久挂载的临时下载锚点请求本地文件；Blob 的 UTF-8 预检大小 MUST 与 `Blob.size` 相同，锚点 `click()` MUST 在该格式的明确用户激活动作中同步调用。调用正常返回时只能报告 `download-requested`，随后立即移除锚点并在下一 macrotask 幂等撤销 object URL、Blob 与格式字符串引用；若 `pagehide`/卸载更早发生则立即执行同一清理。文案 MUST 明确浏览器/设备是否保存、最终名称和位置仍未知。系统不得显示“浏览器已接管”“已保存”“已写入下载目录”或同义保证，也不得把导出请求状态当作成功财务证据。

映射：FR-22、FR-23；AC-22、AC-23；ADR-0003 ADR-E-05、ADR-0003 §5.1.5。

#### Scenario: Confirm JSON without auto-generating Markdown

- **WHEN** 用户在预览中确认 JSON 格式
- **THEN** 系统只为 JSON 进入生成和 `download-requested`（若请求发起调用正常返回），不得自动生成、请求或报告 Markdown

#### Scenario: Browser save outcome remains unknown

- **WHEN** 临时下载请求的调用正常返回，但浏览器可能改名、拒绝或尚未完成设备保存
- **THEN** 页面只报告 `download-requested` 并显示设备控制提示，不声称文件已保存、路径已确定或可被原型撤回

#### Scenario: Cancel before generation

- **WHEN** 用户在确认前取消 JSON 或 Markdown 导出
- **THEN** 对应格式转为 `cancelled`，不生成 Blob、object URL 或文件，不发网络请求，不改变当前会话，也不自动重试或请求另一格式

### Requirement: Stable errors, partial failure, and temporary resource cleanup

系统 MUST 为阶段失败提供不含用户输入、派生金额、文件内容、路径、堆栈或浏览器指纹的稳定错误码，至少支持：`export-no-input`、`export-pending-edit`、`export-snapshot-stale`、`export-schema-mismatch`、`export-required-metadata-missing`、`export-invalid-unicode`、`export-resource-limit-exceeded`、`export-serialization-failed`、`export-blob-creation-failed`、`export-download-request-failed`、`export-resource-cleanup-failed` 和 `export-unsupported-browser`。失败文案 MUST 本地、可操作、非羞辱，且不得把异常对象写入界面、console、网络、日志或持久化。

取消、序列化失败、Blob 失败、请求发起失败、下一次生成前和页面隐藏/卸载时，系统 MUST 幂等移除临时锚点、预览副本、ARIA live/隐藏 DOM 和动态状态，撤销 object URL 并释放应用可控制的 Blob/字符串引用；不得为等待未知落盘结果长期保留临时对象。任一时刻最多存在一个生成中的格式字符串、一个 Blob 和一个 object URL。JSON 与 Markdown MUST 分别保留结果和错误：一格式 `download-requested`、另一格式失败时，界面不得汇总为全部成功、自动重试、自动下载或清空会话。若清理失败，系统 MUST 停止新的导出请求并要求刷新或关闭会话。检测到外发、持久化、敏感日志、跨格式语义漂移、陈旧结果、静默截断或不安全 Markdown 时 MUST 分类为 `export-contract-breach` 并暂停整个研究构建，不能只隐藏导出入口。

映射：FR-23；AC-23；ADR-0003 ADR-E-05、ADR-E-07、ADR-0003 §5.1.5–§5.1.6。

#### Scenario: JSON succeeds while Markdown fails

- **WHEN** JSON 的请求发起调用正常返回，而 Markdown 在序列化或 Blob 创建阶段失败
- **THEN** JSON 保持 `download-requested`，Markdown 保持 `failed` 并显示稳定非敏感错误；系统不显示“导出完成”、不自动重试 Markdown、不清除会话

#### Scenario: Download request failure leaves no unknown object

- **WHEN** 临时锚点绑定或下载请求发起出现页面可观测异常
- **THEN** 对应格式转为 `failed`，临时锚点移除、object URL 撤销、应用可控资源释放；系统不声称设备已保存文件，也不通过复制、分享或服务器兜底

#### Scenario: Cleanup failure is fail-closed

- **WHEN** 系统无法证明某个 object URL 或生成资源已清理
- **THEN** 新导出请求被阻止并显示 `export-resource-cleanup-failed` 对应的稳定操作说明，用户刷新或关闭会话后才可结束该状态

### Requirement: Fixed resource limits and fail-closed generation

首个版本 MUST 固定以下硬上限并在 UTF-8 字节层面判断：本次会话已确认修订最多 50 条；每条修订的旧结果最小快照最多 5 条；已确认用户自由文本总量最多 64 KiB；冻结规范快照估算最多 512 KiB；单一格式最终 UTF-8 文件最多 1 MiB；并发导出资源最多一个格式字符串、一个 Blob 和一个 object URL。计数 MUST 使用规范化文本和 UTF-8 bytes，不得以 UTF-16 code unit、字符数或压缩后大小替代。

超过任一上限时系统 MUST 在相应阶段明确失败并保留当前会话，不得丢弃旧修订、静默截断、采样、压缩、拆包、自动重试、发送服务器或改用其他出口。上限内仍不能满足预览 `500ms` 或单格式生成 `1s` 实验室预算时，系统 MUST 停止分发并等待合同修订，不得用截断、遥测或服务器生成掩盖性能问题。

映射：FR-22、FR-23、FR-25；AC-22、AC-23、AC-26；ADR-0003 ADR-E-07、ADR-E-09、ADR-0003 §5.1.7。

#### Scenario: Maximum session remains complete

- **WHEN** 会话包含 50 条确认修订、每条最多 5 条旧结果、自由文本总量 64 KiB，且规范快照与目标格式均在 512 KiB/1 MiB 边界内
- **THEN** 预览和格式生成不得丢失或静默截断字段；资源数量不超过单并发上限，生成后按规定清理临时资源

#### Scenario: Revision 51 is rejected before loss

- **WHEN** 用户准备确认第 51 条修订
- **THEN** 系统在确认前提示已达修订上限，不丢弃既有事件、不生成不完整快照，并允许用户先导出后刷新开始新会话

#### Scenario: Oversized format fails closed

- **WHEN** 规范快照估算超过 512 KiB 或某一格式 UTF-8 文件超过 1 MiB
- **THEN** 对应阶段显示 `export-resource-limit-exceeded`，不创建格式字符串、Blob 或 object URL，不截断或压缩内容，也不把另一格式报告为等价成功替代

### Requirement: Privacy boundary and user-controlled local output

系统 MUST 只读取当前内存中属于当前会话快照的字段和有效结果；导出不得包含过去会话、未确认按键过程、实际购买结果、研究编号、联系人、正式同意/撤回记录、封闭字段研究观察、遥测或其他产品外研究数据。除用户明确触发的本地下载请求外，原始会话数据、派生财务结果和导出内容 MUST 不发送网络、不写 Cookie、Web Storage、IndexedDB、Cache Storage、URL、剪贴板、Service Worker、服务端、DOM 调试属性、普通日志、分析、错误上报或会话重放；不实施分享、导入、恢复或后台任务。

确认前系统 MUST 披露导出的敏感类别、当前会话/当前快照范围、导出可跳过、文件进入用户设备后由用户控制，以及原型不能召回、删除、恢复、同步或限制其后续复制、备份和分享。用户拒绝或取消导出 MUST 不影响继续完成 Decide 或退出，不得以提醒、红点、完成率或羞辱文案催促下载；错误信息和文件名 MUST 不暴露敏感内容。

映射：FR-01、FR-15–FR-17、FR-23–FR-24；AC-01、AC-13–AC-15、AC-22–AC-25；ADR-0003 ADR-E-06、ADR-0003 §6.2–§6.3。`FR-20`、`FR-21`、`FR-26` 与 `AC-18`、`AC-19`、`AC-27` 仍是产品外研究治理，不属于本 capability 的实现覆盖。

#### Scenario: Export is the only explicit data exit

- **WHEN** 用户确认一份本地 JSON 或 Markdown 下载
- **THEN** 只有该用户选择的文件请求携带会话内容离开当前内存；网络、浏览器持久化、剪贴板、分享 API、研究记录和日志均不接收原始会话数据或派生结果

#### Scenario: Product-external research fields are rejected at the snapshot boundary

- **WHEN** 合成越界 fixture 试图把研究编号、联系人、同意/撤回记录、观察字段或遥测作为快照字段传入构造器
- **THEN** 快照构造 MUST fail-closed 且两种格式均不生成，稳定错误不得包含这些字段的值；原型不得静默把产品外研究对象吸收到会话模型中

#### Scenario: User skips export without pressure

- **WHEN** 用户关闭预览或跳过导出后继续记录决定或退出
- **THEN** 当前会话保持不变且流程可继续；系统不自动生成文件、发起请求、记录分析事件或使用催促性文案

### Requirement: Version compatibility and whole-build rollback boundary

JSON `schema_version` 与 JSON/Markdown 各自的 `format_version` MUST 独立遵循语义版本。删除、改名、改变类型/含义/必需性/null 语义、精确数值表示、状态/原因码含义或修订解释时 MUST 提升 major；只增加不改变既有解释的可忽略字段、代码或章节时才可提升 minor；不改变语义的文字/排版修正才可提升 patch。已用于研究构建的版本 MUST 不原地改写，新生成文件记录构建、规则、货币表、schema 和格式版本；旧文件保持旧语义。

本期的内部 wire-contract validator 与兼容 fixture MUST 拒绝不支持的 major、重复键、未知必需语义、非法精确值或缺失既有必需字段，不得以默认值猜测兼容；当前原型不实现导入、跨会话恢复、批量交换、签名、加密容器、旧文件读取或自动迁移。若 schema、跨格式等价、Unicode/Markdown 安全、下载状态、资源清理、性能或零外发任一验收失败，交付 MUST 停止并恢复上一份整体已验证的构建、产物、配置、依赖、规则/货币和 schema/格式版本（或首次构建直接撤下）；应用代码不得声称可以召回、删除或改写已下载文件。

映射：FR-16、FR-22–FR-23；AC-22、AC-23、AC-26；ADR-0003 ADR-E-08、ADR-E-09、ADR-0003 §5.1.8、§8.2–§8.3。

#### Scenario: Unsupported major fixture is rejected without adding an importer

- **WHEN** 构建时兼容 fixture 或生成前内部 structural validator 提供不支持的 major、重复键或缺失既有必需字段
- **THEN** 合同验证 MUST 以非敏感稳定错误失败；系统不补默认值、不静默降级、不改写文件，也不因此新增运行时导入器或读取路径

#### Scenario: Failed validation triggers whole-build rollback

- **WHEN** 目标浏览器/VoiceOver、跨格式等价、恶意文本安全、最大会话、网络/存储边界或 object URL 生命周期的验收任一失败
- **THEN** 研究构建停止分发并回到上一份整体已验证版本（首次构建则撤下），直到相关 fixture、目标平台和隐私/回滚证据重新通过；已下载文件仍由用户控制，不能被代码召回
