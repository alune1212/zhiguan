import { useEffect, useRef, useState } from "react";

import {
  type EvidenceChoice,
  type NumericEvidenceField,
  type WorkbenchApplicationState,
  type WorkbenchController,
  type WorkbenchFieldId,
  resultsForState,
  useWorkbenchController,
} from "../application/workbench";
import {
  type ExportFormat,
  type ExportWorkbenchOptions,
  type ExportWorkbenchController,
  useExportWorkbenchController,
} from "../application/export-workbench";
import { getBuildIdentityGate, type BuildIdentityGate } from "../adapters/browser/build-metadata";
import type { CalculationResult } from "../domain/calculation";
import type { DecisionCode } from "../domain/session";

const FIELD_LABELS: Record<WorkbenchFieldId, string> = {
  "comparison-period": "比较周期",
  currency: "币种",
  income: "同周期收入",
  "income-tax-basis": "收入口径",
  "work-hours": "同周期工作小时",
  "purchase-price": "购买价格",
  "purchase-period-inclusion": "是否计入所选周期",
  "fixed-cost-total": "固定成本汇总",
  "fixed-cost-coverage": "固定成本覆盖范围",
  "fixed-cost-coverage-description": "覆盖范围说明",
  "value-expectation": "个人价值期待",
};

const RESULT_LABELS: Record<string, string> = {
  "income-rate": "Income Rate",
  "work-time-equivalent": "Work-time Equivalent",
  "coverage-available-margin": "覆盖范围内可用余量",
  "purchase-after-margin": "购买后余量",
  "purchase-impact": "购买影响",
};

const DECISION_OPTIONS: readonly { readonly code: DecisionCode; readonly label: string }[] = [
  { code: "buy", label: "购买" },
  { code: "wait", label: "等待" },
  { code: "adjust-conditions", label: "调整条件" },
  { code: "do-not-buy", label: "不购买" },
  { code: "undecided", label: "暂不决定" },
];

const REASON_LABELS: Record<string, string> = {
  "missing-income": "缺少同周期收入",
  "missing-work-hours": "缺少同周期工作小时",
  "missing-purchase-price": "缺少购买价格",
  "missing-fixed-cost": "缺少固定成本汇总",
  "comparison-period-unconfirmed": "比较周期尚未确认",
  "currency-unconfirmed": "币种尚未确认",
  "tax-basis-unconfirmed": "收入口径尚未确认",
  "input-unconfirmed": "输入状态尚未确认",
  "invalid-decimal": "数字格式不符合当前输入规则",
  "zero-not-allowed": "金额或工作小时不能为零",
  "negative-not-allowed": "原始金额或工作小时不能为负数",
  "fraction-exceeds-currency-minor-unit": "小数位超过该币种精度",
  "numeric-limit-exceeded": "数字超过当前原型的边界",
  "unsupported-currency": "币种不在固定 ISO 4217 快照中",
  "currency-mismatch": "输入使用了不同币种",
  "period-mismatch": "输入不属于同一比较周期",
  "input-reconfirmation-required": "需要重新确认当前输入",
  "tax-basis-not-after-tax": "覆盖余量需要税后收入",
  "fixed-cost-coverage-incomplete": "固定成本覆盖范围不完整",
  "fixed-cost-coverage-description-missing": "缺少固定成本覆盖范围说明",
  "purchase-period-unconfirmed": "尚未确认购买是否计入所选周期",
  "division-by-zero": "当前输入无法完成除法",
  "rule-execution-failed": "规则内核未能完成这项计算",
};

const EVIDENCE_LABELS: Record<EvidenceChoice, string> = {
  "user-confirmed": "用户确认",
  estimated: "近似输入",
};

const PERIOD_LABELS: Readonly<Record<string, string>> = {
  week: "周",
  month: "月",
  year: "年",
  custom: "自定义周期",
};

const NUMERIC_SUMMARY_FIELDS: readonly NumericEvidenceField[] = [
  "income",
  "work-hours",
  "purchase-price",
  "fixed-cost-total",
];

function periodLabel(kind: string): string {
  return PERIOD_LABELS[kind] ?? kind;
}

function summaryValue(state: WorkbenchApplicationState, fieldId: WorkbenchFieldId): string {
  const value = valueOf(state, fieldId).trim();
  if (!value) return "";
  if (fieldId === "comparison-period") {
    const customLabel = state.draft["period-custom-label"].trim();
    return value === "custom" && customLabel.length > 0
      ? `${periodLabel(value)}（${customLabel}）`
      : periodLabel(value);
  }
  if (fieldId === "income-tax-basis") {
    return value === "after-tax" ? "税后" : value === "before-tax" ? "税前" : value;
  }
  if (fieldId === "purchase-period-inclusion") {
    return value === "included" ? "计入" : value === "excluded" ? "不计入" : value;
  }
  if (fieldId === "fixed-cost-coverage") {
    return value === "complete" ? "完整" : value === "partial" ? "部分" : value === "unknown" ? "未知" : value;
  }
  return value;
}

