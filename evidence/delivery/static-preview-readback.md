# 静态预览交付 readback

状态：`2026-08-24` 历史实施中 readback；记录生成后工作树继续发生代码与测试变更，因此不再作为当前 release artifact、manifest 或 live preview 的最终证据。不是 `Prototype Accepted`、跨设备验收或参与者分发授权。

当前工作树仍未提交，构建 preflight 按设计拒绝 dirty build；在形成经批准 commit 并从受信 clean checkout 重新执行完整 readback 前，以下结果只证明交付机制曾按相同配置工作，不能证明当前实现已经形成可分发静态单元。

## 锁定环境

- Node.js：`24.19.0`
- npm：`11.17.0`
- Vite：`8.2.2`
- 默认地址：`127.0.0.1:4173`
- 端口策略：`strictPort=true`

## 实际 readback

在锁定工具链下执行 production build 与默认 preview 后：

- 文档和本地 JS 静态资源均返回 `200`。
- 两类响应均返回 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。
- 两类响应均返回固定 CSP，其中包括 `default-src 'self'`、`connect-src 'none'`、`form-action 'none'`、`object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`、`frame-src 'none'`、`child-src 'none'`、`worker-src 'none'` 和 `manifest-src 'none'`。
- 同一端口第二次启动退出码为 `1`，明确报告 `Port 4173 is already in use`，没有自动换端口。
- `0.0.0.0` 被 LAN 启动适配器拒绝；不属于当前设备网卡的私有 IPv4 同样被拒绝。
- 服务收到显式中止后，`curl` 再次访问 `127.0.0.1:4173` 返回连接失败，证明本次临时服务已经停止并关闭端口。
- `scope:check` 对当次 `dist` 返回 `SCOPE_GUARD_PASS`；构建目录仅含 `index.html` 和同源 JS/CSS，不含 source map、PWA manifest 或 Service Worker。

## LAN 与日志边界

`preview:lan` 只接受一个规范 RFC1918 或链路本地 IPv4，并进一步要求该地址当前确实属于本机非内部 IPv4 网卡。脚本不枚举或输出本机地址，也不接受 `0.0.0.0`、loopback、公共 IPv4、主机名或附加参数。

本次没有启动 LAN 服务，也没有把预览暴露到公共/访客网络。跨设备、目标浏览器和 VoiceOver 仍属于后续独立验收；在网络、设备和日志边界未完成 readback 前不得启用该路径。

## 命令范围

```text
npm run build
npm run scope:check
npm run preview
curl --dump-header - --output /dev/null <loopback-origin>/
curl --dump-header - --output /dev/null <loopback-origin>/assets/<local-build-asset>.js
npm run preview                         # 第二实例，预期 fail-closed
node scripts/preview-lan.mjs 0.0.0.0   # 预期拒绝
node scripts/preview-lan.mjs <非本机私有 IPv4> # 预期拒绝
```

命令输出未记录用户输入、查询参数、研究编号、联系人或真实/近似个人数据；上述 readback 也不声明浏览器已完成人工验收。
