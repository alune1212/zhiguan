# Prototype Accepted 验收 readback

状态：`Alune 于 2026-08-28 明确批准 Prototype Accepted`。本记录不批准研究协议、不授权招募或参与者分发。

日期：`2026-08-28`（Asia/Shanghai）

## 固定研究构建

| 项目 | 固定值 |
| --- | --- |
| 应用实现 commit | `0e1e38c2906b5aab0fa7c64add9d6c8e6dd7fc79` |
| artifact manifest SHA-256 | `33ad07978340129e5bf5f7326452d5e48db552db138fd602d5a32e559dcc4700` |
| 应用版本 / 配置版本 | `0.1.0` / 与候选 manifest 的批准配置值一致 |
| 工具链 | Node.js `24.19.0` / npm `11.17.0` |
| 服务边界 | production `vite preview`，`127.0.0.1:4173`，loopback-only |

当前治理 HEAD 的后续差异只包含治理、证据、主规格同步和 OpenSpec 归档；本轮从全新 clean clone checkout 上述实现 commit，未把治理 HEAD 冒充已验证构建。clean build 写出的 manifest 与既有性能证据一致。

## 可重复自动证据

| 检查 | 结果 |
| --- | --- |
| `npm ci` / `npm run build` / artifact check | 通过；clean-worktree preflight、锁定依赖、货币表、typecheck、scope guard 与 manifest check 均通过 |
| Vitest | `13` files，`137/137` passed |
| delivery | `44/44` passed |
| 合成 fixture focused replay | `14/14` passed；包含 manifest 完整性、全部 fixture replay、50 条修订、JSON/Markdown 完整链与冲突 fail-closed |
| Chromium / WebKit 规则向量 | `4/4` passed；两引擎均回放 `19` fixtures、`76` cases、`655` result oracles、`1` utility，digest 均为 `8328a9521d4f408ae43b682ba55a73c692524647ecbf1b374ded74cac8ae5390` |
| production Chromium E2E | desktop/mobile `15 passed / 1 conditional skip`；该按 project 条件跳过的桌面重复状态用例在 mobile project 通过，不是失败 |

`SYN-01`–`SYN-05` 均由同一固定规则、时间、货币和 schema 合同回放：

| Fixture | 核对结果 |
| --- | --- |
| `SYN-01` | 收入速率与工作时间等价保持 `user-confirmed`；缺固定成本只使余量局部 `insufficient-data`，不填零 |
| `SYN-02` | `62.50 CNY/小时`、`16.00 小时`、`4000.00 CNY user-confirmed`、`3000.00 CNY forecast`、`-1000.00 CNY forecast`；另完成真实页面与双格式文件 readback |
| `SYN-03` | 近似输入依赖保持 `estimated`，购买情景保持 `forecast`，不升级为事实 |
| `SYN-04` | 缺工时只使 Income Rate 与 Work-time Equivalent 为 `insufficient-data`；三项余量仍可用；另完成双格式文件 readback |
| `SYN-05` | `before-tax` 原样保留；税口径不满足的余量路径停止，不做隐式税换算 |

## production 浏览器逐项 readback

- 隐私入口先于输入展示；明确当前页面内存、主动本地下载例外、零产品数据请求/持久化、托管最小元数据、产品外研究边界和随时退出。
- 完整 `SYN-02` 风格输入经确认后显示五张结果卡；逐张展开后核对来源、输入、估算依赖、公式/规则版本、单位、币种、周期、税口径、生成时点、状态、假设、限制、原因和恢复路径。
- 空输入保留在本地失败状态并把焦点移至首个错误；异常负数不生成伪精确值，受影响结果局部显示“数据不足”。
- 返回修改后页面立即说明旧结果失效；取消编辑后明确“旧结果不会恢复，请重新确认当前输入”，未恢复旧结果或旧导出快照。
- “购买、等待、调整条件、不购买、暂不决定”五项均可独立选择，对应稳定代码 `buy`、`wait`、`adjust-conditions`、`do-not-buy`、`undecided`；页面不排序、不推荐，也不替用户判断。
- 低刺激文案覆盖隐私、空/错输入、数据不足、负影响、修改失效、退出、导出和不可召回边界；源码复核未发现催促购买、财富排名、羞辱、恐吓或连续打卡文案。

## JSON / Markdown 真实下载与离线核对

