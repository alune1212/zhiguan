## Context

本变更为 [`proposal.md`](proposal.md) 中单案例购买决策研究原型建立实现前的技术设计；它不改变产品动机或 PRD 的验收合同。

当前仓库没有应用、运行时、依赖清单、构建产物或产品数据。`PRD-0001` 已批准四阶段的纯客户端研究原型，本 OpenSpec 与 `Implementation Authorized` 已于 `2026-08-24` 获 Alune 批准；本设计可在后续独立执行中作为实施依据，但批准本身不表示已经初始化框架、安装依赖或产生运行证据，也不授权研究招募、参与者分发或部署。

实现必须服从三个已批准 ADR：

- `ADR-0001` 固定 React + TypeScript + Vite、研究者控制的 loopback/受控 LAN 静态交付、精确版本工具链、无后端/无持久化/无运行时外部资源，以及安全头和整体构建回滚边界。
- `ADR-0002` 固定无 I/O 的纯 TypeScript 规则内核、`BigInt` 最小货币单位、有理数工时、周期/币种/时区上下文、证据状态传播、失效/修订、精度和规则版本合同。
- `ADR-0003` 固定不可变 `ExportSnapshotV1`、版本化 JSON、安全 GFM Markdown、逐格式下载请求、资源限额和临时对象清理；浏览器只能报告 `download-requested`，不能伪称文件已经保存。

因此设计的主要约束是：敏感会话数据只在当前页面内存中流动；UI 不得复制计算规则；数据不足必须局部、可解释地降级；导出必须从同一个冻结快照产生；构建、测试和交付必须能以完整版本单元复现并整体停止/回滚。研究同意、联系方式、脱敏观察和研究存储属于产品外 `RESEARCH-0001`，不进入本变更的应用边界。

## Goals / Non-Goals

**Goals:**

- 为四个界面阶段建立清晰的模块边界和单向数据流，并明确映射 `Capture → Normalize → Understand → Simulate → Decide` 五个价值循环阶段，使输入、确认、计算、解释、决定和导出可以分别测试。
- 用内存内的会话状态机区分草稿、已确认输入、当前派生结果、失效结果和导出预览，确保修改、取消、刷新和退出都不会复用陈旧值。
- 以 `ADR-0002` 的精确定点/有理数规则内核作为所有结果和状态的唯一来源，并保留公式、依赖、原因、版本和时间上下文供 UI 与导出解释。
- 以一次冻结的 `ExportSnapshotV1` 驱动 JSON 与安全 GFM Markdown 两种等价投影，并将 Blob/object URL 生命周期限制在 DOM 适配器内。
- 交付一个本地打包、默认 loopback、必要时受控 LAN 的静态研究构建；构建安全头、零数据外发/持久化边界和整体停止/回滚均可验证。
- 建立只使用合成 fixture 的类型、规则、组件、浏览器、无障碍、网络/存储、导出、性能、供应链和构建复现证据链；所有实现前证据仍保持待实施状态。

**Non-Goals:**

- 不实现账户、身份、后端 API、数据库、浏览器持久化、同步、导入、恢复、分享、通知、AI、分析、会话重放或任何正式产品能力。
- 不实现研究同意、联系人管理、脱敏观察采集、研究存储 A/B、招募、研究日历或产品外回访系统；原型只提供交接所需的当前会话字段。
- 不提供云托管、公开远程访问、SSR、PWA、Service Worker、Router、外部状态库、UI 组件库、远程字体/CDN、运行时规则服务或动态依赖。
- 不改变 `PRD-0001`、`ADR-0001`～`ADR-0003` 的字段、计算、导出、隐私、支持矩阵、门禁或回滚含义，也不把计划验收写成已通过证据。

## Decisions

### 1. 模块边界与单向数据流

应用按职责分成五个边界，依赖方向只向下游流动：

