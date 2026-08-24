import { currencyInfo, DEFAULT_CURRENCY_TABLE } from "./currency.js";
import {
  MAX_AMOUNT_INTEGER_DIGITS,
  MAX_AMOUNT_TOKEN_LENGTH,
  MAX_RAW_UTF16_CODE_UNITS,
  MAX_WORK_HOURS_FRACTION_DIGITS,
  MAX_WORK_HOURS_INTEGER_DIGITS,
  moneyFromMinorUnits,
  parseMoney,
  parseWorkHours,
} from "./decimal.js";
import {
  moneyDisplay,
  moneyExactValue,
  rateDisplay,
  rationalExactValue,
  workTimeDisplay,
} from "./display.js";
import {
  MAX_RATIONAL_DIGITS,
  normalizeRational,
  tenPower,
} from "./rational.js";
import type {
  CalculationContext,
  CalculationInputs,
  CalculationRequest,
  CalculationResult,
  CoverageStatus,
  CurrencyTable,
  EvidenceStatus,
  FormulaId,
  Money,
  PeriodRef,
  ReasonCode,
  Rational,
  TaxBasis,
  TimeContext,
} from "./types.js";
import {
  CURRENCY_TABLE_SNAPSHOT_ID,
  FORMULA_EXPRESSIONS,
  RESULT_ORDER,
  RULESET_ID,
  RULESET_REF,
  RULESET_VERSION,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

interface NormalizedField<T> {
  readonly fieldId: string;
  readonly value: T | null;
  readonly available: boolean;
  readonly status: EvidenceStatus | null;
  readonly periodRef: PeriodRef | null;
  readonly currencyCode: string | null;
  readonly taxBasis: TaxBasis | null;
  readonly reasons: readonly ReasonCode[];
  readonly assumptions: readonly string[];
}

interface ContextState {
  readonly periodRef: PeriodRef | null;
  readonly currencyCode: string | null;
  readonly currencyTableSnapshotId: string;
  readonly taxBasis: TaxBasis | null;
  readonly timeContext: TimeContext | null;
  readonly table: CurrencyTable;
  readonly commonReasons: readonly ReasonCode[];
  readonly periodMismatch: boolean;
  readonly currencyUnconfirmed: boolean;
  readonly taxUnconfirmed: boolean;
  readonly reconfirmationRequired: boolean;
}

const DEPENDENCIES: Record<FormulaId, readonly string[]> = {
  "income-rate": [
    "income",
    "work-hours",
    "comparison-period",
    "currency",
    "income-tax-basis",
  ],
  "work-time-equivalent": [
    "income",
    "work-hours",
    "purchase-price",
    "comparison-period",
    "currency",
    "income-tax-basis",
  ],
  "coverage-available-margin": [
    "income",
    "fixed-cost-total",
    "fixed-cost-coverage",
    "fixed-cost-coverage-description",
    "comparison-period",
    "currency",
    "income-tax-basis",
  ],
  "purchase-after-margin": [
    "income",
    "fixed-cost-total",
    "fixed-cost-coverage",
    "fixed-cost-coverage-description",
    "purchase-price",
    "purchase-period-inclusion",
    "comparison-period",
    "currency",
    "income-tax-basis",
  ],
  "purchase-impact": [
    "income",
    "fixed-cost-total",
    "fixed-cost-coverage",
    "fixed-cost-coverage-description",
    "purchase-price",
    "purchase-period-inclusion",
    "comparison-period",
    "currency",
    "income-tax-basis",
  ],
};

const REASON_PRIORITY: readonly ReasonCode[] = [
  "period-mismatch",
  "currency-mismatch",
  "comparison-period-unconfirmed",
  "currency-unconfirmed",
  "tax-basis-unconfirmed",
  "missing-income",
  "missing-work-hours",
  "missing-fixed-cost",
  "missing-purchase-price",
  "input-unconfirmed",
  "invalid-decimal",
  "zero-not-allowed",
  "negative-not-allowed",
  "fraction-exceeds-currency-minor-unit",
  "numeric-limit-exceeded",
  "unsupported-currency",
  "input-reconfirmation-required",
  "tax-basis-not-after-tax",
  "fixed-cost-coverage-incomplete",
  "fixed-cost-coverage-description-missing",
  "purchase-period-unconfirmed",
  "division-by-zero",
  "rule-execution-failed",
];

const REASON_ORDER = new Map<ReasonCode, number>(
  REASON_PRIORITY.map((reason, index) => [reason, index]),
);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function isUtcInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  try {
    // Parsing an explicit value is deterministic validation, not a clock read.
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isIanaTimeZoneId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) {
    return false;
  }
  const segments = value.split("/");
  if (
    segments.length < 2 ||
    segments.some((segment) => !/^[A-Za-z][A-Za-z0-9._+-]*$/.test(segment))
  ) {
    return false;
  }
  // The browser adapter performs platform IANA-database validation.  The
  // pure kernel intentionally validates only the stable wire shape and keeps
  // the UTC fallback as the one fixed Etc identifier.
  return true;
}

