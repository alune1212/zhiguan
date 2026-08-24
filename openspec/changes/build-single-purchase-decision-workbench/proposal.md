## Why

`PRD-0001` 已批准用一个单案例购买决策研究原型验证最短个人价值闭环，三项架构前置 ADR 也已全部 `Accepted`，但仓库仍没有把这些合同收束成可审查、可执行且可回滚的实现计划。本变更只为该形成性研究原型建立实现规格与任务门禁；在本 OpenSpec 获得 Alune 明确批准前，不构成 `Implementation Authorized`。

## What Changes

- 规划一个四阶段、纯客户端、当前会话内存内的购买决策工作台：说明研究与隐私边界，收集并确认最小输入，展示可解释的理解/推演结果，再由用户记录自己的决定与复盘条件。
- 规划框架无关的纯 TypeScript 计算与状态内核，严格实现 `ADR-0002` 的定点 `BigInt`、有理数、周期/币种/税口径、五类证据语义及产品财务 `actual` 隔离、失效、修订、舍入、限额和版本合同。
- 规划 `ADR-0003` 定义的不可变 `ExportSnapshotV1`、版本化 JSON、安全 GFM Markdown、逐格式下载请求、资源清理和失败边界。
- 规划 `ADR-0001` 定义的 React + TypeScript + Vite 静态原型、精确版本依赖、loopback/受控 LAN 交付、安全头、零产品数据外发/持久化及完整构建回滚单元。
- 规划以合成 fixture 为唯一测试数据的类型、单元、组件、浏览器、网络/存储、导出、无障碍、性能、供应链和停止/恢复验证；所有运行结果在实施前继续保持“待实施”。
- 明确排除研究存储 A/B、正式同意管理、研究观察采集、招募、研究日历、云托管、账户、后端、数据库、持久化、同步、导入、分享、通知、AI 和正式产品能力。

## Capabilities

### New Capabilities

- `purchase-decision-workbench`: 覆盖四阶段会话流程、最小输入与确认、局部降级、依据展示、决定/复盘记录、内存生命周期、低刺激文案和目标平台可访问性。
- `purchase-decision-calculation`: 覆盖精确数值表示、输入验证、公式依赖、证据状态传播、展示舍入、规则/货币版本、会话失效与已确认修订合同。
- `session-snapshot-export`: 覆盖冻结快照、JSON/Markdown 等价投影、内容安全、预览确认、下载请求状态、资源限额、清理、兼容与失败行为。
- `local-research-delivery`: 覆盖准确版本工具链和依赖白名单、静态构建、loopback/受控 LAN 服务、安全头、网络/存储/日志边界、目标浏览器、性能、供应链及整体停止/回滚。

### Modified Capabilities

无；仓库当前没有既有 OpenSpec capability。

## Impact

- 规划中的未来实现将新增 React/TypeScript/Vite 应用结构、纯 TypeScript 领域与导出模块、本地 CSS、合成 fixture、自动化测试、构建配置和受控本地/LAN 操作证据。
- 直接依赖及准确版本必须严格来自 `ADR-0001` 白名单；不得新增未批准运行时依赖、远程资源、应用 API、数据库、Service Worker、Router、状态库、UI 组件库、分析、错误上报或会话重放。
- 不迁移或回填任何数据；当前没有应用、运行时产品数据、旧客户端或导出文件消费者。
- 本提案本身只新增 OpenSpec 规划制品，不初始化框架、不安装依赖、不编写实现、不部署、不招募，也不改变 `RESEARCH-0001` 的 `Draft` 状态。