1. **UI 层**负责 React 组件、可见表单、四阶段导航、依据面板、文案、焦点和 ARIA 状态。它只读取会话 view model，只发出用户意图（编辑、确认、取消、决定、预览、下载、退出），不计算金额、不解析证据状态，也不直接访问浏览器存储或网络。
2. **会话/状态层**负责内存状态机、草稿与确认边界、修订序号、依赖失效、决定/复盘字段和导出资格。它调用规则内核产生新的不可变结果，不保存跨会话数据。
3. **规则内核**是无 React、DOM、时间读取、随机数、网络、文件、locale、console 和存储依赖的纯 TypeScript 模块。它接收显式上下文和规则/货币快照，返回带精确值、展示值、状态、原因、依赖和版本的结果。
4. **导出领域层**将稳定会话转换为一次性的 `ExportSnapshotV1`，在快照级执行 Unicode、结构和资源限额检查；JSON 与 Markdown serializer 只接受冻结快照，不读取可变 UI 状态。
5. **浏览器/交付适配层**是唯一可以接触 DOM、Blob、object URL、临时 `<a download>`、页面生命周期和静态构建配置的边界。它把用户动作转成会话命令或导出命令，并将浏览器可观察结果映射为 `download-requested`/失败等交互状态。

数据流固定为：

```text
用户事件
  → UI intent
  → session reducer/state machine
  → draft validation / confirmation
  → pure rules kernel
  → immutable result + view model
  → React rendering and explanation

stable session state
  → ExportSnapshotV1 freeze
  → JSON serializer       → DOM download adapter → download-requested
  → Markdown serializer   → DOM download adapter → download-requested
```

规则内核和导出领域层不得反向依赖 React；UI 不得绕过会话层直接调用 serializer；DOM 适配器不得修改领域值或在下载失败时补发网络请求。应用入口只负责组合这些边界和提供显式的设备时间/时区上下文，不把系统默认值偷偷写进领域模块。

**替代方案与拒绝理由：**

- 在每个 React 页面/组件中计算：拒绝，因为页面重构会产生公式、状态和失效语义分叉，且无法把精确规则作为单一可测试合同。
- 让 React 组件直接持有所有可变状态并由导出器再次读取：拒绝，因为预览和两次下载之间可能读取不同状态，形成陈旧或混合快照。
- 引入外部状态库或通用事件总线：拒绝，因为本期状态只属于一个短生命周期会话，新增依赖和隐式订阅会扩大供应链、持久化误用和审计面。
- 让规则内核直接操作 DOM 或读取系统时间：拒绝，因为这会破坏确定性、跨浏览器复现和无 I/O 隐私边界。

### 2. 会话状态、草稿/确认/失效与生命周期

会话状态以明确的三层语义组织：

- **草稿（draft）**：用户正在编辑的未确认值和 UI 校验状态。草稿可以被取消，不产生修订事件，也不能进入计算或导出；它不覆盖当前已确认输入。
- **确认状态（confirmed session）**：按当前比较周期 revision、币种、税口径和各字段状态保存的已提交输入、决定、复盘选择及最小确认元数据。只有这一层才是规则内核和快照的输入来源。
- **派生状态（derived results）**：规则内核根据确认状态生成的不可变结果集合。每项包含 `available`/`unavailable`、四类产品财务结果状态（`insufficient-data / forecast / estimated / user-confirmed`）、精确/展示值、公式、依赖、原因、规则/货币快照和完整时间上下文；`actual` 只允许出现在独立系统修订事件或产品外研究层，不能用旧值补齐不可用结果。

三个 revision 命名空间 MUST 分离：`periodRef.revision` 只标识用户确认的比较周期版本，只有周期变化才递增；`sessionRevision` 在任何影响当前稳定快照的输入、决定、复盘、时区或重算确认后递增，并在冻结时复制为导出的 `snapshot_revision`；`confirmed-input-revision.sequence` 只为实际改变已确认输入的最小事件递增并受 50 条上限约束。它们不得共用计数器或互相替代。

状态转换遵循以下原则：