function isTimeContext(value: unknown): value is TimeContext {
  const record = asRecord(value);
  if (record === null) return false;
  const clockSource = record.clockSource;
  const timeZoneSource = record.timeZoneSource;
  const timeZoneConfirmation = record.timeZoneConfirmation;
  const utcOffset = record.utcOffset;
  return (
    isUtcInstant(record.occurredAtUtc) &&
    isUtcInstant(record.recordedAtUtc) &&
    clockSource === "device-clock" &&
    isIanaTimeZoneId(record.timeZoneId) &&
    typeof utcOffset === "string" &&
    /^(?:[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.test(utcOffset) &&
    (timeZoneSource === "browser-observed" ||
      timeZoneSource === "user-selected" ||
      timeZoneSource === "utc-fallback") &&
    (timeZoneConfirmation === "observed" ||
      timeZoneConfirmation === "user-confirmed" ||
      timeZoneConfirmation === "unconfirmed") &&
    (timeZoneSource !== "utc-fallback" ||
      (record.timeZoneId === "Etc/UTC" && timeZoneConfirmation === "unconfirmed"))
  );
}

function decimalDigitCount(value: bigint): number {
  const magnitude = value < 0n ? -value : value;
  return magnitude.toString().length;
}

function maxMoneyMinorUnits(minorUnit: 0 | 2 | 3 | 4): bigint {
  return tenPower(MAX_AMOUNT_INTEGER_DIGITS + minorUnit) - 1n;
}

function structuredMoneyWithinInputLimit(
  minorUnits: bigint,
  minorUnit: 0 | 2 | 3 | 4,
): boolean {
  return (
    decimalDigitCount(minorUnits) <= MAX_AMOUNT_INTEGER_DIGITS + minorUnit &&
    minorUnits <= maxMoneyMinorUnits(minorUnit)
  );
}

function structuredHoursWithinInputLimit(value: Rational): boolean {
  // 999999.999 is the largest accepted raw work-hours value.  Comparing
  // rationals directly keeps the boundary exact and avoids floating-point coercion.
  return (
    value.numerator * tenPower(MAX_WORK_HOURS_FRACTION_DIGITS) <=
      (tenPower(MAX_WORK_HOURS_INTEGER_DIGITS + MAX_WORK_HOURS_FRACTION_DIGITS) -
        1n) * value.denominator &&
    decimalDigitCount(value.numerator) <= MAX_RATIONAL_DIGITS &&
    decimalDigitCount(value.denominator) <= MAX_RATIONAL_DIGITS
  );
}

function readField(input: unknown): {
  readonly field: UnknownRecord | null;
  readonly value: unknown;
  readonly raw: unknown;
  readonly status: EvidenceStatus | "actual" | null;
  readonly availability: "available" | "not-provided";
  readonly periodRef: PeriodRef | null;
  readonly currencyCode: string | null;
  readonly taxBasis: TaxBasis | null;
  readonly assumptions: readonly string[];
} {
  if (input === null || input === undefined) {
    return {
      field: null,
      value: null,
      raw: null,
      status: null,
      availability: "not-provided",
      periodRef: null,
      currencyCode: null,
      taxBasis: null,
      assumptions: [],
    };
  }
  const record = asRecord(input);
  const isWrapper =
    record !== null &&
    (hasOwn(record, "value") ||
      hasOwn(record, "raw") ||
      hasOwn(record, "availability") ||
      hasOwn(record, "evidenceStatus"));
  const value = isWrapper && record !== null && hasOwn(record, "value")
    ? record.value
    : input;
  const status =
    isWrapper && record !== null &&
    (record.evidenceStatus === "user-confirmed" ||
      record.evidenceStatus === "estimated" ||
      record.evidenceStatus === "forecast" ||
      record.evidenceStatus === "insufficient-data" ||
      record.evidenceStatus === "actual")
      ? record.evidenceStatus
      : "user-confirmed";
  const availability =
    isWrapper && record !== null && record.availability === "not-provided"
      ? "not-provided"
      : "available";
  const valueRecord = asRecord(value);
  const periodRef = toPeriodRef(
    (isWrapper && record !== null ? record.periodRef : undefined) ??
      (valueRecord !== null ? valueRecord.period_ref : undefined) ??
      (valueRecord !== null ? valueRecord.periodRef : undefined),
  );
  const currencyCode =
    asCode(
      (isWrapper && record !== null ? record.currencyCode : undefined) ??
        (valueRecord !== null ? valueRecord.currency_code : undefined) ??
        (valueRecord !== null ? valueRecord.currencyCode : undefined),
    );
  const taxBasis = asTaxBasis(
    (isWrapper && record !== null ? record.taxBasis : undefined) ??
      (valueRecord !== null ? valueRecord.tax_basis : undefined) ??
      (valueRecord !== null ? valueRecord.taxBasis : undefined),
  );
  const assumptions =
    isWrapper && record !== null && Array.isArray(record.assumptions)
      ? record.assumptions.filter((item): item is string => typeof item === "string")
      : [];
  return {
    field: record,
    value,
    raw: isWrapper && record !== null && hasOwn(record, "raw") ? record.raw : value,
    status,
    availability,
    periodRef,
    currencyCode,
    taxBasis,
    assumptions,
  };
}

function asCode(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asTaxBasis(value: unknown): TaxBasis | null {
  return value === "before-tax" || value === "after-tax" ? value : null;
}

function toPeriodRef(value: unknown): PeriodRef | null {
  const record = asRecord(value);
  if (record === null) return null;
  const kindValue = record.kind ?? record.period_kind;
  if (
    kindValue !== "week" &&
    kindValue !== "month" &&
    kindValue !== "year" &&
    kindValue !== "custom"
  ) {
    return null;
  }
  const customLabel = record.customLabel ?? record.custom_label;
  const revision = record.revision;
  if (
    (customLabel !== null && customLabel !== undefined && typeof customLabel !== "string") ||
    typeof revision !== "string"
  ) {
    return null;
  }
  return {
    kind: kindValue,
    customLabel: customLabel === undefined ? null : customLabel,
    revision,
  };
}

function samePeriod(left: PeriodRef | null, right: PeriodRef | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.kind === right.kind &&
    left.customLabel === right.customLabel &&
    left.revision === right.revision
  );
}

function sortReasons(reasons: readonly ReasonCode[]): ReasonCode[] {
  const unique = [...new Set(reasons)];
  return unique.sort((left, right) => {
    const leftRank = REASON_ORDER.get(left) ?? REASON_PRIORITY.length;
    const rightRank = REASON_ORDER.get(right) ?? REASON_PRIORITY.length;
    return leftRank - rightRank;
  });
}

function statusFor(fields: readonly NormalizedField<unknown>[]): EvidenceStatus {
  if (fields.some((field) => !field.available || field.status === null)) {
    return "insufficient-data";
  }
  if (fields.some((field) => field.status === "estimated")) return "estimated";
  return "user-confirmed";
}

function estimatedFieldIds(fields: readonly NormalizedField<unknown>[]): string[] {
  return fields
    .filter((field) => field.available && field.status === "estimated")
    .map((field) => field.fieldId);
}

function normalizeStatus(
  status: EvidenceStatus | "actual" | null,
): { readonly status: EvidenceStatus | null; readonly reason: ReasonCode | null } {
  if (status === "user-confirmed" || status === "estimated") {
    return { status, reason: null };
  }
  if (status === "actual" || status === "forecast" || status === "insufficient-data") {
    return { status: null, reason: "input-unconfirmed" };
  }
  return { status: null, reason: "input-unconfirmed" };
}

function normalizeBasic<T>(
  fieldId: string,
  input: unknown,
  missingReason: ReasonCode,
  parse: (
    raw: unknown,
    source: ReturnType<typeof readField>,
  ) => { readonly value: T | null; readonly reason: ReasonCode | null },
): NormalizedField<T> {
  const raw = readField(input);
  if (raw.availability === "not-provided") {
    return {
      fieldId,
      value: null,
      available: false,
      status: null,
      periodRef: raw.periodRef,
      currencyCode: raw.currencyCode,
      taxBasis: raw.taxBasis,
      reasons: [missingReason],
      assumptions: [],
    };
  }
  const normalizedStatus = normalizeStatus(raw.status);
  if (raw.raw === null || raw.raw === undefined) {
    if (raw.value === null || raw.value === undefined) {
      return {
        fieldId,
        value: null,
        available: false,
        status: null,
        periodRef: raw.periodRef,
        currencyCode: raw.currencyCode,
        taxBasis: raw.taxBasis,
        reasons: [missingReason],
        assumptions: raw.assumptions,
      };
    }
  }
  const parsed = parse(
    raw.raw === null || raw.raw === undefined ? raw.value : raw.raw,
    raw,
  );
  const reasons: ReasonCode[] = [];
  if (normalizedStatus.reason !== null) reasons.push(normalizedStatus.reason);
  if (parsed.reason !== null) reasons.push(parsed.reason);
  if (reasons.length > 0 || parsed.value === null) {
    return {
      fieldId,
      value: null,
      available: false,
      status: null,
      periodRef: raw.periodRef,
      currencyCode: raw.currencyCode,
      taxBasis: raw.taxBasis,
      reasons: reasons.length > 0 ? reasons : [missingReason],
      assumptions: raw.assumptions,
    };
  }
  return {
    fieldId,
    value: parsed.value,
    available: true,
    status: normalizedStatus.status,
    periodRef: raw.periodRef,
    currencyCode: raw.currencyCode,
    taxBasis: raw.taxBasis,
    reasons: [],
    assumptions: raw.assumptions,
  };
}

function parsePeriod(raw: unknown, fallback: PeriodRef | null): PeriodRef | null {
  const parsed = toPeriodRef(raw);
  if (parsed !== null) return parsed;
  if (typeof raw === "string" && fallback !== null && raw === fallback.kind) return fallback;
  return null;
}

function parseCurrencyCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim();
}

function parseTaxBasis(raw: unknown): TaxBasis | null {
  if (raw === "before-tax" || raw === "after-tax") return raw;
  const record = asRecord(raw);
  if (record !== null) {
    const code = record.code ?? record.tax_basis ?? record.taxBasis;
    return asTaxBasis(code);
  }
  return null;
}

function parseCoverage(raw: unknown): CoverageStatus | null {
  if (raw === "complete" || raw === "partial" || raw === "unknown") return raw;
  const record = asRecord(raw);
  const code = record?.code ?? record?.coverage;
  return code === "complete" || code === "partial" || code === "unknown" ? code : null;
}

function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (raw === "included") return true;
  if (raw === "excluded") return false;
  const record = asRecord(raw);
  if (record !== null && typeof record.value === "boolean") return record.value;
  return null;
}

