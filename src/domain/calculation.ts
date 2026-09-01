/**
 * The small calculation kernel used by the page.  Inputs stay as strings at
 * the UI boundary; money and ratios are calculated with BigInt so cents are
 * never rounded through JavaScript Number.
 */

export const CURRENCY = "CNY" as const;
export const PERIOD = "month" as const;
export const MAX_AMOUNT_INTEGER_DIGITS = 15;
export const MAX_WORK_HOURS_INTEGER_DIGITS = 6;
export const MAX_WORK_HOURS_FRACTION_DIGITS = 3;
export const MAX_AMOUNT_CENTS = 99999999999999999n;
export const MAX_WORK_HOURS_NUMERATOR = 999999999n;

export const NUMERIC_FIELDS = ["income", "workHours", "fixedExpenses", "purchaseAmount"] as const;
export type NumericField = (typeof NUMERIC_FIELDS)[number];
export type TaxBasis = "before-tax" | "after-tax";
export type EvidenceStatus = "user-confirmed" | "estimated";
export type InputErrorCode =
  | "missing-input"
  | "invalid-input"
  | "number-too-large"
  | "zero-not-allowed"
  | "evidence-required"
  | "tax-basis-required"
  | "before-tax-margin-unavailable"
  | "fixed-cost-coverage-required"
  | "purchase-period-required";

export interface DecisionInput {
  readonly income: string;
  readonly workHours: string;
  readonly fixedExpenses: string;
  readonly purchaseAmount: string;
  readonly taxBasis: TaxBasis | "";
  readonly fixedCostCoverage: "complete" | "partial" | "unknown" | "";
  readonly purchaseIncluded: "included" | "excluded" | "";
  readonly valueExpectation: string;
  readonly evidence: Readonly<Record<NumericField, EvidenceStatus | "">>;
}

export interface ExactValue {
  readonly numerator: string;
  readonly denominator: string;
  readonly decimal: string;
}

export type ResultId =
  | "income-rate"
  | "work-time-equivalent"
  | "available-margin"
  | "purchase-after-margin"
  | "purchase-impact";

export interface CalculationResult {
  readonly id: ResultId;
  readonly label: string;
  readonly availability: "available" | "insufficient-data";
  readonly evidenceStatus: EvidenceStatus | "forecast" | "insufficient-data";
  readonly exact: ExactValue | null;
  readonly display: string | null;
  readonly unit: string;
  readonly formula: string;
  readonly dependencyFieldIds: readonly string[];
  readonly reasonCodes: readonly InputErrorCode[];
  readonly source: "ruleset-derived";
}

export interface CalculationOutput {
  readonly results: readonly CalculationResult[];
  readonly inputErrors: Readonly<Partial<Record<NumericField | "taxBasis" | "fixedCostCoverage" | "purchaseIncluded", InputErrorCode>>>;
}

interface Money {
  readonly cents: bigint;
}

interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reasonCode: InputErrorCode };

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new Error("division-by-zero");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  };
}

function powerOfTen(digits: number): bigint {
  return 10n ** BigInt(digits);
}

function formatRational(value: Rational, digits = 2): string {
  const sign = value.numerator < 0n ? "-" : "";
  const numerator = value.numerator < 0n ? -value.numerator : value.numerator;
  const scale = powerOfTen(digits);
  const scaled = numerator * scale;
  let rounded = scaled / value.denominator;
  if ((scaled % value.denominator) * 2n >= value.denominator) rounded += 1n;
  const whole = rounded / scale;
  const fraction = (rounded % scale).toString().padStart(digits, "0");
  return `${sign}${whole.toString()}.${fraction}`;
}

function moneyExact(cents: bigint): ExactValue {
  const value = rational(cents, 100n);
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    decimal: formatRational(value),
  };
}

function ratioExact(value: Rational): ExactValue {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    decimal: formatRational(value),
  };
}

function parseDigits(raw: string, maxIntegerDigits: number, maxFractionDigits: number): ParseResult<{ whole: string; fraction: string }> {
  const value = raw.trim();
  if (!value) return { ok: false, reasonCode: "missing-input" };
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) return { ok: false, reasonCode: "invalid-input" };
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  if (whole.length > maxIntegerDigits || fraction.length > maxFractionDigits) {
    return { ok: false, reasonCode: "number-too-large" };
  }
  return { ok: true, value: { whole, fraction } };
}

