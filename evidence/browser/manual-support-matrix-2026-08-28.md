# 目标浏览器、键盘与 VoiceOver 人工矩阵

## 证据来源与范围

Alune 于 `2026-08-28` 明确确认已在 OpenSpec `6.3` 的目标设备上成功完成操作，并随后补录 Windows Chrome 与 iPhone/iOS Safari 的实际版本。本表把该结论标记为 `user-confirmed`；自动化、axe、Playwright 和本机 readback 只作为补充，不冒充 Alune 的人工结论。为遵守数据最小化，本次不保存录屏、语音、真实输入或可识别截图。

人工范围覆盖：四阶段核心流程、桌面键盘、移动/窄屏、macOS/iOS VoiceOver、可见焦点、状态与错误反馈、导出敏感提示，以及启用减少动态后的可完成性。测试只使用合成输入；没有真实收入、资产、身份或研究参与者数据。

## 记录版本

| 目标 | 设备 / 系统 | 浏览器 | 视口 / 网络 | 证据状态 | 结论 |
| --- | --- | --- | --- | --- | --- |
| macOS Chrome | MacBook Pro `Mac15,3`；Apple M3；macOS `27.0` (`26A5421a`) | Google Chrome `152.0.7977.65` | 桌面；loopback | 本机版本 readback；自动流程与性能补充；Alune 人工确认 | 通过 |
| Windows Chrome | Windows `11`，ARM64 | Google Chrome 正式版 `151.0.7922.174` (`arm64`) | 桌面；研究者控制的私有 LAN | Alune 提供版本并人工确认 | 通过 |
| macOS Safari | MacBook Pro `Mac15,3`；macOS `27.0` (`26A5421a`) | Safari `27.0` (`22625.1.29.11.25`) | 桌面；loopback | 本机版本 readback；Alune 人工确认 | 通过 |
| iOS Safari | iPhone `16 Pro Max`；iOS `27` | Safari `27.0` (`22625.1.29.11.25`) | 原生竖屏/窄屏；研究者控制的私有 LAN | Alune 提供版本并人工确认 | 通过 |

Windows 仅按用户提供的 `Windows 11` 版本粒度记录，不推断未提供的 edition、feature update 或 OS build。iOS 同样只记录用户提供的 `iOS 27`，不伪造未提供的系统 build；未采集精确 CSS viewport 数值。私有 LAN 仅用于当次人工访问，没有公共 URL 或长期服务。

## 人工检查项

| 检查项 | macOS Chrome | Windows Chrome | macOS Safari | iOS Safari | 结论来源 / 备注 |
| --- | --- | --- | --- | --- | --- |
| 说明 → 输入 → 确认 → 理解/推演 → 决定/复盘 → 导出入口 | 通过 | 通过 | 通过 | 通过 | Alune `user-confirmed`；合成输入 |
| 桌面键盘完成输入、返回、依据展开、决定、复盘、导出入口与退出 | 通过 | 通过 | 通过 | 不适用 | Alune `user-confirmed`；无指针依赖 |
| 移动/窄屏无横向滚动且操作可完成 | 补充检查通过 | 补充检查通过 | 补充检查通过 | 通过 | iPhone 为人工目标；桌面窄屏为补充 |
| macOS VoiceOver 的标题、标签、单位、状态、错误与恢复动作 | 不适用 | 不适用 | 通过 | 不适用 | Alune `user-confirmed` |
| iOS VoiceOver 的标题、标签、单位、状态、错误与恢复动作 | 不适用 | 不适用 | 不适用 | 通过 | Alune `user-confirmed` |
| 焦点可见、不被困住，阶段变化与错误焦点可理解 | 通过 | 通过 | 通过 | 通过 | Alune `user-confirmed`；自动焦点测试补充 |
| 状态、数据不足和错误不只依赖颜色、图标、动画或位置 | 通过 | 通过 | 通过 | 通过 | Alune `user-confirmed`；axe/DOM 测试补充 |
| 导出敏感提示、取消、失败和 `download-requested` 反馈可理解 | 通过 | 通过 | 通过 | 通过 | Alune `user-confirmed`；浏览器最终落盘仍由设备控制 |
| 启用减少动态后流程、数值、状态和操作反馈仍可完成 | 通过 | 通过 | 通过 | 通过 | Alune `user-confirmed`；CSS 媒体查询自动检查补充 |

## 边界

- 本表完成 OpenSpec `6.3` 的人工支持矩阵，不等于 `Prototype Accepted`、研究协议 `Accepted` 或 `Recruitment Authorized`。
- 浏览器自动化只能补充人工结论；实际 Windows/iPhone 行没有被代理独立远程控制或采集遥测。
- 性能预算、构建身份与最大合成会话见 [`max-session-performance-readback-2026-08-28.md`](max-session-performance-readback-2026-08-28.md)。