function summarySource(state: WorkbenchApplicationState, fieldId: WorkbenchFieldId): string {
  return valueOf(state, fieldId).trim().length > 0 ? "用户输入" : "未提供";
}

function summaryStatus(state: WorkbenchApplicationState, fieldId: WorkbenchFieldId): string {
  const value = valueOf(state, fieldId).trim();
  if (!value) return "未提供";
  if (NUMERIC_SUMMARY_FIELDS.includes(fieldId as NumericEvidenceField)) {
    const evidence = state.evidence[fieldId as NumericEvidenceField];
    return evidence ? EVIDENCE_LABELS[evidence] : "未标记";
  }
  return "待确认";
}

const STAGE_LABELS = ["输入与期待", "确认口径与状态", "理解与推演", "决定与复盘交接"] as const;

function currentStage(state: WorkbenchApplicationState): number {
  switch (state.session.phase) {
    case "input":
      return 1;
    case "confirmation":
      return 2;
    case "understanding":
      return 3;
    case "decision":
    case "review":
      return 4;
  }
}

function isInputStage(state: WorkbenchApplicationState): boolean {
  return state.session.phase === "input";
}

function isConfirmationStage(state: WorkbenchApplicationState): boolean {
  return state.session.phase === "confirmation";
}

function isUnderstandingStage(state: WorkbenchApplicationState): boolean {
  return state.session.phase === "understanding";
}

function isDecisionStage(state: WorkbenchApplicationState): boolean {
  return state.session.phase === "decision" || state.session.phase === "review";
}

function valueOf(state: WorkbenchApplicationState, fieldId: string): string {
  return state.draft[fieldId] ?? "";
}

function EvidenceSelect({
  fieldId,
  value,
  onChange,
  label,
}: {
  readonly fieldId: NumericEvidenceField;
  readonly value: EvidenceChoice | "";
  readonly onChange: (value: EvidenceChoice | "") => void;
  readonly label: string;
}) {
  return (
    <label className="field evidence-field">
      <span>{label}的状态</span>
      <select
        aria-label={`${label}的状态`}
        data-field-id={fieldId}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as EvidenceChoice | "")}
      >
        <option value="">选择输入状态</option>
        <option value="user-confirmed">用户确认</option>
        <option value="estimated">近似输入</option>
      </select>
    </label>
  );
}

function FieldError({ error, id }: { readonly error?: string; readonly id: string }) {
  if (!error) return null;
  return (
    <span className="field-error" id={id} role="alert">
      {error}
    </span>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  required = false,
  hint,
  inputMode,
}: {
  readonly id: WorkbenchFieldId | "period-custom-label";
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
  readonly required?: boolean;
  readonly hint?: string;
  readonly inputMode?: "decimal" | "text";
}) {
  const errorId = `${id}-error`;
  return (
    <label className="field" htmlFor={id}>
      <span>
        {label}
        {required ? <em>必填</em> : <small>可选</small>}
      </span>
      <input
        id={id}
        name={id}
        type="text"
        value={value}
        inputMode={inputMode}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {hint ? <span className="field-hint" id={`${id}-hint`}>{hint}</span> : null}
      <FieldError id={errorId} error={error} />
    </label>
  );
}

