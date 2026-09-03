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

使用 **Bun 1.4.0** 管理依赖和运行开发工具，无需另装 Node.js 或 npm。React、Vite、Vitest 和 TypeScript 保持现有用途。

~~~text
bun ci
bun run dev
bun run check
~~~

`bun run build` 生成静态产物，`bun run preview` 在本机预览。`bun run test` 执行现有 Vitest 测试；`bun test` 是 Bun 自带的另一套测试运行器。

新增依赖使用 `bun add <包名>`（开发依赖加 `--dev`），默认保存精确版本；依赖变更一并提交 `package.json` 和 `bun.lock`。干净安装及 CI 使用 `bun ci`，锁文件与声明不一致时失败。

依赖安装脚本默认全部禁用，确需执行时先审查再加入 `trustedDependencies`。安装后和 `bun run check` 都会检查 peer dependencies，缺少必要依赖或版本不兼容时失败。`bunfig.toml` 统一使用 Bun 运行时，并关闭运行时自动安装依赖。

## 产品与实现边界

- 产品定义见 PRODUCT.md、PRODUCT_STRATEGY.md 和 ROADMAP.md。
- 当前功能短规格见 docs/product/prd/PRD-0001-single-purchase-decision-workbench.md；docs/product/prd/PRD-0002-goal-progress.md 已于 2026-09-01 按回滚条件退役，仅保留历史记录。
- 当前不可逆技术决定见 docs/adr/README.md。
- 术语、指标、数据和品牌边界见 docs/product/glossary.md、docs/product/metrics.md、docs/product/data-principles.md 和 docs/design/brand.md。

不在当前范围内：独立 Goal 进度、账户、完整记账、数据库、同步、提醒、研究招募、公开发布、排名、人生总分和替用户做决定。当前实现与使用反馈不构成研究或市场结论；研究招募暂停，也不是当前开发前置条件。