function parseText(raw: unknown): string | null {
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  const record = asRecord(raw);
  if (record !== null && typeof record.text === "string") {
    return record.text.length > 0 ? record.text : null;
  }
  return null;
}

interface StructuredMoneyParse {
  readonly present: boolean;
  readonly value: Money | null;
  readonly reason: ReasonCode | null;
}

function parseStructuredMoney(
  record: UnknownRecord,
  contextCurrency: string | null,
  table: CurrencyTable,
): StructuredMoneyParse {
  const hasMinorMarker =
    record.kind === "money" ||
    hasOwn(record, "minorUnits") ||
    hasOwn(record, "minor_units") ||
    hasOwn(record, "minorUnit") ||
    hasOwn(record, "minor_unit");
  if (!hasMinorMarker) return { present: false, value: null, reason: null };

  const currencyValue = record.currency_code ?? record.currencyCode ?? contextCurrency;
  const declaredMinorUnit = record.minor_unit ?? record.minorUnit;
  const inferredCurrency =
    typeof currencyValue === "string" ? currencyInfo(currencyValue, table) : null;
  const minorUnitValue =
    declaredMinorUnit === undefined && inferredCurrency?.ok === true
      ? inferredCurrency.value.minorUnit
      : declaredMinorUnit;
  if (
    typeof currencyValue !== "string" ||
    (minorUnitValue !== 0 && minorUnitValue !== 2 && minorUnitValue !== 3 && minorUnitValue !== 4)
  ) {
    return { present: true, value: null, reason: "rule-execution-failed" };
  }
  const amountValue = hasOwn(record, "minor_units")
    ? record.minor_units
    : record.minorUnits;
  let minorUnits: bigint;
  if (typeof amountValue === "bigint") {
    minorUnits = amountValue;
  } else if (typeof amountValue === "string") {
    if (amountValue.length > MAX_RAW_UTF16_CODE_UNITS || amountValue.length > MAX_AMOUNT_TOKEN_LENGTH) {
      return { present: true, value: null, reason: "numeric-limit-exceeded" };
    }
    if (amountValue.startsWith("-")) {
      return { present: true, value: null, reason: "negative-not-allowed" };
    }
    if (amountValue.startsWith("+")) {
      return { present: true, value: null, reason: "rule-execution-failed" };
    }
    if (!/^[0-9]+$/.test(amountValue)) {
      return { present: true, value: null, reason: "rule-execution-failed" };
    }
    try {
      minorUnits = BigInt(amountValue);
    } catch {
      return { present: true, value: null, reason: "rule-execution-failed" };
    }
  } else {
    return { present: true, value: null, reason: "rule-execution-failed" };
  }
  if (!structuredMoneyWithinInputLimit(minorUnits, minorUnitValue)) {
    return { present: true, value: null, reason: "numeric-limit-exceeded" };
  }
  const parsed = moneyFromMinorUnits(minorUnits, currencyValue, minorUnitValue, table);
  if (!parsed.ok) return { present: true, value: null, reason: parsed.reasonCode };
  return { present: true, value: parsed.value, reason: null };
}

