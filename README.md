# 值观 Zhiguan

值观是一个 Personal Value Flow 单页工具：帮助用户理解一次购买选择。

## 当前实现

这是可运行的 React + TypeScript + Vite 单页应用，不是只有文档：

- 核心填写月收入和购买价格，并选择税前或税后口径和自己的平时作息；默认不选作息，确有需要时可从次级入口直接填写“每月工作时间”，固定支出、购买月份归属和价值期待放在可选区。
- 作息提供每周 5 天 × 每天 8 小时、每周 6 天 × 每天 8 小时两个快捷项，也可以自己填写每周平均上班天数和每天平均工作小时数。
- 首先展示工作时间结论，以每小时收入作为补充；交互改造实施中，只有用户主动开启余量后才补充或查看本月可用金额和购买后余量。JSON 仍保留购买影响这一项，供精确回看。
- 结果用中文说明含义、公式、状态和不足原因；输入冲突或缺失时诚实降级。
- 作息换算的月工时按每周天数 × 每天小时 × 52 ÷ 12 估算，并在进入现有计算前按三位小数、四舍五入归一化；这部分始终是 `estimated`。输入区的“我填写的数字里有大概数”只影响用户直接填写的数字，不会把作息估算变成已确认事实；点击“确认并查看结果”即确认本次输入，导出 JSON 仍按每个数字字段保留证据状态。
- 用户可以记录购买、等待、调整条件、不购买或暂不决定，并主动导出当前 JSON；普通输入和计算在本地完成，不持久化。对话优先输入已获批准并正在实施：一句话整理与有界追问共用草稿，编辑摘要后整体确认一次；改动输入会清除旧结果和决定。当前能力边界与实施状态见 ADR-0007。

## 本地运行

使用 **Bun 1.4.0** 管理依赖和运行开发工具，无需另装 Node.js 或 npm。React、Vite、Vitest 和 TypeScript 保持现有用途。

~~~text
bun ci
bun run dev
bun run check
~~~

`bun run build` 生成静态产物，`bun run preview` 在本机预览。`bun run test` 执行现有 Vitest 测试；`bun test` 是 Bun 自带的另一套测试运行器。

### 本机 Jev 对话输入

项目根目录 `.env` 设置 `TYPESAFE_API_KEY=你的密钥`（已被 Git 忽略，不使用 `VITE_` 前缀）。Python 3.14+ 与 SDK 由 uv 管理：

```sh
uv sync --locked
bun run build
uv run --locked --env-file .env scripts/jev_server.py
```

打开 `http://127.0.0.1:4174` 可使用完整本机版本。开发时保持 Python 服务运行，在另一终端运行 `bun run dev`，`http://127.0.0.1:4173` 会将 `/api` 转发到 Python 服务；Vite 预览也配置了同一代理。服务仅绑定回环地址，不用于公开或多人部署。密钥缺失或服务不可用时，仍可手动填表。

打开页面不会自动请求 Jev。首次主动发送前，页面说明 TypeSafe/Jev 将处理当前回答、当前问题及理解所需的少量相关字段或原文片段；不会发送完整表单、全部聊天记录、价值期待或决定理由。手动填写和快捷按钮不调用 Jev。服务不记录请求或模型响应正文；对话原文不进入 JSON 导出。发出的请求无法由本地取消或清空撤回，不承诺第三方数据保留政策，请勿输入身份信息。识别或服务失败时保留当前回答和草稿，用户可主动重试或切换到手动填写；系统不自动重试。

后端离线检查：`uv run --locked python -m unittest discover -s scripts -p 'test_jev_server.py'`。此命令不调用模型。当前对话的虚构样本检查与真实实验：

```sh
uv run --locked scripts/jev_conversation_experiment.py --self-check
uv run --locked --env-file .env scripts/jev_conversation_experiment.py --run --output tmp/jev-conversation-results.jsonl
```

第二条命令会发送真实请求，每样本每轮一次且不自动重试；输出文件须不存在。使用 `--cases` 可选择其他固定虚构样本，勿写入个人财务数据。首版三字段历史实验见 ADR-0006。

新增依赖使用 `bun add <包名>`（开发依赖加 `--dev`），默认保存精确版本；依赖变更一并提交 `package.json` 和 `bun.lock`。干净安装及 CI 使用 `bun ci`，锁文件与声明不一致时失败。

各依赖包自带的安装脚本默认全部禁用，确需执行时先审查再加入 `trustedDependencies`。项目自身的 `postinstall` 和 `bun run check` 都会检查 peer dependencies，缺少必要依赖或版本不兼容时失败。`bunfig.toml` 统一使用 Bun 运行时，并关闭运行时自动安装依赖。

## 产品与实现边界

Jev 对话输入的当前接入边界见 [ADR-0007](docs/adr/ADR-0007-conversational-input.md)；[ADR-0006](docs/adr/ADR-0006-jev-integration.md) 和虚构样本实验仅记录首版历史。金额计算继续复用现有确定性逻辑，当前 JSON 公开格式保持不变。

- 产品定义见 PRODUCT.md、PRODUCT_STRATEGY.md 和 ROADMAP.md。
- 当前功能短规格见 docs/product/prd/PRD-0001-single-purchase-decision-workbench.md；docs/product/prd/PRD-0002-goal-progress.md 已于 2026-09-01 按回滚条件退役，仅保留历史记录。
- 当前不可逆技术决定见 docs/adr/README.md。
- 术语、指标、数据和品牌边界见 docs/product/glossary.md、docs/product/metrics.md、docs/product/data-principles.md 和 docs/design/brand.md。

不在当前范围内：独立 Goal 进度、账户、完整记账、数据库、同步、提醒、研究招募、公开发布、排名、人生总分和替用户做决定。当前实现与使用反馈不构成研究或市场结论；研究招募暂停，也不是当前开发前置条件。