1. 初始会话没有可导出内容；至少一项 `user-confirmed` 或 `estimated` 输入被提交到稳定会话状态后，才可能出现局部结果和导出入口。
2. 开始编辑已确认字段即使其依赖结果失去“当前”资格，进入 `pending-reconfirmation`；UI 可显示待确认提示，但不显示旧结果为当前结论。
3. 取消未确认草稿不会创建 `confirmed-input-revision`，也不会把旧结果重新标记为当前；依赖结果保持待重新确认，直到用户明确确认仍有效的输入并重新计算。
4. 确认修改时递增会话 revision，先使受影响结果失效，再用同一不可变 ruleset 计算新结果；修订事件只保留 ADR-0002/0003 规定的最小前后值、旧结果快照和时间上下文，并受 50 条上限约束。
5. 缺失、无效、周期/币种冲突、税口径不允许、覆盖不足或规则故障返回 `null + insufficient-data`；仍安全的其他结果继续可见。未来购买情景优先保持 `forecast`，但缺失优先于未来状态。
6. 进入导出预览时冻结 revision；预览后的编辑、确认、重算、周期/币种/时区变化或构建变化都使快照 `stale`，必须重新预览。刷新、关闭、退出和 `pagehide` 清除应用引用、预览 view model 和临时下载资源，不尝试恢复。

复盘条件、决定依据和价值期待是当前会话字段，不进入研究存储；用户主动导出时作为快照的一部分带走。会话状态不写入 Cookie、Web Storage、IndexedDB、Cache Storage、URL、剪贴板或服务端。任何需要跨会话恢复的需求都不属于本设计。

**替代方案与拒绝理由：**

- 直接在输入变化时覆盖确认值并继续显示旧结果：拒绝，因为用户尚未确认的新值和旧结果会混合，违反修订与可解释性合同。
- 取消编辑后恢复旧结果为“当前”：拒绝，因为 ADR-0002 明确要求旧结果不再参与当前计算；恢复必须重新确认并重新生成。
- 将草稿或结果写入 localStorage/sessionStorage 以减少输入：拒绝，因为本期明确禁止持久化，且会引入删除、恢复和隐私副本边界。
- 用一个笼统的 `loading/error` 标记替代证据状态和可用性：拒绝，因为工作流失效不是第六种证据状态，且用户无法知道缺什么、如何修正。

### 3. 精确规则内核与可解释结果

规则内核以纯函数和显式依赖表承载 `ADR-0002`：

- 金额先按固定 ISO 4217 快照转换为最小货币单位 `BigInt`；工时和除法结果使用约分、分母为正的 `BigInt` 有理数。领域金额、工时、速率和派生值不经过 JavaScript `Number`、浮点、`parseFloat` 或中间展示值。
- 输入先经过长度、ASCII 十进制、正数、币种 minor unit、工作小时和有理数分子/分母限额校验；超限、零、负数、非法语法和不支持币种返回稳定原因码并局部停止依赖结果。
- 周期 revision、币种、税口径、设备时点、IANA 时区来源、ruleset `purchase-decision-rules@1.0.0` 和固定货币快照由调用方作为不可变输入传入；内核不读取 locale、当前系统时间或远程货币表。
- `income-rate`、`work-time-equivalent`、`coverage-available-margin`、`purchase-after-margin` 和 `purchase-impact` 由内核统一计算。余量可以为零或负数；税后收入与完整固定成本覆盖足以计算 `coverage-available-margin`，只有 `purchase-after-margin` 与 `purchase-impact` 额外要求用户确认购买计入当前周期。
- 状态传播按 `insufficient-data > forecast > estimated > user-confirmed` 执行；研究层或系统事件的 `actual` 不进入产品财务状态。每个结果带公式 ID、依赖字段、原因码、假设、限制、生成时点、精确值、展示值、舍入元数据和版本。
- 所有舍入只在展示边界执行，统一 `half-away-from-zero`；Income Rate 和 Work-time Equivalent 的显示规则不回流到后续公式。`Intl.NumberFormat` 只负责已确定十进制字符串的本地化呈现。

规则内核输出不可变领域结果；UI 通过 view model 展示简明结果和“查看依据”，导出层直接承接同一结果，不复制公式或自行决定 `insufficient-data`。失败不得回退为零、旧值、默认工时、浮点路径、网络规则或静默猜测。

**替代方案与拒绝理由：**

- JavaScript `Number`：拒绝，因为二进制浮点和安全整数边界不能满足精确、可重现的货币和除法合同。
- 仅使用货币最小单位整数：拒绝，因为速率与工作时间等价需要精确有理数，不能提前截断或舍入。
- 引入 decimal 包或通用规则引擎：拒绝，因为本期固定公式可由原生 `BigInt`/有理数实现，新增运行时依赖、动态规则和供应链面不必要。
- 在组件中用已展示的 Income Rate 继续计算 Work-time Equivalent：拒绝，因为会把展示舍入误差传播到领域结果。