function parseMoneyInput(
  raw: unknown,
  contextCurrency: string | null,
  table: CurrencyTable,
  source?: ReturnType<typeof readField>,
): { readonly value: Money | null; readonly reason: ReasonCode | null } {
  const sourceValue =
    source?.field !== null && source?.field !== undefined && hasOwn(source.field, "value")
      ? source.field.value
      : undefined;
  const structuredRecord =
    asRecord(sourceValue) ?? asRecord(raw) ?? asRecord(source?.field);
  if (structuredRecord !== null) {
    const structured = parseStructuredMoney(structuredRecord, contextCurrency, table);
    if (structured.present) {
      if (typeof raw !== "string") {
        return { value: structured.value, reason: structured.reason };
      }
      if (structured.reason !== null) {
        return { value: null, reason: structured.reason };
      }
      // A supplied raw token remains the authoritative input; validating the
      // structured mirror above prevents it from bypassing input limits.
    }
  }
  if (contextCurrency === null) {
    return { value: null, reason: "currency-unconfirmed" };
  }
  const parsed = parseMoney(raw, contextCurrency, table);
  return parsed.ok
    ? { value: parsed.value, reason: null }
    : { value: null, reason: parsed.reasonCode };
}

function parseWorkHoursInput(
  raw: unknown,
  source?: ReturnType<typeof readField>,
): {
  readonly value: Rational | null;
  readonly reason: ReasonCode | null;
} {
  const sourceValue =
    source?.field !== null && source?.field !== undefined && hasOwn(source.field, "value")
      ? source.field.value
      : undefined;
  const record = asRecord(sourceValue) ?? asRecord(raw) ?? asRecord(source?.field);
  if (
    record !== null &&
    (record.kind === "rational" || hasOwn(record, "numerator") || hasOwn(record, "denominator"))
  ) {
    if (!hasOwn(record, "numerator") || !hasOwn(record, "denominator")) {
      return { value: null, reason: "rule-execution-failed" };
    }
    const numerator = record.numerator;
    const denominator = record.denominator;
    let n: bigint;
    let d: bigint;
    if (typeof numerator === "bigint") {
      n = numerator;
    } else if (typeof numerator === "string") {
      if (numerator.length > MAX_RAW_UTF16_CODE_UNITS || !/^-?[0-9]+$/.test(numerator)) {
        return { value: null, reason: "rule-execution-failed" };
      }
      try {
        n = BigInt(numerator);
      } catch {
        return { value: null, reason: "rule-execution-failed" };
      }
    } else {
      return { value: null, reason: "rule-execution-failed" };
    }
    if (typeof denominator === "bigint") {
      d = denominator;
    } else if (typeof denominator === "string") {
      if (denominator.length > MAX_RAW_UTF16_CODE_UNITS || !/^[0-9]+$/.test(denominator)) {
        return { value: null, reason: "rule-execution-failed" };
      }
      try {
        d = BigInt(denominator);
      } catch {
        return { value: null, reason: "rule-execution-failed" };
      }
    } else {
      return { value: null, reason: "rule-execution-failed" };
    }
    const normalized = normalizeRational(n, d);
    if (!normalized.ok) return { value: null, reason: normalized.reasonCode };
    if (normalized.value.numerator <= 0n) {
      return {
        value: null,
        reason: normalized.value.numerator === 0n
          ? "zero-not-allowed"
          : "negative-not-allowed",
      };
    }
    if (!structuredHoursWithinInputLimit(normalized.value)) {
      return { value: null, reason: "numeric-limit-exceeded" };
    }
    if (typeof raw !== "string") {
      return { value: normalized.value, reason: null };
    }
    // A supplied raw token remains authoritative; the structured mirror was
    // nevertheless validated above so it cannot smuggle an oversized value.
  }
  const parsed = parseWorkHours(raw);
  return parsed.ok
    ? { value: parsed.value, reason: null }
    : { value: null, reason: parsed.reasonCode };
}

function normalizePeriodField(
  input: unknown,
  contextPeriod: PeriodRef | null,
): NormalizedField<PeriodRef> {
  return normalizeBasic("comparison-period", input, "comparison-period-unconfirmed", (raw) => {
    const value = parsePeriod(raw, contextPeriod);
    return value === null
      ? { value: null, reason: "comparison-period-unconfirmed" }
      : { value, reason: null };
  });
}

function normalizeCurrencyField(
  input: unknown,
  table: CurrencyTable = DEFAULT_CURRENCY_TABLE,
): NormalizedField<string> {
  return normalizeBasic("currency", input, "currency-unconfirmed", (raw) => {
    const value = parseCurrencyCode(raw);
    if (value === null || value.length === 0) {
      return { value: null, reason: "currency-unconfirmed" };
    }
    const currency = currencyInfo(value, table);
    return currency.ok
      ? { value: currency.value.code, reason: null }
      : { value: null, reason: currency.reasonCode };
  });
}

function normalizeTaxField(input: unknown): NormalizedField<TaxBasis> {
  return normalizeBasic("income-tax-basis", input, "tax-basis-unconfirmed", (raw) => {
    const value = parseTaxBasis(raw);
    return value === null
      ? { value: null, reason: "tax-basis-unconfirmed" }
      : { value, reason: null };
  });
}

function normalizeMoneyField(
  fieldId: string,
  input: unknown,
  missingReason: ReasonCode,
  contextCurrency: string | null,
  table: CurrencyTable,
): NormalizedField<Money> {
  return normalizeBasic(fieldId, input, missingReason, (raw, source) =>
    parseMoneyInput(raw, contextCurrency, table, source),
  );
}

function normalizeWorkField(input: unknown): NormalizedField<Rational> {
  return normalizeBasic("work-hours", input, "missing-work-hours", parseWorkHoursInput);
}

function normalizeCoverageField(input: unknown): NormalizedField<CoverageStatus> {
  return normalizeBasic("fixed-cost-coverage", input, "fixed-cost-coverage-incomplete", (raw) => {
    const value = parseCoverage(raw);
    return value === null
      ? { value: null, reason: "fixed-cost-coverage-incomplete" }
      : { value, reason: null };
  });
}

