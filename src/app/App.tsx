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
  type ResultId,
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
  income: "每月收入",
  workHours: "每月工作时间",
  fixedExpenses: "每月固定支出",
  purchaseAmount: "这笔购买要花多少",
};

type InputErrorField = NumericField | "taxBasis" | "fixedCostCoverage" | "purchaseIncluded";

const PROBLEM_FIELD_LABELS: Record<InputErrorField, string> = {
  ...FIELD_LABELS,
  purchaseAmount: "购买价格",
  taxBasis: "税前或到手的选择",
  fixedCostCoverage: "固定支出是否已经填全",
  purchaseIncluded: "是否按本月付款来算",
};

export function inputErrorText(field: InputErrorField, code: InputErrorCode): string {
  switch (code) {
    case "missing-input":
      if (field === "fixedExpenses") return "填一下每月固定支出；没有可以填 0。";
      if (field === "purchaseAmount") return "填一下购买价格。";
      return `填一下${PROBLEM_FIELD_LABELS[field]}。`;
    case "invalid-input":
      return field === "workHours" ? "只填数字，例如 160 或 160.5。" : "只填数字，不要加逗号或“元”。";
    case "number-too-large":
      return field === "workHours"
        ? "这个时间超出可填写范围，请检查；小数最多三位。"
        : "这个金额超出可填写范围，请检查；小数最多两位。";
    case "zero-not-allowed":
      if (field === "income") return "每月收入需要大于 0。";
      if (field === "workHours") return "每月工作时间需要大于 0。";
      return "购买价格需要大于 0。";
    case "evidence-required":
      return "请确认这些数字里有没有大概数。";
    case "tax-basis-required":
      return "选一下月收入是税前还是税后。";
    case "before-tax-margin-unavailable":
      return "你填的是税前收入，所以现在算不了本月剩余金额。请重新填入税后（到手）收入，并选择“税后（到手）”，再查看结果。";
    case "fixed-cost-coverage-required":
      return "请确认你填的是本月全部固定支出。";
    case "purchase-period-required":
      return "请确认是否按本月付款来算。";
  }
}

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