### 4. 冻结快照、双投影与 DOM adapter

导出采用“冻结一次、纯函数双投影、适配器请求下载”的结构：

1. 导出资格只从稳定确认状态判断；未确认草稿、旧结果、待重新确认字段和构造时 revision 变化均阻止快照。合法的未提供字段和 `insufficient-data` 结果可以导出，但必须为显式 `null` 加独立可用性/原因。
2. 预览阶段把当前会话复制成不可变 `ExportSnapshotV1`，执行 Unicode scalar、换行、NUL/孤立 surrogate 和资源限额检查；预览本身不创建 Blob 或 object URL。
3. JSON serializer 输出固定顺序、显式字段、内嵌字典、UTF-8/LF 和精确数字字符串；Markdown serializer 输出固定章节、安全 GFM 子集和可逆 Unicode visible escape。用户自由文本只能进入独立字面代码块，serializer 必须确定性选择不与内容冲突的围栏；自由文本不能成为标题、表格语法、HTML、链接、图片或自动链接。
4. 两个 serializer 以稳定字段 ID、状态、单位、依赖、原因和修订语义进行跨格式等价断言；除格式/表示层元数据外，必须引用同一 `snapshot_revision` 和 `snapshot_captured_at`。
5. DOM adapter 在明确用户动作内串行创建一个格式的 Blob、短时 object URL 和临时 anchor；同步 `click()` 成功只转换为 `download-requested`。下一 macrotask 或 `pagehide` 幂等撤销 URL、移除 anchor、释放字符串/Blob 引用；失败保持会话不变，不自动重试、不清除会话、不切换到网络/剪贴板/分享。

浏览器时间适配器是唯一可读取设备时钟和 IANA 时区建议的边界。它把 UTC instant 规范为 `Date.prototype.toISOString()` 的 `YYYY-MM-DDTHH:mm:ss.sssZ` 形式，领域层只接受严格匹配且可往返的值；`occurred_at_utc` 与 `recorded_at_utc` 仍是两个显式字段。`snapshot_captured_at` 在冻结时记录，`file_generated_at` 在每个格式生成时另行记录；两种建议文件名只使用同一 `snapshot_captured_at` 截至秒的 UTC stem，不使用 `file_generated_at` 或任何用户文本。

下载交互状态（`idle / previewing / ready / generating / download-requested / failed / cancelled`）与五类证据代码分离；产品财务结果仍只使用不含 `actual` 的四类状态。JSON 和 Markdown 分别报告成功请求或失败；不能把一个格式的请求发起描述为两格式已保存，也不能声称浏览器/操作系统已经落盘。

**替代方案与拒绝理由：**

- 两个 serializer 各自读取可变页面状态：拒绝，因为容易产生字段、状态或修订漂移。
- 只导出 JSON 或只导出 Markdown：拒绝，因为本期既需要机器可读迁移出口，也需要用户可读摘要。
- 直接拼接完整 GFM/HTML：拒绝，因为用户文本可改变 Markdown 结构或触发外部内容；安全子集牺牲富文本自由是有意取舍。
- File System Access、Web Share、剪贴板、服务器生成或 `data:` URL：拒绝，因为扩大权限、目的地或数据外发边界，且超出一次性本地下载合同。

### 5. 静态交付、模块安全头与隐私边界

构建采用 ADR-0001 的精确版本工具链和最小依赖白名单：Node.js `24.19.0`/npm `11.17.0` 只用于 `npm ci`、类型检查、测试和构建；浏览器运行时为 `react@19.2.8`、`react-dom@19.2.8` 与本地项目资源。Vite 只生成静态 `dist`，不生成 SSR、API、Functions、Service Worker、PWA manifest 或数据库配置。

