import {
  CURRENCY,
  PERIOD,
  WORK_TIME_ESTIMATE_RULE,
  type CalculationOutput,
  type DecisionInput,
  type EvidenceStatus,
  type ExactValue,
  type ResultId,
} from "./calculation";
import { validateWorkTimeBasis } from "./income";

export const PURCHASE_SNAPSHOT_FORMAT = "zhiguan-purchase-decision@2" as const;
export const PURCHASE_RULESET_VERSION = "zhiguan-income-calendar@1" as const;

export type PurchaseDecisionCode = "buy" | "wait" | "adjust-conditions" | "do-not-buy" | "undecided";

export interface PurchaseDecision {
  readonly code: PurchaseDecisionCode | "";
  readonly rationale: string;
  readonly reviewCondition: string;
}

export interface PurchaseSnapshotContext {
  readonly comparisonMonth: string;
  readonly timeZone: string;
}

export interface PurchaseSnapshotV2 {
  readonly format: typeof PURCHASE_SNAPSHOT_FORMAT;
  readonly exported_at: string;
  readonly comparison_month: string;
  readonly time_zone: string;
  readonly ruleset_version: typeof PURCHASE_RULESET_VERSION;
  readonly currency: typeof CURRENCY;
  readonly period: typeof PERIOD;
  readonly inputs: {
    readonly income: string;
    readonly work_hours: string;
    readonly work_time_basis: CalculationOutput["workTime"]["basis"];
    readonly fixed_expenses: string;
    readonly purchase_amount: string;
    readonly tax_basis: DecisionInput["taxBasis"] | null;
    readonly fixed_cost_coverage: DecisionInput["fixedCostCoverage"] | null;
    readonly purchase_included: DecisionInput["purchaseIncluded"] | null;
    readonly value_expectation: string;
    readonly evidence: Readonly<Record<"income" | "workHours" | "fixedExpenses" | "purchaseAmount", EvidenceStatus | "">>;
  };
  readonly results: readonly {
    readonly id: ResultId;
    readonly label: string;
    readonly availability: "available" | "insufficient-data";
    readonly evidence_status: EvidenceStatus | "forecast" | "insufficient-data";
    readonly exact: ExactValue | null;
    readonly display: string | null;
    readonly unit: string;
    readonly formula: string;
    readonly dependencies: readonly string[];
    readonly reasons: readonly string[];
    readonly source: "ruleset-derived";
  }[];
  readonly decision: {
    readonly code: PurchaseDecisionCode | null;
    readonly rationale: string | null;
    readonly review_condition: string | null;
  };
}

export function createPurchaseSnapshot(
  input: DecisionInput,
  output: CalculationOutput,
  decision: PurchaseDecision,
  context: PurchaseSnapshotContext,
  now = new Date(),
): PurchaseSnapshotV2 {
  assertContext(context, now);
  return {
    format: PURCHASE_SNAPSHOT_FORMAT,
    exported_at: now.toISOString(),
    comparison_month: context.comparisonMonth,
    time_zone: context.timeZone,
    ruleset_version: PURCHASE_RULESET_VERSION,
    currency: CURRENCY,
    period: PERIOD,
    inputs: {
      income: input.income,
      work_hours: output.workTime.workHours,
      work_time_basis: copyWorkTimeBasis(output.workTime.basis),
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
      exact: item.exact ? { ...item.exact } : null,
      display: item.display,
      unit: item.unit,
      formula: item.formula,
      dependencies: [...item.dependencyFieldIds],
      reasons: [...item.reasonCodes],
      source: item.source,
    })),
    decision: {
      code: decision.code || null,
      rationale: decision.rationale || null,
      review_condition: decision.reviewCondition || null,
    },
  };
}

function copyWorkTimeBasis(basis: CalculationOutput["workTime"]["basis"]): CalculationOutput["workTime"]["basis"] {
  return {
    ...basis,
    ...(basis.work_days ? { work_days: [...basis.work_days] } : {}),
    ...(basis.periods ? { periods: basis.periods.map((period) => ({ ...period })) } : {}),
    ...(basis.exceptions ? { exceptions: { ...basis.exceptions } } : {}),
  };
}