export function parseAmount(raw: string, allowZero = true): ParseResult<Money> {
  const parsed = parseDigits(raw, MAX_AMOUNT_INTEGER_DIGITS, 2);
  if (!parsed.ok) return parsed;
  const cents = BigInt(parsed.value.whole) * 100n + BigInt(parsed.value.fraction.padEnd(2, "0") || "0");
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, reasonCode: "number-too-large" };
  if (!allowZero && cents === 0n) return { ok: false, reasonCode: "zero-not-allowed" };
  return { ok: true, value: { cents } };
}

export function parseWorkHours(raw: string): ParseResult<Rational> {
  const parsed = parseDigits(raw, MAX_WORK_HOURS_INTEGER_DIGITS, MAX_WORK_HOURS_FRACTION_DIGITS);
  if (!parsed.ok) return parsed;
  const fractionDigits = parsed.value.fraction.length;
  const denominator = powerOfTen(fractionDigits);
  const numerator = BigInt(parsed.value.whole) * denominator + BigInt(parsed.value.fraction || "0");
  if (numerator === 0n) return { ok: false, reasonCode: "zero-not-allowed" };
  if (numerator > MAX_WORK_HOURS_NUMERATOR) return { ok: false, reasonCode: "number-too-large" };
  return { ok: true, value: rational(numerator, denominator) };
}

function inputReasons(parsed: ParseResult<unknown>, evidence: EvidenceStatus | ""): InputErrorCode[] {
  const reasons: InputErrorCode[] = [];
  if (!parsed.ok) reasons.push(parsed.reasonCode);
  if (parsed.ok && evidence !== "user-confirmed" && evidence !== "estimated") reasons.push("evidence-required");
  return reasons;
}

function statusFor(fields: readonly NumericField[], input: DecisionInput): EvidenceStatus {
  return fields.some((field) => input.evidence[field] === "estimated") ? "estimated" : "user-confirmed";
}

function result(
  id: ResultId,
  label: string,
  unit: string,
  formula: string,
  dependencies: readonly string[],
  reasons: readonly InputErrorCode[],
  evidenceStatus: EvidenceStatus | "forecast" | "insufficient-data",
  exact: ExactValue | null,
  display: string | null,
): CalculationResult {
  const uniqueReasons = [...new Set(reasons)];
  const available = uniqueReasons.length === 0 && exact !== null && display !== null;
  return {
    id,
    label,
    availability: available ? "available" : "insufficient-data",
    evidenceStatus: available ? evidenceStatus : "insufficient-data",
    exact: available ? exact : null,
    display: available ? display : null,
    unit,
    formula,
    dependencyFieldIds: dependencies,
    reasonCodes: uniqueReasons,
    source: "ruleset-derived",
  };
}