研究运行时默认由锁定版本的 `vite preview` 绑定 `127.0.0.1:4173` 并启用 `strictPort`，只在跨设备验收确有必要且网络/设备边界已 readback 时短时绑定研究者控制的 LAN 地址；不使用公共、访客或无法说明日志边界的网络。构建完成后可断网运行，图像、图标及其他非系统资源全部随构建提供，字体只使用本地 CSS 声明的系统字体栈；不引入 CDN、远程 ESM、打包/外部字体、分析、错误上报或会话重放。

静态响应和浏览器边界通过 Vite `preview.headers` 与构建/浏览器断言至少固定：`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`；CSP 的 `default-src 'self'`、`connect-src 'none'`、`form-action 'none'`、`object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`，并将脚本、样式、图片和字体限制在构建内必要来源。应用禁止 Cookie、Web Storage、IndexedDB、Cache Storage、Service Worker、剪贴板、URL 敏感值和任何产品数据请求。服务端/终端不保留请求日志；若无法证明无持久元数据，则停止该交付方式并按 ADR-0001 fail-closed。

该边界只覆盖原型当前会话。PRD 中针对未来静态托管的最小字段、最多 7 天、仅 Alune 查看和删除 readback 不是本次已选交付方式的兜底许可；当前 loopback/受控 LAN 路径一旦无法证明不持久化请求元数据，就必须停止，只有新的 Accepted ADR 才能启用其他托管方式。研究联系方式、同意、脱敏观察、研究编号和研究存储不加载进应用，不写入构建产物或导出文件。

构建元数据使用一个非循环、可机械复核的合同：`app_version` 读取根 `package.json` 的精确 SemVer（首版 `0.1.0`），`config_version` 固定为 `research-static-config@1.0.0`，`git_commit_sha` 为构建 checkout 的 40 位小写提交 SHA。构建脚本按 UTF-8 字节顺序排列规范 POSIX 相对路径，为 `dist` 文件、`package-lock.json`、构建配置、ruleset、货币快照和导出 schema/format 常量记录字节数与 SHA-256，生成 UTF-8/LF、固定键顺序的外部 `artifact-manifest.json`；只有 manifest 本身不进入条目。为解除自引用，`dist/index.html` 中固定的 `artifact-manifest-sha256` meta 值在生成和复核文件条目时规范为 64 个 ASCII `0`，计算 manifest 摘要后再替换为真实 SHA-256；浏览器适配层只从这组固定 meta 读取四个 `application_build` 字段，不新增 fetch，也不把 DOM 元数据交给规则内核。`artifact_manifest_sha256` 是 manifest 精确字节的 SHA-256；manifest、meta carrier、规范化条目或版本任一不一致都阻止启动或导出。该摘要用于可复现性，不宣称签名或防篡改。

Artifact manifest 的内部顶层 schema 固定为 `manifest_version`、`app_version`、`config_version`、`build_mode`、`worktree_state`、`git_commit_sha`、`entries`（固定顺序）；`build_mode` 仅允许 `release` 或明确标记的 `implementation-preview`，`worktree_state` 仅允许 `clean` 或 `dirty`，而 `entries` 逐项包含规范 POSIX 相对 `path`、UTF-8 字节数和小写 SHA-256。`build_mode` 与 `worktree_state` 是 manifest 内部的构建来源/门禁信息，不能复制到 `application_build`；导出 wire contract 的 `application_build` 仍严格只有 `app_version`、`git_commit_sha`、`artifact_manifest_sha256`、`config_version` 四个字段。默认 production build/preview 只接受 `release` + `clean`，实现预览不构成研究构建或可分发证据。

**替代方案与拒绝理由：**

- 云静态托管或公开 URL：拒绝，因为当前不能证明项目级日志、访问、用途和删除边界，且会扩大研究访问面。
- SSR/全栈框架、后端或数据库：拒绝，因为会引入服务端副本、身份/权限、迁移和删除合同，超出本期纯客户端研究原型。
- `file://` 单文件包：拒绝，因为需要额外内联/打包机制，当前没有足够的跨浏览器与 CSP 证据；受控 `vite preview` 已满足本期交付。
- 公共或长期 LAN 服务：拒绝，因为不符合短时、研究者控制和可停止的边界。

### 6. 测试证据与构建可复现性

测试按层级和证据类型组织，避免只证明页面能显示：

