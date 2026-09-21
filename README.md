# 值观 Zhiguan

值观是一个 Personal Value Flow 单页工具：帮助用户理解一次购买选择。

## 当前实现

这是可运行的 React + TypeScript + Vite 单页应用，不是只有文档：

- 核心填写月收入和购买价格，并选择税前或税后口径和自己的平时作息；默认不选作息，确有需要时可从次级入口直接填写“每月工作时间”，固定支出、购买月份归属和价值期待放在可选区。
- 作息提供每周 5 天 × 每天 8 小时、每周 6 天 × 每天 8 小时两个快捷项，也可以自己填写每周平均上班天数和每天平均工作小时数。
- 首先展示工作时间结论，以每小时收入作为补充；开始补充余量信息后，再展示本月可用金额和购买后余量。JSON 仍保留购买影响这一项，供精确回看。
- 结果用中文说明含义、公式、状态和不足原因；输入冲突或缺失时诚实降级。
- 作息换算的月工时按每周天数 × 每天小时 × 52 ÷ 12 估算，并在进入现有计算前按三位小数、四舍五入归一化；这部分始终是 `estimated`。输入区的“我填写的数字里有大概数”只影响用户直接填写的数字，不会把作息估算变成已确认事实；点击“确认并查看结果”即确认本次输入，导出 JSON 仍按每个数字字段保留证据状态。
- 用户可以记录购买、等待、调整条件、不购买或暂不决定，并主动导出当前 JSON；普通填表和计算在本地完成，不持久化。可选 Jev 辅助填写仅在主动提交时发送描述文字，核对后只填入空白字段。

## 本地运行

使用 **Bun 1.4.0** 管理依赖和运行开发工具，无需另装 Node.js 或 npm。React、Vite、Vitest 和 TypeScript 保持现有用途。

~~~text
bun ci
bun run dev
bun run check
~~~

`bun run build` 生成静态产物，`bun run preview` 在本机预览。`bun run test` 执行现有 Vitest 测试；`bun test` 是 Bun 自带的另一套测试运行器。

### 可选辅助填写

项目根目录 `.env` 设置 `TYPESAFE_API_KEY=你的密钥`（已被 Git 忽略，不使用 `VITE_` 前缀）。Python 3.14+ 与 SDK 由 uv 管理：

```sh
uv sync --locked
bun run build
uv run --locked --env-file .env scripts/jev_server.py
```

打开 `http://127.0.0.1:4174` 可使用完整本机版本。开发时保持 Python 服务运行，在另一终端运行 `bun run dev`，`http://127.0.0.1:4173` 会将 `/api` 转发到 Python 服务；Vite 预览也配置了同一代理。服务仅绑定回环地址，不用于公开或多人部署。密钥缺失或服务不可用时，仍可手动填表。

点击“帮我整理”才将描述发送 TypeSafe/Jev，其他表单内容不随请求发送；服务不记录描述或模型响应正文。取消只能停止页面等待，无法撤回已发出的外部请求。不承诺第三方数据保留政策，勿在描述中包含身份信息。结果仍需核对，不自动填零或替代购买决定。

后端离线检查：`uv run --locked python -m unittest discover -s scripts -p 'test_jev_server.py'`。此命令不调用模型；合成样本实验命令见 ADR-0006。

新增依赖使用 `bun add <包名>`（开发依赖加 `--dev`），默认保存精确版本；依赖变更一并提交 `package.json` 和 `bun.lock`。干净安装及 CI 使用 `bun ci`，锁文件与声明不一致时失败。

各依赖包自带的安装脚本默认全部禁用，确需执行时先审查再加入 `trustedDependencies`。项目自身的 `postinstall` 和 `bun run check` 都会检查 peer dependencies，缺少必要依赖或版本不兼容时失败。`bunfig.toml` 统一使用 Bun 运行时，并关闭运行时自动安装依赖。

## 产品与实现边界

Jev 辅助填写的接入决定与虚构样本实验记录见 [ADR-0006](docs/adr/ADR-0006-jev-integration.md)。现有金额计算、决定和导出格式保持原有逻辑。

- 产品定义见 PRODUCT.md、PRODUCT_STRATEGY.md 和 ROADMAP.md。
- 当前功能短规格见 docs/product/prd/PRD-0001-single-purchase-decision-workbench.md；docs/product/prd/PRD-0002-goal-progress.md 已于 2026-09-01 按回滚条件退役，仅保留历史记录。
- 当前不可逆技术决定见 docs/adr/README.md。
- 术语、指标、数据和品牌边界见 docs/product/glossary.md、docs/product/metrics.md、docs/product/data-principles.md 和 docs/design/brand.md。

不在当前范围内：独立 Goal 进度、账户、完整记账、数据库、同步、提醒、研究招募、公开发布、排名、人生总分和替用户做决定。当前实现与使用反馈不构成研究或市场结论；研究招募暂停，也不是当前开发前置条件。
