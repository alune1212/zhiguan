## Purpose

本能力把单案例购买决策所需的金额、工时、周期、币种、税口径和证据状态收束为可解释、可复现且可安全失效的精确计算合同，使用户只看到有依据的局部结果，并能追溯规则版本、原因与确认修订。

## ADDED Requirements

### Requirement: 受限 ASCII 数值输入与边界

所有原始金额、工时和派生有理数都 MUST 通过固定的、与 locale 无关的 ASCII 数值合同。金额（收入、购买价格、固定成本汇总）MUST 为正数，整数部分最多 15 位，小数位不得超过所选货币的 ISO minor unit，输入 token 最多 32 个字符；工作小时 MUST 为正数，整数部分最多 6 位、小数最多 3 位，最大值为 `999999.999` 小时，输入 token 最多 16 个字符。任何原始字段在 trim、模式匹配或数值构造前 MUST 先检查不超过 64 个 UTF-16 code units；通过该门禁后才去除两端空白、先识别正负号以返回具体原因，再检查 token 上限和 `(?:0|[1-9][0-9]*)(?:\.[0-9]+)?`。输入不得接受正号、负数、指数、分组分隔符、全角数字或隐式 locale 解析。派生有理数的分子和分母在每次约分后各最多 128 个十进制数字，分母 MUST 大于零且零值 MUST 规范为 `0/1`。原始金额/工时的零值无效；派生余量的零值与负值有效。空值、超限和非法值不得被截断、填零或猜测。

#### Scenario: 合法值停在声明的上限

- **WHEN** 金额使用最多 15 位整数和所选货币允许的最大 minor unit 小数、工作小时使用 `999999.999`，且所有 token 与原始字段长度均未超限
- **THEN** 系统 MUST 保留规范十进制含义并允许其依赖结果继续计算；工作小时的 `999999.999` MUST 被视为合法上界而不是被截断

#### Scenario: 超过任一上限即 fail-closed

- **WHEN** 金额出现第 16 位整数、工作小时出现第 7 位整数或第 4 位小数、token 超过其类型上限、原始字段超过 64 个 UTF-16 code units，或约分后的分子/分母超过 128 位
- **THEN** 受影响结果 MUST 为 `null`、证据状态 MUST 为 `insufficient-data`，并返回 `numeric-limit-exceeded` 或适用的稳定原因码；系统不得截断、回退旧结果或改用浮点数

#### Scenario: 语法和符号不被隐式修正

- **WHEN** 用户输入空值、零、负数、正号、指数、分组符号、全角数字、locale 小数符号或其他不符合受限 ASCII 语法的 token
- **THEN** 系统 MUST 拒绝该输入并返回 `invalid-decimal`、`zero-not-allowed` 或 `negative-not-allowed` 等稳定原因码；系统不得自动清洗为另一个数值

#### Scenario: 派生零值保持有效

- **WHEN** 精确公式得到零余量或零有理数，而所有原始输入均为有效正数
- **THEN** 系统 MUST 将零有理数规范为 `0/1` 并把零余量保留为有效结果；不得套用原始输入的 `zero-not-allowed`、改为空值或隐藏该结果

#### Scenario: 货币精度约束小数

- **WHEN** 金额的小数位超过当前已确认币种的 minor unit，或币种不是固定货币快照中具有大写三字母代码和 `0 / 2 / 3 / 4` minor unit 的条目
- **THEN** 系统 MUST 返回 `fraction-exceeds-currency-minor-unit` 或 `unsupported-currency`，只停止依赖该金额的结果，不得换汇、猜测精度或把多余小数静默舍入

### Requirement: BigInt 定点与有理数精确性

金额 MUST 以所选币种的最小货币单位作为 `BigInt` 定点值进行领域运算；除法派生结果 MUST 以分母为正且已约分的 `BigInt` 分子/分母表示。所有公式的中间值 MUST 保持精确，不能因 BigInt 整除而截断，也不能使用 JavaScript `Number`、`parseFloat`、`NaN`、`Infinity` 或 Number/BigInt 混算。Work-time Equivalent MUST 直接依赖原始精确收入、价格和工时，不能依赖已展示的 Income Rate。相同的显式输入、上下文和不可变规则版本 MUST 产生相同规范结果。

#### Scenario: 展示 tie 前保留精确分数

- **WHEN** 收入为 `2.01 CNY`、工作小时为 `2`，需要展示 Income Rate
- **THEN** 系统 MUST 先保留精确值 `201/200 CNY/小时`，只在展示边界得到 `1.01 CNY/小时`，不得把中间值提前变为 `1.00` 或依赖二进制浮点