- `tsc --noEmit` 验证领域、状态、快照和适配器类型边界；Vitest 对解析/有理数/舍入、公式依赖、状态矩阵、修订失效、快照结构、Unicode 和限额执行表驱动测试。
- React Testing Library 验证可见标签、错误关联、阶段转换、依据展开、决定/复盘、预览/取消和局部 `insufficient-data`；组件只断言规则内核返回的结果，不重算领域值。
- Playwright 在 PRD 支持矩阵中验证主/失败流程、网络捕获、Cookie/Storage/URL、下载请求、页面生命周期和部分失败；axe 只提供自动化无障碍补充。
- 真实浏览器人工验收覆盖桌面键盘、macOS VoiceOver、iOS VoiceOver、焦点/状态公告、减少动态和文案；自动化不能替代这些证据。
- 只使用 `SYN-01`～`SYN-05`、边界数字、恶意 Markdown/Unicode、最大会话和故障 fixture；不使用真实/近似个人的收入、工时、购买、身份、研究记录或含此类数据的截图，合成 fixture 的验收截图仍可作为证据。
- `VAL-01`～`VAL-12` 和 PRD AC 证据分阶段记录为“待实施”直到真实运行验证完成；OpenSpec 设计不把类型通过、静态审查或本地构建预期写成 `Prototype Accepted`。

每个研究构建是不可拆分的可复现单元：批准 commit、精确 `package-lock.json`、Node/npm 版本、配置、ruleset、ISO 货币快照、测试 fixture 和 `dist` artifact manifest/SHA-256 一起记录。构建使用 `npm ci` 和锁定版本；`dist` 不含 source map、真实数据、测试截图、开发日志或远程资源。构建前后执行依赖清单、许可证、安装脚本、安全通告、peer/engine、静态外联和产物内容检查；任何未批准依赖、动态下载或不一致摘要都阻止构建使用。

验证应证明四个可回滚门槛：规则结果与快照语义可重现；两种导出跨格式等价且安全；浏览器无产品数据外发/持久化；静态服务可以停止并从完整版本单元恢复。失败时暂停整个构建，定位并清除可控副本，恢复上一份整体已验证版本；不能只替换一个页面、serializer、依赖或规则文件，也不能声称代码回滚会召回已下载文件。

**替代方案与拒绝理由：**

- 只运行组件 smoke test 或检查页面截图：拒绝，因为无法证明精确计算、证据状态、网络/存储、下载失败、VoiceOver 和导出等价。
- 使用真实参与者数据或真实财务输入测试：拒绝，因为违反最小化和不进入测试/日志/截图的隐私边界；合成 fixture 已覆盖验收变量。
- 使用浮动依赖、在线 schema 或运行时货币/规则服务：拒绝，因为无法重现构建/结果，并扩大网络和供应链边界。
- 只回滚某个 JS 文件或某个 serializer：拒绝，因为构建、规则、货币快照、导出版本和配置共同决定用户看到的合同，必须整体回滚。

## Risks / Trade-offs