function normalizePurchasePeriodField(input: unknown): NormalizedField<boolean> {
  const normalized = normalizeBasic("purchase-period-inclusion", input, "purchase-period-unconfirmed", (raw) => {
    const value = parseBoolean(raw);
    return value === null
      ? { value: null, reason: "purchase-period-unconfirmed" }
      : { value, reason: null };
  });
  if (!normalized.available || normalized.value === null) return normalized;
  if (normalized.status !== "user-confirmed") {
    return {
      ...normalized,
      value: null,
      available: false,
      status: null,
      reasons: ["purchase-period-unconfirmed"],
    };
  }
  return normalized;
}

function normalizeDescriptionField(input: unknown): NormalizedField<string> {
  return normalizeBasic(
    "fixed-cost-coverage-description",
    input,
    "fixed-cost-coverage-description-missing",
    (raw) => {
      const value = parseText(raw);
      return value === null
        ? { value: null, reason: "fixed-cost-coverage-description-missing" }
        : { value, reason: null };
    },
  );
}

function resolveInput(inputs: CalculationInputs, camel: string, dashed: string): unknown {
  if (hasOwn(inputs as UnknownRecord, camel)) return inputs[camel];
  if (hasOwn(inputs as UnknownRecord, dashed)) return inputs[dashed];
  const underscored = dashed.replaceAll("-", "_");
  return inputs[underscored];
}

function contextState(context: CalculationContext, inputs: CalculationInputs): ContextState {
  const table = context.currencyTable ?? DEFAULT_CURRENCY_TABLE;
  const periodRef = context.periodRef ?? null;
  const currencyCode = context.currencyCode ?? null;
  const taxBasis = context.taxBasis ?? null;
  const contextCurrency = currencyCode === null
    ? { ok: false as const, reasonCode: "currency-unconfirmed" as const }
    : currencyInfo(currencyCode, table);
  const periodField = normalizePeriodField(
    resolveInput(inputs, "comparisonPeriod", "comparison-period"),
    periodRef,
  );
  const currencyField = normalizeCurrencyField(
    resolveInput(inputs, "currency", "currency"),
    table,
  );
  const taxField = normalizeTaxField(
    resolveInput(inputs, "incomeTaxBasis", "income-tax-basis"),
  );
  const commonReasons: ReasonCode[] = [];
  const customCurrencyTable =
    context.currencyTable !== undefined && context.currencyTable !== DEFAULT_CURRENCY_TABLE;
  if (periodRef === null) commonReasons.push("comparison-period-unconfirmed");
  if (currencyCode === null) {
    commonReasons.push("currency-unconfirmed");
  } else if (!contextCurrency.ok) {
    commonReasons.push(contextCurrency.reasonCode);
  }
  if (taxBasis === null) commonReasons.push("tax-basis-unconfirmed");
  if (
    periodField.available &&
    periodRef !== null &&
    periodField.value !== null &&
    !samePeriod(periodField.value, periodRef)
  ) {
    commonReasons.push("period-mismatch");
  }
  if (
    currencyField.available &&
    currencyCode !== null &&
    currencyField.value !== null &&
    currencyField.value !== currencyCode
  ) {
    commonReasons.push("currency-mismatch", "input-reconfirmation-required");
  }
  if (
    taxField.available &&
    taxBasis !== null &&
    taxField.value !== null &&
    taxField.value !== taxBasis
  ) {
    commonReasons.push("tax-basis-unconfirmed", "input-reconfirmation-required");
  }
  const revisionValues = [
    periodField.periodRef,
    // Period references carried by the values are checked in calculateResults.
  ];
  const periodMismatch = revisionValues.some(
    (value) => value !== null && periodRef !== null && !samePeriod(value, periodRef),
  );
  if (periodMismatch) commonReasons.push("period-mismatch");
  const timeContext = context.timeContext ?? null;
  if (!isTimeContext(timeContext) || customCurrencyTable) {
    // There is no dedicated public reason for a malformed build/session
    // envelope.  Keep the failure non-sensitive and fail closed rather than
    // claiming a fixed snapshot or generating a result without timestamps.
    commonReasons.push("rule-execution-failed");
  }
  const versionMismatch =
    context.rulesetId !== RULESET_ID ||
    context.rulesetVersion !== RULESET_VERSION ||
    context.currencyTableSnapshotId !== CURRENCY_TABLE_SNAPSHOT_ID;
  if (versionMismatch) commonReasons.push("rule-execution-failed");
  return {
    periodRef,
    currencyCode,
    currencyTableSnapshotId: context.currencyTableSnapshotId ?? CURRENCY_TABLE_SNAPSHOT_ID,
    taxBasis,
    timeContext,
    table,
    commonReasons: sortReasons(commonReasons),
    periodMismatch: commonReasons.includes("period-mismatch"),
    currencyUnconfirmed: currencyCode === null,
    taxUnconfirmed: commonReasons.includes("tax-basis-unconfirmed"),
    reconfirmationRequired: commonReasons.includes("input-reconfirmation-required"),
  };
}

function contextReasonsFor(
  state: ContextState,
  fields: readonly NormalizedField<unknown>[],
): ReasonCode[] {
  const reasons: ReasonCode[] = [...state.commonReasons];
  if (state.periodMismatch) reasons.push("period-mismatch");
  if (state.currencyUnconfirmed) reasons.push("currency-unconfirmed");
  if (state.taxUnconfirmed) reasons.push("tax-basis-unconfirmed");
  if (state.reconfirmationRequired) reasons.push("input-reconfirmation-required");
  const fixedCostAvailable = fields.some(
    (field) => field.fieldId === "fixed-cost-total" && field.available,
  );
  const coverageAvailable = fields.some(
    (field) => field.fieldId === "fixed-cost-coverage" && field.available,
  );
  for (const field of fields) {
    const periodRequired =
      field.fieldId === "income" ||
      field.fieldId === "work-hours" ||
      field.fieldId === "fixed-cost-total" ||
      field.fieldId === "purchase-period-inclusion";
    if (periodRequired && field.available && state.periodRef !== null && field.periodRef === null) {
      reasons.push(
        field.fieldId === "purchase-period-inclusion"
          ? "purchase-period-unconfirmed"
          : "period-mismatch",
      );
    } else if (
      field.periodRef !== null &&
      state.periodRef !== null &&
      !samePeriod(field.periodRef, state.periodRef)
    ) {
      reasons.push("period-mismatch");
    }
    if (
      field.currencyCode !== null &&
      state.currencyCode !== null &&
      field.currencyCode !== state.currencyCode
    ) {
      reasons.push("currency-mismatch", "input-reconfirmation-required");
    }
    if (
      field.taxBasis !== null &&
      state.taxBasis !== null &&
      field.taxBasis !== state.taxBasis
    ) {
      reasons.push("tax-basis-unconfirmed", "input-reconfirmation-required");
    }
    for (const reason of field.reasons) {
      if (
        !fixedCostAvailable &&
        (reason === "fixed-cost-coverage-incomplete" ||
          reason === "fixed-cost-coverage-description-missing")
      ) {
        continue;
      }
      if (!coverageAvailable && reason === "fixed-cost-coverage-description-missing") {
        continue;
      }
      reasons.push(reason);
    }
  }
  return reasons;
}