export function serializePurchaseSnapshot(snapshot: PurchaseSnapshotV2): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function isPurchaseSnapshotV2(value: unknown): value is PurchaseSnapshotV2 {
  if (!hasExactKeys(value, ["format", "exported_at", "comparison_month", "time_zone", "ruleset_version", "currency", "period", "inputs", "results", "decision"])) return false;
  if (value.format !== PURCHASE_SNAPSHOT_FORMAT || value.currency !== CURRENCY || value.period !== PERIOD) return false;
  if (value.ruleset_version !== PURCHASE_RULESET_VERSION || !isIsoDate(value.exported_at) || !isMonth(value.comparison_month) || !isTimeZone(value.time_zone)) return false;
  if (!hasExactKeys(value.inputs, ["income", "work_hours", "work_time_basis", "fixed_expenses", "purchase_amount", "tax_basis", "fixed_cost_coverage", "purchase_included", "value_expectation", "evidence"])) return false;
  if (!hasExactKeys(value.inputs.evidence, ["income", "workHours", "fixedExpenses", "purchaseAmount"])) return false;
  if (!isWorkTimeBasis(value.inputs.work_time_basis, value.comparison_month, value.time_zone)) return false;
  if (!isString(value.inputs.income) || !isString(value.inputs.work_hours) || !isString(value.inputs.fixed_expenses) || !isString(value.inputs.purchase_amount) || !isString(value.inputs.value_expectation)) return false;
  if (!isNullableEnum(value.inputs.tax_basis, ["before-tax", "after-tax"]) || !isNullableEnum(value.inputs.fixed_cost_coverage, ["complete", "partial", "unknown"]) || !isNullableEnum(value.inputs.purchase_included, ["included", "excluded"])) return false;
  if (!isEvidence(value.inputs.evidence.income) || !isEvidence(value.inputs.evidence.workHours) || !isEvidence(value.inputs.evidence.fixedExpenses) || !isEvidence(value.inputs.evidence.purchaseAmount)) return false;
  if (!Array.isArray(value.results) || value.results.length !== 5 || !value.results.every(isResult)) return false;
  const resultIds = new Set<unknown>(value.results.map((result) => isRecord(result) ? result.id : null));
  if (resultIds.size !== 5 || !["income-rate", "work-time-equivalent", "available-margin", "purchase-after-margin", "purchase-impact"].every((id) => resultIds.has(id))) return false;
  if (!hasExactKeys(value.decision, ["code", "rationale", "review_condition"])) return false;
  return isNullableEnum(value.decision.code, ["buy", "wait", "adjust-conditions", "do-not-buy", "undecided"])
    && isNullableString(value.decision.rationale)
    && isNullableString(value.decision.review_condition);
}

function assertContext(context: PurchaseSnapshotContext, now: Date): void {
  if (!isMonth(context.comparisonMonth)) throw new RangeError("invalid-comparison-month");
  if (!isTimeZone(context.timeZone)) throw new RangeError("invalid-time-zone");
  if (!Number.isFinite(now.getTime())) throw new RangeError("invalid-export-time");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNullableEnum<const T extends readonly string[]>(value: unknown, values: T): value is T[number] | null {
  return value === null || (typeof value === "string" && values.includes(value));
}

function isEvidence(value: unknown): value is EvidenceStatus | "" {
  return value === "" || value === "user-confirmed" || value === "estimated";
}

function isMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})$/u.exec(value);
  return match !== null && Number(match[1]) >= 1 && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isWorkTimeBasis(value: unknown, comparisonMonth: string, timeZone: string): value is PurchaseSnapshotV2["inputs"]["work_time_basis"] {
  if (!isRecord(value) || !["unselected", "five-day", "six-day", "custom", "monthly", "calendar"].includes(String(value.mode))) return false;
  const commonKeys = ["mode", "days_per_week", "hours_per_day", "conversion"];
  if (value.mode === "calendar") {
    if (!hasExactKeys(value, [...commonKeys, "comparison_month", "time_zone", "total_work_seconds", "work_days", "periods", "exceptions", "schedule_source"])) return false;
    return value.days_per_week === null && value.hours_per_day === null && value.conversion === null
      && value.comparison_month === comparisonMonth && value.time_zone === timeZone
      && isNonNegativeIntegerString(value.total_work_seconds) && BigInt(value.total_work_seconds) <= 32n * 24n * 60n * 60n
      && Array.isArray(value.work_days) && value.work_days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
      && new Set(value.work_days).size === value.work_days.length
      && Array.isArray(value.periods) && value.periods.every(isPeriod)
      && isExceptions(value.exceptions)
      && (value.schedule_source === "default" || value.schedule_source === "user-confirmed")
      && validateWorkTimeBasis({
        timeZone: value.time_zone,
        workDays: value.work_days,
        periods: value.periods,
        exceptions: value.exceptions,
        scheduleSource: value.schedule_source,
      });
  }

  if (!hasExactKeys(value, commonKeys) || value.days_per_week !== null && !isString(value.days_per_week) || value.hours_per_day !== null && !isString(value.hours_per_day)) return false;
  if (value.mode === "unselected" || value.mode === "monthly") return value.days_per_week === null && value.hours_per_day === null && value.conversion === null;
  if (value.mode === "five-day") return value.days_per_week === "5" && value.hours_per_day === "8" && isEstimateConversion(value.conversion);
  if (value.mode === "six-day") return value.days_per_week === "6" && value.hours_per_day === "8" && isEstimateConversion(value.conversion);
  return value.days_per_week !== null && value.hours_per_day !== null && isEstimateConversion(value.conversion);
}