#### Scenario: 规则失败不回退到旧值或零值

- **WHEN** 约分、除法或规则执行发生预期失败或意外异常
- **THEN** 当前受影响结果 MUST 为 `null` 和 `insufficient-data`，预期失败 MUST 返回稳定原因码，意外异常 MUST 转换为 `rule-execution-failed`；系统不得显示零值、旧结果、默认值或 Number 计算结果

#### Scenario: 精确值贯穿下游依赖

- **WHEN** 展示舍入后的速率与原始价格、工时共同存在，且需要计算 Work-time Equivalent 或购买影响
- **THEN** 下游结果 MUST 使用未舍入的最小货币单位或有理数，而不是任何展示字符串；改变展示位数或本地分组不得改变精确结果

### Requirement: 比较周期、币种、税口径与时间上下文

每个会话 MUST 显式使用 `{ kind: week | month | year | custom, customLabel, revision }` 的比较周期；收入、工时、固定成本和已提供的购买周期归属 MUST 引用完全相同的当前 `revision`。购买周期归属只控制 `purchase-after-margin` 与 `purchase-impact`，不得成为 Income Rate 或 Work-time Equivalent 的依赖。会话 MUST 只有一个用户确认的 ISO 4217 币种，金额和结果 MUST 保存固定 `currencyTableSnapshotId`；不得自动跨周期换算、跨币种换汇、分摊或重写输入。税口径 MUST 明确为 `before-tax` 或 `after-tax`。确认、修订和结果 MUST 携带 `occurredAtUtc`、`recordedAtUtc`、`clockSource`、`timeZoneId`、`utcOffset`、`timeZoneSource` 和 `timeZoneConfirmation`；时区只解释时点，不得参与本期数值公式。

#### Scenario: 相同周期和币种允许共同计算

- **WHEN** 收入、工时、适用固定成本和已提供的购买周期归属均引用同一已确认周期 revision，所有金额使用同一已确认币种及其快照，购买价格有效，并声明税口径
- **THEN** 系统 MUST 允许满足其他依赖的结果计算，并在结果中保留周期引用、币种代码、`currencyTableSnapshotId`、税口径和完整时间上下文

#### Scenario: 周期或币种冲突停止依赖结果

- **WHEN** 任一带 `periodRef` 的输入引用不同周期 revision、任一金额引用不同币种，或用户改变币种但尚未以新币种重新录入并确认金额
- **THEN** 受冲突影响的结果 MUST 为 `insufficient-data`，原因 MUST 为 `period-mismatch`、`currency-mismatch` 或适用的重新确认原因；系统不得自动转换、换汇、分摊或只替换币种代码

#### Scenario: 税前路径只保留允许的结果

- **WHEN** 收入口径为 `before-tax`
- **THEN** Income Rate 与 Work-time Equivalent MUST 可以按税前口径计算并持续显示 `before-tax`；覆盖余量、购买后余量和购买影响 MUST 为 `insufficient-data`，原因 MUST 为 `tax-basis-not-after-tax`

#### Scenario: 时区 fallback 不改变数值

- **WHEN** 浏览器无法提供有效 IANA 时区而系统使用 `Etc/UTC`、`+00:00` 和 `utc-fallback`，或用户随后修改时区元数据
- **THEN** 系统 MUST 标明 fallback/来源与未确认警告，数值结果 MUST 不因时区改变而变化，新的结果或事件 MUST 使用新的完整时间上下文且不得重写旧事件

### Requirement: 五项公式的依赖与局部可用性

系统 MUST 以以下五项精确公式作为本能力的唯一计算语义，其中 `I` 为收入最小货币单位、`P` 为购买价格、`F` 为完整固定成本汇总、`S = 10^minorUnit`、工时为 `Hn/Hd`：

- `income-rate` MUST 计算 `(I × Hd) / (S × Hn)`，依赖收入、工时、同一周期/币种及已声明税口径。
- `work-time-equivalent` MUST 计算 `(P × Hn) / (I × Hd)` 小时，依赖前项的原始依赖与购买价格。
- `coverage-available-margin` MUST 计算 `I - F`，仅接受税后收入、有效且完整的固定成本覆盖、非空覆盖说明及同一周期/币种。
- `purchase-after-margin` MUST 计算 `(I - F) - P`，依赖安全可用的基线和用户确认购买计入当前周期；它是未来情景。
- `purchase-impact` MUST 计算 `purchase-after-margin - coverage-available-margin = -P`，仅在基线与购买后余量均安全可用时生成；它是未来情景。