两组文件都由 production 页面明确预览和确认后分别触发下载；关闭浏览器上下文后再以 UTF-8 从文件系统读取、解析和比较，未用页面内存替代离线检查。临时文件只含合成数据，未提交仓库。

| 场景 | JSON | Markdown | 离线语义结果 |
| --- | --- | --- | --- |
| `SYN-02` | `39,009` bytes；建议文件名 `zhiguan-purchase-decision-20260828T005928Z.json` | `41,035` bytes；建议文件名 `zhiguan-purchase-decision-20260828T005928Z.md` | revision `17`；构建/manifest、五项结果、状态、决定 `wait`、依据、输入 field IDs 与时间上下文一致 |
| `SYN-04` | `37,782` bytes；建议文件名 `zhiguan-purchase-decision-20260828T011329Z.json` | `39,828` bytes；建议文件名 `zhiguan-purchase-decision-20260828T011329Z.md` | revision `15`；缺失 `work-hours` 显式为 `availability=not-provided`、`value=null`、`evidence_status=null`；两项不可用结果为 `insufficient-data`，三项余量及状态一致 |

两种表示均包含自描述 schema/format、快照与构建身份；Markdown 包含 JSON 中每个 input field ID、formula ID、可用 display value、决定与依据。文件名不含输入或自由文本；Markdown 不含远程 URL、脚本、iframe 或 object。

## 网络、存储、console、失败清理与信任边界

| 边界 | 本轮结果 |
| --- | --- |
| 请求 | 每次下载 readback 仅 `3` 个 `127.0.0.1:4173` 静态请求；外部请求 `0` |
| 浏览器持久化 | Cookie、localStorage、sessionStorage、IndexedDB、Cache Storage 均为空；URL query/hash 为空 |
| console / page error | warning/error `0`；page error `0`；未输出输入、派生金额、文件内容或路径 |
| 下载资源与失败 | download adapter、pagehide、取消、Blob/object URL、清理失败阻断、生成/下载失败和 1 MiB 限额自动断言均通过；退出后页面只显示“当前页面内存已清除”且不声称能召回已下载文件 |
| 关键隐私/信任事件 | 本轮合成验收范围内记录和观察为 `0`；未使用真实收入、购买、身份、联系人或研究记录 |

## 当前候选的整单元回滚、关闭与恢复

1. 停止 `0e1e38c… / 33ad0797…` preview；`lsof` 无 `4173` listener，`curl --max-time 2` 失败。
2. 在独立 clean clone 恢复上一完整单元 `e27c3e2c807fb3315ac56444b629ff2c3f242bc2 / 1d7ad86c8a91cf1b0c37ed443842a3c1e0e3347c6fbf8ffa715bba3cd419facb`；`npm ci`、delivery `44/44`、Vitest `136/136`、build/manifest、HTTP `200`、release headers 和 production E2E `15 passed / 1 conditional skip` 均通过。
3. 停止回滚单元并再次确认端口关闭。
4. 从第二个全新 clean clone 重建并恢复 `0e1e38c… / 33ad0797…`；首次尝试复用已有测试 clone 被 `manifest-git-dirty` 正确拒绝，没有绕过门禁。恢复单元的 build/manifest、identity carriers 和 production E2E `15 passed / 1 conditional skip` 通过。
5. 最终停止恢复单元；`4173` 无 listener，`curl` 失败。两个单元未混用 `dist`、manifest、lockfile、配置、规则、货币或 schema/format。

回滚只能撤下/恢复应用可控的完整交付单元，不能召回、删除或改写用户已下载文件。

## 结论与停止点

AC-01–AC-17、AC-20–AC-26 及 VAL-04、VAL-05、VAL-11 的缺口已由本记录与既有目标设备人工矩阵、性能、规则、无障碍和供应链证据闭合；未发现 P1/P2 阻塞或未解决关键隐私/信任事件。

Alune 已在查看本 readback 和 diff 后于 `2026-08-28` 明确批准 `Prototype Accepted`。固定研究构建为 `0e1e38c2906b5aab0fa7c64add9d6c8e6dd7fc79`，artifact manifest SHA-256 为 `33ad07978340129e5bf5f7326452d5e48db552db138fd602d5a32e559dcc4700`。

研究协议仍为 `Draft`，`Recruitment Authorized=false`；不得招募、向参与者分发或公开发布。
