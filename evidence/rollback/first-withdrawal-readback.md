# 首次撤下与停止演练 readback

状态：`2026-08-24` clean 候选的首次停止/撤下部分演练；不是完整已接受版本回滚，也不是 `Prototype Accepted`。

## 本轮执行

1. 从 commit `aff13047346cd4ceeba02299e13c3db5557fc165` 的一次性 clean clone 生成 release artifact；manifest SHA-256 为 `766aea6267f8f7636f6eae6aeec1e9f9cacd4260b0d051b90f034cc7e7f7e38f`。
2. `npm run preview` 先通过 toolchain 和 artifact check，再只监听 `127.0.0.1:4173`；同端口第二实例按 `strictPort` 拒绝启动。
3. 在 production Chromium desktop/narrow `10/10` 验收后显式结束 preview；终端没有输出请求路径、输入或其他业务值。
4. `curl --max-time 2 <loopback-origin>` 返回退出码 `7`，提示无法连接；`lsof -nP -iTCP:4173 -sTCP:LISTEN` 无输出。

本轮没有启动 LAN、公开 URL、云托管或长期服务，没有对参与者分发。Playwright 只使用合成数据验证浏览器下载请求；临时浏览器上下文与一次性 clean clone 不构成可召回的参与者副本。没有删除或覆盖用户文件。

## 回滚边界

这是首个 clean 候选构建，仓库尚无上一份 `Prototype Accepted` 的完整静态交付单元，因此本轮能证明的是“首次撤下”：停服务、关端口，并保留可复现的 commit/manifest readback。不能伪造“恢复上一接受版本”的演练结果。

后续一旦存在可接受版本，回滚必须以同一完整版本单元恢复，至少同时包含：

- 40 位 Git commit SHA；
- `dist` 与 artifact manifest；
- `package-lock.json`、Node.js/npm 版本与构建配置；
- ruleset、货币快照、schema/format 版本；
- 受影响的供应链、scope、类型、测试、浏览器和响应头 readback。

不得混用不同 commit 或只回滚单个文件。用户已经主动下载到设备的 JSON/Markdown 文件不在原型控制范围内，无法召回、远程删除或确认最终保存位置。

## 尚缺门禁

- 在该完整版本单元上执行一次发布、撤下、恢复和重新 readback。
- 目标设备/浏览器的人工作业与已下载文件边界确认。

因此 OpenSpec 任务 6.6 仍只能记为部分证据，不能勾选完成。
