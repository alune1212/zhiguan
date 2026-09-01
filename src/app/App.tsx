import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  CURRENCY,
  NUMERIC_FIELDS,
  PERIOD,
  calculateDecision,
  calculateGoalProgress,
  type CalculationOutput,
  type DecisionInput,
  type EvidenceStatus,
  type GoalInput,
  type GoalProgressOutput,
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
    income: "",
    workHours: "",
    fixedExpenses: "",
    purchaseAmount: "",
  },
};

const EMPTY_GOAL_INPUT: GoalInput = {
  name: "",
  target: "",
  current: "",
  unit: "",
  evidence: { target: "", current: "" },
};

const GOAL_VALUE_FIELDS = ["target", "current"] as const;
type GoalValueField = (typeof GOAL_VALUE_FIELDS)[number];

const GOAL_VALUE_LABELS: Record<GoalValueField, string> = {
  target: "目标值",
  current: "当前值",
};

const FIELD_LABELS: Record<NumericField, string> = {
  income: "月收入",
  workHours: "月工作小时",
  fixedExpenses: "月固定支出",
  purchaseAmount: "购买金额",
};

const DEPENDENCY_LABELS: Record<string, string> = {
  ...FIELD_LABELS,
  taxBasis: "收入口径",
  fixedCostCoverage: "固定支出覆盖范围",
  purchaseIncluded: "购买是否计入当前月份",
};

const ERROR_LABELS: Record<InputErrorCode, string> = {
  "missing-input": "请填写这一项。",
  "invalid-input": "请输入非负数字，不要使用逗号或货币符号。",
  "number-too-large": "数字超出当前原型支持的范围。",
  "zero-not-allowed": "这一项必须大于零。",
  "evidence-required": "请选择输入是用户确认还是近似输入。",
  "tax-basis-required": "请选择税前或税后口径。",
  "before-tax-margin-unavailable": "税前收入不足以直接计算可用余量；请改用税后口径。",
  "fixed-cost-coverage-required": "固定支出需要完整覆盖后才能计算余量。",
  "purchase-period-required": "购买只有计入当前月份后才计算购买后余量。",
  "goal-name-required": "请填写目标名称。",
  "goal-unit-required": "请填写目标单位。",
};

const RESULT_REASON_LABELS: Record<InputErrorCode, string> = {
  ...ERROR_LABELS,
};

function updateNumeric(input: DecisionInput, field: NumericField, value: string): DecisionInput {
  return { ...input, [field]: value };
}