export function calculateDecision(input: DecisionInput): CalculationOutput {
  const parsedIncome = parseAmount(input.income, false);
  const parsedHours = parseWorkHours(input.workHours);
  const parsedFixed = parseAmount(input.fixedExpenses);
  const parsedPurchase = parseAmount(input.purchaseAmount, false);
  const taxReason: InputErrorCode[] = input.taxBasis === "" ? ["tax-basis-required"] : [];
  const coverageReason: InputErrorCode[] = input.fixedCostCoverage === "complete" ? [] : ["fixed-cost-coverage-required"];
  const purchasePeriodReason: InputErrorCode[] = input.purchaseIncluded === "included" ? [] : ["purchase-period-required"];
  const incomeReasons = inputReasons(parsedIncome, input.evidence.income);
  const hoursReasons = inputReasons(parsedHours, input.evidence.workHours);
  const fixedReasons = inputReasons(parsedFixed, input.evidence.fixedExpenses);
  const purchaseReasons = inputReasons(parsedPurchase, input.evidence.purchaseAmount);
  const inputErrors: Partial<Record<NumericField | "taxBasis" | "fixedCostCoverage" | "purchaseIncluded", InputErrorCode>> = {};
  if (incomeReasons[0]) inputErrors.income = incomeReasons[0];
  if (hoursReasons[0]) inputErrors.workHours = hoursReasons[0];
  if (fixedReasons[0]) inputErrors.fixedExpenses = fixedReasons[0];
  if (purchaseReasons[0]) inputErrors.purchaseAmount = purchaseReasons[0];
  if (taxReason[0]) inputErrors.taxBasis = taxReason[0];
  if (input.fixedCostCoverage === "") inputErrors.fixedCostCoverage = "fixed-cost-coverage-required";
  if (input.purchaseIncluded === "") inputErrors.purchaseIncluded = "purchase-period-required";

  const income = parsedIncome.ok ? parsedIncome.value : null;
  const hours = parsedHours.ok ? parsedHours.value : null;
  const fixed = parsedFixed.ok ? parsedFixed.value : null;
  const purchase = parsedPurchase.ok ? parsedPurchase.value : null;
  const rateReasons = [...incomeReasons, ...hoursReasons, ...taxReason];
  const rate = income && hours
    ? rational(income.cents * hours.denominator, 100n * hours.numerator)
    : null;
  const rateResult = result(
    "income-rate",
    "每小时收入",
    "CNY/小时",
    "月收入 ÷ 月工时",
    ["income", "workHours", "taxBasis"],
    rateReasons,
    statusFor(["income", "workHours"], input),
    rate ? ratioExact(rate) : null,
    rate ? `${formatRational(rate)} 元/小时` : null,
  );

  const workTimeReasons = [...incomeReasons, ...hoursReasons, ...purchaseReasons, ...taxReason];
  const workTime = income && hours && purchase
    ? rational(purchase.cents * hours.numerator, income.cents * hours.denominator)
    : null;
  const workTimeResult = result(
    "work-time-equivalent",
    "这笔钱相当于多少工作时间",
    "小时",
    "购买金额 ÷ 每小时收入",
    ["income", "workHours", "purchaseAmount", "taxBasis"],
    workTimeReasons,
    statusFor(["income", "workHours", "purchaseAmount"], input),
    workTime ? ratioExact(workTime) : null,
    workTime ? `${formatRational(workTime)} 小时` : null,
  );

  const marginReasons = [...incomeReasons, ...fixedReasons, ...taxReason, ...coverageReason];
  if (input.taxBasis === "before-tax") marginReasons.push("before-tax-margin-unavailable");
  const margin = income && fixed && input.taxBasis === "after-tax" ? income.cents - fixed.cents : null;
  const marginResult = result(
    "available-margin",
    "本月可用金额",
    "CNY",
    "税后月收入 − 月固定支出",
    ["income", "fixedExpenses", "taxBasis", "fixedCostCoverage"],
    marginReasons,
    statusFor(["income", "fixedExpenses"], input),
    margin !== null ? moneyExact(margin) : null,
    margin !== null ? `${moneyExact(margin).decimal} 元` : null,
  );

  const afterReasons = [...marginReasons, ...purchaseReasons, ...purchasePeriodReason];
  const after = income && fixed && purchase && input.taxBasis === "after-tax"
    ? income.cents - fixed.cents - purchase.cents
    : null;
  const afterResult = result(
    "purchase-after-margin",
    "买完后本月还剩",
    "CNY",
    "税后月收入 − 月固定支出 − 购买金额",
    ["income", "fixedExpenses", "purchaseAmount", "taxBasis", "fixedCostCoverage", "purchaseIncluded"],
    afterReasons,
    "forecast",
    after !== null ? moneyExact(after) : null,
    after !== null ? `${moneyExact(after).decimal} 元` : null,
  );

  const impact = purchase ? moneyExact(-purchase.cents) : null;
  const impactResult = result(
    "purchase-impact",
    "这笔购买减少的余量",
    "CNY",
    "买完后本月还剩 − 本月可用金额",
    ["income", "fixedExpenses", "purchaseAmount", "taxBasis", "fixedCostCoverage", "purchaseIncluded"],
    afterReasons,
    "forecast",
    after !== null && impact !== null ? impact : null,
    after !== null && impact !== null ? `${impact.decimal} 元` : null,
  );

  return {
    results: [rateResult, workTimeResult, marginResult, afterResult, impactResult],
    inputErrors,
  };
}
