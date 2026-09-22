import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AssistInput } from "./AssistInput";
import {
  EMPTY_ASSIST_ESTIMATES,
  areNumericValuesEquivalent,
  finalizeAssistInput,
  type AssistEstimatedValues as AssistEstimateMap,
} from "./assist-flow";
import { downloadJson } from "./download";
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
  type WorkTimeBasis,
  type WorkTimeInput,
} from "../domain/calculation";
import {
  createPurchaseSnapshot,
  serializePurchaseSnapshot,
  type PurchaseDecisionCode,
  type PurchaseSnapshotV2,
} from "../domain/purchase-snapshot";

const EMPTY_INPUT: DecisionInput = {
  income: "",
  workHours: "",
  workTime: { mode: "unselected" },
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

type NumericInputField = NumericField | "workDaysPerWeek" | "workHoursPerDay";

const FIELD_LABELS: Record<NumericInputField, string> = {
  income: "每月收入",
  workHours: "每月工作时间",
  fixedExpenses: "每月固定支出",
  purchaseAmount: "这笔购买要花多少",
  workDaysPerWeek: "每周平均上班几天",
  workHoursPerDay: "每个上班日平均工作几小时",
};

type InputErrorField = NumericInputField | "taxBasis" | "fixedCostCoverage" | "purchaseIncluded";

const PROBLEM_FIELD_LABELS: Record<InputErrorField, string> = {
  ...FIELD_LABELS,
  purchaseAmount: "购买价格",
  workDaysPerWeek: "每周上班天数",
  workHoursPerDay: "每天工作小时数",
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
      if (field === "workDaysPerWeek" || field === "workHoursPerDay") return "只填数字，可以带小数，例如 5.5。";
      return field === "workHours" ? "只填数字，例如 160 或 160.5。" : "只填数字，不要加逗号或“元”。";
    case "number-too-large":
      if (field === "workDaysPerWeek" || field === "workHoursPerDay") return "这个数字超出可填写范围，请检查；小数最多三位。";
      return field === "workHours"
        ? "这个时间超出可填写范围，请检查；小数最多三位。"
        : "这个金额超出可填写范围，请检查；小数最多两位。";
    case "zero-not-allowed":
      if (field === "income") return "每月收入需要大于 0。";
      if (field === "workHours") return "每月工作时间需要大于 0。";
      if (field === "workDaysPerWeek" || field === "workHoursPerDay") return `${PROBLEM_FIELD_LABELS[field]}需要大于 0。`;
      return "购买价格需要大于 0。";
    case "out-of-range":
      if (field === "workDaysPerWeek") return "每周上班天数不能超过 7 天。";
      if (field === "workHoursPerDay") return "每天工作小时数不能超过 24 小时。";
      return "请检查作息：每周不超过 7 天，每天不超过 24 小时。";
    case "number-too-small":
      return "折算后的月工作时间不足 0.001 小时，请调整作息。";
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

export function updateNumeric(input: DecisionInput, field: NumericInputField, value: string): DecisionInput {
  if (field === "workDaysPerWeek" || field === "workHoursPerDay") {
    if (input.workTime?.mode !== "custom") return input;
    const key = field === "workDaysPerWeek" ? "daysPerWeek" : "hoursPerDay";
    return { ...input, workTime: { ...input.workTime, [key]: value } };
  }
  return { ...input, [field]: value };
}

export function updateWorkTimeMode(input: DecisionInput, mode: Exclude<WorkTimeInput["mode"], "calendar">): DecisionInput {
  return {
    ...input,
    workHours: "",
    workTime: mode === "custom" ? { mode, daysPerWeek: "", hoursPerDay: "" } : { mode },
  };
}

export function updateAllEvidence(input: DecisionInput, value: EvidenceStatus): DecisionInput {
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

export interface AssistEstimatedValues {
  readonly income?: string | null;
  readonly workHours?: string | null;
  readonly fixedExpenses?: string | null;
  readonly purchaseAmount?: string | null;
}

export function updateEvidencePreservingAssistEstimates(
  input: DecisionInput,
  value: EvidenceStatus,
  estimatedValues: AssistEstimatedValues,
): DecisionInput {
  const next = updateAllEvidence(input, value);
  if (value !== "user-confirmed") return next;
  return {
    ...next,
    evidence: {
      ...next.evidence,
      income: estimatedValues.income != null && input.income === estimatedValues.income ? "estimated" : next.evidence.income,
      workHours: estimatedValues.workHours != null && input.workHours === estimatedValues.workHours ? "estimated" : next.evidence.workHours,
      fixedExpenses: estimatedValues.fixedExpenses != null && input.fixedExpenses === estimatedValues.fixedExpenses ? "estimated" : next.evidence.fixedExpenses,
      purchaseAmount: estimatedValues.purchaseAmount != null && input.purchaseAmount === estimatedValues.purchaseAmount ? "estimated" : next.evidence.purchaseAmount,
    },
  };
}

export interface DecisionForm {
  readonly code: PurchaseDecisionCode | "";
  readonly rationale: string;
  readonly reviewCondition: string;
}

export const DECISION_OPTIONS: readonly { readonly code: PurchaseDecisionCode; readonly label: string }[] = [
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
      work_hours: output.workTime.workHours,
      work_time_basis: output.workTime.basis,
      fixed_expenses: input.fixedExpenses,
      purchase_amount: input.purchaseAmount,
      tax_basis: input.taxBasis || null,
      fixed_cost_coverage: input.fixedCostCoverage || null,
      purchase_included: input.purchaseIncluded || null,
      value_expectation: input.valueExpectation,
      evidence: { ...input.evidence, workHours: output.workTime.evidence },
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

export interface AppProps {
  readonly initialInput?: DecisionInput;
  readonly comparisonMonth?: string;
  readonly timeZone?: string;
  readonly onBack?: () => void;
  readonly onFavorite?: (snapshot: PurchaseSnapshotV2) => Promise<void>;
  readonly onAdoptMonth?: (month: string, draft: DecisionInput) => void;
}

function monthInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new RangeError("invalid-time-zone-month");
  return `${year}-${month}`;
}

function isCalendarStale(input: DecisionInput, selectedMonth: string, selectedTimeZone: string): boolean {
  if (monthInTimeZone(new Date(), selectedTimeZone) !== selectedMonth) return true;
  const calendar = input.workTime?.mode === "calendar" ? input.workTime : undefined;
  if (calendar && (calendar.comparisonMonth !== selectedMonth || calendar.timeZone !== selectedTimeZone)) return true;
  return false;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
  readonly field: NumericInputField;
  readonly input: DecisionInput;
  readonly error?: InputErrorCode;
  readonly hint?: string;
  readonly onChange: (value: string) => void;
}) {
  const inputId = `input-${field}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const unit = field === "workDaysPerWeek" ? "天" : field === "workHours" || field === "workHoursPerDay" ? "小时" : "元";
  const schedule = input.workTime?.mode === "custom" ? input.workTime : null;
  const value = field === "workDaysPerWeek"
    ? schedule?.daysPerWeek ?? ""
    : field === "workHoursPerDay"
      ? schedule?.hoursPerDay ?? ""
      : input[field];
  return (
    <div className="field">
      <label htmlFor={inputId}>{FIELD_LABELS[field]}（{unit}）</label>
      <input
        id={inputId}
        name={field}
        type="text"
        inputMode="decimal"
        value={value}
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
    || field === "workDaysPerWeek"
    || field === "workHoursPerDay"
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

function unavailableResultText(result: CalculationResult, inputErrors: InputErrors, basis?: WorkTimeBasis): string {
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
    return code === "invalid-input" || code === "number-too-large" || code === "zero-not-allowed"
      || code === "out-of-range" || code === "number-too-small";
  });
  const outcome = RESULT_OUTCOMES[result.id];
  const label = (field: InputErrorField) => field === "workHours" && basis && basis.mode !== "monthly"
    ? "工作安排"
    : PROBLEM_FIELD_LABELS[field];

  if (missingFields.length > 0 && invalidFields.length === 0) {
    if (missingFields.length === 1 && missingFields[0] === "fixedExpenses") {
      return "还缺每月固定支出，所以现在算不了本月剩余金额。没有固定支出可以填 0。";
    }
    return `还缺${joinChinese(missingFields.map(label))}，所以现在算不了${outcome}。`;
  }
  if (invalidFields.length > 0 && missingFields.length === 0) {
    return `先改正${joinChinese(invalidFields.map(label))}，才能计算${outcome}。`;
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

export function resultText(result: CalculationResult, inputErrors: InputErrors, basis?: WorkTimeBasis): string {
  if (result.availability === "insufficient-data" || !result.exact) {
    return unavailableResultText(result, inputErrors, basis);
  }

  const value = result.exact.decimal;
  switch (result.id) {
    case "work-time-equivalent":
      if (basis?.conversion) return `按平时作息估算，这笔钱约相当于你工作 ${value} 小时的收入。`;
      if (result.evidenceStatus === "estimated") return `按你填的大概数，这笔钱约相当于你工作 ${value} 小时的收入。`;
      return `按这些数字，这笔钱相当于你工作 ${value} 小时的收入。`;
    case "income-rate":
      if (basis?.conversion) return `按平时作息估算，每小时收入约为 ${value} 元。`;
      if (result.evidenceStatus === "estimated") return `按你填的大概数，每小时收入约为 ${value} 元。`;
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
  workTime,
}: {
  readonly result: CalculationResult;
  readonly taxBasis: TaxBasis | "";
  readonly inputErrors: InputErrors;
  readonly workTime: CalculationOutput["workTime"];
}) {
  const titleId = `${result.id}-title`;
  const primary = result.id === "work-time-equivalent";
  return (
    <article className={`result ${primary ? "result-primary " : ""}${result.availability}`} aria-labelledby={titleId}>
      <h3 id={titleId}>{RESULT_TITLES[result.id]}</h3>
      <p className="result-value">{resultText(result, inputErrors, workTime.basis)}</p>
      <details>
        <summary>怎么算出来的</summary>
        {(result.id === "work-time-equivalent" || result.id === "income-rate") && workTime.basis.conversion ? (
          <>
            <p>按每周 {workTime.basis.days_per_week} 天、每个上班日 {workTime.basis.hours_per_day} 小时估算。{workTime.basis.conversion.formula}，月工时四舍五入保留三位小数。{workTime.workHours ? `本次按每月 ${workTime.workHours} 小时换算。` : "作息填写完整且有效后才能换算。"}</p>
            {workTime.basis.conversion.assumptions.map((assumption) => <p key={assumption}>{assumption}</p>)}
          </>
        ) : null}
        <p>{resultDetails(result, taxBasis)}</p>
      </details>
    </article>
  );
}

export function App({
  initialInput,
  comparisonMonth,
  timeZone,
  onBack,
  onFavorite,
  onAdoptMonth,
}: AppProps) {
  const initialCalendar = initialInput?.workTime?.mode === "calendar" ? initialInput.workTime : undefined;
  const selectedTimeZone = timeZone ?? initialCalendar?.timeZone ?? localTimeZone();
  const selectedMonth = comparisonMonth ?? initialCalendar?.comparisonMonth ?? monthInTimeZone(new Date(), selectedTimeZone);
  const [input, setInput] = useState<DecisionInput>(() => initialInput ?? EMPTY_INPUT);
  const [submittedInput, setSubmittedInput] = useState<DecisionInput | null>(null);
  const [decision, setDecision] = useState<DecisionForm>({ code: "", rationale: "", reviewCondition: "" });
  const [assistResetKey, setAssistResetKey] = useState(0);
  const [assistEstimatedValues, setAssistEstimatedValues] = useState<AssistEstimateMap>({ ...EMPTY_ASSIST_ESTIMATES });
  const [manualMode, setManualMode] = useState(true);
  const [marginRequested, setMarginRequested] = useState(false);
  const [approximateInput, setApproximateInput] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [favoriteState, setFavoriteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const calculated = submittedInput === input;
  const output = useMemo(() => calculateDecision(input), [input]);
  const visibleResults = useMemo(() => visibleResultsFor(output, marginRequested), [output, marginRequested]);
  const hasAvailableResult = visibleResults.some((result) => result.availability === "available");
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const favoriteRequestId = useRef(0);

  useEffect(() => {
    if (calculated) resultHeadingRef.current?.focus();
  }, [calculated]);

  const clear = () => {
    favoriteRequestId.current += 1;
    setInput(initialInput ?? EMPTY_INPUT);
    setSubmittedInput(null);
    setDecision({ code: "", rationale: "", reviewCondition: "" });
    setAssistResetKey((current) => current + 1);
    setAssistEstimatedValues({ ...EMPTY_ASSIST_ESTIMATES });
    setManualMode(true);
    setMarginRequested(false);
    setApproximateInput(false);
    setDraftNotice(null);
    setFavoriteState("idle");
    setDraftRevision((current) => current + 1);
  };

  const updateDraft = (next: DecisionInput, nextEstimates: AssistEstimateMap = assistEstimatedValues) => {
    const workTimeUnchanged = (next.workTime && input.workTime)
      ? JSON.stringify(next.workTime) === JSON.stringify(input.workTime)
      : next.workTime === input.workTime;
    if (next.income === input.income
      && next.workHours === input.workHours
      && next.fixedExpenses === input.fixedExpenses
      && next.purchaseAmount === input.purchaseAmount
      && next.taxBasis === input.taxBasis
      && next.fixedCostCoverage === input.fixedCostCoverage
      && next.purchaseIncluded === input.purchaseIncluded
      && next.valueExpectation === input.valueExpectation
      && workTimeUnchanged
      && next.evidence.income === input.evidence.income
      && next.evidence.workHours === input.evidence.workHours
      && next.evidence.fixedExpenses === input.evidence.fixedExpenses
      && next.evidence.purchaseAmount === input.evidence.purchaseAmount
      && nextEstimates.income === assistEstimatedValues.income
      && nextEstimates.workHours === assistEstimatedValues.workHours
      && nextEstimates.fixedExpenses === assistEstimatedValues.fixedExpenses
      && nextEstimates.purchaseAmount === assistEstimatedValues.purchaseAmount) return;
    const hadResultOrDecision = calculated || Boolean(decision.code || decision.rationale || decision.reviewCondition);
    favoriteRequestId.current += 1;
    setInput(next);
    setAssistEstimatedValues(nextEstimates);
    setSubmittedInput(null);
    setDecision({ code: "", rationale: "", reviewCondition: "" });
    setDraftRevision((current) => current + 1);
    setFavoriteState("idle");
    setDraftNotice(hadResultOrDecision ? "输入已更改，旧结果和决定理由已清除；重新确认后请再选择决定。" : null);
  };

  const manualUpdate = (next: DecisionInput, changedNumeric?: NumericField) => {
    const nextEstimates = { ...assistEstimatedValues };
    if (changedNumeric) {
      const existingEstimate = nextEstimates[changedNumeric];
      nextEstimates[changedNumeric] = existingEstimate === input[changedNumeric]
        && areNumericValuesEquivalent(changedNumeric, input[changedNumeric], next[changedNumeric])
        ? next[changedNumeric]
        : null;
    }
    updateDraft(next, nextEstimates);
  };

  const changeApproximatePreference = (value: boolean) => {
    if (value === approximateInput) return;
    setApproximateInput(value);
    if (calculated) updateDraft(finalizeAssistInput(input, assistEstimatedValues, value), assistEstimatedValues);
  };

  const updateNumericField = (field: NumericInputField, value: string) => {
    const next = updateNumeric(input, field, value);
    manualUpdate(next, field === "workDaysPerWeek" || field === "workHoursPerDay" ? undefined : field);
  };

  const confirmInput = (draft: DecisionInput = input, estimates: AssistEstimateMap = assistEstimatedValues) => {
    if (isCalendarStale(draft, selectedMonth, selectedTimeZone)) return;
    const confirmed = finalizeAssistInput(draft, estimates, approximateInput);
    setInput(confirmed);
    setAssistEstimatedValues(estimates);
    setSubmittedInput(confirmed);
    setDraftNotice(null);
  };

  const currentMonth = () => monthInTimeZone(new Date(), selectedTimeZone);

  const adoptCurrentMonth = () => {
    const month = currentMonth();
    if (onAdoptMonth) onAdoptMonth(month, input);
    else if (onBack) onBack();
    else setDraftNotice("请返回收入看板并重新打开购买分析；新页面会按当前月份的作息重新计算。此草稿尚未保存。");
  };

  const favorite = async () => {
    if (!onFavorite || !calculated) return;
    if (isCalendarStale(input, selectedMonth, selectedTimeZone)) return;
    const requestId = ++favoriteRequestId.current;
    setFavoriteState("saving");
    try {
      const snapshot = createPurchaseSnapshot(input, output, decision, {
        comparisonMonth: selectedMonth,
        timeZone: selectedTimeZone,
      });
      await onFavorite(snapshot);
      if (favoriteRequestId.current === requestId) setFavoriteState("saved");
    } catch {
      if (favoriteRequestId.current === requestId) setFavoriteState("error");
    }
  };

  const downloadCurrentSnapshot = () => {
    if (isCalendarStale(input, selectedMonth, selectedTimeZone)) return;
    const snapshot = createPurchaseSnapshot(input, output, decision, {
      comparisonMonth: selectedMonth,
      timeZone: selectedTimeZone,
    });
    downloadJson(serializePurchaseSnapshot(snapshot), "zhiguan-purchase-decision-v2.json");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    confirmInput();
  };

  const visibleErrors = calculated ? output.inputErrors : {};
  const hasEstimatedValues = Object.values(input.evidence).some((status) => status === "estimated");
  const hasAssistEstimates = Object.values(assistEstimatedValues).some((value) => value !== null);
  const workTimeMode = input.workTime?.mode ?? "monthly";
  const hasScheduleFieldError = Boolean(visibleErrors.workDaysPerWeek || visibleErrors.workHoursPerDay);
  const monthNoticeVisible = isCalendarStale(input, selectedMonth, selectedTimeZone);

  return (
    <main className="app-shell">
      <header className="topbar">
        {onBack ? <button className="quiet-button" type="button" onClick={onBack}>返回收入看板</button> : <a className="brand" href="#page-title">值观</a>}
        <button className="quiet-button" type="button" onClick={clear}>清空购买草稿</button>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">这次购买要花多少工作时间？</h1>
        <p>填入这次购买的价格即可。月收入和本月作息沿用已保存资料；对话与更多设置都可以按需打开。</p>
      </section>

      <AssistInput
        key={assistResetKey}
        currentInput={input}
        estimatedValues={assistEstimatedValues}
        draftRevision={draftRevision}
        manualMode={manualMode}
        marginRequested={marginRequested}
        approximateInput={approximateInput}
        onDraftChange={updateDraft}
        onApproximateInputChange={changeApproximatePreference}
        onMarginRequest={() => setMarginRequested(true)}
        onConfirm={(draft, estimates) => confirmInput(draft, estimates)}
        onSwitchManual={() => setManualMode(true)}
        onSwitchChat={() => setManualMode(false)}
      />

      {manualMode ? <form className="card form" onSubmit={submit} noValidate autoComplete="off">
        <div className="section-heading">
          <h2>算一笔购买</h2>
          <p>收入和作息只用于这次计算，不会写回已保存资料；金额单位为人民币。</p>
        </div>
        <div className="field-grid">
          {initialInput ? (
            <p className="field-hint field-wide">沿用每月到手收入 {input.income || "—"} 元 · {selectedMonth} 作息估算 · {selectedTimeZone}</p>
          ) : <NumericFieldControl field="income" input={input} error={visibleErrors.income} onChange={(value) => updateNumericField("income", value)} />}
          <NumericFieldControl field="purchaseAmount" input={input} error={visibleErrors.purchaseAmount} onChange={(value) => updateNumericField("purchaseAmount", value)} />
        </div>

        <details className="optional-inputs">
          <summary>详细修改这次的比较条件</summary>
          <div className="optional-content">
            {initialInput ? <NumericFieldControl field="income" input={input} error={visibleErrors.income} onChange={(value) => updateNumericField("income", value)} /> : null}
            <div className="field">
              <label htmlFor="tax-basis">收入类型</label>
              <select
                id="tax-basis"
                name="tax-basis"
                value={input.taxBasis}
                aria-invalid={visibleErrors.taxBasis ? "true" : undefined}
                aria-describedby={visibleErrors.taxBasis ? "tax-basis-error" : undefined}
                onChange={({ currentTarget: { value } }) => manualUpdate({ ...input, taxBasis: value as TaxBasis | "" })}
              >
                <option value="">尚未确认</option>
                <option value="after-tax">税后（到手）</option>
                <option value="before-tax">税前（还没扣税）</option>
              </select>
              <FieldError field="taxBasis" code={visibleErrors.taxBasis} id="tax-basis-error" />
            </div>

            <fieldset className="work-time-inputs" aria-invalid={visibleErrors.workHours ? "true" : undefined} aria-describedby="work-time-hint">
              <legend>仅调整这次购买的工作时间</legend>
              <p className="field-hint" id="work-time-hint">更改只影响这次试算，不会修改收入资料。按每周作息估算会用全年平均月工时。</p>
              {initialCalendar ? (
                <label className="work-time-manual">
                  <input
                    type="radio"
                    name="work-time-mode"
                    value="calendar"
                    checked={workTimeMode === "calendar"}
                    onChange={() => manualUpdate({ ...input, workHours: "", workTime: initialCalendar })}
                  />
                  沿用 {initialCalendar.comparisonMonth} 的已保存作息
                </label>
              ) : null}
              <div className="work-time-options">
                {([
                  ["five-day", "每周 5 天，每天 8 小时"],
                  ["six-day", "每周 6 天，每天 8 小时"],
                  ["custom", "自定义每周作息"],
                ] as const).map(([mode, label]) => (
                  <label key={mode}>
                    <input type="radio" name="work-time-mode" value={mode} checked={workTimeMode === mode} onChange={() => manualUpdate(updateWorkTimeMode(input, mode), "workHours")} />
                    {label}
                  </label>
                ))}
              </div>
              <label className="work-time-manual">
                <input type="radio" name="work-time-mode" value="monthly" checked={workTimeMode === "monthly"} onChange={() => manualUpdate(updateWorkTimeMode(input, "monthly"), "workHours")} />
                直接填写每月工作小时数
              </label>
              {workTimeMode === "custom" ? (
                <div className="field-grid work-time-custom">
                  <NumericFieldControl field="workDaysPerWeek" input={input} error={visibleErrors.workDaysPerWeek} hint="可以填小数，例如大小周填 5.5。" onChange={(value) => manualUpdate(updateNumeric(input, "workDaysPerWeek", value))} />
                  <NumericFieldControl field="workHoursPerDay" input={input} error={visibleErrors.workHoursPerDay} hint="包含经常性加班，不含通勤和休息。" onChange={(value) => manualUpdate(updateNumeric(input, "workHoursPerDay", value))} />
                </div>
              ) : null}
              {workTimeMode === "monthly" ? (
                <div className="work-time-custom">
                  <NumericFieldControl field="workHours" input={input} error={visibleErrors.workHours} onChange={(value) => manualUpdate(updateNumeric(input, "workHours", value), "workHours")} />
                </div>
              ) : null}
              {workTimeMode !== "monthly" && visibleErrors.workHours && !hasScheduleFieldError ? (
                <span className="error" id="work-time-error" role="alert">{workTimeMode === "unselected" ? "选一下平时作息，或直接填写每月工作小时数。" : inputErrorText("workHours", visibleErrors.workHours)}</span>
              ) : null}
              {workTimeMode === "calendar" ? <p className="field-hint">按已保存的当月日历工作秒数估算；系统不会把排班或例外发送给对话服务。</p> : null}
              {output.workTime.basis.conversion ? <p className="field-hint work-time-note">按平均作息估算，不代表本月实际出勤。包含经常性加班，不含通勤和休息。</p> : null}
            </fieldset>

            <label className="check-row">
              <input
                type="checkbox"
                checked={approximateInput}
                aria-describedby={hasAssistEstimates ? "assist-estimate-hint" : undefined}
                onChange={({ currentTarget: { checked } }) => changeApproximatePreference(checked)}
              />
              我填写的数字里有大概数
            </label>
            {hasAssistEstimates ? <p className="field-hint" id="assist-estimate-hint">辅助整理逐项识别的大概数仍按估算；填写更准确的数值后可重新确认。</p> : null}
          </div>
        </details>

        <details className="optional-inputs" open={marginRequested} onToggle={(event) => setMarginRequested(event.currentTarget.open)}>
          <summary>还想看买完后，这个月剩多少？（可选）</summary>
          <div className="optional-content">
            <NumericFieldControl field="fixedExpenses" input={input} error={visibleErrors.fixedExpenses} hint="没有固定支出可以填 0。" onChange={(value) => updateNumericField("fixedExpenses", value)} />
            <div className="field">
              <label htmlFor="fixed-cost-coverage">固定支出范围</label>
              <select
                id="fixed-cost-coverage"
                value={input.fixedCostCoverage}
                aria-invalid={visibleErrors.fixedCostCoverage ? "true" : undefined}
                aria-describedby={visibleErrors.fixedCostCoverage ? "fixed-cost-coverage-error" : undefined}
                onChange={({ currentTarget: { value } }) => manualUpdate({ ...input, fixedCostCoverage: value as DecisionInput["fixedCostCoverage"] })}
              >
                <option value="">尚未确认</option>
                <option value="complete">包含本月全部固定支出</option>
                <option value="partial">只包含一部分</option>
                <option value="unknown">不确定</option>
              </select>
            </div>
            <FieldError field="fixedCostCoverage" code={visibleErrors.fixedCostCoverage} id="fixed-cost-coverage-error" />
            <div className="field">
              <label htmlFor="purchase-included">本月是否付款</label>
              <select
                id="purchase-included"
                value={input.purchaseIncluded}
                aria-invalid={visibleErrors.purchaseIncluded ? "true" : undefined}
                aria-describedby={visibleErrors.purchaseIncluded ? "purchase-included-error" : undefined}
                onChange={({ currentTarget: { value } }) => manualUpdate({ ...input, purchaseIncluded: value as DecisionInput["purchaseIncluded"] })}
              >
                <option value="">尚未确认</option>
                <option value="included">本月付款</option>
                <option value="excluded">不在本月付款</option>
              </select>
            </div>
            <FieldError field="purchaseIncluded" code={visibleErrors.purchaseIncluded} id="purchase-included-error" />
            <div className="field field-wide">
              <label htmlFor="value-expectation">你希望它带来什么？（可选）</label>
              <textarea id="value-expectation" rows={2} value={input.valueExpectation} aria-describedby="value-expectation-hint" onChange={({ currentTarget: { value } }) => manualUpdate({ ...input, valueExpectation: value })} />
              <span className="field-hint" id="value-expectation-hint">不参与计算，只帮你记住当时的期待。</span>
            </div>
          </div>
        </details>

        <button className="primary-button" type="submit">确认并查看结果</button>
      </form> : null}

      {draftNotice ? <p className="draft-notice" role="status">{draftNotice}</p> : null}

      {calculated ? (
        <section className="results-section" aria-labelledby="results-title">
          <h2 id="results-title" ref={resultHeadingRef} tabIndex={-1}>结果</h2>
          <div className="result-grid">
            {visibleResults.map((result) => (
              <ResultCard key={result.id} result={result} taxBasis={input.taxBasis} inputErrors={output.inputErrors} workTime={output.workTime} />
            ))}
          </div>
          <div className="result-notes">
            {hasAvailableResult ? (
            <p>{hasEstimatedValues ? "你填写的数字里有大概数，相关结果也是大概值。" : output.workTime.evidence === "estimated" ? "工作时间和每小时收入按计划作息估算，不代表本月实际出勤。" : "按你刚刚确认的数字计算。"}</p>
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
                <input type="radio" name="decision" value={option.code} checked={decision.code === option.code} onChange={() => { favoriteRequestId.current += 1; setFavoriteState("idle"); setDecision((current) => ({ ...current, code: option.code })); }} />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="field field-wide">
            <label htmlFor="decision-rationale">想记下原因吗？（可选）</label>
            <textarea id="decision-rationale" rows={2} value={decision.rationale} aria-describedby="decision-rationale-hint" onChange={({ currentTarget: { value } }) => { favoriteRequestId.current += 1; setFavoriteState("idle"); setDecision((current) => ({ ...current, rationale: value })); }} />
            <span className="field-hint" id="decision-rationale-hint">这段话不参与计算。</span>
          </div>
          {onFavorite ? (
            <>
              <button className="secondary-button" type="button" disabled={favoriteState === "saving" || favoriteState === "saved"} onClick={() => void favorite()}>
                {favoriteState === "saving" ? "正在收藏…" : favoriteState === "saved" ? "已加入收藏" : "收藏这次结果"}
              </button>
              {favoriteState === "error" ? <p className="error" role="alert">收藏没有保存成功，请检查后重试。</p> : null}
            </>
          ) : null}
          <button className="secondary-button" type="button" onClick={downloadCurrentSnapshot}>下载这次记录（@2）</button>
        </section>
      ) : null}

      {monthNoticeVisible ? (
        <section className="draft-notice" role="status">
          <p>当前已进入 {currentMonth()}，这份草稿仍按 {selectedMonth} 计算。旧月结果不会标成新月结果。</p>
          <button className="secondary-button" type="button" onClick={adoptCurrentMonth}>
            {onAdoptMonth ? `采用 ${currentMonth()} 并重新计算` : "返回收入看板后用新月份重新打开"}
          </button>
        </section>
      ) : null}

      <footer className="footer">只有点击发送后，当前回答、问题和理解回答所需的少量相关字段才会发送给 TypeSafe/Jev；收入资料、日历排班、日期例外、价值期待和决定理由不会整体发送。对话服务是否留存内容以其服务说明为准。清空购买草稿不会删除已保存的收入资料。</footer>
    </main>
  );
}