function updateEvidence(input: DecisionInput, field: NumericField, value: EvidenceStatus | ""): DecisionInput {
  return { ...input, evidence: { ...input.evidence, [field]: value } };
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

export function createGoalExportJson(input: GoalInput, output: GoalProgressOutput): string {
  const result = output.result;
  const payload = {
    format: "zhiguan-goal-progress@1",
    exported_at: new Date().toISOString(),
    scope: "current-session",
    goal: {
      name: input.name,
      target: input.target,
      current: input.current,
      unit: input.unit,
      evidence: input.evidence,
    },
    result: {
      id: result.id,
      availability: result.availability,
      evidence_status: result.evidenceStatus,
      completed_ratio: result.completedRatio,
      completed_display: result.completedDisplay,
      remaining_gap: result.remainingGap,
      remaining_display: result.remainingDisplay,
      formula: result.formula,
      dependencies: result.dependencyFieldIds,
      reasons: result.reasonCodes,
      source: result.source,
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

function exportGoalJson(input: GoalInput, output: GoalProgressOutput): void {
  downloadJson(createGoalExportJson(input, output), "zhiguan-goal-progress.json");
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
  return (
    <div className="field">
      <label htmlFor={inputId}>{FIELD_LABELS[field]}</label>
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
      <span className="hint">单位：{field === "workHours" ? "小时" : "CNY"}；当前比较周期：月。</span>
      <FieldError code={error} id={errorId} />
    </div>
  );
}

function EvidenceControl({
  id,
  label,
  value,
  error,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: EvidenceStatus | "";
  readonly error?: InputErrorCode;
  readonly onChange: (value: EvidenceStatus | "") => void;
}) {
  const inputId = `evidence-${id}`;
  const errorId = `${inputId}-error`;
  return (
    <div className="field evidence-field">
      <label htmlFor={inputId}>{label}的状态</label>
      <select
        id={inputId}
        name={inputId}
        value={value}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.currentTarget.value as EvidenceStatus | "")}
      >
        <option value="">选择状态</option>
        <option value="user-confirmed">用户确认</option>
        <option value="estimated">近似输入</option>
      </select>
      <FieldError code={error} id={errorId} />
    </div>
  );
}

function GoalValueControl({
  field,
  input,
  error,
  onValueChange,
  onEvidenceChange,
}: {
  readonly field: GoalValueField;
  readonly input: GoalInput;
  readonly error?: InputErrorCode;
  readonly onValueChange: (value: string) => void;
  readonly onEvidenceChange: (value: EvidenceStatus | "") => void;
}) {
  const inputId = `goal-${field}`;
  const errorId = `${inputId}-error`;
  const evidenceError = input.evidence[field] === "" && error === "evidence-required" ? error : undefined;
  return (
    <div className="input-pair">
      <div className="field">
        <label htmlFor={inputId}>{GOAL_VALUE_LABELS[field]}</label>
        <input
          id={inputId}
          name={inputId}
          type="text"
          inputMode="decimal"
          value={input[field]}
          aria-invalid={error && !evidenceError ? "true" : undefined}
          aria-describedby={error && !evidenceError ? errorId : undefined}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
        <span className="hint">最多两位小数；当前值可以为 0 或超过目标值。</span>
        <FieldError code={evidenceError ? undefined : error} id={errorId} />
      </div>
      <EvidenceControl
        id={`goal-${field}`}
        label={GOAL_VALUE_LABELS[field]}
        value={input.evidence[field]}
        error={evidenceError}
        onChange={onEvidenceChange}
      />
    </div>
  );
}

function evidenceLabel(value: EvidenceStatus | ""): string {
  return value === "user-confirmed" ? "用户确认" : value === "estimated" ? "近似输入" : "未确认";
}

function GoalProgressCard({ input, output }: { readonly input: GoalInput; readonly output: GoalProgressOutput }) {
  const { result } = output;
  return (
    <article className={`result ${result.availability}`} aria-labelledby="goal-progress-title">
      <div className="result-heading">
        <h3 id="goal-progress-title">{input.name.trim() || "Goal Progress"}</h3>
        <span className="status">{result.availability === "available" ? result.evidenceStatus : "数据不足"}</span>
      </div>
      <div className="goal-metrics">
        <div><span className="label">已完成比例</span><p className="result-value">{result.completedDisplay ?? "数据不足"}</p></div>
        <div><span className="label">剩余差距</span><p className="result-value">{result.remainingDisplay ?? "数据不足"}</p></div>
      </div>
      <p className="formula">{result.formula}</p>
      {result.reasonCodes.length > 0 ? (
        <p className="reason">{result.reasonCodes.map((code) => RESULT_REASON_LABELS[code]).join(" ")}</p>
      ) : null}
      <details>
        <summary>查看依据</summary>
        <p>来源：规则计算。单位：{input.unit.trim() || "未确认"}。状态：{result.evidenceStatus}。</p>
        <p>证据：目标值为{evidenceLabel(input.evidence.target)}；当前值为{evidenceLabel(input.evidence.current)}。</p>
        <p>假设：目标值和当前值使用相同单位与口径。</p>
        <p>限制：这里只显示当前快照，不记录历史、不预测完成时间，也不评价目标。</p>
        <p>修正：返回 Goal 输入区修改数值、单位或证据状态，然后重新计算。</p>
        <p>精确值：完成比例 {result.completedRatio ? `${result.completedRatio.numerator}/${result.completedRatio.denominator}` : "数据不足"}；剩余差距 {result.remainingGap ? `${result.remainingGap.numerator}/${result.remainingGap.denominator}` : "数据不足"}。</p>
      </details>
    </article>
  );
}

function ResultCard({ result, taxBasis }: { readonly result: CalculationOutput["results"][number]; readonly taxBasis: TaxBasis | "" }) {
  const titleId = `${result.id}-title`;
  return (
    <article className={`result ${result.availability}`} aria-labelledby={titleId}>
      <div className="result-heading">
        <h3 id={titleId}>{result.label}</h3>
        <span className="status">{result.availability === "available" ? result.evidenceStatus : "数据不足"}</span>
      </div>
      <p className="result-value">{result.display ?? "数据不足"}</p>
      <p className="formula">{result.formula} · 单位：{result.unit}</p>
      {result.reasonCodes.length > 0 ? (
        <p className="reason">{result.reasonCodes.map((code) => RESULT_REASON_LABELS[code]).join(" ")}</p>
      ) : null}
      <details>
        <summary>查看依据</summary>
        <p>来源：规则计算。输入：{result.dependencyFieldIds.map((field) => DEPENDENCY_LABELS[field] ?? field).join("、")}。</p>
        <p>口径：CNY · 月 · {taxBasis === "after-tax" ? "税后" : taxBasis === "before-tax" ? "税前" : "收入口径未确认"}。状态：{result.availability === "available" ? result.evidenceStatus : "insufficient-data"}。</p>
        <p>假设：输入属于同一月份；余量要求固定支出完整覆盖，购买情景还要求购买计入当月。</p>
        <p>限制：这里只描述当前输入关系，不是完整账本、真实时薪或购买建议。</p>
        <p>修正：返回输入区修改数值、证据状态或覆盖范围，然后重新计算。</p>
        <p>精确值：{result.exact ? `${result.exact.numerator}/${result.exact.denominator} = ${result.exact.decimal}` : "数据不足"}</p>
      </details>
    </article>
  );
}

export function App() {
  const [input, setInput] = useState<DecisionInput>(EMPTY_INPUT);
  const [submittedInput, setSubmittedInput] = useState<DecisionInput | null>(null);
  const [decision, setDecision] = useState<DecisionForm>({ code: "", rationale: "", reviewCondition: "" });
  const [goalInput, setGoalInput] = useState<GoalInput>(EMPTY_GOAL_INPUT);
  const [submittedGoalInput, setSubmittedGoalInput] = useState<GoalInput | null>(null);
  const calculated = submittedInput === input;
  const goalCalculated = submittedGoalInput === goalInput;
  const output = calculateDecision(input);
  const goalOutput = calculateGoalProgress(goalInput);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const goalResultHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (calculated) resultHeadingRef.current?.focus();
  }, [calculated]);

  useEffect(() => {
    if (goalCalculated) goalResultHeadingRef.current?.focus();
  }, [goalCalculated]);

  const clear = () => {
    setInput(EMPTY_INPUT);
    setSubmittedInput(null);
    setDecision({ code: "", rationale: "", reviewCondition: "" });
    setGoalInput(EMPTY_GOAL_INPUT);
    setSubmittedGoalInput(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedInput(input);
  };

  const submitGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedGoalInput(goalInput);
  };

  const visibleErrors = calculated ? output.inputErrors : {};
  const visibleGoalErrors = goalCalculated ? goalOutput.inputErrors : {};

  return (
    <main className="app-shell">
      <header className="topbar">
        <p className="eyebrow">值观 · 购买决策与目标</p>
        <button className="quiet-button" type="button" onClick={clear}>清空当前会话</button>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">把一次购买放回你的月度口径</h1>
        <p>只在当前页面内存中计算。结果描述输入之间的关系，不替你做决定；缺失或不合适的输入会显示为数据不足。</p>
      </section>

      <form className="card form" onSubmit={submit} noValidate autoComplete="off">
        <div className="section-heading">
          <div><p className="eyebrow">输入</p><h2>确认最少信息</h2></div>
          <p className="hint">固定使用 CNY 与月周期，不联网、不保存。</p>
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="tax-basis">收入口径</label>
            <select
              id="tax-basis"
              name="tax-basis"
              value={input.taxBasis}
              aria-invalid={visibleErrors.taxBasis ? "true" : undefined}
              aria-describedby={visibleErrors.taxBasis ? "tax-basis-error" : undefined}
              onChange={({ currentTarget: { value } }) => setInput((current) => ({ ...current, taxBasis: value as TaxBasis | "" }))}
            >
              <option value="">选择口径</option>
              <option value="after-tax">税后（可支配）</option>
              <option value="before-tax">税前</option>
            </select>
            <FieldError code={visibleErrors.taxBasis} id="tax-basis-error" />
          </div>
          <div className="field field-static"><span className="label">币种与周期</span><output>CNY · 月</output></div>
          {NUMERIC_FIELDS.map((field) => (
            <div className="input-pair" key={field}>
              <NumericFieldControl field={field} input={input} error={visibleErrors[field] === "evidence-required" ? undefined : visibleErrors[field]} onChange={(value) => setInput((current) => updateNumeric(current, field, value))} />
              <EvidenceControl id={field} label={FIELD_LABELS[field]} value={input.evidence[field]} error={input.evidence[field] === "" && visibleErrors[field] === "evidence-required" ? "evidence-required" : undefined} onChange={(value) => setInput((current) => updateEvidence(current, field, value))} />
            </div>
          ))}
          <div className="field">
            <label htmlFor="fixed-cost-coverage">固定支出覆盖范围</label>
            <select id="fixed-cost-coverage" value={input.fixedCostCoverage} onChange={({ currentTarget: { value } }) => setInput((current) => ({ ...current, fixedCostCoverage: value as DecisionInput["fixedCostCoverage"] }))} aria-invalid={visibleErrors.fixedCostCoverage ? "true" : undefined} aria-describedby={visibleErrors.fixedCostCoverage ? "fixed-cost-coverage-error" : undefined}>
              <option value="">选择范围</option>
              <option value="complete">完整覆盖</option>
              <option value="partial">部分覆盖</option>
              <option value="unknown">不确定</option>
            </select>
            <span className="hint">可用余量只使用你确认过的完整固定支出范围。</span>
            <FieldError code={visibleErrors.fixedCostCoverage} id="fixed-cost-coverage-error" />
          </div>
          <fieldset className="field choice-field" aria-invalid={visibleErrors.purchaseIncluded ? "true" : undefined} aria-describedby={visibleErrors.purchaseIncluded ? "purchase-included-error" : undefined}>
            <legend>购买是否计入当前月份</legend>
            <label><input type="radio" name="purchase-included" value="included" checked={input.purchaseIncluded === "included"} onChange={() => setInput((current) => ({ ...current, purchaseIncluded: "included" }))} />计入</label>
            <label><input type="radio" name="purchase-included" value="excluded" checked={input.purchaseIncluded === "excluded"} onChange={() => setInput((current) => ({ ...current, purchaseIncluded: "excluded" }))} />不计入</label>
            <FieldError code={visibleErrors.purchaseIncluded} id="purchase-included-error" />
          </fieldset>
          <div className="field field-wide">
            <label htmlFor="value-expectation">个人价值期待</label>
            <textarea id="value-expectation" rows={3} value={input.valueExpectation} onChange={({ currentTarget: { value } }) => setInput((current) => ({ ...current, valueExpectation: value }))} />
            <span className="hint">只记录你希望这项购买带来的结果，不会转换成分数。</span>
          </div>
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit">计算当前关系</button>
          <span className="hint">收入、工时、固定支出和购买金额均使用有限范围的正数；固定支出可为 0。</span>
        </div>
      </form>

      <section className="results-section" aria-labelledby="results-title" aria-live="polite">
        <div className="section-heading">
          <div><p className="eyebrow">理解</p><h2 id="results-title" ref={resultHeadingRef} tabIndex={-1}>计算结果</h2></div>
          <p className="hint">每个结果都显示来源、公式、单位和数据状态。</p>
        </div>
        {calculated ? (
          <div className="result-grid">{output.results.map((result) => <ResultCard key={result.id} result={result} taxBasis={input.taxBasis} />)}</div>
        ) : (
          <p className="notice">填写输入后点击“计算当前关系”。修改输入后需要重新计算。</p>
        )}
      </section>

      <section className="card decision-card" aria-labelledby="decision-title">
        <div className="section-heading"><div><p className="eyebrow">决定 · 复盘</p><h2 id="decision-title">记录你的决定</h2></div><p className="hint">决定属于你；这里只保留当前页面内存。</p></div>
        <fieldset className="decision-options">
          <legend>决定状态</legend>
          {DECISION_OPTIONS.map((option) => <label key={option.code}><input type="radio" name="decision" value={option.code} checked={decision.code === option.code} onChange={() => setDecision((current) => ({ ...current, code: option.code }))} />{option.label}</label>)}
        </fieldset>
        <div className="field field-wide"><label htmlFor="decision-rationale">依据或尚待确认条件</label><textarea id="decision-rationale" rows={3} value={decision.rationale} onChange={({ currentTarget: { value } }) => setDecision((current) => ({ ...current, rationale: value }))} /><span className="hint">不填写也不会替你生成决定。</span></div>
        <div className="field field-wide"><label htmlFor="review-condition">可选复盘条件</label><input id="review-condition" type="text" value={decision.reviewCondition} onChange={({ currentTarget: { value } }) => setDecision((current) => ({ ...current, reviewCondition: value }))} /><span className="hint">产品外人工复盘；本页不提醒、不上传。</span></div>
      </section>

      <section className="card export-card" aria-labelledby="export-title">
        <div className="section-heading"><div><p className="eyebrow">出口</p><h2 id="export-title">一次性 JSON 导出</h2></div><p className="hint">只有点击按钮时才在设备上创建文件。</p></div>
        <p>导出包含当前输入和当前结果（包括数据不足状态）；下载后的文件由浏览器和设备控制。</p>
        <button className="secondary-button" type="button" disabled={!calculated} onClick={() => exportJson(input, output, decision)}>下载当前 JSON</button>
      </section>

      <section className="card goal-card" aria-labelledby="goal-title">
        <div className="section-heading">
          <div><p className="eyebrow">Goal</p><h2 id="goal-title">看见一个目标的当前进度</h2></div>
          <p className="hint">独立于购买计算；不保存历史、不预测完成时间。</p>
        </div>
        <form onSubmit={submitGoal} noValidate autoComplete="off">
          <div className="field-grid">
            <div className="input-pair">
              <div className="field">
                <label htmlFor="goal-name">目标名称</label>
                <input id="goal-name" type="text" maxLength={80} value={goalInput.name} aria-invalid={visibleGoalErrors.name ? "true" : undefined} aria-describedby={visibleGoalErrors.name ? "goal-name-error" : undefined} onChange={({ currentTarget: { value } }) => setGoalInput((current) => ({ ...current, name: value }))} />
                <FieldError code={visibleGoalErrors.name} id="goal-name-error" />
              </div>
              <div className="field">
                <label htmlFor="goal-unit">用户定义单位</label>
                <input id="goal-unit" type="text" maxLength={24} placeholder="例如 CNY、小时、页" value={goalInput.unit} aria-invalid={visibleGoalErrors.unit ? "true" : undefined} aria-describedby={visibleGoalErrors.unit ? "goal-unit-error" : undefined} onChange={({ currentTarget: { value } }) => setGoalInput((current) => ({ ...current, unit: value }))} />
                <span className="hint">应用不会猜测或换算单位。</span>
                <FieldError code={visibleGoalErrors.unit} id="goal-unit-error" />
              </div>
            </div>
            {GOAL_VALUE_FIELDS.map((field) => (
              <GoalValueControl
                key={field}
                field={field}
                input={goalInput}
                error={visibleGoalErrors[field]}
                onValueChange={(value) => setGoalInput((current) => ({ ...current, [field]: value }))}
                onEvidenceChange={(value) => setGoalInput((current) => ({ ...current, evidence: { ...current.evidence, [field]: value } }))}
              />
            ))}
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit">计算目标进度</button>
            <span className="hint">只比较当前值与目标值；修改任一输入后需要重新计算。</span>
          </div>
        </form>

        <div className="goal-results" aria-live="polite" aria-labelledby="goal-results-title">
          <h3 id="goal-results-title" ref={goalResultHeadingRef} tabIndex={-1}>目标进度结果</h3>
          {goalCalculated ? <GoalProgressCard input={goalInput} output={goalOutput} /> : <p className="notice">填写 Goal 后点击“计算目标进度”。</p>}
        </div>
        <div className="form-actions">
          <button className="secondary-button" type="button" disabled={!goalCalculated} onClick={() => exportGoalJson(goalInput, goalOutput)}>下载目标 JSON</button>
          <span className="hint">只导出当前已提交的 Goal 快照，不包含购买数据。</span>
        </div>
      </section>

      <footer className="footer">退出或刷新页面即可清空当前页面内存；本页不会上传或持久化数据。</footer>
    </main>
  );
}