function baseResult(
  formulaId: FormulaId,
  state: ContextState,
  exact: CalculationResult["exact"],
  display: CalculationResult["display"],
  unit: string,
  currencyCode: string | null,
  fields: readonly NormalizedField<unknown>[],
  reasons: readonly ReasonCode[],
  assumptions: readonly NormalizedField<unknown>[] = [],
  limitations: readonly string[] = [],
): CalculationResult {
  const normalizedReasons = sortReasons(reasons);
  const unavailable = normalizedReasons.length > 0 || exact === null || display === null;
  const status = unavailable ? "insufficient-data" : statusFor(fields);
  return {
    formulaId,
    source: "ruleset-derived",
    formulaExpression: FORMULA_EXPRESSIONS[formulaId],
    availability: unavailable ? "unavailable" : "available",
    exact: unavailable ? null : exact,
    display: unavailable ? null : display,
    unit,
    currencyCode,
    periodRef: state.periodRef,
    taxBasis: state.taxUnconfirmed ? null : state.taxBasis,
    evidenceStatus: status,
    primaryReasonCode: normalizedReasons[0] ?? null,
    reasonCodes: normalizedReasons,
    dependencyFieldIds: DEPENDENCIES[formulaId],
    estimatedDependencyFieldIds: estimatedFieldIds(fields),
    assumptions: [...new Set(assumptions.flatMap((field) => field.assumptions))],
    limitations,
    timeContext: state.timeContext,
    rounding: {
      mode: "half-away-from-zero",
      displayDigits: display?.displayDigits ?? null,
      rounded: display?.rounded ?? false,
    },
    rulesetId: RULESET_ID,
    rulesetVersion: RULESET_VERSION,
    rulesetRef: RULESET_REF,
    currencyTableSnapshotId: state.currencyTableSnapshotId,
  };
}

function unavailableResult(
  formulaId: FormulaId,
  state: ContextState,
  unit: string,
  currencyCode: string | null,
  fields: readonly NormalizedField<unknown>[],
  reasons: readonly ReasonCode[],
  assumptions: readonly NormalizedField<unknown>[] = [],
  limitations: readonly string[] = [],
): CalculationResult {
  return baseResult(
    formulaId,
    state,
    null,
    null,
    unit,
    currencyCode,
    fields,
    reasons,
    assumptions,
    limitations,
  );
}

function catchResult(
  formulaId: FormulaId,
  state: ContextState,
  unit: string,
  currencyCode: string | null,
  fields: readonly NormalizedField<unknown>[],
): CalculationResult {
  return unavailableResult(formulaId, state, unit, currencyCode, fields, ["rule-execution-failed"]);
}

function failedContextState(context: unknown): ContextState {
  const record = asRecord(context);
  const suppliedSnapshot = record?.currencyTableSnapshotId;
  return {
    periodRef: null,
    currencyCode: null,
    currencyTableSnapshotId:
      typeof suppliedSnapshot === "string" ? suppliedSnapshot : CURRENCY_TABLE_SNAPSHOT_ID,
    taxBasis: null,
    timeContext: null,
    table: DEFAULT_CURRENCY_TABLE,
    commonReasons: ["rule-execution-failed"],
    periodMismatch: false,
    currencyUnconfirmed: false,
    taxUnconfirmed: false,
    reconfirmationRequired: false,
  };
}

function financialInputs(
  context: ContextState,
  inputs: CalculationInputs,
): {
  readonly comparisonPeriod: NormalizedField<PeriodRef>;
  readonly currency: NormalizedField<string>;
  readonly income: NormalizedField<Money>;
  readonly taxBasis: NormalizedField<TaxBasis>;
  readonly workHours: NormalizedField<Rational>;
  readonly purchasePrice: NormalizedField<Money>;
  readonly purchasePeriod: NormalizedField<boolean>;
  readonly fixedCost: NormalizedField<Money>;
  readonly coverage: NormalizedField<CoverageStatus>;
  readonly coverageDescription: NormalizedField<string>;
} {
  const comparisonPeriod = normalizePeriodField(
    resolveInput(inputs, "comparisonPeriod", "comparison-period"),
    context.periodRef,
  );
  const currency = normalizeCurrencyField(
    resolveInput(inputs, "currency", "currency"),
    context.table,
  );
  const income = normalizeMoneyField(
    "income",
    resolveInput(inputs, "income", "income"),
    "missing-income",
    context.currencyCode,
    context.table,
  );
  const taxBasis = normalizeTaxField(
    resolveInput(inputs, "incomeTaxBasis", "income-tax-basis"),
  );
  const workHours = normalizeWorkField(
    resolveInput(inputs, "workHours", "work-hours"),
  );
  const purchasePrice = normalizeMoneyField(
    "purchase-price",
    resolveInput(inputs, "purchasePrice", "purchase-price"),
    "missing-purchase-price",
    context.currencyCode,
    context.table,
  );
  const purchasePeriod = normalizePurchasePeriodField(
    resolveInput(inputs, "purchasePeriodInclusion", "purchase-period-inclusion"),
  );
  const fixedCost = normalizeMoneyField(
    "fixed-cost-total",
    resolveInput(inputs, "fixedCostTotal", "fixed-cost-total"),
    "missing-fixed-cost",
    context.currencyCode,
    context.table,
  );
  const coverage = normalizeCoverageField(
    resolveInput(inputs, "fixedCostCoverage", "fixed-cost-coverage"),
  );
  const coverageDescription = normalizeDescriptionField(
    resolveInput(inputs, "fixedCostCoverageDescription", "fixed-cost-coverage-description"),
  );
  return {
    comparisonPeriod,
    currency,
    income,
    taxBasis,
    workHours,
    purchasePrice,
    purchasePeriod,
    fixedCost,
    coverage,
    coverageDescription,
  };
}