function isEstimateConversion(value: unknown): boolean {
  if (!hasExactKeys(value, ["formula", "weeks_per_year", "months_per_year", "decimal_places", "rounding", "assumptions"])) return false;
  return value.formula === WORK_TIME_ESTIMATE_RULE.formula
    && value.weeks_per_year === WORK_TIME_ESTIMATE_RULE.weeks_per_year
    && value.months_per_year === WORK_TIME_ESTIMATE_RULE.months_per_year
    && value.decimal_places === WORK_TIME_ESTIMATE_RULE.decimal_places
    && value.rounding === WORK_TIME_ESTIMATE_RULE.rounding
    && Array.isArray(value.assumptions) && value.assumptions.length === WORK_TIME_ESTIMATE_RULE.assumptions.length
    && value.assumptions.every((item, index) => item === WORK_TIME_ESTIMATE_RULE.assumptions[index]);
}

function isPeriod(value: unknown): boolean {
  return hasExactKeys(value, ["start", "end", "endDayOffset"])
    && isTimeOfDay(value.start) && isTimeOfDay(value.end)
    && (value.endDayOffset === 0 || value.endDayOffset === 1);
}

function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function isExceptions(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([date, kind]) => isCalendarDate(date) && (kind === "work" || kind === "rest"));
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const day = Number(value.slice(-2));
  const year = Number(value.slice(0, 4));
  const monthNumber = Number(value.slice(5, 7));
  if (year < 1 || monthNumber < 1 || monthNumber > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber - 1];
  return day >= 1 && day <= (daysInMonth ?? 0);
}

function isNonNegativeIntegerString(value: unknown): value is string {
  return typeof value === "string" && value.length <= 12 && /^(?:0|[1-9]\d*)$/u.test(value);
}

function isResult(value: unknown): value is PurchaseSnapshotV2["results"][number] {
  if (!hasExactKeys(value, ["id", "label", "availability", "evidence_status", "exact", "display", "unit", "formula", "dependencies", "reasons", "source"])) return false;
  if (!isNullableEnum(value.id, ["income-rate", "work-time-equivalent", "available-margin", "purchase-after-margin", "purchase-impact"]) || value.id === null) return false;
  if (!isString(value.label) || value.availability !== "available" && value.availability !== "insufficient-data") return false;
  if (value.evidence_status !== "user-confirmed" && value.evidence_status !== "estimated" && value.evidence_status !== "forecast" && value.evidence_status !== "insufficient-data") return false;
  if (!(value.exact === null || isExact(value.exact)) || !isNullableString(value.display)) return false;
  const valueAvailable = value.availability === "available";
  return (valueAvailable === (value.exact !== null)) && (valueAvailable === (value.display !== null))
    && (valueAvailable === (value.evidence_status !== "insufficient-data"))
    && isString(value.unit) && isString(value.formula) && Array.isArray(value.dependencies) && value.dependencies.every(isString)
    && Array.isArray(value.reasons) && value.reasons.every(isKnownReason)
    && (valueAvailable || value.reasons.length > 0)
    && new Set(value.reasons).size === value.reasons.length && value.source === "ruleset-derived";
}

function isExact(value: unknown): value is ExactValue {
  if (!hasExactKeys(value, ["numerator", "denominator", "decimal"])) return false;
  if (!isString(value.numerator) || value.numerator.length > 48 || !/^(?:0|-?[1-9]\d*)$/u.test(value.numerator)) return false;
  if (!isString(value.denominator) || value.denominator.length > 48 || !/^[1-9]\d*$/u.test(value.denominator)) return false;
  if (!isString(value.decimal) || !/^-?\d+\.\d{2}$/u.test(value.decimal)) return false;
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  const sign = numerator < 0n ? "-" : "";
  const absolute = numerator < 0n ? -numerator : numerator;
  const scaled = absolute * 100n;
  let rounded = scaled / denominator;
  if ((scaled % denominator) * 2n >= denominator) rounded += 1n;
  const expected = `${sign}${rounded / 100n}.${(rounded % 100n).toString().padStart(2, "0")}`;
  return value.decimal === expected;
}

function isKnownReason(value: unknown): boolean {
  return ["missing-input", "invalid-input", "number-too-large", "zero-not-allowed", "out-of-range", "number-too-small", "evidence-required", "tax-basis-required", "before-tax-margin-unavailable", "fixed-cost-coverage-required", "purchase-period-required"].includes(String(value));
}