function InputForm({ controller }: { readonly controller: WorkbenchController }) {
  const state = controller;
  return (
    <section className="section-block" aria-labelledby="input-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Capture</p>
          <h2 id="input-title" data-stage-heading tabIndex={-1}>先放回你的口径</h2>
        </div>
        <p className="section-summary">只填写完成这次判断需要的最少信息。所有输入都可以留在当前页面内存中。</p>
      </div>

      <div className="form-grid">
        <label className="field" htmlFor="comparison-period">
          <span>比较周期<em>必填</em></span>
          <select
            id="comparison-period"
            name="comparison-period"
            value={valueOf(state, "comparison-period")}
            aria-invalid={state.inputErrors["comparison-period"] ? "true" : undefined}
            aria-describedby={state.inputErrors["comparison-period"] ? "comparison-period-error" : undefined}
            onChange={(event) => state.setField("comparison-period", event.currentTarget.value)}
          >
            <option value="">选择周期</option>
            <option value="week">周</option>
            <option value="month">月</option>
            <option value="year">年</option>
            <option value="custom">自定义周期</option>
          </select>
          <FieldError id="comparison-period-error" error={state.inputErrors["comparison-period"]} />
        </label>

        {valueOf(state, "comparison-period") === "custom" ? (
          <TextField
            id="period-custom-label"
            label="自定义周期名称"
            value={valueOf(state, "period-custom-label")}
            required
            onChange={(value) => state.setField("period-custom-label", value)}
            hint="不需要填写精确起止日期。"
          />
        ) : null}

        <TextField
          id="currency"
          label="币种"
          value={valueOf(state, "currency")}
          required
          onChange={(value) => state.setField("currency", value)}
          error={state.inputErrors.currency}
          hint="使用固定 ISO 4217 大写代码，例如 CNY。"
        />
        <label className="field" htmlFor="income-tax-basis">
          <span>收入口径<em>必填</em></span>
          <select
            id="income-tax-basis"
            name="income-tax-basis"
            value={valueOf(state, "income-tax-basis")}
            aria-invalid={state.inputErrors["income-tax-basis"] ? "true" : undefined}
            aria-describedby={state.inputErrors["income-tax-basis"] ? "income-tax-basis-error" : undefined}
            onChange={(event) => state.setField("income-tax-basis", event.currentTarget.value)}
          >
            <option value="">选择口径</option>
            <option value="after-tax">税后</option>
            <option value="before-tax">税前</option>
          </select>
          <FieldError id="income-tax-basis-error" error={state.inputErrors["income-tax-basis"]} />
        </label>

        <TextField
          id="income"
          label="同周期收入"
          value={valueOf(state, "income")}
          required
          inputMode="decimal"
          onChange={(value) => state.setField("income", value)}
          error={state.inputErrors.income}
          hint="正数；不输入逗号或货币符号。"
        />
        <EvidenceSelect
          fieldId="income"
          label="同周期收入"
          value={state.evidence.income}
          onChange={(value) => state.setEvidence("income", value)}
        />

        <TextField
          id="work-hours"
          label="同周期工作小时"
          value={valueOf(state, "work-hours")}
          required
          inputMode="decimal"
          onChange={(value) => state.setField("work-hours", value)}
          error={state.inputErrors["work-hours"]}
          hint="只用于时间比较，不代表生活价值。"
        />
        <EvidenceSelect
          fieldId="work-hours"
          label="同周期工作小时"
          value={state.evidence["work-hours"]}
          onChange={(value) => state.setEvidence("work-hours", value)}
        />

        <TextField
          id="purchase-price"
          label="购买价格"
          value={valueOf(state, "purchase-price")}
          required
          inputMode="decimal"
          onChange={(value) => state.setField("purchase-price", value)}
          error={state.inputErrors["purchase-price"]}
          hint="不需要商品链接、账单或凭证。"
        />
        <EvidenceSelect
          fieldId="purchase-price"
          label="购买价格"
          value={state.evidence["purchase-price"]}
          onChange={(value) => state.setEvidence("purchase-price", value)}
        />

        <fieldset
          className="field fieldset-field"
          aria-invalid={state.inputErrors["purchase-period-inclusion"] ? "true" : undefined}
          aria-describedby={state.inputErrors["purchase-period-inclusion"] ? "purchase-period-inclusion-error" : undefined}
        >
          <legend>是否计入所选周期<em>必填</em></legend>
          <label className="choice-line"><input type="radio" name="purchase-period-inclusion" value="included" checked={valueOf(state, "purchase-period-inclusion") === "included"} onChange={(event) => state.setField("purchase-period-inclusion", event.currentTarget.value)} />计入</label>
          <label className="choice-line"><input type="radio" name="purchase-period-inclusion" value="excluded" checked={valueOf(state, "purchase-period-inclusion") === "excluded"} onChange={(event) => state.setField("purchase-period-inclusion", event.currentTarget.value)} />不计入</label>
          <FieldError id="purchase-period-inclusion-error" error={state.inputErrors["purchase-period-inclusion"]} />
        </fieldset>

        <TextField
          id="fixed-cost-total"
          label="固定成本汇总"
          value={valueOf(state, "fixed-cost-total")}
          inputMode="decimal"
          onChange={(value) => state.setField("fixed-cost-total", value)}
          error={state.inputErrors["fixed-cost-total"]}
          hint="可留空；不要求列出交易明细。"
        />
        <EvidenceSelect
          fieldId="fixed-cost-total"
          label="固定成本汇总"
          value={state.evidence["fixed-cost-total"]}
          onChange={(value) => state.setEvidence("fixed-cost-total", value)}
        />

        <label className="field" htmlFor="fixed-cost-coverage">
          <span>固定成本覆盖范围<small>可选</small></span>
          <select
            id="fixed-cost-coverage"
            value={valueOf(state, "fixed-cost-coverage")}
            aria-invalid={state.inputErrors["fixed-cost-coverage"] ? "true" : undefined}
            aria-describedby={state.inputErrors["fixed-cost-coverage"] ? "fixed-cost-coverage-error" : undefined}
            onChange={(event) => state.setField("fixed-cost-coverage", event.currentTarget.value)}
          >
            <option value="">未选择</option>
            <option value="complete">完整</option>
            <option value="partial">部分</option>
            <option value="unknown">未知</option>
          </select>
          <FieldError id="fixed-cost-coverage-error" error={state.inputErrors["fixed-cost-coverage"]} />
        </label>
        <TextField
          id="fixed-cost-coverage-description"
          label="覆盖范围说明"
          value={valueOf(state, "fixed-cost-coverage-description")}
          onChange={(value) => state.setField("fixed-cost-coverage-description", value)}
          error={state.inputErrors["fixed-cost-coverage-description"]}
          hint="例如：只包含已确认的固定支出总额。"
        />
      </div>

      <label className="field field-wide" htmlFor="value-expectation">
        <span>个人价值期待<em>必填</em></span>
        <textarea
          id="value-expectation"
          name="value-expectation"
          rows={3}
          value={valueOf(state, "value-expectation")}
          aria-invalid={state.inputErrors["value-expectation"] ? "true" : undefined}
          aria-describedby={state.inputErrors["value-expectation"] ? "value-expectation-error" : undefined}
          onChange={(event) => state.setField("value-expectation", event.currentTarget.value)}
        />
        <span className="field-hint">写下你希望这项购买带来的结果；它不会被转换成分数或购买结论。</span>
        <FieldError id="value-expectation-error" error={state.inputErrors["value-expectation"]} />
      </label>

      <div className="action-row">
        <button className="button button-primary" type="button" onClick={state.openConfirmation}>检查输入与口径</button>
        {state.session.confirmed && state.session.confirmedStability === "invalidated" && state.session.draft ? (
          <button className="button button-secondary" type="button" onClick={() => state.dispatch({ type: "cancel-edit" })}>取消这次编辑</button>
        ) : null}
        <p className="action-note">不愿继续时可以随时退出，不需要说明原因。</p>
      </div>
    </section>
  );
}