缺少或不安全的依赖 MUST 只停止依赖该字段的结果。系统 MUST 保留可安全展示的局部结果；不得因为固定成本、购买周期或税后余量缺失而阻止仍独立可用的 Income Rate 或 Work-time Equivalent。

#### Scenario: 缺少固定成本仍可展示局部结果

- **WHEN** 收入、工时、购买价格、周期、币种和税口径有效，但固定成本未填写、覆盖为部分/未知，或完整覆盖没有说明
- **THEN** Income Rate 与 Work-time Equivalent MUST 按其可用依赖生成；`coverage-available-margin`、`purchase-after-margin` 与 `purchase-impact` MUST 为 `insufficient-data`，并分别说明固定成本覆盖或说明缺失

#### Scenario: 未确认购买周期不阻止工作时间视角

- **WHEN** 收入、工时和价格有效，但用户尚未确认购买是否计入当前比较周期
- **THEN** Work-time Equivalent MUST 仍可生成；`purchase-after-margin` 与 `purchase-impact` MUST 为 `insufficient-data`，原因 MUST 包含 `purchase-period-unconfirmed`

#### Scenario: 余量为负数仍是有效结果

- **WHEN** 税后收入减去完整固定成本，或再减去购买价格后得到负数
- **THEN** 系统 MUST 保留该精确负值及其状态，不得 clamp 为零、改写为净资产/支付能力或生成购买建议；展示 MUST 以平静、可解释的“低于零”语义说明已确认覆盖范围

### Requirement: 证据状态优先级与状态隔离

每个产品财务结果 MUST 使用且仅使用 `insufficient-data`、`forecast`、`estimated` 或 `user-confirmed` 四类状态，并按 `insufficient-data > forecast > estimated > user-confirmed` 的顺序求值：关键依赖缺失/无效/未确认时为 `insufficient-data`；未来购买情景在依赖安全时为 `forecast`；非未来结果含任一估算依赖时为 `estimated`；非未来结果全部为用户确认时为 `user-confirmed`。研究层或系统事件的 `actual` MUST 与产品财务状态隔离，不得传播或升级任何产品财务结果为 `actual`。`pending-reconfirmation`、`stale` 和 `invalid-input` MUST 只作为工作流可用性或原因语义，不得成为第五类证据状态。

#### Scenario: 缺失优先于未来

- **WHEN** 结果描述未来购买情景但任一关键输入缺失、无效、周期/币种冲突或税口径不允许
- **THEN** 结果 MUST 为 `insufficient-data` 而不是 `forecast`，并 MUST 揭示缺失或冲突依赖及修正路径

#### Scenario: 未来结果保留 forecast 并揭示估算依赖

- **WHEN** 购买情景的所有依赖有效，且至少一个依赖为 `estimated`
- **THEN** 结果 MUST 为 `forecast`，同时列出每个 `estimated` 依赖；不得把未来结果降级为 `estimated`

#### Scenario: 非未来结果按输入状态传播

- **WHEN** 非未来结果的关键依赖均有效且至少一个为 `estimated`，或全部为 `user-confirmed`
- **THEN** 前者 MUST 为 `estimated`，后者 MUST 为 `user-confirmed`，并分别显示估算依赖或确认来源与时点

#### Scenario: 研究 actual 不进入财务图

- **WHEN** 研究层记录一条 `actual` 的步骤观察或系统记录一条确认事件
- **THEN** 产品财务结果状态 MUST 保持原有 `insufficient-data`、`forecast`、`estimated` 或 `user-confirmed`，不得因该事件升级为 `actual`

### Requirement: 稳定原因码与非敏感失败合同

每个不可用结果 MUST 返回 `null`、稳定的 primary reason 和去重后的全部适用原因；原因优先级 MUST 先按上下文（周期、币种），再按公式依赖，再按输入合法性，再按产品门禁，最后按规则故障确定。原因码 MUST 不包含原始值、派生值、堆栈或设备敏感信息，用户可见文案 MUST 将其映射为可操作的非敏感修正说明。实现 MUST 支持以下稳定原因码集合：`missing-income`、`missing-work-hours`、`missing-purchase-price`、`missing-fixed-cost`、`comparison-period-unconfirmed`、`currency-unconfirmed`、`tax-basis-unconfirmed`、`input-unconfirmed`、`invalid-decimal`、`zero-not-allowed`、`negative-not-allowed`、`fraction-exceeds-currency-minor-unit`、`numeric-limit-exceeded`、`unsupported-currency`、`currency-mismatch`、`period-mismatch`、`input-reconfirmation-required`、`tax-basis-not-after-tax`、`fixed-cost-coverage-incomplete`、`fixed-cost-coverage-description-missing`、`purchase-period-unconfirmed`、`division-by-zero` 和 `rule-execution-failed`。

