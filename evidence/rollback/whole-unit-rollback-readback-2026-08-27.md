# 整体交付单元回滚与恢复 readback

状态：`2026-08-27` OpenSpec 6.6 实测通过；不是 `Prototype Accepted`、参与者分发授权或正式产品发布。

## 交付单元

| 角色 | Git commit | artifact manifest SHA-256 | 工具链 |
| --- | --- | --- | --- |
| 演练开始时的当前单元 | `e27c3e2c807fb3315ac56444b629ff2c3f242bc2` | `1d7ad86c8a91cf1b0c37ed443842a3c1e0e3347c6fbf8ffa715bba3cd419facb` | Node.js `24.19.0` / npm `11.17.0` |
| 上一份可复现 clean 单元 | `aff13047346cd4ceeba02299e13c3db5557fc165` | `766aea6267f8f7636f6eae6aeec1e9f9cacd4260b0d051b90f034cc7e7f7e38f` | Node.js `24.19.0` / npm `11.17.0` |

`aff1304…` 的既有 clean readback 见 [`clean-release-readback-2026-08-24.md`](../delivery/clean-release-readback-2026-08-24.md)。本次在 `/private/tmp` 的独立 clone 中重新执行 `npm ci`、build、依赖/货币/类型/delivery/scope 检查和 Vitest；结果为 delivery `44/44`、Vitest `129/129`，生成的 manifest 与既有 SHA-256 一致。该单元是技术上已验证的回滚目标，但不是 `Prototype Accepted`。

## 停止、恢复与 readback

1. 记录当前 `e27c3e2…` 单元只监听 `127.0.0.1:4173`，manifest 校验通过。
2. 对已核验的 preview 进程发送 `SIGINT`。随后 `curl --max-time 2` 返回退出码 `7`，`lsof -nP -iTCP:4173 -sTCP:LISTEN` 无输出。
3. 从完整的 `aff1304…` clone 启动 preview；prepreview 重新核对 Node/npm 与 manifest，页面返回 HTTP `200`，并核对：
   - `Cache-Control: no-store`；
   - 批准的 CSP、`Cross-Origin-Resource-Policy`、`Permissions-Policy`、`Referrer-Policy`、`X-Content-Type-Options`、`X-Frame-Options`；
   - HTML carrier 中的 commit、manifest、`app_version=0.1.0` 和与 manifest 一致的批准配置版本。
4. 在恢复单元上以 production headers 门禁运行 Playwright desktop/mobile 合成 readback，结果 `10/10 passed`。首次沙箱内尝试在浏览器启动前被 macOS Mach port 权限拒绝；同一命令在非沙箱环境重跑后全部通过，该首次结果不属于应用失败。
5. 停止 `aff1304…` preview，再次确认 `curl` 退出码 `7` 且 4173 无监听。
6. 回到当前 `e27c3e2…` 工作树，重新执行 artifact check，启动并核对 HTTP `200`、安全头及四项身份 carrier；随后按会话结束边界停止服务，并最终确认 4173 无监听。

整个演练未启用 LAN、公共 URL、云托管或真实用户数据。preview 终端未输出输入、派生结果或请求路径；Playwright 只使用合成数据，临时下载位于一次性浏览器上下文。主工作树在演练时保持 clean，未混用两个 commit 的 `dist`、manifest、lockfile、配置、规则、货币或 schema/format。

## 不可召回边界

原型只能停止服务、清理应用可控页面状态、临时 object URL、浏览器测试上下文和本地工作副本。已由用户主动下载到设备的 JSON/Markdown 不在原型控制范围内，不能远程召回、删除、改写或确认最终保存位置；回滚不能改变这一边界。

## 结论

OpenSpec 6.6 的停止、首次撤下、上一完整单元恢复、受影响 readback、当前单元恢复验证和最终关端口均已执行。6.6 可以勾选；6.3、6.4、`Prototype Accepted`、研究协议 `Accepted` 与 `Recruitment Authorized` 不由本记录关闭。
