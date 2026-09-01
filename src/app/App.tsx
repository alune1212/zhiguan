import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  CURRENCY,
  PERIOD,
  calculateDecision,
  type CalculationOutput,
  type DecisionInput,
  type EvidenceStatus,
  type InputErrorCode,
  type NumericField,
  type TaxBasis,
} from "../domain/calculation";

const EMPTY_INPUT: DecisionInput = {
  income: "",
  workHours: "",
  fixedExpenses: "",
  purchaseAmount: "",
  taxBasis: "",
  fixedCostCoverage: "",
  purchaseIncluded: "",
  valueExpectation: "",
  evidence: {
    income: "user-confirmed",
    workHours: "user-confirmed",
    fixedExpenses: "user-confirmed",
    purchaseAmount: "user-confirmed",
  },
};

const FIELD_LABELS: Record<NumericField, string> = {
  income: "月收入",
  workHours: "每月工作时间",
  fixedExpenses: "每月固定支出",
  purchaseAmount: "这笔购买的价格",
};

const DEPENDENCY_LABELS: Record<string, string> = {
  ...FIELD_LABELS,
  taxBasis: "收入按税前还是税后填写",
  fixedCostCoverage: "固定支出是否填全",
  purchaseIncluded: "这笔购买是否算在本月",
};

const ERROR_LABELS: Record<InputErrorCode, string> = {
  "missing-input": "请填写这个数字。",
  "invalid-input": "请输入数字，不要加逗号或货币符号。",
  "number-too-large": "这个数字太大了。",
  "zero-not-allowed": "请输入大于 0 的数字。",
  "evidence-required": "请确认这些数字是否含估算。",
  "tax-basis-required": "请选择税前收入或税后收入。",
  "before-tax-margin-unavailable": "只有税后收入才能计算本月余量。",
  "fixed-cost-coverage-required": "请确认固定支出已经填全。",
  "purchase-period-required": "请确认这笔购买算在本月。",
};

const RESULT_REASON_LABELS: Record<InputErrorCode, string> = {
  ...ERROR_LABELS,
};

function updateNumeric(input: DecisionInput, field: NumericField, value: string): DecisionInput {
  return { ...input, [field]: value };
}

function updateAllEvidence(input: DecisionInput, value: EvidenceStatus): DecisionInput {
  return {
    ...input,
    evidence: {
      income: value,
      workHours: value,
      fixedExpenses: value,
      purchaseAmount: value,
    },
  };
}

type DecisionCode = "buy" | "wait" | "adjust-conditions" | "do-not-buy" | "undecided";
export interface DecisionForm {
  readonly code: DecisionCode | "";
  readonly rationale: string;
  readonly reviewCondition: string;
}

const DECISION_OPTIONS: readonly { readonly code: DecisionCode; readonly label: string }[] = [
  { code: "buy", label: "购买" },
  { code: "wait", label: "等待" },
  { code: "adjust-conditions", label: "调整条件" },
  { code: "do-not-buy", label: "不购买" },
  { code: "undecided", label: "暂不决定" },
];

