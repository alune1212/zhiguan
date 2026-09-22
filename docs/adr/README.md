# 架构决策记录

ADR 只记录会改变长期系统边界、数据含义或公开格式的决定。普通实现直接在代码和测试中完成，不因流程需要创建文档。

## 当前决定

| ADR | 状态 | 决定 |
| --- | --- | --- |
| ADR-0001 | Accepted | 本地浏览器内存态 React/Vite 单页应用 |
| ADR-0002 | Accepted | CNY 精确分、确定性计算、证据状态与不足降级 |
| ADR-0003 | Accepted | 购买决策当前快照的一次性 JSON 导出 |
| ADR-0005 | Accepted | 明确作息估算、证据状态与增量导出依据 |
| [ADR-0006](ADR-0006-jev-integration.md) | Superseded | 保留首版三字段 Jev 辅助填写决定及实验记录；当前范围由 ADR-0007 替代 |
| [ADR-0007](ADR-0007-conversational-input.md) | Accepted | 一句话对话优先、按需追问、最少上下文及一次整体确认；本机实现已完成并归档验证 |
| [ADR-0008](ADR-0008-local-profile-and-purchase-favorites.md) | Accepted；实施中 | 收入看板、同浏览器基础资料与主动收藏、本地备份恢复、日历分摊及购买快照 @2 |

ADR-0007 已替代 ADR-0006 的首版范围。ADR-0008 在新收入看板及由其进入的购买流程中，限定替代 ADR-0001 的纯内存要求、ADR-0002/0005 的默认平均月工时口径和 ADR-0003 的 @1 / 不持久化约束；旧流程、旧快照及其验证历史仍按各 ADR 原文保留。旧实验仍按历史结果保留，不作为新增识别能力已验证的证据。

## 实施状态

[ADR-0008](ADR-0008-local-profile-and-purchase-favorites.md)、[PRD-0003](../product/prd/PRD-0003-income-dashboard.md) 与 [RFC-0001](../product/rfc/RFC-0001-income-understanding.md) 的范围已获批准，代码实施中。新流程整体尚未交付；存储、备份恢复、自动检查与浏览器验收仍待完成。新流程完成前，用户工作流仍遵循当前已交付行为。

## 退役记录

| ADR | 状态 | 原因 |
| --- | --- | --- |
| ADR-0004 | Retired before delivery | 对应研究招募与本地研究数据保管功能未进入当前交付，随研究轨道整体删除；历史决定仍保留在 Git 中 |

## 什么时候需要 ADR

只有新增持久化、身份、同步、外部服务、敏感数据处理，或改变公开导出/计算格式时，才先写 ADR。ADR 应说明背景、决定、影响和回滚触发条件。

已实现的 ADR 不删除；决定失效时标记为 Superseded 或 Deprecated，并留下替代路径。
