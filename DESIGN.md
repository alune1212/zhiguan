# 值观设计规范

**版本：** 0.1.0 · **日期：** 2026-09-23

**状态：** Apple-inspired 视觉方案、[概念稿](docs/design/frontend-concepts.html)和现有 React/Vite 应用中的 shadcn/ui + Tailwind CSS v4 界面均已交付。preview 与临时 Docker 容器的验收记录及边界见[前端验收记录](docs/design/frontend-acceptance.md)；真实用户验证与正式发布尚未完成。

本规范服从 [PRODUCT.md](PRODUCT.md)、[产品策略](PRODUCT_STRATEGY.md)、[路线图](ROADMAP.md)、[架构约束](ARCHITECTURE.md) 与 [品牌指南](docs/design/brand.md)。页面视觉统一遵循本文件；后续调整集中更新规范，不逐页更换主题。设计调整不改变计算、证据状态、存储或外部服务边界。

## System · 设计方向

- **定位：** Apple 风格的轻量个人收入工具。安静、清晰、数字优先，帮助用户理解时间与收入。
- **受众与主任务：** 有相对稳定收入的个人；少量输入后看懂今日收入估算，需要时再分析购买。
- **Genre / Theme：** modern-minimal / Apple-inspired for Zhiguan。浅色底、系统无衬线字体、单一蓝色操作强调；各页面共享同一系统。
- **Macrostructure：** 收入首页采用 Stat-Led 的应用布局：主数字与含义 → 辅助信息 → 依据与操作。取消营销式整屏占位、入场计数和宣传模块。
- **导航与收尾：** 边缘对齐的轻量顶栏，只承载当前页面所需的返回、收藏和设置操作；页面末尾按需显示本地保存说明，不增加营销页脚。
- **视觉重点：** 留白、稳定的数字排版、分组列表和轻量表单；无需装饰性图片、设备外框、玻璃面板或渐变背景。
- **组件体系：** 官方 shadcn/ui React 组件，统一使用 Radix primitives、Tailwind CSS v4 与语义 CSS 变量；图标采用 Lucide。按页面实际需要引入组件。

## Provenance · 来源与适配