function ConfirmationSection({ controller }: { readonly controller: WorkbenchController }) {
  const state = controller;
  const summaryFields: readonly WorkbenchFieldId[] = [
    "comparison-period", "currency", "income-tax-basis", "income", "work-hours", "purchase-price",
    "purchase-period-inclusion", "fixed-cost-total", "fixed-cost-coverage", "fixed-cost-coverage-description", "value-expectation",
  ];
  return (
    <section className="section-block" aria-labelledby="confirmation-title">
      <div className="section-heading">
        <div><p className="section-kicker">Normalize</p><h2 id="confirmation-title" data-stage-heading tabIndex={-1}>确认口径与状态</h2></div>
        <p className="section-summary">请核对周期、币种、税口径和每项输入的证据状态。近似输入会保持为估算。</p>
      </div>
      <dl className="summary-list">
        {summaryFields.map((fieldId) => (
          <div className="summary-row" key={fieldId}>
            <dt>{FIELD_LABELS[fieldId]}</dt>
            <dd>
              {summaryValue(state, fieldId) || "未提供"}
              <span className="status-chip">来源：{summarySource(state, fieldId)}</span>
              <span className="status-chip">状态：{summaryStatus(state, fieldId)}</span>
            </dd>
          </div>
        ))}
      </dl>
      {state.notice ? <p className="inline-notice" role="status">{state.notice}</p> : null}
      <div className="action-row">
        <button className="button button-secondary" type="button" onClick={() => state.session.confirmed ? state.dispatch({ type: "cancel-edit" }) : state.dispatch({ type: "back-to-input" })}>{state.session.confirmed ? "取消这次编辑" : "返回输入"}</button>
        <button className="button button-primary" type="button" onClick={state.confirmInput}>{state.session.confirmed ? "重新确认当前输入" : "确认口径并查看结果"}</button>
      </div>
    </section>
  );
}

function statusLabel(result: CalculationResult): string {
  if (result.availability !== "available") return "数据不足";
  switch (result.evidenceStatus) {
    case "forecast": return "预测";
    case "estimated": return "估算";
    case "user-confirmed": return "用户确认";
    default: return result.evidenceStatus;
  }
}

function resultValue(result: CalculationResult): string {
  return result.availability === "available" && result.display ? result.display.text : "数据不足";
}