#### Scenario: 多个问题仍有确定 primary reason

- **WHEN** 一个结果同时存在周期冲突、缺失输入和非法数值
- **THEN** 系统 MUST 按固定优先级返回稳定 primary reason，并返回去重的全部适用原因；同一输入、上下文和版本再次计算时顺序与代码 MUST 一致

#### Scenario: 原因信息不泄露敏感值

- **WHEN** 用户查看不足原因、错误提示、性能记录或测试结果
- **THEN** 内容 MUST 只包含稳定原因码和非敏感修正路径，不得包含真实金额、工时、派生财务值、原始 token、堆栈或日志中的敏感上下文

### Requirement: 展示舍入、负值和不可回流

所有舍入 MUST 只发生在最终展示边界，并使用不依赖浮点的 `half-away-from-zero`：比较 `2 × |余数|` 与分母，达到或超过一半时增加绝对商后恢复符号。金额 MUST 按货币 minor unit 展示；Income Rate MUST 展示 `min(4, max(currencyMinorUnit, 2))` 位小数；Work-time Equivalent MUST 以小时展示 2 位小数，精确非零但结果为 `0.00` 时 MUST 显示 `<0.01 小时`。结果依据 MUST 同时保留精确值、规范展示值、位数、舍入模式和 `rounded` 标记；展示值、分组符号和小数符号 MUST 永远不得回流为下游计算输入。

#### Scenario: 正数 tie 使用 half-away-from-zero

- **WHEN** 精确 Income Rate 为 `201/200 CNY/小时`，其展示边界正好是 `1.005`
- **THEN** 规范展示值 MUST 为 `1.01 CNY/小时`，并标记 `half-away-from-zero` 与 `rounded: true`；任何下游结果 MUST 仍使用 `201/200`

#### Scenario: 负数 tie 离零舍入

- **WHEN** 负的派生余量或差异在展示边界形成 `-1.005`
- **THEN** 规范展示值 MUST 为 `-1.01`，不得向零舍入、截断或改写为零；负值的精确数学意义和状态 MUST 保持不变

#### Scenario: 精确非零小时不伪装为零

- **WHEN** Work-time Equivalent 的精确正值小于半个展示最小单位，舍入结果会为 `0.00`
- **THEN** 系统 MUST 展示 `<0.01 小时`，同时保留精确有理数；该展示文本不得用于任何后续公式

### Requirement: 规则与货币快照版本不可变

每个结果、输入上下文和确认修订 MUST 保存 `rulesetId: purchase-decision-rules`、`rulesetVersion: 1.0.0`（合并为 `purchase-decision-rules@1.0.0`）以及固定的 `currencyTableSnapshotId: iso4217-list-one@2026-01-01#sha256:838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9`。规则版本、应用构建版本、Git SHA、货币快照版本和导出格式版本 MUST 分开记录。一个构建和一次会话 MUST 只使用一个不可变规则版本；实现不得运行时查询“当前”货币表、远端规则或静默切换版本。改变公式、依赖、状态优先级、输入限额、舍入、周期/时区语义、既有原因码含义或既有货币 minor unit 时 MUST 视为语义版本变化，不得原地重写已接受版本。

#### Scenario: 结果可追溯到规则和货币来源

- **WHEN** 任一公式成功生成结果或以 `insufficient-data` 结束
- **THEN** 结果 MUST 同时带有规则 ID/版本、货币快照 ID、周期引用、税口径和时间上下文；不得只写“当前规则”或“当前 ISO 表”

#### Scenario: 版本不能在会话中静默替换

- **WHEN** 构建发现不同规则版本或不同货币快照，或运行时无法访问固定快照
- **THEN** 系统 MUST 在会话建立或构建验证边界阻止该不一致配置并且不生成财务结果；该配置错误不得伪装成新的财务原因码，也不得远程获取、自动升级、换汇或用新版本重解释旧结果

### Requirement: 已确认输入的修改、取消与重新确认

