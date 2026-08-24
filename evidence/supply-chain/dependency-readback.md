# 供应链 readback（OpenSpec 2.5）

本证据只记录 2026-08-24 在当前工作树、精确临时 Node/npm 工具链下的非敏感供应链摘要。它不证明研究原型已经完成，也不替代后续构建、浏览器、VoiceOver、性能或人工验收。

## 运行边界

| 项目 | readback |
| --- | --- |
| Node.js | `24.19.0` |
| npm | `11.17.0` |
| npm registry | `https://registry.npmjs.org/` |
| npm strict script policy | `true`（`.npmrc` 的 `strict-allow-scripts=true`） |
| npm cache | 仅使用临时目录 `/private/tmp/zhiguan-npm-cache-2.5` |
| 审计脚本 | `scripts/check-dependency-policy.mjs`，只读 package manifest/lock/config，发现违规时退出非零；不自动修改文件 |

审计依据是当前 `package.json`、`package-lock.json` 和 `.npmrc`。项目配置将 registry 精确固定为官方 npm registry；环境覆盖为其他 registry 时，工具链检查与依赖策略检查均 fail-closed。没有新增直接依赖、范围版本、浮动标签、`file:`、`git:`、非 registry HTTP(S) tarball、`workspace:`、`link:`、`npm:` alias 或远程 ESM 来源。

## 直接依赖与锁文件

根 manifest 只有 15 项直接依赖，运行时 2 项、开发/验收 13 项；每项均为批准的精确版本，React 与 React DOM 版本相同。锁文件为 lockfile v3，根包身份、引擎和两组直接依赖与 manifest 一致。

| 类别 | 精确白名单 |
| --- | --- |
| runtime | `react@19.2.8`、`react-dom@19.2.8` |
| build/type | `typescript@7.0.2`、`vite@8.2.2`、`@vitejs/plugin-react@6.1.0`、`@types/node@24.13.3`、`@types/react@19.2.18`、`@types/react-dom@19.2.4` |
| unit/component | `vitest@4.1.11`、`jsdom@30.0.1`、`@testing-library/dom@10.4.1`、`@testing-library/react@16.3.2`、`@testing-library/user-event@14.6.5` |
| browser/a11y | `@playwright/test@1.62.1`、`@axe-core/playwright@4.13.0` |

审计脚本的稳定摘要：

```text
DEPENDENCY_POLICY_PASS lockfile=v3 packages=158 scripts=2 script-packages=1 engines=110 peers=14 optional-peer-missing=26 licenses=Apache-2.0:28,BlueOak-1.0.0:1,BSD-2-Clause:2,BSD-3-Clause:2,CC0-1.0:1,ISC:3,MIT:105,MIT-0:2,MPL-2.0:14
```

`packages=158` 是锁文件中根包之外的解析条目；158/158 条目均为 npm registry HTTPS tarball，158/158 均含 `sha512-...` integrity。`npm ci` 会在安装时再次按 lockfile 校验这些摘要。

## 安装脚本与策略

根 `preinstall` 仅运行仓库内 `scripts/verify-toolchain.mjs`，检查 Node/npm 精确版本；根脚本不读取用户输入、不联网、不写持久状态。依赖锁文件中仅有两个安装脚本条目，均为同一包名的已知 macOS optional 变体：

| lock 条目 | 决策 |
| --- | --- |
| `fsevents@2.3.2`（`@playwright/test` 路径） | `package.json#allowScripts.fsevents=false`，显式拒绝 |
| `fsevents@2.3.3`（`vite` 路径） | `package.json#allowScripts.fsevents=false`，显式拒绝 |

任何新的 `hasInstallScript`、未列入 `allowScripts` 的包、非布尔决策、未知 allowlist 项或未批准的根安装生命周期脚本都会 fail-closed。`.npmrc` 的 `strict-allow-scripts=true` 已核对；未使用 `ignore-scripts=true` 绕过策略。

## 传递依赖、engine、peer 与许可证