export const DECISION_OPTIONS: readonly { readonly code: DecisionCode; readonly label: string }[] = [
  { code: "buy", label: "现在买" },
  { code: "wait", label: "再等等" },
  { code: "adjust-conditions", label: "换个条件再看" },
  { code: "do-not-buy", label: "这次不买" },
  { code: "undecided", label: "还没想好" },
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

function FieldError({ field, code, id }: { readonly field: InputErrorField; readonly code?: InputErrorCode; readonly id: string }) {
  return code ? <span className="error" id={id} role="alert">{inputErrorText(field, code)}</span> : null;
}

function NumericFieldControl({
  field,
  input,
  error,
  hint,
  onChange,
}: {
  readonly field: NumericField;
  readonly input: DecisionInput;
  readonly error?: InputErrorCode;
  readonly hint?: string;
  readonly onChange: (value: string) => void;
}) {
  const inputId = `input-${field}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
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
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {hint ? <span className="field-hint" id={hintId}>{hint}</span> : null}
      <FieldError field={field} code={error} id={errorId} />
    </div>
  );
}

type CalculationResult = CalculationOutput["results"][number];
type InputErrors = CalculationOutput["inputErrors"];

const VISIBLE_RESULT_ORDER: readonly ResultId[] = [
  "work-time-equivalent",
  "income-rate",
  "available-margin",
  "purchase-after-margin",
];

const RESULT_TITLES: Record<ResultId, string> = {
  "work-time-equivalent": "工作时间",
  "income-rate": "每小时收入",
  "available-margin": "扣掉固定支出后",
  "purchase-after-margin": "买完以后",
  "purchase-impact": "这笔购买减少的余量",
};

const RESULT_OUTCOMES: Record<ResultId, string> = {
  "work-time-equivalent": "买它要花多少工作时间",
  "income-rate": "每小时收入",
  "available-margin": "本月剩余金额",
  "purchase-after-margin": "买完后还剩多少",
  "purchase-impact": "这笔购买减少的余量",
};

function isInputErrorField(field: string): field is InputErrorField {
  return field === "income"
    || field === "workHours"
    || field === "fixedExpenses"
    || field === "purchaseAmount"
    || field === "taxBasis"
    || field === "fixedCostCoverage"
    || field === "purchaseIncluded";
}

function joinChinese(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "相关内容";
  if (items.length === 2) return items.join("和");
  return `${items.slice(0, -1).join("、")}和${items.at(-1)}`;
}

function isZeroDecimal(value: string): boolean {
  return /^-?0(?:\.0+)?$/u.test(value);
}

function unavailableResultText(result: CalculationResult, inputErrors: InputErrors): string {
  if (result.reasonCodes.includes("before-tax-margin-unavailable")) {
    return inputErrorText("taxBasis", "before-tax-margin-unavailable");
  }

  const problemFields = result.dependencyFieldIds
    .filter(isInputErrorField)
    .filter((field) => inputErrors[field]);
  const missingFields = problemFields.filter((field) => {
    const code = inputErrors[field];
    return code === "missing-input" || code === "tax-basis-required";
  });
  const invalidFields = problemFields.filter((field) => {
    const code = inputErrors[field];
    return code === "invalid-input" || code === "number-too-large" || code === "zero-not-allowed";
  });
  const outcome = RESULT_OUTCOMES[result.id];

  if (missingFields.length > 0 && invalidFields.length === 0) {
    if (missingFields.length === 1 && missingFields[0] === "fixedExpenses") {
      return "还缺每月固定支出，所以现在算不了本月剩余金额。没有固定支出可以填 0。";
    }
    return `还缺${joinChinese(missingFields.map((field) => PROBLEM_FIELD_LABELS[field]))}，所以现在算不了${outcome}。`;
  }
  if (invalidFields.length > 0 && missingFields.length === 0) {
    return `先改正${joinChinese(invalidFields.map((field) => PROBLEM_FIELD_LABELS[field]))}，才能计算${outcome}。`;
  }
  if (missingFields.length > 0 || invalidFields.length > 0) {
    return `上面标出的内容还没填好，所以现在算不了${outcome}。`;
  }

  const needsCoverage = result.reasonCodes.includes("fixed-cost-coverage-required");
  const needsPurchasePeriod = result.reasonCodes.includes("purchase-period-required");
  if (needsCoverage && needsPurchasePeriod) {
    return "还需要确认固定支出已经填全，并确认是否按本月付款来算，才能计算买完后还剩多少。";
  }
  if (needsCoverage) return "还需要确认固定支出已经填全，才能计算本月剩余金额。";
  if (needsPurchasePeriod) return "还需要确认这笔购买算进本月，才能计算买完后还剩多少。";
  return `上面的信息还没填好，所以现在算不了${outcome}。`;
}

export function resultText(result: CalculationResult, inputErrors: InputErrors): string {
  if (result.availability === "insufficient-data" || !result.exact) {
    return unavailableResultText(result, inputErrors);
  }

  const value = result.exact.decimal;
  switch (result.id) {
    case "work-time-equivalent":
      return `按这些数字，这笔钱相当于你工作 ${value} 小时的收入。`;
    case "income-rate":
      return `按你填的月收入和工作时间，每小时收入约为 ${value} 元。`;
    case "available-margin":
      if (isZeroDecimal(value)) return "扣掉固定支出后，本月刚好没有余量。";
      return value.startsWith("-")
        ? `扣掉固定支出后，本月还差 ${value.slice(1)} 元。`
        : `扣掉固定支出后，本月还剩 ${value} 元。`;
    case "purchase-after-margin":
      if (isZeroDecimal(value)) return "如果把这笔购买算进本月，买完后本月刚好没有余量。";
      return value.startsWith("-")
        ? `如果把这笔购买算进本月，买完后还差 ${value.slice(1)} 元。`
        : `如果把这笔购买算进本月，买完后还剩 ${value} 元。`;
    case "purchase-impact":
      return `这笔购买会让本月余量减少 ${value.startsWith("-") ? value.slice(1) : value} 元。`;
  }
}

export function visibleResultsFor(output: CalculationOutput, optionalStarted: boolean): readonly CalculationResult[] {
  return VISIBLE_RESULT_ORDER.flatMap((id) => {
    const result = output.results.find((candidate) => candidate.id === id);
    const coreResult = id === "work-time-equivalent" || id === "income-rate";
    return result && (coreResult || optionalStarted) ? [result] : [];
  });
}

function resultDetails(result: CalculationResult, taxBasis: TaxBasis | ""): string {
  const incomeBasis = taxBasis === "after-tax"
    ? "月收入按你选择的税后（到手）金额计算。"
    : taxBasis === "before-tax"
      ? "月收入按你选择的税前金额计算。"
      : "还需要选择这个收入是税前还是到手。";
  switch (result.id) {
    case "work-time-equivalent":
      return `先用月收入除以每月工作时间，算出每小时收入；再用购买价格除以每小时收入。${incomeBasis}`;
    case "income-rate":
      return `月收入除以每月工作时间。${incomeBasis}`;
    case "available-margin":
      return "税后月收入减去每月固定支出。";
    case "purchase-after-margin":
      return "税后月收入减去每月固定支出，再减去这笔购买的价格。";
    case "purchase-impact":
      return "买完后本月还剩减去本月可用金额。";
  }
}

function ResultCard({
  result,
  taxBasis,
  inputErrors,
}: {
  readonly result: CalculationResult;
  readonly taxBasis: TaxBasis | "";
  readonly inputErrors: InputErrors;
}) {
  const titleId = `${result.id}-title`;
  const primary = result.id === "work-time-equivalent";
  return (
    <article className={`result ${primary ? "result-primary " : ""}${result.availability}`} aria-labelledby={titleId}>
      <h3 id={titleId}>{RESULT_TITLES[result.id]}</h3>
      <p className="result-value">{resultText(result, inputErrors)}</p>
      <details>
        <summary>怎么算出来的</summary>
        <p>{resultDetails(result, taxBasis)}</p>
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
  const visibleResults = visibleResultsFor(output, optionalStarted);
  const hasAvailableResult = visibleResults.some((result) => result.availability === "available");
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
        <button className="quiet-button" type="button" onClick={clear}>清空重填</button>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">这次购买要花多少工作时间？</h1>
        <p>先填月收入、每月工作时间和购买价格，看看它相当于多少工作时间。想算买完后这个月还剩多少，再补每月固定支出。</p>
      </section>

      <form className="card form" onSubmit={submit} noValidate autoComplete="off">
        <div className="section-heading">
          <h2>先填三个数字</h2>
          <p>金额都填人民币。收入、工作时间和固定支出都填一个月的数；购买价格填这一次要付的金额。</p>
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="tax-basis">这个收入是税前还是到手？</label>
            <select
              id="tax-basis"
              name="tax-basis"
              value={input.taxBasis}
              aria-invalid={visibleErrors.taxBasis ? "true" : undefined}
              aria-describedby={visibleErrors.taxBasis ? "tax-basis-error" : undefined}
              onChange={({ currentTarget: { value } }) => setInput((current) => ({ ...current, taxBasis: value as TaxBasis | "" }))}
            >
              <option value="">选一种</option>
              <option value="after-tax">税后（到手）</option>
              <option value="before-tax">税前（还没扣税）</option>
            </select>
            <FieldError field="taxBasis" code={visibleErrors.taxBasis} id="tax-basis-error" />
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
          <summary>还想看买完后，这个月剩多少？（可选）</summary>
          <div className="optional-content">
            <NumericFieldControl field="fixedExpenses" input={input} error={visibleErrors.fixedExpenses} hint="没有固定支出可以填 0。" onChange={(value) => setInput((current) => updateNumeric(current, "fixedExpenses", value))} />
            <label className="check-row">
              <input
                type="checkbox"
                checked={input.fixedCostCoverage === "complete"}
                aria-invalid={visibleErrors.fixedCostCoverage ? "true" : undefined}
                aria-describedby={visibleErrors.fixedCostCoverage ? "fixed-cost-coverage-error" : undefined}
                onChange={({ currentTarget: { checked } }) => setInput((current) => ({ ...current, fixedCostCoverage: checked ? "complete" : "" }))}
              />
              我已经把本月所有固定支出都算进去了
            </label>
            <FieldError field="fixedCostCoverage" code={visibleErrors.fixedCostCoverage} id="fixed-cost-coverage-error" />
            <label className="check-row">
              <input
                type="checkbox"
                checked={input.purchaseIncluded === "included"}
                aria-invalid={visibleErrors.purchaseIncluded ? "true" : undefined}
                aria-describedby={visibleErrors.purchaseIncluded ? "purchase-included-error" : undefined}
                onChange={({ currentTarget: { checked } }) => setInput((current) => ({ ...current, purchaseIncluded: checked ? "included" : "" }))}
              />
              按本月付款来算
            </label>
            <FieldError field="purchaseIncluded" code={visibleErrors.purchaseIncluded} id="purchase-included-error" />
            <div className="field field-wide">
              <label htmlFor="value-expectation">你希望它带来什么？（可选）</label>
              <textarea id="value-expectation" rows={2} value={input.valueExpectation} aria-describedby="value-expectation-hint" onChange={({ currentTarget: { value } }) => setInput((current) => ({ ...current, valueExpectation: value }))} />
              <span className="field-hint" id="value-expectation-hint">不参与计算，只帮你记住当时的期待。</span>
            </div>
          </div>
        </details>

        <button className="primary-button" type="submit">确认并查看结果</button>
      </form>

      {calculated ? (
        <section className="results-section" aria-labelledby="results-title">
          <h2 id="results-title" ref={resultHeadingRef} tabIndex={-1}>结果</h2>
          <div className="result-grid">
            {visibleResults.map((result) => (
              <ResultCard key={result.id} result={result} taxBasis={input.taxBasis} inputErrors={output.inputErrors} />
            ))}
          </div>
          <div className="result-notes">
            {hasAvailableResult ? (
              <p>{hasEstimatedValues ? "你填了大概数，所以这些结果也都是大概值。" : "按你刚刚确认的数字计算。"}</p>
            ) : null}
            <p>这里只根据你这次填写的数字计算，不是完整账本，也不会替你决定要不要买。</p>
          </div>
        </section>
      ) : null}

      {calculated ? (
        <section className="card decision-card" aria-labelledby="decision-title">
          <h2 id="decision-title">你准备怎么做？</h2>
          <fieldset className="decision-options" aria-labelledby="decision-title">
            {DECISION_OPTIONS.map((option) => (
              <label key={option.code}>
                <input type="radio" name="decision" value={option.code} checked={decision.code === option.code} onChange={() => setDecision((current) => ({ ...current, code: option.code }))} />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="field field-wide">
            <label htmlFor="decision-rationale">想记下原因吗？（可选）</label>
            <textarea id="decision-rationale" rows={2} value={decision.rationale} aria-describedby="decision-rationale-hint" onChange={({ currentTarget: { value } }) => setDecision((current) => ({ ...current, rationale: value }))} />
            <span className="field-hint" id="decision-rationale-hint">这段话不参与计算。</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => exportJson(input, output, decision)}>下载这次记录</button>
        </section>
      ) : null}

      <footer className="footer">你填写的内容只在当前页面使用。刷新或关闭后会清空，不会上传，也不会保存在浏览器里。</footer>
    </main>
  );
}