function EvidenceDetails({ result }: { readonly result: CalculationResult }) {
  const time = result.timeContext;
  return (
    <details className="evidence-details">
      <summary>查看依据</summary>
      <div className="evidence-body">
        <dl className="evidence-list">
          <div><dt>来源</dt><dd>{result.source}（规则内核）</dd></div>
          <div><dt>输入</dt><dd>{result.dependencyFieldIds.map((fieldId) => FIELD_LABELS[fieldId as WorkbenchFieldId] ?? fieldId).join("、") || "无"}</dd></div>
          <div><dt>估算输入</dt><dd>{result.estimatedDependencyFieldIds.map((fieldId) => FIELD_LABELS[fieldId as WorkbenchFieldId] ?? fieldId).join("、") || "无"}</dd></div>
          <div><dt>公式/规则</dt><dd>{result.formulaExpression} · 规则版本 {result.rulesetRef}</dd></div>
          <div><dt>单位与币种</dt><dd>{result.unit} · {result.currencyCode ?? "不适用"}</dd></div>
          <div><dt>比较周期</dt><dd>{result.periodRef ? `${periodLabel(result.periodRef.kind)}${result.periodRef.customLabel ? `（${result.periodRef.customLabel}）` : ""} · ${result.periodRef.revision}` : "未提供"}</dd></div>
          <div><dt>税口径</dt><dd>{result.taxBasis === "after-tax" ? "税后" : result.taxBasis === "before-tax" ? "税前" : "未提供"}</dd></div>
          <div><dt>生成时点</dt><dd>{time ? `${time.recordedAtUtc} · ${time.timeZoneId}` : "未提供"}</dd></div>
          <div><dt>状态</dt><dd>{statusLabel(result)}</dd></div>
          <div><dt>假设</dt><dd>{result.assumptions.length > 0 ? result.assumptions.join("；") : "无额外假设"}</dd></div>
          <div><dt>限制</dt><dd>{result.limitations.length > 0 ? result.limitations.join("；") : "结果只描述当前输入下的规则关系。"}</dd></div>
          <div><dt>原因</dt><dd>{result.reasonCodes.length > 0 ? result.reasonCodes.map((code) => REASON_LABELS[code] ?? code).join("；") : "无"}</dd></div>
          <div><dt>恢复</dt><dd>{result.availability === "available" ? "可返回确认阶段修改输入后重新确认。" : "补齐或修正上述原因后，再返回确认阶段重新确认。"}</dd></div>
        </dl>
      </div>
    </details>
  );
}

function ResultCard({ result }: { readonly result: CalculationResult }) {
  const titleId = `${result.formulaId}-result-title`;
  return (
    <article
      className={`result-card ${result.availability === "available" ? "is-available" : "is-unavailable"}`}
      aria-labelledby={titleId}
    >
      <div className="result-card-heading">
        <div><h3 id={titleId}>{RESULT_LABELS[result.formulaId] ?? result.formulaId}</h3><p>{resultValue(result)}</p></div>
        <span className="result-status">{statusLabel(result)}</span>
      </div>
      <EvidenceDetails result={result} />
    </article>
  );
}

function UnderstandingSection({ controller }: { readonly controller: WorkbenchController }) {
  const state = controller;
  const results = resultsForState(state);
  return (
    <section className="section-block" aria-labelledby="understanding-title">
      <div className="section-heading">
        <div><p className="section-kicker">Understand · Simulate</p><h2 id="understanding-title" data-stage-heading tabIndex={-1}>理解与推演</h2></div>
        <p className="section-summary">结果只来自当前确认的输入。数据不足会局部停下，不会用默认值填补。</p>
      </div>
      <div className="expectation-callout"><span>你的价值期待</span><p>{valueOf(state, "value-expectation") || "未提供"}</p></div>
      <div className="result-list" aria-live="polite">
        {results.length > 0 ? results.map((result) => <ResultCard key={result.formulaId} result={result} />) : <p className="empty-state">当前没有可展示的结果，请返回确认阶段检查输入。</p>}
      </div>
      {state.notice ? <p className="inline-notice" role="status">{state.notice}</p> : null}
      <div className="action-row">
        <button className="button button-secondary" type="button" onClick={() => state.dispatch({ type: "begin-edit" })}>返回修改</button>
        <button className="button button-primary" type="button" onClick={() => state.dispatch({ type: "open-decision" })}>继续到决定</button>
      </div>
    </section>
  );
}

const EXPORT_FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  json: "JSON",
  markdown: "Markdown",
};

const EXPORT_STATE_LABELS: Readonly<Record<string, string>> = {
  idle: "未预览",
  previewing: "正在预览",
  ready: "等待确认",
  generating: "正在生成",
  "download-requested": "已发起下载请求",
  failed: "导出失败",
  cancelled: "已取消",
};

