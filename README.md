# 值观 Zhiguan

值观是一个 Personal Value Flow 单页工具：帮助用户理解一次购买选择。

## 当前实现

这是可运行的 React + TypeScript + Vite 单页应用，不是只有文档：

- 核心只填写月收入、月工时和购买价格，并选择税前或税后口径；固定支出、购买月份归属和价值期待放在可选区。
- 首先展示每小时收入和工作时间；开始补充余量信息后，再展示本月可用金额和购买后余量。JSON 仍保留购买影响这一项，供精确回看。
- 结果用中文说明含义、公式、状态和不足原因；输入冲突或缺失时诚实降级。
- 输入区用一个“这些数字里有估算值”选择统一标记数字证据；点击“确认并查看结果”即确认本次输入，导出 JSON 仍按每个数字字段保留证据状态。
- 用户可以记录购买、等待、调整条件、不购买或暂不决定，并主动导出当前 JSON；应用不联网、不持久化。

## 本地运行

~~~text
npm ci
npm run dev
npm run check
~~~

## 产品与实现边界

- 产品定义见 PRODUCT.md、PRODUCT_STRATEGY.md 和 ROADMAP.md。
- 当前功能短规格见 docs/product/prd/PRD-0001-single-purchase-decision-workbench.md；docs/product/prd/PRD-0002-goal-progress.md 已于 2026-09-01 按回滚条件退役，仅保留历史记录。
- 当前不可逆技术决定见 docs/adr/README.md。
- 术语、指标、数据和品牌边界见 docs/product/glossary.md、docs/product/metrics.md、docs/product/data-principles.md 和 docs/design/brand.md。

不在当前范围内：独立 Goal 进度、账户、完整记账、数据库、同步、提醒、研究招募、公开发布、排名、人生总分和替用户做决定。当前实现与使用反馈不构成研究或市场结论；研究招募暂停，也不是当前开发前置条件。