用户开始编辑已确认输入时，所有依赖结果 MUST 立即失去“当前”资格并进入 `pending-reconfirmation`，旧结果只能作为当前会话内的最小历史快照，绝不能参与当前计算。取消未确认草稿 MUST 丢弃草稿且不创建修订事件；取消不得把旧结果对象重新标记为当前，结果必须继续等待重新确认。用户确认确有变更后 MUST 使用同一不可变规则版本重新计算，并为该次确认产生一条且仅一条 `confirmed-input-revision` 事件；事件可在独立系统事件命名空间标记 `eventStatus: actual`，但不得改变财务输入或结果的证据状态。事件 MUST 仅保留顺序号、触发者、完整时间上下文、字段、修改前后受限规范值/原始文本、证据状态、周期、币种/单位、确认时点、失效结果 ID、旧结果最小快照和规则版本。一次会话最多保留 50 条已确认修订，每条旧结果最多对应五个固定公式；第 51 次修订 MUST 在确认前被阻止，既有事件不得丢弃或截断。值未改变时不得伪造修订事件；刷新、关闭或退出 MUST 清除输入、结果、事件和旧快照。

#### Scenario: 开始编辑立即失效

- **WHEN** 用户开始修改任何已确认的收入、工时、价格、固定成本、周期或币种字段但尚未确认
- **THEN** 所有受影响结果 MUST 立即不可作为当前结果，当前可用性 MUST 表示 `pending-reconfirmation`，财务结果 MUST 不再参与任何下游计算

#### Scenario: 取消草稿不恢复旧结果

- **WHEN** 用户取消尚未确认的修改
- **THEN** 草稿和本次未确认变更 MUST 被丢弃，不得创建修订事件或把旧结果恢复为当前；依赖结果的证据状态 MUST 为 `insufficient-data`，独立工作流可用性 MUST 保持 `pending-reconfirmation`，直至用户重新确认有效输入

#### Scenario: 确认修改只产生最小修订

- **WHEN** 用户确认一项已确认输入的实际变更
- **THEN** 系统 MUST 生成新时间上下文下的新结果和一条且仅一条 `confirmed-input-revision`，旧值只存在最小快照中且不参与当前计算；财务证据状态 MUST 依据新输入重新求值，而不是被系统事件的 `actual` 覆盖

#### Scenario: 确认未改变的值不伪造事件

- **WHEN** 用户重新确认与原规范值相同的输入
- **THEN** 系统 MUST 重新建立当前有效性所需的结果，但不得伪造一条数值未变的修订事件；旧结果仍不得直接复用为新结果

#### Scenario: 会话终止清除修订历史

- **WHEN** 用户刷新、关闭或退出原型
- **THEN** 当前输入、结果、修订事件和最小旧快照 MUST 不可恢复；系统不得依赖浏览器持久化或声称可以恢复历史

#### Scenario: 第 51 条修订在确认前被阻止

- **WHEN** 当前会话已经保留 50 条已确认修订，用户准备确认另一项实际变更
- **THEN** 系统 MUST 在创建事件或替换当前确认状态前提示达到上限，保留既有输入、结果与 50 条事件，并允许用户先导出后刷新；不得丢弃、覆盖或截断旧事件

### Requirement: 纯内存、无 I/O 与跨浏览器确定性

计算合同 MUST 是不依赖 React 或 DOM 的纯 TypeScript 模块，并在当前会话内存中完成；不得读取或写入网络、Cookie、localStorage、sessionStorage、IndexedDB、Cache Storage、URL、剪贴板、文件、console、研究记录、随机数、locale 或隐式系统时钟。调用方 MUST 显式提供全部周期、币种、规则和时间上下文。不得以网络服务、日志、默认值、旧结果或 `Number` 路径兜底。对相同合成输入、显式上下文、规则版本和货币快照，目标浏览器 MUST 产生相同的规范精确值、状态、原因码、单位、版本和规范十进制展示值；本地化分组只能是外层展示，不得改变规范合同。

#### Scenario: 断网和无存储仍可计算

- **WHEN** 在无网络、禁用浏览器持久化且未提供系统时间的环境中执行固定合成输入
- **THEN** 系统 MUST 仅依据显式输入和固定表计算，得到与联网环境相同的规范结果，且不得产生产品数据请求、存储副本、console 输出或远程兜底

#### Scenario: 目标浏览器结果一致

