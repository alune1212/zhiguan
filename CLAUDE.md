# Claude 入口

开始任何任务前先阅读根目录 [`AGENTS.md`](AGENTS.md)。它是本仓库唯一的 AI/贡献者协作规则来源。

随后按 `AGENTS.md` 的顺序阅读 `PRODUCT.md`、`PRODUCT_STRATEGY.md`、`ROADMAP.md`、`ARCHITECTURE.md` 以及相关 PRD、RFC、ADR。产品宪法优先于实现偏好；涉及宪法冲突先提交 RFC。

提交前使用 GitHub Issue/PR 模板完成产品对齐、数据与信任、隐私、可解释性、输入负担、反焦虑、范围和验证门禁。不要在此文件复制规则；详细规则变更只修改 `AGENTS.md`。

## Agent skills

### Issue tracker

Issues and specs are tracked in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default canonical label names. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo. Domain context lives in root `CONTEXT.md` when created, with architecture decisions under `docs/adr/`. See `docs/agents/domain.md`.