export function createExportJson(input: DecisionInput, output: CalculationOutput, decision: DecisionForm): string {
  const payload = {
    format: "zhiguan-purchase-decision@1",
    exported_at: new Date().toISOString(),
    currency: CURRENCY,
    period: PERIOD,
    inputs: {
      income: input.income,
      work_hours: input.workHours,
      fixed_expenses: input.fixedExpenses,
      purchase_amount: input.purchaseAmount,
      tax_basis: input.taxBasis || null,
      fixed_cost_coverage: input.fixedCostCoverage || null,
      purchase_included: input.purchaseIncluded || null,
      value_expectation: input.valueExpectation,
      evidence: input.evidence,
    },
    results: output.results.map((item) => ({
      id: item.id,
      label: item.label,
      availability: item.availability,
      evidence_status: item.evidenceStatus,
      exact: item.exact,
      display: item.display,
      unit: item.unit,
      formula: item.formula,
      dependencies: item.dependencyFieldIds,
      reasons: item.reasonCodes,
      source: item.source,
    })),
    decision: {
      code: decision.code || null,
      rationale: decision.rationale || null,
      review_condition: decision.reviewCondition || null,
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function downloadJson(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportJson(input: DecisionInput, output: CalculationOutput, decision: DecisionForm): void {
  downloadJson(createExportJson(input, output, decision), "zhiguan-purchase-decision.json");
}

function FieldError({ code, id }: { readonly code?: InputErrorCode; readonly id: string }) {
  return code ? <span className="error" id={id} role="alert">{ERROR_LABELS[code]}</span> : null;
}

function NumericFieldControl({
  field,
  input,
  error,
  onChange,
}: {
  readonly field: NumericField;
  readonly input: DecisionInput;
  readonly error?: InputErrorCode;
  readonly onChange: (value: string) => void;
}) {
  const inputId = `input-${field}`;
  const errorId = `${inputId}-error`;
  const unit = field === "workHours" ? "小时" : "元";
  return (
    <div className="field">
      <label htmlFor={inputId}>{FIELD_LABELS[field]}（{unit}）</label>
      <input
        id={inputId}
        name={field}
        type="text"
        inputMode="decimal"
        value={input[field]}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <FieldError code={error} id={errorId} />
    </div>
  );
}

const STATUS_LABELS = {
  "user-confirmed": "已核对",
  estimated: "含估算",
  forecast: "假设结果",
  "insufficient-data": "还缺信息",
} as const;

const RESULT_EXPLANATIONS: Record<CalculationOutput["results"][number]["id"], string> = {
  "income-rate": "按本月收入和工作时间折算。",
  "work-time-equivalent": "也就是你大约要工作这么久，才能挣到这笔钱。",
  "available-margin": "税后收入扣掉你填写的固定支出。",
  "purchase-after-margin": "如果是负数，表示本月收入扣除这些支出后不够。",
  "purchase-impact": "这笔购买对本月余量的影响。",
};

function ResultCard({ result, taxBasis }: { readonly result: CalculationOutput["results"][number]; readonly taxBasis: TaxBasis | "" }) {
  const titleId = `${result.id}-title`;
  return (
    <article className={`result ${result.availability}`} aria-labelledby={titleId}>
      <div className="result-heading">
        <h3 id={titleId}>{result.label}</h3>
        <span className="status">{STATUS_LABELS[result.evidenceStatus]}</span>
      </div>
      <p className="result-value">{result.display ?? "暂时算不了"}</p>
      <p>{RESULT_EXPLANATIONS[result.id]}</p>
      {result.reasonCodes.length > 0 ? (
        <p className="reason">{result.reasonCodes.map((code) => RESULT_REASON_LABELS[code]).join(" ")}</p>
      ) : null}
      <details>
        <summary>怎么算</summary>
        <p>{result.formula}。用到：{result.dependencyFieldIds.map((field) => DEPENDENCY_LABELS[field] ?? field).join("、")}。</p>
        <p>按月计算，收入按{taxBasis === "after-tax" ? "税后" : taxBasis === "before-tax" ? "税前" : "尚未选择的"}金额填写。</p>
        <p>只根据你这次填写的数据计算，不是完整账本或购买建议；要调整结果，修改上面的数字后重新确认。</p>
      </details>
    </article>
  );
}

export function App() {
  const [input, setInput] = useState<DecisionInput>(EMPTY_INPUT);
  const [submittedInput, setSubmittedInput] = useState<DecisionInput | null>(null);
  const [decision, setDecision] = useState<DecisionForm>({ code: "", rationale: "", reviewCondition: "" });
  const calculated = submittedInput === input;
  const output = calculateDecision(input);
  const optionalStarted = Boolean(input.fixedExpenses.trim() || input.fixedCostCoverage || input.purchaseIncluded);
  const visibleResults = output.results.filter((result) => (
    result.id === "income-rate"
    || result.id === "work-time-equivalent"
    || (optionalStarted && result.id !== "purchase-impact")
  ));
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (calculated) resultHeadingRef.current?.focus();
  }, [calculated]);

  const clear = () => {
    setInput(EMPTY_INPUT);
    setSubmittedInput(null);
    setDecision({ code: "", rationale: "", reviewCondition: "" });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedInput(input);
  };

  const visibleErrors = calculated ? output.inputErrors : {};
  const hasEstimatedValues = Object.values(input.evidence).some((status) => status === "estimated");

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#page-title">值观</a>
        <button className="quiet-button" type="button" onClick={clear}>重新填写</button>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">购买前算一算</p>
        <h1 id="page-title">这笔购买，要花你多少工作时间？</h1>
        <p>填 3 个数字，先看它相当于多少工作时间。想看本月买完还剩多少，再补固定支出。</p>
      </section>

      <form className="card form" onSubmit={submit} noValidate autoComplete="off">
        <div className="section-heading">
          <h2>先填这三个数字</h2>
          <p>人民币，按月计算</p>
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="tax-basis">月收入按哪种金额填？</label>
            <select
              id="tax-basis"
              name="tax-basis"
              value={input.taxBasis}
              aria-invalid={visibleErrors.taxBasis ? "true" : undefined}
              aria-describedby={visibleErrors.taxBasis ? "tax-basis-error" : undefined}
              onChange={({ currentTarget: { value } }) => setInput((current) => ({ ...current, taxBasis: value as TaxBasis | "" }))}
            >
              <option value="">请选择</option>
              <option value="after-tax">税后（到手）</option>
              <option value="before-tax">税前</option>
            </select>
            <FieldError code={visibleErrors.taxBasis} id="tax-basis-error" />
          </div>
          <NumericFieldControl field="income" input={input} error={visibleErrors.income} onChange={(value) => setInput((current) => updateNumeric(current, "income", value))} />
          <NumericFieldControl field="workHours" input={input} error={visibleErrors.workHours} onChange={(value) => setInput((current) => updateNumeric(current, "workHours", value))} />
          <NumericFieldControl field="purchaseAmount" input={input} error={visibleErrors.purchaseAmount} onChange={(value) => setInput((current) => updateNumeric(current, "purchaseAmount", value))} />
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={hasEstimatedValues}
            onChange={({ currentTarget: { checked } }) => setInput((current) => updateAllEvidence(current, checked ? "estimated" : "user-confirmed"))}
          />
          这些数字里有大概数
        </label>

        <details className="optional-inputs" open={optionalStarted || undefined}>
          <summary>再算算本月买完还剩多少（可选）</summary>
          <div className="optional-content">
            <NumericFieldControl field="fixedExpenses" input={input} error={visibleErrors.fixedExpenses} onChange={(value) => setInput((current) => updateNumeric(current, "fixedExpenses", value))} />
            <label className="check-row">
              <input
                type="checkbox"
                checked={input.fixedCostCoverage === "complete"}
                aria-invalid={visibleErrors.fixedCostCoverage ? "true" : undefined}
                aria-describedby={visibleErrors.fixedCostCoverage ? "fixed-cost-coverage-error" : undefined}
                onChange={({ currentTarget: { checked } }) => setInput((current) => ({ ...current, fixedCostCoverage: checked ? "complete" : "" }))}
              />
              上面的固定支出已经包含本月全部固定开销
            </label>
            <FieldError code={visibleErrors.fixedCostCoverage} id="fixed-cost-coverage-error" />
            <label className="check-row">
              <input
                type="checkbox"
                checked={input.purchaseIncluded === "included"}
                aria-invalid={visibleErrors.purchaseIncluded ? "true" : undefined}
                aria-describedby={visibleErrors.purchaseIncluded ? "purchase-included-error" : undefined}
                onChange={({ currentTarget: { checked } }) => setInput((current) => ({ ...current, purchaseIncluded: checked ? "included" : "" }))}
              />
              这笔购买算在本月
            </label>
            <FieldError code={visibleErrors.purchaseIncluded} id="purchase-included-error" />
            <div className="field field-wide">
              <label htmlFor="value-expectation">你希望它带来什么？（可选）</label>
              <textarea id="value-expectation" rows={2} value={input.valueExpectation} onChange={({ currentTarget: { value } }) => setInput((current) => ({ ...current, valueExpectation: value }))} />
            </div>
          </div>
        </details>

        <button className="primary-button" type="submit">确认并查看结果</button>
      </form>

      {calculated ? (
        <section className="results-section" aria-labelledby="results-title">
          <div className="section-heading">
            <h2 id="results-title" ref={resultHeadingRef} tabIndex={-1}>结果</h2>
            <details className="status-help">
              <summary>数字和状态说明</summary>
              <p>“已核对”表示你提交时确认了数字；“含估算”表示其中有大概数；“假设结果”表示它描述买下后的情况；“还缺信息”会告诉你缺什么。</p>
            </details>
          </div>
          <div className="result-grid">
            {visibleResults.map((result) => <ResultCard key={result.id} result={result} taxBasis={input.taxBasis} />)}
          </div>
        </section>
      ) : null}

      {calculated ? (
        <section className="card decision-card" aria-labelledby="decision-title">
          <h2 id="decision-title">你的决定</h2>
          <fieldset className="decision-options">
            <legend>现在怎么选？</legend>
            {DECISION_OPTIONS.map((option) => (
              <label key={option.code}>
                <input type="radio" name="decision" value={option.code} checked={decision.code === option.code} onChange={() => setDecision((current) => ({ ...current, code: option.code }))} />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="field field-wide">
            <label htmlFor="decision-rationale">为什么这样选？（可选）</label>
            <textarea id="decision-rationale" rows={2} value={decision.rationale} onChange={({ currentTarget: { value } }) => setDecision((current) => ({ ...current, rationale: value }))} />
          </div>
          <button className="secondary-button" type="button" onClick={() => exportJson(input, output, decision)}>下载本次数据</button>
        </section>
      ) : null}

      <footer className="footer">刷新或关闭页面后，本次填写会清空；不会上传，也不会保存在浏览器里。</footer>
    </main>
  );
}