- **WHEN** 在桌面 Chrome、macOS Safari、iOS Safari 等批准支持矩阵中使用相同输入、上下文和规则版本执行同一场景
- **THEN** 精确值/分子分母、证据状态、primary reason、单位、版本和规范展示值 MUST 完全一致；浏览器差异不得改变舍入边界或状态优先级

### Requirement: 合成 fixture 与边界结果合同

实现和验收 MUST 使用不含真实个人数据的 `SYN-01`–`SYN-05` 及新增边界、tie、负余量、周期/币种/税口径冲突 fixture。以下结果是可审计的行为合同，不得用默认值、展示近似或跨场景旧结果替代。

#### Scenario: SYN-01 全部用户确认但无固定成本

- **WHEN** 使用同一月度周期税后收入 `10000 CNY`、确认工作 `160 小时`、确认购买价格 `1000 CNY`，不填写固定成本
- **THEN** Income Rate 的精确值 MUST 为 `62.5 CNY/小时`、规范展示 MUST 为 `62.50 CNY/小时`，Work-time Equivalent 的精确值 MUST 为 `16 小时`、展示 MUST 为 `16.00 小时`，二者均为 `user-confirmed`；基线余量及购买后余量 MUST 为 `insufficient-data`

#### Scenario: SYN-02 完整覆盖和购买情景

- **WHEN** 在 SYN-01 中加入确认固定成本 `6000 CNY`、完整覆盖说明，并确认购买属于同一比较周期
- **THEN** `coverage-available-margin` MUST 为精确 `4000 CNY` 且为 `user-confirmed`，`purchase-after-margin` MUST 为精确 `3000 CNY` 且为 `forecast`，`purchase-impact` MUST 为精确 `-1000 CNY` 且为 `forecast`，Work-time Equivalent MUST 仍为 `16.00 小时`

#### Scenario: SYN-03 估算依赖传播

- **WHEN** 使用税后收入 `10000 CNY`（确认）、工作约 `160 小时`（估算）、购买 `1000 CNY`（确认）、固定成本约 `6000 CNY`（估算）、完整覆盖说明和同周期购买确认
- **THEN** Income Rate、Work-time Equivalent 和基线余量 MUST 为 `estimated`，购买后余量及购买影响 MUST 为 `forecast`，并 MUST 展示工时与固定成本的估算依赖

#### Scenario: SYN-04 缺少工时的局部不足

- **WHEN** 收入和购买价格有效但工作小时缺失
- **THEN** Income Rate 与 Work-time Equivalent MUST 为 `insufficient-data` 并返回 `missing-work-hours`；任何依赖工时的未来结果 MUST 同样为 `insufficient-data`，不得因为未来性质改为 `forecast`

#### Scenario: SYN-05 税前收入

- **WHEN** 使用同一月度周期税前收入 `10000 CNY`（确认）、工作 `160 小时`（确认）、购买 `1000 CNY`（确认）、固定成本 `6000 CNY`（确认）、完整覆盖说明和同周期购买确认
- **THEN** Income Rate MUST 为 `62.5 CNY/小时`、Work-time Equivalent MUST 为 `16 小时`，二者均为带 `before-tax` 口径的 `user-confirmed`；基线余量、购买后余量和购买影响 MUST 为 `insufficient-data` 并说明 `tax-basis-not-after-tax`

#### Scenario: 边界 tie、负余量和周期冲突

- **WHEN** 分别执行正负 `half-away-from-zero` tie、产生负的覆盖余量、输入超限值以及不同周期 revision/币种的同数值输入
- **THEN** 正负 tie MUST 按离零方向展示，负余量 MUST 保留精确负数，超限 MUST fail-closed，不同上下文 MUST 只停止受影响结果；所有结果均 MUST 保留稳定原因、版本和可解释依赖

## Traceability

- PRD 功能需求：`FR-02`–`FR-05`、`FR-07`–`FR-13`，并承接 `FR-17` 的计算内核 I/O 边界；`FR-06` 的价值期待与反评分语义由 `purchase-decision-workbench` 承担。
- PRD 验收标准：`AC-05`–`AC-11`、`AC-20`、`AC-21`、`AC-24`；合成计算样例：`SYN-01`–`SYN-05`。
- ADR：`ADR-0002` §5.1.1–§5.1.7（数值边界、上下文、公式、状态、原因码、舍入、版本与修订）、§6.3（隐私/无 I/O）、§8.2–§8.3（兼容与回滚）及 `ADR-C-03`–`ADR-C-08` / `VAL-01`–`VAL-12`。
