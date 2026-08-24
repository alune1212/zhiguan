# 首次撤下与停止演练 readback

状态：`2026-08-24` 实施期部分演练；不是完整已接受版本回滚，也不是 `Prototype Accepted`。

## 本轮执行

1. 结束显式启动在 `127.0.0.1:4173` 的临时 `npm run dev` 会话。
2. `curl --max-time 2 <loopback-origin>` 返回退出码 `7`，提示无法连接；本轮 origin 为本机 `127.0.0.1:4173`。
3. `lsof -nP -iTCP:4173 -sTCP:LISTEN` 无输出，确认没有监听进程。
4. 运行 `npm run check:artifact`；当前工作树为 dirty，检查按设计返回 `ARTIFACT_MANIFEST_FAIL manifest-git-dirty`，旧 `dist` 不能作为当前已验证交付单元启动。

本轮没有启动 LAN、公开 URL、云托管或长期服务，没有对参与者分发，也没有创建可召回的用户下载副本。工作目录中的历史 `dist` 保留用于审计，但被 manifest/dirty gate 明确阻止作为当前交付物；没有删除或覆盖用户文件。

## 回滚边界

这是首个实现中的候选构建，仓库尚无上一份 `Prototype Accepted` 的完整静态交付单元，因此本轮能证明的是“首次撤下”：停服务、关端口、阻止旧 artifact 被误认作当前版本。不能伪造“恢复上一接受版本”的演练结果。

后续一旦存在可接受版本，回滚必须以同一完整版本单元恢复，至少同时包含：

- 40 位 Git commit SHA；
- `dist` 与 artifact manifest；
- `package-lock.json`、Node.js/npm 版本与构建配置；
- ruleset、货币快照、schema/format 版本；
- 受影响的供应链、scope、类型、测试、浏览器和响应头 readback。

不得混用不同 commit 或只回滚单个文件。用户已经主动下载到设备的 JSON/Markdown 文件不在原型控制范围内，无法召回、远程删除或确认最终保存位置。

## 尚缺门禁

- 经批准 commit 的 clean checkout 与当前 production artifact。
- 在该完整版本单元上执行一次发布、撤下、恢复和重新 readback。
- 目标设备/浏览器的人工作业与已下载文件边界确认。

因此 OpenSpec 任务 6.6 仍只能记为部分证据，不能勾选完成。