- 传递依赖版本完全来自 `package-lock.json`。审计脚本检查每个解析条目的版本、registry 来源、integrity 和许可证字段，并拒绝非 npm registry 来源。
- 以批准基线 Node.js `24.19.0`、npm `11.17.0` 对 110 个 engine 声明进行范围检查，全部满足；不可解析或不满足的范围会阻止审计。
- 14 个必需 peer 依赖均已解析且满足范围；26 个缺失 peer 槽位均明确标为 `peerDependenciesMeta.optional=true`，不被当作必需 peer 冲突。`npm ls --all` 的 `problems` 为空。
- 解析许可证清单共 9 类、158 条：`MIT` 105、`Apache-2.0` 28、`MPL-2.0` 14、`ISC` 3、`BSD-2-Clause` 2、`BSD-3-Clause` 2、`MIT-0` 2、`BlueOak-1.0.0` 1、`CC0-1.0` 1。`MPL-2.0` 只对锁定的 `@axe-core/playwright`、`axe-core`、`lightningcss` 及其列明的平台包精确放行；其他包即使声明同一许可证也会被拒绝。GPL/LGPL/AGPL、未知或缺失许可证同样阻止构建。
- `.npmrc` 的 `audit=false` 只关闭 `npm ci` 的隐式、时点不清晰审计输出；本 readback 仍显式运行并记录 `npm audit --audit-level=critical`，任何 critical 通告都会阻止构建。

## 精确命令结果

以下命令均以 `/private/tmp/zhiguan-toolchain.8tyAmC/node-v24.19.0-darwin-arm64/bin` 置于 `PATH` 首位执行：

```text
node --version                         v24.19.0
npm --version                          11.17.0
npm config get registry                https://registry.npmjs.org/
npm config get strict-allow-scripts    true
```

```text
NPM_CONFIG_CACHE=/private/tmp/zhiguan-npm-cache-2.5 npm ci
exit=0
preinstall -> toolchain-ok node=24.19.0 npm=11.17.0
added 115 packages
```

```text
npm ls --all --json
exit=0
name=zhiguan-purchase-decision-workbench
version=0.1.0
topLevelDependencyCount=15
problems=[]
```

```text
npm audit --audit-level=critical --json
exit=0
info=0 low=0 moderate=0 high=0 critical=0 total=0
```

```text
npm audit signatures
exit=0
verified_registry_signatures=115
verified_attestations=50
```

`npm audit` 与 registry signature/attestation 的结果是本次执行日的 registry readback；后续新增依赖、lockfile 漂移、registry 数据变化或安全通告出现时必须重新审计，不得把本次零通告或签名结果永久化。

## 自动化测试

```text
node --test tests/delivery/dependency-policy.test.mjs
tests=8 pass=8 fail=0
```

测试覆盖当前基线通过、直接依赖/远程来源漂移、非 registry/integrity/许可证违规、未复审 MPL 包、registry 环境覆盖、严格安装脚本策略、必需 peer/engine 不相容，以及稳定非敏感摘要。审计脚本仅输出状态、计数、许可证清单和固定违规代码，不输出 URL、integrity 值或任意依赖元数据内容。

测试编排已经分离：`npm run test:delivery` 使用 Node 内建测试运行 `.mjs` 交付门禁，`npm test` 只运行 TypeScript/Vitest 领域与组件测试，`npm run test:all` 依次运行两者。当前锁定工具链下聚合命令可以通过，不再存在 `No test suite found` 的旧阻塞。

## 结论与停止条件

本次 2.5 readback 在当前精确 lockfile 下通过，没有发现未处置 critical 安全通告、许可证冲突、必需 peer/engine 冲突、未说明安装脚本、非 registry 来源或 integrity 缺失。若任何上述条件在后续安装、依赖更新、构建或审计中出现，必须保持 OpenSpec task 未完成、停止构建/服务，并在 ADR 复审或替代依赖批准后重新执行完整 readback。
