> 归档说明（2026-09-03 核对）：本目录保留本次界面调整时的提案、设计、规格与验证记录。它先于同日的 Bun 迁移，文中的 npm 命令和当时文案属于历史记录；当前命令见根目录 `README.md`，当前规格见 `openspec/specs/purchase-decision-workbench/spec.md`，当前文案见 `docs/design/purchase-page-copy.md`。以上路径均相对仓库根目录。

## Why

当前单次购买页已经能完成计算和决定闭环，但主要信息仍被机械化标签、重复状态说明和同等权重的结果卡片遮住，用户难以一眼理解数字代表什么。页面文案草案已经确认，现在应先把这套语言和信息层级同步到现有界面，再考虑任何新功能。

## What Changes

- 以 `docs/design/purchase-page-copy.md` 为唯一文案基线，统一输入、结果、缺失数据和决定四个阶段的用户可见文字。
- 将工作时间结论作为主要结果，收入速率和本月余量作为补充结果；计算依据与统一限制保留为次级说明。
- 将 `user-confirmed`、`estimated`、`forecast` 和 `insufficient-data` 的含义写进具体句子，不要求用户理解独立状态标签。
- 按输入问题显示可行动的字段错误和缺失原因；负数余量用“还差 {金额} 元”表达，不改变底层负值。
- 将五种决定改为自然、可区分的动作文字，同时保持原有决定代码及用户自主选择边界。
- 同步组件和样式层级，并更新自动化测试与键盘、读屏、窄屏检查。
- 不新增或删除输入项，不改变计算公式、数值精度、证据状态、决定代码、JSON 导出格式、内存态隐私边界或网络行为。

## Capabilities

### New Capabilities

- `purchase-decision-workbench`: 规定现有单次购买页四阶段的自然语言、结果层级、状态解释、缺失反馈、决定表达及可访问呈现。当前主规格目录没有活动 spec，因此以新增 delta 记录这次用户可观察行为。

### Modified Capabilities

无。

## Impact

- 主要影响 `src/app/App.tsx`、`src/styles/app.css` 和现有组件测试。
- `src/domain/calculation.ts` 的公式、结果 ID、原因码和导出用精确值保持不变；如需自然句子所需的 view-model 分支，只能在界面呈现层派生。
- `docs/design/purchase-page-copy.md` 是验收基线；实施完成后更新其状态和对应测试断言。
- 不增加依赖，不涉及 API、数据库、存储、同步、外部服务或公开格式迁移。