- React 组件与纯 TypeScript 结果可能分叉 → 规则、状态和导出只允许从单一内核/快照读取；禁止组件内复制公式，并以状态矩阵和跨层断言拦截漂移。
- 草稿、旧结果或预览快照被误当成当前事实 → 将 draft、confirmed、derived、pending-reconfirmation 和 `stale` 分层；任何确认/修订/预览后变化都使依赖结果或快照失效，取消不恢复旧结果。
- 自建 `BigInt`/有理数/舍入内核存在高影响边界错误 → 固定解析与资源上限，使用表驱动、边界、性质和独立参考向量测试；任一差异立即停止构建并整体回滚。
- 安全 Markdown 处理遗漏控制字符或结构注入 → 先做快照级 Unicode 预检，用户文本只进入可逆字面代码块，禁止 HTML/链接/图片/autolink，并以 JSON 解析值和冻结快照做跨格式 scalar 级比较。
- 浏览器下载请求被误报为文件已保存 → 只使用 `download-requested`，逐格式保留状态，临时 URL 下一 macrotask/卸载时幂等撤销；预览和文案明确最终路径、改名和落盘由设备决定。
- Blob/object URL 或预览 DOM 副本保留敏感数据过久 → 限制单格式串行资源，取消/失败/pagehide/下一请求统一清理 anchor、ARIA/DOM、字符串、Blob 和 URL；清理失败时停止新的导出并要求刷新/关闭。
- 快照/自由文本/修订限额阻塞合理研究会话 → 在确认和预览前机械执行 `ADR-0003` 上限，明确提示并允许先导出后刷新；禁止静默截断、压缩或服务器兜底，合法会话超预算时先暂停并复审 OpenSpec/ADR。
- 静态服务或网络环境泄露访问元数据或引入外连 → 默认 loopback、短时受控 LAN、`no-store`、CSP `connect-src 'none'`、断网验收和会前后 readback；无法证明日志/代理/网络边界时停止交付，只有新的 Accepted ADR 才能选择其他分发方式。
- 依赖供应链或构建环境漂移 → 精确白名单、`npm ci`、lockfile、许可证/安装脚本/安全通告/engine 检查和产物摘要；版本、规则、货币快照或配置不一致时不启动服务。
- VoiceOver、键盘或性能预算未达标但自动化显示通过 → 把人工 VoiceOver/键盘和固定设备性能作为独立门禁，axe/Playwright 只作补充；未达标不得标记 `Prototype Accepted`。
- 错误构建已经生成用户下载文件 → 立即停止分发和导出，记录构建/规则/格式/货币版本并通知处置；整体回滚只能影响后续会话，不能召回、删除或改写外部文件。
- 未来需求推动增加研究存储、招募或云端能力 → 将其视为越界信号，停止当前变更并另行提交适用 PRD/RFC/ADR；本设计不通过“临时”接口或隐藏配置预留该能力。

## Migration Plan

当前是“无应用、无产品数据、无旧客户端”的初始状态，不需要数据迁移或回填。首次实现和安全回退按完整版本单元执行：

1. 在 `Implementation Authorized` 之后，按本设计和已批准 ADR 初始化最小 React/TypeScript/Vite 目录、精确依赖和锁文件；先建立纯规则/状态/快照模块及合成 fixture，再接入 UI 和 DOM 适配器。不得在初始化阶段加入研究存储、账户、后端、云托管或其他非目标能力。
2. 在受信、无参与者数据的环境用 `npm ci` 生成并验证类型、测试、静态 `dist`、安全头、依赖清单和 artifact manifest；记录 commit、Node/npm、lockfile、配置、ruleset、货币快照和产物 SHA-256。未完成 `VAL-01`～`VAL-12` 相应证据前，不得把构建称为研究就绪。
3. 先以 loopback 运行固定构建并完成网络/存储/日志/导出/规则/无障碍/性能 readback；只有跨设备验收必要且 LAN、设备、端口和日志边界已确认时，才短时开放研究者控制的 LAN。研究招募和研究记录仍需 `RESEARCH-0001` 另行门禁，不由本设计推进。
4. 若首个构建在任一规则、状态、隐私、导出、资源、性能、可访问性、供应链或安全头验证失败，立即停止服务、关闭端口、撤下构建并清除应用可控临时资源；首次无上一版本可恢复时保持不可用，不为维持会话继续使用问题构建。
5. 若已有上一份完整验证版本，整体恢复该版本的 Git commit、`dist`、依赖锁、Node/npm、配置、安全头、ruleset、货币快照、schema/format 版本和 manifest；重新执行受影响的 fixture、浏览器、网络/存储、下载生命周期和停止/恢复证据，全部通过后才重新开放。
6. 若问题涉及外发、持久化、敏感日志、错误状态升级、不安全 Markdown、跨格式漂移或错误结果，按关键隐私/信任事件暂停整个研究构建；定位、删除并验证可控副本后再修复和复验。若合法需求超出本设计或任一 Accepted ADR，停止并提交新的 PRD/RFC/ADR/OpenSpec 变更，不在本次实现中隐式扩展。

由于没有应用数据，回滚不包含数据库迁移、用户回填或跨会话兼容。用户已经下载的文件属于设备外部副本，任何代码/静态资源回滚都不能召回、删除、改写或证明其已被修复；处置必须通过版本记录、清晰通知和用户自行管理边界完成。
