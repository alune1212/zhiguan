# 值观 Zhiguan

值观是一个帮助用户理解单次购买选择的 Personal Value Flow 单页工具：把收入、工作时间、固定成本、购买价格和个人期待放在同一份可解释的当前会话里。

## 当前实现

这是可运行的 React + TypeScript + Vite 单页应用，不是只有文档：

- 输入并确认 CNY 月收入、月工时、税口径、购买价格/月份归属和价值期待；固定支出覆盖确认只影响余量结果。
- 在同一页面展示 Income Rate、Work-time Equivalent、覆盖范围内可用余量、购买后余量、购买影响五个结果。
- 结果说明来源、公式、状态和不足原因；输入冲突或缺失时诚实降级。
- 用户可以记录购买、等待、调整条件、不购买或暂不决定，并主动导出当前 JSON；应用不联网、不持久化。

## 本地运行

~~~text
npm ci
npm run dev
npm run check
~~~

## 产品与实现边界

- 产品定义见 PRODUCT.md、PRODUCT_STRATEGY.md 和 ROADMAP.md。
- 当前功能短规格见 docs/product/prd/PRD-0001-single-purchase-decision-workbench.md。
- 当前不可逆技术决定见 docs/adr/README.md。
- 术语、指标、数据和品牌边界见 docs/product/glossary.md、docs/product/metrics.md、docs/product/data-principles.md 和 docs/design/brand.md。

不在当前范围内：账户、完整记账、数据库、同步、提醒、研究招募、公开发布、排名、人生总分和替用户做决定。研究招募暂停，不是当前开发前置条件。
