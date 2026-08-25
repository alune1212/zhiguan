# 规则规范向量跨引擎 readback

状态：`2026-08-24` OpenSpec `3.9` 的实施与自动证据。此证据只关闭规则内核规范向量，不代表真实 Safari、VoiceOver、人工支持矩阵、性能、回滚或 `Prototype Accepted`。

## 环境与安装边界

- 规则实现基线 Git commit：`a64ce6424f5cadba31404568083cb8154a79375d`
- 本 3.9 证据 commit：`463cd72ba35a5119d0019fff011d1722ccf5647b`
- macOS：`27.0`（build `26A5416b`，`arm64`）
- Node.js：`24.19.0`
- npm：`11.17.0`
- Playwright：`1.62.1`
- Chromium engine：`151.0.7922.34`，Playwright build `v1234`
- WebKit engine：`26.5`，Playwright build `v2336`

按批准范围执行 `playwright install webkit`，只向本机 Playwright browser cache 安装与锁定 Playwright 版本匹配的 WebKit；未新增 npm 依赖，`package-lock.json` 未变化。规则测试使用独立 `playwright.rules.config.ts`、loopback `127.0.0.1:4174` 和 `.tmp/playwright-rule-vectors` 临时输出，不修改主 UI Playwright 配置或 production artifact。

受限沙箱不能取得 macOS 浏览器启动所需的 bootstrap 权限；在获批准的本机受控执行边界中启动两个引擎后，规则断言全部通过。测试结束后 `4173` 与 `4174` 均无监听服务。

## 向量与口径

向量从 `tests/fixtures/synthetic/manifest.json` 的 19 个合成 fixture 构造，包含 `SYN-01`–`SYN-05`，以及空、零、负数、数值限额、minor unit、周期/币种/税口径冲突、rounding tie、负余量、Unicode、50 条修订和代表性失败边界。未读取或写入真实收入、购买、身份、联系人或研究记录。

既有 fixture 合同的计数与本跨引擎门禁保持一致，但证据类型明确拆分：

- 76 个声明 case 中，71 个属于规则计算或 rounding；5 个 export/download/cleanup failure case 明确不属于规则内核，本门禁只核对其排除分类，不把它们写成浏览器执行结果。
- 652 个 `CalculationResult` 检查中，152 个直接对照 fixture 的 exact/display/availability/evidence/primary reason 等独立期望；50 次修订的 before/after 共 500 个结果对照 Node/V8 基线并与 WebKit 结果比较，属于 engine-parity 证据，不冒充独立 fixture oracle。
- 另有 3 个 fixture-backed rounding display oracle；因此沿用既有合同口径为 655 个 result oracle。
- 另有 1 个 129 位 rational normalization utility oracle。

每个引擎执行 132 个 `CalculationRequest`。所有请求按正序执行两次，注入伪造 `oldResults`/`previousResults` 后再执行，并按逆序重放；四组规范输出一致。每个 fixture-backed 结果核对精确 rational/minor units、display、availability、evidence status、primary/all reason、依赖、单位、币种、周期、税口径、完整 `TimeContext`、ruleset 与货币快照；修订结果核对完整 canonical envelope。

两引擎得到同一固定 SHA-256 规范摘要：

```text
8328a9521d4f408ae43b682ba55a73c692524647ecbf1b374ded74cac8ae5390
```

该摘要已进入测试断言；后续规则输出变化必须显式更新向量与证据，不能静默漂移。

## I/O、时钟与旧值边界

规则源码门禁拒绝 `Number`、`parseFloat`、非显式参数的 `Date` 引用、`performance`、随机数、网络 API、浏览器存储、clipboard、console、DOM 全局和旧结果标识。唯一允许的 `new Date(value)` 只校验已注入 UTC 字符串，不读取系统当前时间。

页面先加载纯规则 harness，再切换 offline。执行期间运行时 sentinel 阻止 `Number`、`Date.now`、零参数 `Date`、`performance.now`、随机数、网络、存储、clipboard 和 console；同时观测到：

- 额外 HTTP/WebSocket request：`0`
- console/page error：`0`
- Cookie、localStorage、sessionStorage、IndexedDB、Cache Storage、Service Worker：空
- URL query/hash：空
- 伪旧结果注入前后输出：一致

源码全词扫描补充覆盖模块加载期别名引用，避免仅依赖运行时 sentinel。

## 最终自动结果

```text
npm run test:rules:browsers  -> 4/4 passed
npm test                     -> 129/129 passed
npm run typecheck            -> passed
npm run test:delivery        -> 44/44 passed
npm run scope:check          -> passed
npm run check:dependencies   -> passed
git diff --check             -> passed
```

## 未关闭的门禁

Playwright WebKit 是规则跨引擎证据，不是实际 macOS Safari、iOS Safari 或 VoiceOver 证据，也不证明 WebKit 与任一 Safari 发布版完全等价。OpenSpec `4.6`、`6.3`、`6.4`、`6.6` 继续保持未完成；`Prototype Accepted=false`、研究协议非 `Accepted`、`Recruitment Authorized=false`。不得据此进行参与者分发、公开发布或招募。