function ExportFormatPanel({
  format,
  controller,
}: {
  readonly format: ExportFormat;
  readonly controller: ExportWorkbenchController;
}) {
  const state = controller[format];
  const label = EXPORT_FORMAT_LABELS[format];
  const errorId = `export-${format}-error`;
  return (
    <article className="export-format" aria-labelledby={`export-${format}-title`}>
      <div className="export-format-heading">
        <div>
          <h4 id={`export-${format}-title`}>{label}</h4>
          <p className="export-format-status" aria-live="polite">
            {EXPORT_STATE_LABELS[state.state] ?? state.state}
          </p>
        </div>
        <span className="status-chip">{state.state}</span>
      </div>
      {state.preview ? (
        <div className="export-preview" aria-live="polite">
          <dl className="export-preview-list">
            <div><dt>文件名</dt><dd>{state.preview.file_name}</dd></div>
            <div><dt>范围</dt><dd>当前会话的当前快照；含 {state.preview.included_field_ids.length} 个字段和已确认修订。</dd></div>
            <div><dt>敏感类别</dt><dd>{state.preview.sensitive_field_ids.length} 个当前会话字段可能包含金额、时间或文本。</dd></div>
            <div><dt>缺失与不足</dt><dd>数据不足仍按不可用结果保留，不以默认值补齐。</dd></div>
            <div><dt>设备边界</dt><dd>页面只报告下载请求；是否保存、最终名称和位置由浏览器与设备决定。</dd></div>
          </dl>
          {state.state === "ready" ? (
            <div className="action-row">
              <button className="button button-primary" type="button" onClick={() => controller.confirm(format)}>
                确认并发起 {label} 下载请求
              </button>
              <button className="button button-secondary" type="button" onClick={() => controller.cancel(format)}>
                取消 {label} 导出
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {state.state === "download-requested" ? (
        <p className="inline-notice" role="status">页面已发起下载请求；浏览器或设备是否保存、最终名称和位置未知。</p>
      ) : null}
      {!state.preview && state.state === "cancelled" ? <p className="inline-notice" role="status">已取消本格式导出；当前会话保持不变。</p> : null}
      {state.error ? <p className="field-error" id={errorId} role="alert">{state.error.message}</p> : null}
      {controller.snapshot && !state.preview && !controller.paused ? (
        <button className="button button-secondary" type="button" onClick={() => controller.preview(format)}>
          预览 {label}
        </button>
      ) : null}
    </article>
  );
}

function ExportSection({ controller }: { readonly controller: ExportWorkbenchController }) {
  const canOpen = controller.canExport && !controller.snapshot && !controller.paused && !controller.cleanupBlocked;
  const hasSnapshot = controller.snapshot !== null && !controller.snapshotStale;
  const hasDownloadRequest = controller.json.state === "download-requested" || controller.markdown.state === "download-requested";
  return (
    <section className="export-workbench" aria-labelledby="export-title">
      <div className="export-heading">
        <div>
          <p className="section-kicker">本地出口</p>
          <h3 id="export-title">当前会话导出</h3>
        </div>
        <p className="export-skip-note">导出可以跳过，不影响继续记录决定或退出。</p>
      </div>
      <p className="export-boundary">
        预览只读取当前页面内存中的当前快照和已确认修订；下载文件进入设备后由你控制，原型不能召回、删除或恢复。
      </p>
      {!controller.buildVerified ? <p className="inline-notice" role="status">未验证实现预览，不能导出。</p> : null}
      {controller.buildVerified && !controller.canExport ? <p className="inline-notice" role="status">暂无可导出内容；请先确认至少一项当前输入。</p> : null}
      {controller.paused ? <p className="field-error" role="alert">{controller.pauseError?.message ?? "导出合同验证失败，当前构建已暂停。"}</p> : null}
      {controller.error && !controller.pauseError ? <p className="field-error" role="alert">{controller.error.message}</p> : null}
      <div className="action-row">
        <button className="button button-secondary" type="button" onClick={controller.open} disabled={!canOpen}>
          打开导出预览
        </button>
        {hasSnapshot ? <p className="action-note">已冻结一个共享快照；请分别预览并确认 JSON 或 Markdown。</p> : null}
      </div>
      {hasSnapshot || hasDownloadRequest ? (
        <div className="export-format-grid">
          <ExportFormatPanel format="json" controller={controller} />
          <ExportFormatPanel format="markdown" controller={controller} />
        </div>
      ) : null}
    </section>
  );
}

function DecisionSection({ controller, exportController }: { readonly controller: WorkbenchController; readonly exportController: ExportWorkbenchController }) {
  const state = controller;
  const [selected, setSelected] = useState<DecisionCode | "">(state.session.decision.code ?? "");
  const [rationale, setRationale] = useState(state.session.decision.rationale ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const submitDecision = () => {
    if (selected === "" || rationale.trim().length === 0) {
      setError("请选择一种决定，并填写一句依据或尚待确认条件。");
      const target = selected === ""
        ? document.querySelector<HTMLInputElement>('input[name="decision"]')
        : document.getElementById("decision-rationale");
      target?.focus();
      return;
    }
    setError(null);
    controller.dispatch({ type: "set-decision", code: selected, rationale });
  };

  const saveReview = () => {
    if (state.reviewDraft.kind === "" && state.reviewDraft.value.trim().length === 0) {
      return;
    }
    if (state.reviewDraft.kind === "" || state.reviewDraft.value.trim().length === 0) {
      setReviewError("如填写复盘交接，请同时选择日期或条件并填写内容。");
      const target = state.reviewDraft.kind === ""
        ? document.getElementById("review-kind")
        : document.getElementById("review-value");
      target?.focus();
      return;
    }
    setReviewError(null);
    controller.dispatch({ type: "save-review" });
  };

  return (
    <section className="section-block decision-block" aria-labelledby="decision-title">
      <div className="section-heading">
        <div><p className="section-kicker">Decide · Review handoff</p><h2 id="decision-title" data-stage-heading tabIndex={-1}>记录你的决定</h2></div>
        <p className="section-summary">这里不评价、不排序，也不替你判断什么值得。复盘交接由产品外人工完成。</p>
      </div>

      <fieldset className="decision-options" aria-invalid={error ? "true" : undefined} aria-describedby={error ? "decision-error" : undefined}>
        <legend>决定状态</legend>
        {DECISION_OPTIONS.map(({ code, label }) => (
          <label className="decision-option" key={code}><input type="radio" name="decision" value={code} checked={selected === code} onChange={() => setSelected(code)} /><span>{label}</span></label>
        ))}
      </fieldset>
      <label className="field field-wide" htmlFor="decision-rationale">
        <span>依据或尚待确认条件<em>必填</em></span>
        <textarea id="decision-rationale" rows={3} value={rationale} onChange={(event) => { setRationale(event.currentTarget.value); setError(null); }} aria-invalid={error ? "true" : undefined} aria-describedby={error ? "decision-error" : undefined} />
        <span className="field-hint">只记录你当时愿意保留的一句话，不会发送给研究者或其他服务。</span>
      </label>
      {error ? <p className="field-error" id="decision-error" role="alert">{error}</p> : null}
      <div className="action-row">
        <button className="button button-secondary" type="button" onClick={() => controller.dispatch({ type: "set-phase", phase: "understanding" })}>返回理解</button>
        <button className="button button-primary" type="button" onClick={submitDecision}>记录我的决定</button>
      </div>

      {state.handoffComplete ? <div className="handoff-panel" role="status"><h3>决定交接已完成</h3><p>决定只保留在当前会话内存中。原型不创建提醒、不联系任何人，也不代表已经完成产品内复盘。</p></div> : null}

      <div className="review-panel" aria-labelledby="review-title">
        <div><h3 id="review-title">可选复盘条件</h3><p>如果你愿意，可以留下产品外人工复盘的条件或日期。这里不会保存、上传或自动提醒。</p></div>
        <div className="review-grid">
          <label className="field" htmlFor="review-kind"><span>复盘方式<small>可选</small></span><select id="review-kind" value={state.reviewDraft.kind} aria-invalid={reviewError ? "true" : undefined} aria-describedby={reviewError ? "review-error" : undefined} onChange={(event) => { setReviewError(null); controller.dispatch({ type: "set-review-draft", kind: event.currentTarget.value as "" | "local-date" | "condition", value: state.reviewDraft.value }); }}><option value="">暂不设置</option><option value="local-date">日期</option><option value="condition">条件</option></select></label>
          <label className="field" htmlFor="review-value"><span>{state.reviewDraft.kind === "local-date" ? "复盘日期" : "复盘条件"}<small>可选</small></span><input id="review-value" type={state.reviewDraft.kind === "local-date" ? "date" : "text"} value={state.reviewDraft.value} aria-invalid={reviewError ? "true" : undefined} aria-describedby={reviewError ? "review-error" : undefined} onChange={(event) => { setReviewError(null); controller.dispatch({ type: "set-review-draft", kind: state.reviewDraft.kind, value: event.currentTarget.value }); }} /></label>
        </div>
        {reviewError ? <p className="field-error" id="review-error" role="alert">{reviewError}</p> : null}
        <button className="button button-secondary" type="button" onClick={saveReview}>记录复盘交接</button>
        {state.session.review.availability === "available" ? <p className="inline-notice" role="status">复盘交接条件已记录在当前会话内存中。</p> : null}
      </div>

      <ExportSection controller={exportController} />
    </section>
  );
}

function PrivacyNotice({ controller }: { readonly controller: WorkbenchController }) {
  return (
    <section className="privacy-card" aria-labelledby="privacy-title">
      <p className="section-kicker">开始前</p>
      <h1 id="privacy-title">先看清这次会话的边界</h1>
      <p className="lead">这是用于形成性研究的单案例购买决策原型。它只帮助你查看输入、口径和规则关系，不替你定义什么值得，也不提供购买建议。</p>
      <ul className="privacy-list">
        <li>当前会话数据只在浏览器内存中处理；刷新或关闭页面后，原型不会保留或恢复。</li>
        <li>只有你主动触发本地导出时，才会在你的设备上创建文件；下载后的文件由你的设备控制。</li>
        <li>本页不写入 Cookie 或浏览器持久化，不发送产品数据，也不接入账户、联系人、提醒或外部服务。</li>
        <li>当前原型只面向你控制的 loopback 或受控 LAN 页面；如果页面由受控静态托管提供，服务端可能看到最小访问元数据（例如请求时间、网络地址或用户代理）。这不表示会话数据会被上传。</li>
        <li>正式研究同意、脱敏观察和后续联系属于产品外流程；本原型不替代这些授权，也不默认录音、录像或截图。</li>
        <li>你可以在任一阶段退出，不需要解释原因。退出会清除原型内存中的当前会话。</li>
      </ul>
      <div className="action-row"><button className="button button-primary" type="button" onClick={controller.start}>我了解，开始输入</button><button className="button button-quiet" type="button" onClick={controller.exit}>退出当前会话</button></div>
    </section>
  );
}

function ExitScreen({ controller }: { readonly controller: WorkbenchController }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <main className="app-shell">
      <section className="exit-card" aria-labelledby="exit-title">
        <p className="section-kicker">会话已退出</p>
        <h1 id="exit-title" ref={headingRef} tabIndex={-1}>当前页面内存已清除</h1>
        <p>原型不会恢复这次会话，也不会声称可以删除你已经下载到设备上的文件。</p>
        <button className="button button-primary" type="button" onClick={controller.start}>开始新的空白会话</button>
      </section>
    </main>
  );
}

function Workbench({ controller, exportController }: { readonly controller: WorkbenchController; readonly exportController: ExportWorkbenchController }) {
  const state = controller;
  const stage = currentStage(state);
  const stageRegionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = stageRegionRef.current?.querySelector<HTMLElement>("[data-stage-heading]");
    heading?.focus();
  }, [state.session.phase]);
  return (
    <main className="app-shell" ref={stageRegionRef}>
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">值观</span><span className="brand-subtitle">购买决策工作台</span></div>
        <nav aria-label="会话阶段"><ol className="stage-progress">{STAGE_LABELS.map((label, index) => <li className={index + 1 === stage ? "is-current" : index + 1 < stage ? "is-complete" : ""} key={label}><span aria-current={index + 1 === stage ? "step" : undefined}>{index + 1}</span><b>{label}</b></li>)}</ol></nav>
        <button className="exit-button" type="button" onClick={controller.exit}>退出当前会话</button>
      </header>

      <section className="task-intro" aria-labelledby="page-title"><div><p className="section-kicker">当前任务</p><h1 id="page-title">把一次购买放回你的时间与口径</h1></div><p>先确认输入，再查看可以安全得出的关系。决定由你记录，复盘在产品外完成。</p></section>
      {state.notice && !isConfirmationStage(state) && !isDecisionStage(state) ? <p className="global-notice" role="status">{state.notice}</p> : null}
      {isInputStage(state) ? <InputForm controller={controller} /> : null}
      {isConfirmationStage(state) ? <ConfirmationSection controller={controller} /> : null}
      {isUnderstandingStage(state) ? <UnderstandingSection controller={controller} /> : null}
      {isDecisionStage(state) ? <DecisionSection controller={controller} exportController={exportController} /> : null}
      <footer className="session-footer"><span>当前会话只存在于此页面内存。</span><button className="button button-quiet" type="button" onClick={controller.exit}>退出并清除当前会话</button></footer>
    </main>
  );
}

export interface AppProps {
  readonly buildIdentityGate?: Readonly<BuildIdentityGate>;
  readonly exportOptions?: Omit<ExportWorkbenchOptions, "buildIdentityGate">;
}

export function App({ buildIdentityGate = getBuildIdentityGate(), exportOptions }: AppProps = {}) {
  const controller = useWorkbenchController();
  const exportController = useExportWorkbenchController(controller.session, { ...exportOptions, buildIdentityGate });
  const exited = controller.session.lifecycle === "exited";
  if (exited) return <ExitScreen controller={controller} />;
  if (!controller.privacyAcknowledged) return <main className="app-shell"><PrivacyNotice controller={controller} /></main>;
  return <Workbench controller={controller} exportController={exportController} />;
}

export { FIELD_LABELS, RESULT_LABELS, STAGE_LABELS };