function allRelevantFields(
  data: ReturnType<typeof financialInputs>,
  ids: readonly string[],
): NormalizedField<unknown>[] {
  const map: Record<string, NormalizedField<unknown>> = {
    "comparison-period": data.comparisonPeriod as NormalizedField<unknown>,
    currency: data.currency as NormalizedField<unknown>,
    income: data.income as NormalizedField<unknown>,
    "income-tax-basis": data.taxBasis as NormalizedField<unknown>,
    "work-hours": data.workHours as NormalizedField<unknown>,
    "purchase-price": data.purchasePrice as NormalizedField<unknown>,
    "purchase-period-inclusion": data.purchasePeriod as NormalizedField<unknown>,
    "fixed-cost-total": data.fixedCost as NormalizedField<unknown>,
    "fixed-cost-coverage": data.coverage as NormalizedField<unknown>,
    "fixed-cost-coverage-description": data.coverageDescription as NormalizedField<unknown>,
  };
  return ids.map((id) => map[id]).filter((field): field is NormalizedField<unknown> => field !== undefined);
}

function appendContextReasons(
  state: ContextState,
  fields: readonly NormalizedField<unknown>[],
): ReasonCode[] {
  return contextReasonsFor(state, fields);
}

function calculateIncomeRate(
  state: ContextState,
  data: ReturnType<typeof financialInputs>,
): CalculationResult {
  const fields = allRelevantFields(data, DEPENDENCIES["income-rate"]);
  const reasons = appendContextReasons(state, fields);
  if (
    data.income.currencyCode !== null &&
    state.currencyCode !== null &&
    data.income.currencyCode !== state.currencyCode
  ) reasons.push("currency-mismatch", "input-reconfirmation-required");
  if (data.workHours.periodRef !== null && state.periodRef !== null && !samePeriod(data.workHours.periodRef, state.periodRef)) {
    reasons.push("period-mismatch");
  }
  if (reasons.length > 0 || data.income.value === null || data.workHours.value === null) {
    return unavailableResult("income-rate", state, `${state.currencyCode ?? "currency"}/小时`, state.currencyCode, fields, reasons);
  }
  try {
    const denominator = tenPower(data.income.value.minorUnit) * data.workHours.value.numerator;
    const fraction = normalizeRational(
      data.income.value.minorUnits * data.workHours.value.denominator,
      denominator,
    );
    if (!fraction.ok) return unavailableResult("income-rate", state, `${state.currencyCode ?? "currency"}/小时`, state.currencyCode, fields, [fraction.reasonCode]);
    return baseResult(
      "income-rate",
      state,
      rationalExactValue(fraction.value, state.currencyCode, `${state.currencyCode ?? "currency"}/小时`),
      rateDisplay(fraction.value, state.currencyCode ?? "currency", data.income.value.minorUnit),
      `${state.currencyCode ?? "currency"}/小时`,
      state.currencyCode,
      fields,
      [],
      fields,
    );
  } catch {
    return catchResult("income-rate", state, `${state.currencyCode ?? "currency"}/小时`, state.currencyCode, fields);
  }
}

function calculateWorkTimeEquivalent(
  state: ContextState,
  data: ReturnType<typeof financialInputs>,
): CalculationResult {
  const fields = allRelevantFields(data, DEPENDENCIES["work-time-equivalent"]);
  const reasons = appendContextReasons(state, fields);
  if (
    data.income.currencyCode !== null &&
    state.currencyCode !== null &&
    data.income.currencyCode !== state.currencyCode
  ) reasons.push("currency-mismatch", "input-reconfirmation-required");
  if (
    data.purchasePrice.currencyCode !== null &&
    state.currencyCode !== null &&
    data.purchasePrice.currencyCode !== state.currencyCode
  ) reasons.push("currency-mismatch", "input-reconfirmation-required");
  if (reasons.length > 0 || data.income.value === null || data.workHours.value === null || data.purchasePrice.value === null) {
    return unavailableResult("work-time-equivalent", state, "小时", null, fields, reasons);
  }
  try {
    const fraction = normalizeRational(
      data.purchasePrice.value.minorUnits * data.workHours.value.numerator,
      data.income.value.minorUnits * data.workHours.value.denominator,
    );
    if (!fraction.ok) return unavailableResult("work-time-equivalent", state, "小时", null, fields, [fraction.reasonCode]);
    return baseResult(
      "work-time-equivalent",
      state,
      rationalExactValue(fraction.value, null, "小时"),
      workTimeDisplay(fraction.value),
      "小时",
      null,
      fields,
      [],
      fields,
      ["这是工作时间比较，不代表体验本身的价值。"],
    );
  } catch {
    return catchResult("work-time-equivalent", state, "小时", null, fields);
  }
}

function calculateCoverage(
  state: ContextState,
  data: ReturnType<typeof financialInputs>,
): CalculationResult {
  const fields = allRelevantFields(data, DEPENDENCIES["coverage-available-margin"]);
  const reasons = appendContextReasons(state, fields);
  if (
    data.income.currencyCode !== null &&
    state.currencyCode !== null &&
    data.income.currencyCode !== state.currencyCode
  ) reasons.push("currency-mismatch");
  if (
    data.fixedCost.currencyCode !== null &&
    state.currencyCode !== null &&
    data.fixedCost.currencyCode !== state.currencyCode
  ) reasons.push("currency-mismatch");
  if (state.taxBasis === "before-tax") reasons.push("tax-basis-not-after-tax");
  if (data.coverage.available && data.coverage.value !== "complete") {
    reasons.push("fixed-cost-coverage-incomplete");
  }
  if (
    data.coverage.available &&
    data.coverage.value === "complete" &&
    !data.coverageDescription.available
  ) {
    reasons.push("fixed-cost-coverage-description-missing");
  }
  if (reasons.length > 0 || data.income.value === null || data.fixedCost.value === null) {
    return unavailableResult("coverage-available-margin", state, state.currencyCode ?? "currency", state.currencyCode, fields, reasons);
  }
  try {
    const value = data.income.value.minorUnits - data.fixedCost.value.minorUnits;
    return baseResult(
      "coverage-available-margin",
      state,
      moneyExactValue(value, data.income.value.currencyCode, data.income.value.minorUnit),
      moneyDisplay(value, data.income.value.currencyCode, data.income.value.minorUnit, true),
      data.income.value.currencyCode,
      data.income.value.currencyCode,
      fields,
      [],
      fields,
    );
  } catch {
    return catchResult("coverage-available-margin", state, state.currencyCode ?? "currency", state.currencyCode, fields);
  }
}

