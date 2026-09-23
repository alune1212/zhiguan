# Proposal

## Why

当前首页要求先有购买计划，基础资料刷新即失，未实现用户最在意的“工作时间对应的收入逐秒积累”。Q1–Q13 已确认以收入理解为独立任务，降低首次输入与重复填写负担；本变更将 PRD-0003、RFC-0001、ADR-0008 的审阅稿转为可实施计划，不将规划视为实现或正式验证。

## What Changes

- 首次只填到手月收入，默认双休、09:00–12:00 / 13:00–18:00，详细设置折叠；首页展示今日收入估算、本月累计和每秒速率。
- 按保存时区与当月工作日历分摊，支持特殊日期；关闭后重新打开按时间重算，非工作时段不增长，始终明确 estimated。
- 同浏览器保存基础资料，主动收藏购买快照；提供备份恢复、单项删除和清空，失败不得静默覆盖。
- 购买分析改为次级入口，复用资料与日历计算口径，对话仅按需主动使用；临时购买改动不写回资料。
- **BREAKING** 新日历购买快照使用 `zhiguan-purchase-decision@2`，资料备份使用独立 `zhiguan-local-backup@1`；旧 @1 文件含义不变，不自动导入或猜测迁移。
- 同步宪法修订、策略、路线图、架构、PRD 和 ADR 的生效/实现状态，承认收入理解本身的价值；不增加账户、云同步、核薪、上报或自动节假日服务。

## Capabilities

### New Capabilities

- `income-dashboard`: 低输入设置、日历分摊、逐秒估算、详细设置和无障碍收入理解。
- `local-profile-and-favorites`: 同浏览器资料、收藏快照、版本化本地备份、恢复与删除的完整边界。

### Modified Capabilities

- `purchase-decision-workbench`: 从首页入口改为次级能力，复用资料与日历工时，修订默认值/对话来源、隐私说明及 @2 导出，保留决定、余量、失败接续及证据语义。

## Impact

- `src/app/App.tsx` 当前同时承载内存表单、确认、结果和导出，将接入看板与设置；`AssistInput.tsx` / `assist-flow.ts` 需识别复用资料而非重复追问，保留最少上下文规则。
- `src/domain/calculation.ts` 已有 BigInt/有理数、`calculateDecision` 与 `resolveWorkTime`，JSON 导出目前在 `App.tsx` 的 `createExportJson`；复用精度与证据逻辑，新增日历输入依据，不将新秒数先截成三位小数小时。
- `src/styles/app.css`、`tests/calculation.test.ts`、`tests/app.smoke.test.tsx`、`tests/assist.test.tsx` 和必要的新日历/存储测试；Bun 工具链不变，无新增外部服务。
- 新增原生浏览器本地存储与备份格式；保留现有 Jev 服务的主动调用边界，不保存或上传全部对话、资料与收藏。
- 现行宪法/策略、主 spec 和 ADR 仍有“单次购买、纯内存、不预选、平均月工时”等相反规则。实施首步应用 RFC-0001 和 ADR-0008 的批准范围并同步文档；本次仅生成 delta，不修改主 spec 或运行代码。