用户选择 [getdesign.md 的 Apple 方案](https://getdesign.md/apple/design-md) 作为值观的公开设计参考；[原始 DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/apple/DESIGN.md) 是第三方对 Apple 网站的设计分析，不是 Apple 官方规范。参考日期为 2026-09-23。

沿用浅灰与白色表面、深色文字、单一蓝色操作色及系统字体方向。本文的页面结构、中文排版、证据表达和控件规则为值观重新制定；不复制 Apple 品牌标识、图片、文案、摄影展陈或 10–12px 微小脚注。颜色锚点源于参考文件，其余值为项目适配值；实际渲染与对比度取样范围见[前端验收记录](docs/design/frontend-acceptance.md)。

## 页面与信息层级

保留现有 `setup / dashboard / purchase / favorites` 页面状态与功能边界，遵循 [PRD-0003](docs/product/prd/PRD-0003-income-dashboard.md) 和现有购买流程。

| 页面 | 首屏重点 | 后续内容与操作 |
| --- | --- | --- |
| 首次设置 | 一个必填项“每月到手收入（元）”；默认作息可见；“保存并开始” | 显示“按双休、每天 8 小时估算 · 可修改”和此浏览器保存范围；详细设置折叠，备份恢复可达 |
| 收入首页 | “今日收入估算”与一个主金额；当前工作或休息状态 | 本月收入估算和每秒速率排为辅助信息；一句口径说明与可展开依据；“算一笔购买”、收藏与设置为次级操作 |
| 收入与作息设置 | 当前值和分组字段，保留草稿与校验反馈 | 工作日、时段、特殊日期和时区按需展开；保存前说明重算影响；备份与清空单独分组 |
| 购买分析 | 一句话输入与手动切换；复用已有基础资料 | 按需追问、摘要确认、工作时间等价结果、可选决定、收藏与下载；显示本次比较口径及临时覆盖 |
| 收藏 | 可扫描的纵向列表；购买对象、当时结果、收藏时间与证据状态 | 详情展开当时的输入和依据；保留重新试算与删除；空列表说明如何主动收藏 |

主金额附近始终保留“估算”与简短依据；详细公式可以折叠。收入理解本身就是完整任务，不把购买、收藏或决定包装成必做步骤。不为凑齐看板添加账户、资产余额、排行榜、目标、订阅、趋势图或虚构历史。

## Tokens · 语义变量

当前以本文为规范来源。下列变量已接入 `src/styles/app.css`，由 shadcn/ui 与页面共用；不并存一套 Hallmark 配色和一套 shadcn 配色。本文不创建未接入页面的 `tokens.css` 或 token 导出流水线。

以下是完整 CSS 颜色值，直接用 `var(--primary)` 消费，不再包裹 `hsl()` 或 `oklch()`。`primary` 表示主操作，`accent` 表示列表、菜单等轻量交互表面。主题映射参照 [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)。

```css
:root {
  --background: oklch(0.97071 0.00265 286.35); /* #f5f5f7 */
  --foreground: oklch(0.23158 0.00381 286.10); /* #1d1d1f */
  --card: oklch(1 0 0);
  --card-foreground: var(--foreground);
  --popover: var(--card);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.52197 0.17709 255.83); /* #0066cc */
  --primary-foreground: var(--card);
  --primary-hover: oklch(0.48021 0.16048 255.42);
  --primary-pressed: oklch(0.43523 0.14467 255.27);
  --secondary: oklch(0.93243 0.00670 286.27);
  --secondary-foreground: var(--foreground);
  --muted: var(--secondary);
  --muted-foreground: oklch(0.48792 0.01107 285.98);
  --accent: oklch(0.96091 0.01878 255.53);
  --accent-foreground: var(--foreground);
  --destructive: oklch(0.50034 0.18205 29.51);
  --destructive-foreground: var(--card);
  --border: oklch(0.86524 0.00683 286.26);
  --input: oklch(0.62166 0.00742 286.18);
  --ring: var(--primary);
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --radius: 0.75rem;
  --radius-card: 1.125rem;
  --radius-pill: 9999px;
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 0.75rem;
  --space-lg: 1rem;
  --space-xl: 1.5rem;
  --space-2xl: 2rem;
  --space-3xl: 3rem;
  --space-4xl: 4rem;
  --text-caption: 0.875rem;
  --text-body: 1rem;
  --text-section: 1.25rem;
  --text-title: clamp(1.5rem, 3vw, 2rem);
  --text-income: clamp(2.5rem, 6vw, 5rem);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
}
```

`--border` 只做装饰性分隔；需要可辨识边界的输入框使用 `--input`，焦点使用 `--ring`。说明、占位文字使用 `--muted-foreground`，不可再通过降低透明度削弱关键说明。蓝色保留给可操作元素和焦点，不把收入数值染成“增长成功”的颜色。红色只用于错误或破坏性操作，不评价购买与收入。

### Exports · Tailwind v4 / shadcn/ui 映射

以下映射已接入 `src/styles/app.css` 的 Tailwind v4 主题块，并保留实际需要的导入和变量；不另建重复主题。官方接入方式见 [Vite 安装说明](https://ui.shadcn.com/docs/installation/vite)。

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary-hover: var(--primary-hover);
  --color-primary-pressed: var(--primary-pressed);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: var(--radius-card);
  --font-sans: var(--font-ui);
}
```

字号、间距、动效和胶囊圆角复用上面的命名变量；页面不得重复写裸颜色或另选字体。首轮设计基线为浅色，不自动套用组件默认深色配色；后续若增加深色模式，在本规范中统一定义并验证。

## 排版、空间与形状

- **字体：** 全站使用同一系统无衬线栈，以 400/500/600 字重建立层级；标题使用正体。字体由本机提供，不下载或打包 SF Pro；中文不套用英文标题的负字距。
- **主金额：** `--text-income`、600 字重、约 1.1 行高；使用 `font-variant-numeric: tabular-nums lining-nums`，单位弱于数字但可读。数字更新不改变周边布局；大金额不得截断、用省略号或偷偷舍入为“万”。超长数字在窄屏改用更小预设字号并将单位另行放置。
- **其他文字：** 页面标题 24–32px、分组标题 20px、正文与输入 16px、注释和证据标签至少 14px；中文正文行高约 1.6。重要估算和隐私说明不降为脚注。
- **空间：** 使用 4px 基础尺度；页面最大宽度沿用约 62rem，首填表单约 32rem。手机左右留白 16px，桌面 24–32px；区域间隔 32–48px、组内 16–24px、标签到控件 8px。
- **容器：** 主数字区优先开放布局，辅助数字组成一组；表单与收藏用分组和列表组织，避免卡片套卡片。确需卡片时采用白底、18px 圆角和轻分隔，常规内容不加投影。
- **按钮与输入：** 主操作蓝底白字、胶囊形；次操作采用 outline/ghost，普通输入沿用 12px 圆角。默认触控目标至少 44×44px，输入文字至少 16px。相同语义的控件使用统一 variant，不在页面上逐个改样式。

## shadcn/ui 组件使用约定

组件承载交互和可访问性，值观主题决定外观。只按已有功能添加组件，不引入整套 dashboard 模板、额外路由、表单框架或图表依赖。现有业务状态与计算继续由原模块负责。

| 需求 | 组件与约定 |
| --- | --- |
| 操作 | `Button` 的 default/outline/ghost/destructive；主按钮只对应当前任务，忙碌时保持宽度并用动作文字反馈 |
| 表单 | `FieldGroup / Field / FieldLabel / FieldDescription / FieldError` 配 `Input / Textarea / Checkbox / RadioGroup / Select`；错误与字段关联，保留输入 |
| 作息与备份输入 | 日期、时间和文件选择优先保留原生能力；明确标签、时区和单位，不为外观改写解析或校验 |
| 可选设置与依据 | `Collapsible`，多组独立内容才用 `Accordion`；展开控件必须有文字和展开状态 |
| 收藏与结果 | 普通语义列表优先；独立面板使用共享的表面与边界样式；用 `Badge` 表达证据状态，必要时以分隔线分组 |
| 异常与空状态 | `Alert` 显示错误、未保存或冲突；`Empty` 显示首次或无收藏；成功优先就地确认 |
| 覆盖与清空确认 | `AlertDialog` 展示准确影响范围、取消和确认；取消保持原资料，默认焦点放在取消；单项删除保持现有确认语义 |

表单无效时，`Field` 使用 `data-invalid`，控件使用 `aria-invalid` 并关联错误文本。图标仅用于明确动作；装饰图标对读屏隐藏，纯图标按钮有可访问名称。弹层保留标题、描述、焦点管理和键盘关闭能力。组件 API 在实际接入时按所选 Radix 版本的官方文档核对。

## 证据状态与交互状态

证据状态来自领域结果，不从金额、颜色、保存成功或确认按钮推断。同一状态在首页、购买分析、收藏与导出保持原语义：

| 领域状态 | 界面文字与处理 |
| --- | --- |
| `actual` | “实际”；只用于已有可追溯实际记录，不把当前收入估算放入此类 |
| `user-confirmed` | “已确认”；描述用户核对的输入，不能提升其派生估算或预测的证据等级 |
| `estimated` | “估算”；与数值就近呈现，说明输入、计划作息、月份与时区等依据 |
| `forecast` | “预测”；呈现未来假设与适用范围，不写成承诺 |
| `insufficient-data` | “数据不足”；数值位可以显示 `—`，同时给出缺失原因和修正入口，不填零或旧结果 |

证据 `Badge` 使用中性 secondary/outline 样式和完整文字，不依靠红绿、颜色深浅或图标区分可信度。真实计算得到的零正常显示，不能与数据不足混淆。

| 交互状态 | 反馈要求 |
| --- | --- |
| default / hover | 主按钮使用 primary/primary-hover，轻操作使用 accent 表面；hover 不放大、不抬升 |
| focus / active | focus-visible 立即显示不低于 3:1 的 2px 焦点环，外偏移 2px；active 使用 primary-pressed，不缩放或位移 |
| disabled / loading | 使用真实禁用语义；必要时说明禁用原因；等待时禁止重复提交且保留当前内容，不为本地即时计算添加假加载 |
| error / success | 错误就地说明原因和恢复路径；成功使用简短状态文字；只有实际写入成功才能显示“已保存” |

保存失败明确显示“未保存，本次可临时使用”；资料冲突、损坏或恢复失败保留原资料和恢复出口。说明“仅保存在此浏览器”，不宣称云同步、加密或保证下载已落盘。恢复覆盖与清空的确认范围遵循 [ADR-0008](docs/adr/ADR-0008-local-profile-and-purchase-favorites.md)。

## 响应式、动效与可访问性

- 在 320 / 375 / 414 / 768px 和桌面宽度检查核心页面；手机单列、分组标题上下排列，网格使用 `minmax(0, 1fr)`。操作组可换行，单个按钮文字保持单行；长标题、错误和说明可自然折行。
- `html` 与 `body` 使用 `overflow-x: clip` 作为防护，同时修复实际溢出；不可依赖裁切隐藏内容。检查大金额、长中文、长文件名、200% 缩放和键盘焦点，所有核心信息与操作可达。
- 正文及说明对比度至少 4.5:1；大字、必要控件边界和焦点至少 3:1。可读性优先于“浅灰高级感”，验收以最终组合及实际状态为准。
- 数值按领域结果直接刷新，不使用从零增长、翻牌、闪烁、弹跳、庆祝粒子或红绿涨跌。收入主数字保持 `aria-live="off"`；操作结果和错误按需使用合适的 live region，不逐秒打断读屏。
- 默认无入场动画。确需弹层过渡时，仅使用不超过 180ms 的 opacity/transform 与命名 easing；不动画布局、焦点环或输入错误。减少动态模式移除空间运动，最多保留 120ms 淡变。
- 保留输入标签、标题层级、键盘顺序、清楚的可见焦点和返回路径；错误、选中、估算及工作/休息状态都有文字表达。

## 实施与验收边界

1. 手机与桌面概念稿见[概念稿页面](docs/design/frontend-concepts.html)；演示只使用合成数据，不使用个人财务截图。
2. 现有应用已接入 shadcn/ui，复用原页面与领域模块；基础样式和公共 variants 集中维护，未新增平行 UI，也未改写购买草稿与本地资料语义。
3. 本地 preview 与临时 Docker 容器的可重复交互、视口及资源检查见[前端验收记录](docs/design/frontend-acceptance.md)。该记录只覆盖列明的状态与视口；概念稿、组件接入和有限浏览器检查不能推定真实用户验证、原生浏览器缩放、完整对比度组合或 Jev 全部网络行为已通过。