function calculatePurchaseAfter(
  state: ContextState,
  data: ReturnType<typeof financialInputs>,
  coverage: CalculationResult,
): CalculationResult {
  const fields = allRelevantFields(data, DEPENDENCIES["purchase-after-margin"]);
  const reasons = appendContextReasons(state, fields);
  if (coverage.availability !== "available" || data.fixedCost.value === null || data.income.value === null) {
    reasons.push(...coverage.reasonCodes);
  }
  if (
    data.purchasePrice.currencyCode !== null &&
    state.currencyCode !== null &&
    data.purchasePrice.currencyCode !== state.currencyCode
  ) reasons.push("currency-mismatch", "input-reconfirmation-required");
  if (data.purchasePeriod.value !== true) reasons.push("purchase-period-unconfirmed");
  const income = data.income.value;
  const fixedCost = data.fixedCost.value;
  const purchasePrice = data.purchasePrice.value;
  if (reasons.length > 0 || purchasePrice === null || coverage.exact === null || income === null || fixedCost === null) {
    return unavailableResult("purchase-after-margin", state, state.currencyCode ?? "currency", state.currencyCode, fields, reasons);
  }
  try {
    const value = income.minorUnits - fixedCost.minorUnits - purchasePrice.minorUnits;
    const result = baseResult(
      "purchase-after-margin",
      state,
      moneyExactValue(value, income.currencyCode, income.minorUnit),
      moneyDisplay(value, income.currencyCode, income.minorUnit, true),
      income.currencyCode,
      income.currencyCode,
      fields,
      [],
      fields,
    );
    return result.availability === "available"
      ? { ...result, evidenceStatus: "forecast" }
      : result;
  } catch {
    return catchResult("purchase-after-margin", state, state.currencyCode ?? "currency", state.currencyCode, fields);
  }
}

function calculatePurchaseImpact(
  state: ContextState,
  data: ReturnType<typeof financialInputs>,
  coverage: CalculationResult,
  purchaseAfter: CalculationResult,
): CalculationResult {
  const fields = allRelevantFields(data, DEPENDENCIES["purchase-impact"]);
  const reasons = appendContextReasons(state, fields);
  if (coverage.availability !== "available") reasons.push(...coverage.reasonCodes);
  if (purchaseAfter.availability !== "available") reasons.push(...purchaseAfter.reasonCodes);
  if (
    data.purchasePrice.currencyCode !== null &&
    state.currencyCode !== null &&
    data.purchasePrice.currencyCode !== state.currencyCode
  ) reasons.push("currency-mismatch", "input-reconfirmation-required");
  if (data.purchasePeriod.value !== true) reasons.push("purchase-period-unconfirmed");
  if (reasons.length > 0 || data.purchasePrice.value === null || coverage.exact === null || purchaseAfter.exact === null) {
    return unavailableResult("purchase-impact", state, state.currencyCode ?? "currency", state.currencyCode, fields, reasons);
  }
  try {
    const value = -data.purchasePrice.value.minorUnits;
    const result = baseResult(
      "purchase-impact",
      state,
      moneyExactValue(value, data.purchasePrice.value.currencyCode, data.purchasePrice.value.minorUnit),
      moneyDisplay(value, data.purchasePrice.value.currencyCode, data.purchasePrice.value.minorUnit),
      data.purchasePrice.value.currencyCode,
      data.purchasePrice.value.currencyCode,
      fields,
      [],
      fields,
    );
    return result.availability === "available"
      ? { ...result, evidenceStatus: "forecast" }
      : result;
  } catch {
    return catchResult("purchase-impact", state, state.currencyCode ?? "currency", state.currencyCode, fields);
  }
}

function calculateWithState(
  state: ContextState,
  data: ReturnType<typeof financialInputs>,
): readonly CalculationResult[] {
  const incomeRate = calculateIncomeRate(state, data);
  const workTime = calculateWorkTimeEquivalent(state, data);
  const coverage = calculateCoverage(state, data);
  const purchaseAfter = calculatePurchaseAfter(state, data, coverage);
  const purchaseImpact = calculatePurchaseImpact(state, data, coverage, purchaseAfter);
  return [incomeRate, workTime, coverage, purchaseAfter, purchaseImpact];
}

export function calculatePurchaseDecision(
  request: CalculationRequest,
): readonly CalculationResult[] {
  try {
    const state = contextState(request.context, request.inputs);
    const data = financialInputs(state, request.inputs);
    // Period checks are intentionally performed per formula dependency.  A
    // work-hours revision mismatch must not erase an independent margin path,
    // and purchase-period metadata must not block rate/WTE calculations.
    return calculateWithState(state, data);
  } catch {
    let state: ContextState;
    try {
      state = contextState(request.context, request.inputs);
    } catch {
      state = failedContextState(request?.context);
    }
    let data: ReturnType<typeof financialInputs> | null = null;
    try {
      data = financialInputs(state, request.inputs);
    } catch {
      data = null;
    }
    return RESULT_ORDER.map((formulaId) =>
      catchResult(
        formulaId,
        state,
        formulaId === "work-time-equivalent"
          ? "小时"
          : formulaId === "income-rate"
            ? `${state.currencyCode ?? "currency"}/小时`
            : `${state.currencyCode ?? "currency"}`,
        formulaId === "work-time-equivalent" ? null : state.currencyCode,
        data === null ? [] : allRelevantFields(data, DEPENDENCIES[formulaId]),
      ),
    );
  }
}

export const calculateResults = calculatePurchaseDecision;
export const evaluateRules = calculatePurchaseDecision;
export const calculate = calculatePurchaseDecision;

export function resultByFormula(
  results: readonly CalculationResult[],
  formulaId: FormulaId,
): CalculationResult | null {
  return results.find((result) => result.formulaId === formulaId) ?? null;
}
