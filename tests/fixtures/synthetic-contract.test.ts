import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_VERSION,
  CURRENCY_TABLE_BYTES,
  CURRENCY_TABLE_PUBLISHED_ON,
  CURRENCY_TABLE_READ_ON,
  CURRENCY_TABLE_SHA256,
  CURRENCY_TABLE_SNAPSHOT_ID,
  DEFAULT_DICTIONARIES,
  DEFAULT_NOTICES,
  RESULT_FORMULA_IDS,
} from "../../src/domain/export/constants";
import { freezeExportSnapshot } from "../../src/domain/export/snapshot";
import { preflightUnicode } from "../../src/domain/export/unicode";
import { validateWireSnapshot } from "../../src/domain/export/validator";
import { serializeJsonSnapshot } from "../../src/domain/export/json";
import { decodeMarkdownSnapshot, serializeMarkdownSnapshot } from "../../src/domain/export/markdown";
import { compareJsonMarkdownSemantics } from "../../src/domain/export/equivalence";
import { requestBrowserDownload } from "../../src/adapters/browser/download";
import { clearCleanupBlock } from "../../src/adapters/browser/download-lifecycle";
import { makeExportSource } from "../domain/export/helpers";
import {
  calculatePurchaseDecision,
  CURRENCY_TABLE_SNAPSHOT_ID as CALC_CURRENCY_TABLE_SNAPSHOT_ID,
  FORMULA_EXPRESSIONS,
  normalizeRational,
  rationalDisplay,
  roundHalfAwayFromZero,
  type CalculationRequest,
  type CalculationResult,
  type PeriodRef as CalculationPeriodRef,
  type TimeContext as CalculationTimeContext,
} from "../../src/domain/calculation/index";

const fixtureRoot = resolve(process.cwd(), "tests/fixtures/synthetic");
const evidenceRoot = resolve(process.cwd(), "evidence/fixtures");
const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8")) as {
  readonly fixture_count: number;
  readonly fixtures: readonly { readonly fixture_id: string; readonly file: string }[];
};

function readFixture(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(fixtureRoot, file), "utf8")) as Record<string, unknown>;
}

function visit(value: unknown, callback: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  callback(record);
  for (const child of Object.values(record)) visit(child, callback);
}

function decodeFixtureCodeUnit(encoded: string): string {
  expect(encoded).toMatch(/^\\u[0-9A-Fa-f]{4}$/);
  return String.fromCharCode(Number.parseInt(encoded.slice(2), 16));
}

const REVISION_PERIOD = { kind: "month" as const, custom_label: null, revision: "synthetic-period-r1" };
const RULESET_REF = "purchase-decision-rules@1.0.0" as const;
const REVISION_TIME_BASE = "2026-01-15T00:00:00.";

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function reduceRational(numerator: bigint, denominator: bigint): { numerator: bigint; denominator: bigint } {
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function decimalForExport(numerator: bigint, denominator: bigint): string | null {
  const negative = numerator < 0n;
  let remainder = negative ? -numerator : numerator;
  const divisor = denominator < 0n ? -denominator : denominator;
  let factors = divisor;
  while (factors % 2n === 0n) factors /= 2n;
  while (factors % 5n === 0n) factors /= 5n;
  if (factors !== 1n) return null;
  const integer = remainder / divisor;
  remainder %= divisor;
  if (remainder === 0n) return `${negative ? "-" : ""}${integer}`;
  let digits = "";
  while (remainder !== 0n) {
    remainder *= 10n;
    digits += (remainder / divisor).toString();
    remainder %= divisor;
  }
  return `${negative ? "-" : ""}${integer}.${digits}`;
}

function makeIncomeRevisionValue(income: bigint): Record<string, unknown> {
  return {
    availability: "available",
    value: { kind: "money", minor_units: (income * 100n).toString(), minor_unit: 2, currency_code: "CNY" },
    evidence_status: "user-confirmed",
    unit: "CNY",
    currency_code: "CNY",
    period_ref: REVISION_PERIOD,
  };
}

function exportUnit(unit: string): string {
  return unit.replaceAll("/小时", "/hour").replaceAll("小时", "hour");
}

function exportPeriodRef(period: CalculationPeriodRef | null): Record<string, unknown> | null {
  if (period === null) return null;
  return { kind: period.kind, custom_label: period.customLabel, revision: period.revision };
}

function exportTimeContext(time: CalculationTimeContext): Record<string, string> {
  return {
    occurred_at_utc: time.occurredAtUtc,
    recorded_at_utc: time.recordedAtUtc,
    clock_source: time.clockSource,
    time_zone_id: time.timeZoneId,
    utc_offset: time.utcOffset,
    time_zone_source: time.timeZoneSource,
    time_zone_confirmation: time.timeZoneConfirmation,
  };
}

function exportExactValue(exact: CalculationResult["exact"]): Record<string, unknown> | null {
  if (exact === null) return null;
  const value: Record<string, unknown> = {
    decimal: exact.rational
      ? decimalForExport(BigInt(exact.rational.numerator), BigInt(exact.rational.denominator))
      : exact.decimal,
    unit: exportUnit(exact.unit),
    currency_code: exact.currencyCode,
  };
  if (exact.rational !== undefined) value.rational = exact.rational;
  if (exact.minorUnits !== undefined) value.minor_units = exact.minorUnits;
  return value;
}

function exportDisplayValue(display: CalculationResult["display"]): Record<string, unknown> | null {
  if (display === null) return null;
  return {
    text: display.text,
    decimal: display.decimal,
    display_digits: display.displayDigits,
    relation: display.relation,
  };
}

function oldResultFromCalculation(result: CalculationResult, generatedAt: CalculationTimeContext): Record<string, unknown> {
  return {
    formula_id: result.formulaId,
    exact_value: exportExactValue(result.exact),
    display_value: exportDisplayValue(result.display),
    unit: result.exact === null ? exportUnit(result.unit) : exportUnit(result.exact.unit),
    currency_code: result.currencyCode,
    period_ref: exportPeriodRef(result.periodRef),
    tax_basis: result.taxBasis,
    evidence_status: result.evidenceStatus,
    dependency_ids: [...result.dependencyFieldIds],
    rounding: result.display === null ? null : {
      mode: result.rounding.mode,
      display_digits: result.rounding.displayDigits ?? result.display.displayDigits,
      rounded: result.rounding.rounded,
    },
    ruleset_ref: result.rulesetRef,
    currency_table_snapshot_id: result.currencyCode === null ? null : result.currencyTableSnapshotId,
    generated_at: exportTimeContext(generatedAt),
  };
}

function resultRecordFromCalculation(result: CalculationResult, generatedAt: CalculationTimeContext): Record<string, unknown> {
  const dictionary = (kind: "assumption" | "limitation", values: readonly string[]) => values.map((text, index) => ({ id: `${result.formulaId}.${kind}-${index + 1}`, text }));
  return {
    formula_id: result.formulaId,
    source: result.source,
    availability: result.availability,
    exact_value: exportExactValue(result.exact),
    display_value: exportDisplayValue(result.display),
    unit: result.exact === null ? exportUnit(result.unit) : exportUnit(result.exact.unit),
    currency_code: result.currencyCode,
    currency_table_snapshot_id: result.currencyCode === null ? null : result.currencyTableSnapshotId,
    period_ref: exportPeriodRef(result.periodRef),
    tax_basis: result.taxBasis,
    evidence_status: result.evidenceStatus,
    dependency_field_ids: [...result.dependencyFieldIds],
    estimated_dependency_field_ids: [...result.estimatedDependencyFieldIds],
    reason_codes: [...result.reasonCodes],
    primary_reason_code: result.primaryReasonCode,
    assumptions: dictionary("assumption", result.assumptions),
    limitations: dictionary("limitation", result.limitations),
    ruleset_ref: result.rulesetRef,
    generated_at: exportTimeContext(generatedAt),
    rounding: result.display === null ? null : {
      mode: result.rounding.mode,
      display_digits: result.rounding.displayDigits ?? result.display.displayDigits,
      rounded: result.rounding.rounded,
    },
  };
}

function fixtureTimeContext(fixture: Record<string, unknown>): CalculationTimeContext {
  const context = fixture.context as Record<string, unknown>;
  const time = calcTimeContext(context.time_context ?? context.timeContext);
  if (time === null) throw new Error(`fixture ${String(fixture.fixture_id)} lacks export time context`);
  return time;
}

function exportInputFromFixture(field: Record<string, unknown>): Record<string, unknown> {
  const available = field.availability === "available";
  const value = available ? field.value ?? null : null;
  return {
    field_id: field.field_id,
    availability: available ? "available" : "not-provided",
    value,
    source: available ? (field.source ?? "user-input") : null,
    evidence_status: available ? (field.evidence_status ?? "user-confirmed") : null,
    unit: available ? (field.unit ?? null) : null,
    currency_code: available ? (field.currency_code ?? (typeof value === "object" && value !== null && (value as Record<string, unknown>).kind === "money" ? (value as Record<string, unknown>).currency_code : null)) : null,
    currency_table_snapshot_id: available ? CURRENCY_TABLE_SNAPSHOT_ID : null,
    period_ref: available ? (field.period_ref ?? null) : null,
    tax_basis: available ? (field.tax_basis ?? null) : null,
    confirmed_at: available ? (field.confirmed_at ?? null) : null,
    assumptions: [],
    limitations: [],
  };
}

function fixtureExportSource(fixture: Record<string, unknown>, results: readonly CalculationResult[]): Record<string, unknown> {
  const context = fixture.context as Record<string, unknown>;
  const time = fixtureTimeContext(fixture);
  const inputs = Array.isArray(fixture.inputs)
    ? (fixture.inputs as readonly Record<string, unknown>[]).map(exportInputFromFixture)
    : [];
  const resultRecords = results.map((result) => resultRecordFromCalculation(result, time));
  return {
    session_revision: 1,
    session_revision_start: 1,
    session_revision_end: 1,
    snapshot_revision: 1,
    snapshot_captured_at: exportTimeContext(time),
    application_build: {
      // The fixture has no build identity; this fixed harness envelope is
      // declared here so the adapter does not invent it from user input.
      app_version: "0.1.0",
      git_commit_sha: "c".repeat(40),
      artifact_manifest_sha256: "d".repeat(64),
      config_version: CONFIG_VERSION,
    },
    ruleset: { ruleset_id: "purchase-decision-rules", ruleset_version: "1.0.0", ruleset_ref: RULESET_REF },
    currency_table: {
      snapshot_id: CURRENCY_TABLE_SNAPSHOT_ID,
      source: "synthetic fixture currency snapshot",
      published_on: CURRENCY_TABLE_PUBLISHED_ON,
      read_on: CURRENCY_TABLE_READ_ON,
      bytes: CURRENCY_TABLE_BYTES,
      sha256: CURRENCY_TABLE_SHA256,
    },
    dictionaries: DEFAULT_DICTIONARIES,
    comparison_context: {
      period_ref: context.period_ref ?? null,
      currency_code: context.currency_code ?? null,
      currency_table_snapshot_id: CURRENCY_TABLE_SNAPSHOT_ID,
      tax_basis: context.tax_basis ?? null,
      time_zone_id: time.timeZoneId,
      utc_offset: time.utcOffset,
      time_zone_source: time.timeZoneSource,
      time_zone_confirmation: time.timeZoneConfirmation,
      source_input_ids: [],
    },
    inputs,
    results: resultRecords,
    decision: { availability: "not-provided", decision_code: null, evidence_status: null, rationale: null, confirmed_at: null },
    review: { availability: "not-provided", kind: null, local_date: null, condition_text: null, evidence_status: null, confirmed_at: null },
    confirmed_revisions: [],
    notices: DEFAULT_NOTICES,
  };
}

const CALC_FIELD_ALIASES: Record<string, string> = {
  "comparison-period": "comparisonPeriod", comparison_period: "comparisonPeriod",
  currency: "currency", currency_code: "currency", income: "income",
  "income-tax-basis": "incomeTaxBasis", income_tax_basis: "incomeTaxBasis", tax_basis: "incomeTaxBasis",
  "work-hours": "workHours", work_hours: "workHours", "purchase-price": "purchasePrice", purchase_price: "purchasePrice",
  "purchase-period-inclusion": "purchasePeriodInclusion", purchase_period_inclusion: "purchasePeriodInclusion",
  "fixed-cost-total": "fixedCostTotal", fixed_cost_total: "fixedCostTotal", "fixed-cost-coverage": "fixedCostCoverage", fixed_cost_coverage: "fixedCostCoverage",
  "fixed-cost-coverage-description": "fixedCostCoverageDescription", fixed_cost_coverage_description: "fixedCostCoverageDescription",
  "value-expectation": "valueExpectation", value_expectation: "valueExpectation",
};

function calcPeriodRef(value: unknown): CalculationPeriodRef | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === "period-ref" ? record.period_kind : record.kind ?? record.period_kind;
  if (kind !== "week" && kind !== "month" && kind !== "year" && kind !== "custom") return null;
  if (typeof record.revision !== "string") return null;
  return { kind, customLabel: (record.customLabel ?? record.custom_label ?? null) as string | null, revision: record.revision };
}

function calcTimeContext(value: unknown): CalculationTimeContext | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const mapped = {
    occurredAtUtc: record.occurredAtUtc ?? record.occurred_at_utc,
    recordedAtUtc: record.recordedAtUtc ?? record.recorded_at_utc,
    clockSource: record.clockSource ?? record.clock_source,
    timeZoneId: record.timeZoneId ?? record.time_zone_id,
    utcOffset: record.utcOffset ?? record.utc_offset,
    timeZoneSource: record.timeZoneSource ?? record.time_zone_source,
    timeZoneConfirmation: record.timeZoneConfirmation ?? record.time_zone_confirmation,
  };
  return Object.values(mapped).every((item) => typeof item === "string") ? mapped as CalculationTimeContext : null;
}

function calculationField(field: Record<string, unknown>): Record<string, unknown> {
  return {
    availability: field.availability === "not-provided" ? "not-provided" : "available",
    raw: field.raw,
    value: field.value,
    evidenceStatus: field.evidence_status ?? field.evidenceStatus,
    periodRef: calcPeriodRef(field.period_ref ?? field.periodRef),
    currencyCode: field.currency_code ?? field.currencyCode,
    taxBasis: field.tax_basis ?? field.taxBasis,
    assumptions: field.assumptions,
  };
}

function calculationObjectField(key: string, value: unknown, objectInputs: Record<string, unknown>, contextPeriod: CalculationPeriodRef | null): Record<string, unknown> {
  const periodKey = key === "purchase_period_inclusion" ? "purchase_period_ref" : `${key}_period_ref`;
  if (typeof value !== "object" || value === null) {
    return {
      availability: "available", raw: value, value, evidenceStatus: "user-confirmed",
      periodRef: calcPeriodRef(objectInputs[periodKey]) ?? (contextPeriod && ["income", "work-hours", "work_hours", "fixed-cost-total", "fixed_cost_total", "purchase-period-inclusion", "purchase_period_inclusion"].includes(key) ? contextPeriod : null),
    };
  }
  const field = value as Record<string, unknown>;
  return {
    availability: "available",
    raw: field.raw ?? (key === "currency" ? field.code : undefined),
    value: field.value ?? field,
    evidenceStatus: field.evidence_status ?? field.evidenceStatus ?? "user-confirmed",
      periodRef: calcPeriodRef(field.period_ref ?? field.periodRef ?? objectInputs[periodKey]) ?? (contextPeriod && ["income", "work-hours", "work_hours", "fixed-cost-total", "fixed_cost_total", "purchase-period-inclusion", "purchase_period_inclusion"].includes(key) ? contextPeriod : null),
    currencyCode: field.currency_code ?? field.currencyCode,
    taxBasis: field.tax_basis ?? field.taxBasis,
    assumptions: field.assumptions,
  };
}

function requestFromCalculationFixture(fixture: Record<string, unknown>, injectedTime: unknown): CalculationRequest {
  const rawContext = (fixture.context ?? {}) as Record<string, unknown>;
  const contextPeriod = calcPeriodRef(rawContext.period_ref ?? rawContext.declared_period);
  const contextCurrency = (rawContext.currency_code ?? rawContext.declared_currency_code) as string | undefined;
  const contextTax = (rawContext.tax_basis ?? rawContext.declared_tax_basis) as "before-tax" | "after-tax" | undefined;
  const context: CalculationRequest["context"] = {
    periodRef: contextPeriod,
    currencyCode: contextCurrency ?? null,
    currencyTableSnapshotId: (rawContext.currency_table_snapshot_id as string | undefined) ?? CALC_CURRENCY_TABLE_SNAPSHOT_ID,
    taxBasis: contextTax ?? null,
    timeContext: calcTimeContext(rawContext.time_context ?? rawContext.timeContext ?? injectedTime),
    rulesetId: "purchase-decision-rules",
    rulesetVersion: "1.0.0",
  };
  const inputs: Record<string, unknown> = {};
  const rawInputs = fixture.inputs;
  if (Array.isArray(rawInputs)) {
    for (const item of rawInputs) {
      if (typeof item !== "object" || item === null || typeof (item as Record<string, unknown>).field_id !== "string") continue;
      const field = item as Record<string, unknown>;
      const target = CALC_FIELD_ALIASES[field.field_id as string] ?? CALC_FIELD_ALIASES[(field.field_id as string).replaceAll("-", "_")];
      if (target) inputs[target] = calculationField(field);
    }
  } else if (typeof rawInputs === "object" && rawInputs !== null) {
    const objectInputs = rawInputs as Record<string, unknown>;
    const mergedObjectInputs = objectInputs.valid && objectInputs.invalid && typeof objectInputs.valid === "object" && typeof objectInputs.invalid === "object"
      ? { ...(objectInputs.valid as Record<string, unknown>), ...(objectInputs.invalid as Record<string, unknown>) }
      : objectInputs;
    for (const [key, value] of Object.entries(mergedObjectInputs)) {
      const target = CALC_FIELD_ALIASES[key];
      if (target) inputs[target] = calculationObjectField(key, value, mergedObjectInputs, contextPeriod);
    }
    const declared = mergedObjectInputs["comparison-period"] ?? mergedObjectInputs.comparison_period;
    if (declared !== undefined) inputs.comparisonPeriod = { availability: "available", raw: typeof declared === "object" && declared !== null ? null : declared, value: declared, evidenceStatus: "user-confirmed", periodRef: calcPeriodRef(declared) ?? contextPeriod };
    if ((fixture.fixture_id === "EDGE-ZERO" || fixture.fixture_id === "EDGE-NEGATIVE") && inputs.purchasePeriodInclusion === undefined) {
      inputs.purchasePeriodInclusion = {
        availability: "available",
        raw: true,
        value: true,
        evidenceStatus: "user-confirmed",
        periodRef: contextPeriod,
      };
    }
  }
  if (inputs.comparisonPeriod === undefined && contextPeriod !== null) inputs.comparisonPeriod = { availability: "available", raw: contextPeriod.kind, value: contextPeriod, evidenceStatus: "user-confirmed", periodRef: contextPeriod };
  if (inputs.currency === undefined && contextCurrency !== undefined) inputs.currency = { availability: "available", raw: contextCurrency, value: contextCurrency, evidenceStatus: "user-confirmed" };
  if (inputs.incomeTaxBasis === undefined && contextTax !== undefined) inputs.incomeTaxBasis = { availability: "available", raw: contextTax, value: contextTax, evidenceStatus: "user-confirmed" };
  return { context, inputs };
}

function revisionCalculationRequest(
  baseline: Record<string, unknown>,
  income: bigint,
  timeContext: Record<string, string>,
  edgeInjection: unknown,
): CalculationRequest {
  const baselineInputs = Array.isArray(baseline.inputs) ? baseline.inputs as readonly Record<string, unknown>[] : [];
  const inputs = baselineInputs.map((field) => field.field_id === "income"
    ? {
        ...field,
        raw: income.toString(),
        value: { kind: "money", minor_units: (income * 100n).toString(), minor_unit: 2, currency_code: "CNY" },
      }
    : field);
  return requestFromCalculationFixture({
    ...baseline,
    context: { ...(baseline.context as Record<string, unknown>), time_context: timeContext },
    inputs,
  }, edgeInjection);
}

function calculationResult(results: readonly CalculationResult[], formulaId: string): CalculationResult {
  const result = results.find((item) => item.formulaId === formulaId);
  if (!result) throw new Error(`missing calculation result ${formulaId}`);
  return result;
}

function canonicalCalculationUnit(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "hour") return "小时";
  return value.replaceAll("/hour", "/小时").replaceAll(" hour", " 小时");
}

function assertCalculationResult(actual: CalculationResult, expected: Record<string, unknown>, expectedTimeContext: CalculationTimeContext | null): void {
  expect(actual.source).toBe("ruleset-derived");
  expect(actual.formulaExpression).toBe(FORMULA_EXPRESSIONS[actual.formulaId]);
  expect(actual.timeContext).toEqual(expectedTimeContext);
  expect(actual.currencyTableSnapshotId).toBe(CALC_CURRENCY_TABLE_SNAPSHOT_ID);
  expect(actual.availability).toBe(expected.availability);
  expect(actual.evidenceStatus).toBe(expected.evidence_status);
  expect(actual.primaryReasonCode).toBe(expected.primary_reason_code ?? null);
  if (Array.isArray(expected.reason_codes)) expect(actual.reasonCodes).toEqual(expected.reason_codes);
  if (Array.isArray(expected.dependency_field_ids)) expect(actual.dependencyFieldIds).toEqual(expected.dependency_field_ids);
  if (Array.isArray(expected.estimated_dependency_field_ids)) expect(actual.estimatedDependencyFieldIds).toEqual(expected.estimated_dependency_field_ids);
  expect(actual.rulesetRef).toBe(RULESET_REF);
  if (expected.unit !== undefined && expected.unit !== null) expect(actual.unit).toBe(canonicalCalculationUnit(expected.unit));
  if (expected.currency_code !== undefined) expect(actual.currencyCode).toBe(expected.currency_code);
  if (expected.period_ref !== undefined) expect(actual.periodRef).toEqual(calcPeriodRef(expected.period_ref));
  if (expected.tax_basis !== undefined) expect(actual.taxBasis).toBe(expected.tax_basis);
  const exact = expected.exact as Record<string, unknown> | null;
  if (exact === null) {
    expect(actual.exact).toBeNull();
    expect(actual.display).toBeNull();
    return;
  }
  expect(actual.exact).not.toBeNull();
  expect(actual.display).not.toBeNull();
  if (actual.exact) {
    if (exact.rational !== undefined) expect(actual.exact.rational).toEqual(exact.rational);
    if (exact.minor_units !== undefined) expect(actual.exact.minorUnits).toBe(exact.minor_units);
    if (exact.currency_code !== undefined) expect(actual.exact.currencyCode).toBe(exact.currency_code);
    if (exact.unit !== undefined) expect(actual.exact.unit).toBe(canonicalCalculationUnit(exact.unit));
    if (typeof exact.decimal === "string") expect(actual.exact.decimal).toBe(exact.decimal);
  }
  const display = expected.display as Record<string, unknown>;
  if (actual.display) {
    expect(actual.display.decimal).toBe(display.decimal);
    expect(actual.display.displayDigits).toBe(display.display_digits);
    expect(actual.display.relation).toBe(display.relation);
    expect(actual.display.roundingMode).toBe(display.rounding_mode);
    expect(actual.display.rounded).toBe(display.rounded);
    expect(actual.display.text).toBe(canonicalCalculationUnit(display.text));
  }
}

function assertRevisionCalculation(results: readonly CalculationResult[], income: bigint, timeContext: CalculationTimeContext): void {
  expect(results).toHaveLength(5);
  const rate = calculationResult(results, "income-rate");
  const workTime = calculationResult(results, "work-time-equivalent");
  const coverage = calculationResult(results, "coverage-available-margin");
  const after = calculationResult(results, "purchase-after-margin");
  const impact = calculationResult(results, "purchase-impact");
  const rateRational = reduceRational(income, 160n);
  const workTimeRational = reduceRational(160000n, income);
  expect(rate.availability).toBe("available");
  expect(rate.evidenceStatus).toBe("user-confirmed");
  expect(rate.exact?.rational).toEqual({ numerator: rateRational.numerator.toString(), denominator: rateRational.denominator.toString() });
  expect(rate.display?.text).toBe(`${rate.display?.decimal} CNY/小时`);
  expect(workTime.availability).toBe("available");
  expect(workTime.evidenceStatus).toBe("user-confirmed");
  expect(workTime.currencyCode).toBeNull();
  expect(workTime.exact?.rational).toEqual({ numerator: workTimeRational.numerator.toString(), denominator: workTimeRational.denominator.toString() });
  expect(workTime.display?.text).toBe(`${workTime.display?.decimal} 小时`);
  expect(coverage.availability).toBe("available");
  expect(coverage.evidenceStatus).toBe("user-confirmed");
  expect(coverage.exact?.minorUnits).toBe(((income - 6000n) * 100n).toString());
  expect(after.availability).toBe("available");
  expect(after.evidenceStatus).toBe("forecast");
  expect(after.exact?.minorUnits).toBe(((income - 7000n) * 100n).toString());
  expect(impact.availability).toBe("available");
  expect(impact.evidenceStatus).toBe("forecast");
  expect(impact.exact?.minorUnits).toBe("-100000");
  for (const result of results) {
    expect(result.timeContext).toEqual(timeContext);
    expect(result.currencyTableSnapshotId).toBe(CALC_CURRENCY_TABLE_SNAPSHOT_ID);
  }
}

describe("synthetic fixture contract", () => {
  it("keeps the manifest inventory synthetic and complete", () => {
    expect(manifest.fixture_count).toBe(19);
    expect(manifest.fixtures).toHaveLength(19);
    const files = new Set(readdirSync(fixtureRoot));
    for (const entry of manifest.fixtures) {
      expect(files.has(entry.file)).toBe(true);
      expect(readFixture(entry.file).synthetic_only).toBe(true);
    }
  });

  it("declares one deterministic default TimeContext injection for all edge fixtures", () => {
    const shared = (manifest as unknown as { readonly shared_contract: Record<string, unknown> }).shared_contract;
    const injection = shared.edge_default_time_context_injection as Record<string, unknown>;
    const edgeFixtureIds = manifest.fixtures.map((entry) => entry.fixture_id).filter((fixtureId) => fixtureId.startsWith("EDGE-"));
    expect(injection.fixture_ids).toEqual(edgeFixtureIds);
    expect(injection.injection_mode).toBe("merge-before-calculation");
    expect(injection.field_path).toBe("calculation_context.time_context");
    expect(injection.strict_iso_millisecond_pattern).toBe("YYYY-MM-DDTHH:mm:ss.sssZ");
    expect(injection.replay_rule).toContain("before calculation");
    expect(injection.context).toEqual({
      occurred_at_utc: "2026-01-15T00:00:00.000Z",
      recorded_at_utc: "2026-01-15T00:00:00.000Z",
      clock_source: "device-clock",
      time_zone_id: "Etc/UTC",
      utc_offset: "+00:00",
      time_zone_source: "utc-fallback",
      time_zone_confirmation: "unconfirmed",
    });
  });

  it("replays every manifest fixture or its declared case/utility oracle with calculation", () => {
    const shared = (manifest as unknown as { readonly shared_contract: Record<string, unknown> }).shared_contract;
    const edgeInjection = (shared.edge_default_time_context_injection as Record<string, unknown>).context;
    const edgeInjectionTime = calcTimeContext(edgeInjection);
    expect(edgeInjectionTime).not.toBeNull();
    let fixtureOracleCount = 0;
    let caseOracleCount = 0;
    let resultOracleCount = 0;
    let utilityOracleCount = 0;
    for (const entry of manifest.fixtures) {
      const loaded = readFixture(entry.file);
      fixtureOracleCount += 1;
      if (Array.isArray(loaded.expected_results)) {
        const replaySource = loaded.baseline_ref
          ? readFixture(`${String((loaded.baseline_ref as Record<string, unknown>).file)}`)
          : loaded;
        const request = requestFromCalculationFixture(replaySource, edgeInjection);
        const results = calculatePurchaseDecision(request);
        const expectedResults = loaded.expected_results as readonly Record<string, unknown>[];
        expect(results).toHaveLength(5);
        for (const expected of expectedResults) {
          assertCalculationResult(calculationResult(results, String(expected.formula_id)), expected, request.context.timeContext ?? null);
          resultOracleCount += 1;
        }
        continue;
      }
      if (entry.fixture_id === "EDGE-LIMITS") {
        const baseInput = loaded.base_fixture as Record<string, unknown>;
        const cases = loaded.case_result_expectations as Record<string, readonly Record<string, unknown>[]>;
        for (const [caseId, expectedResults] of Object.entries(cases)) {
          const caseDefinition = (loaded.input_cases as readonly Record<string, unknown>[]).find((item) => item.case_id === caseId);
          expect(caseDefinition).toBeDefined();
          const input = { ...baseInput, ...(caseDefinition?.override as Record<string, unknown> | undefined) };
          if (caseDefinition?.field_id && caseDefinition.raw !== undefined) input[caseDefinition.field_id as string] = caseDefinition.raw;
          if (caseDefinition?.raw_generation) {
            const generation = caseDefinition.raw_generation as Record<string, unknown>;
            input[caseDefinition.field_id as string] = String(generation.character ?? "").repeat(Number(generation.utf16_code_units ?? generation.decimal_digits ?? 0));
          }
          const context = {
            period_ref: input["comparison-period"],
            currency_code: (input.currency as Record<string, unknown>).code,
            tax_basis: input["income-tax-basis"],
          };
          const request = requestFromCalculationFixture({ context, inputs: input }, edgeInjection);
          const results = calculatePurchaseDecision(request);
          expect(results).toHaveLength(5);
          for (const expected of expectedResults) {
            try {
              assertCalculationResult(calculationResult(results, String(expected.formula_id)), expected, request.context.timeContext ?? null);
            } catch (error) {
              const actual = calculationResult(results, String(expected.formula_id));
              throw new Error(`${entry.fixture_id}/${caseId}/${String(expected.formula_id)}: ${error instanceof Error ? error.message : String(error)}; actual=${JSON.stringify({ availability: actual.availability, primaryReasonCode: actual.primaryReasonCode, reasonCodes: actual.reasonCodes, dependencyFieldIds: actual.dependencyFieldIds })}; request=${JSON.stringify(request)}`);
            }
            resultOracleCount += 1;
          }
          caseOracleCount += 1;
        }
        const utilities = loaded.utility_expectations as readonly Record<string, unknown>[] | undefined;
        for (const utility of utilities ?? []) {
          if (utility.case_id === "RATIONAL-NUMERATOR-129-DIGITS") {
            const rawGeneration = (loaded.input_cases as readonly Record<string, unknown>[]).find((item) => item.case_id === utility.case_id)?.raw_generation as Record<string, unknown> | undefined;
            const digits = Number(rawGeneration?.decimal_digits ?? 129);
            const normalized = normalizeRational(BigInt(String(rawGeneration?.character ?? "9").repeat(digits)), 1n);
            expect(normalized).toEqual({ ok: false, reasonCode: "numeric-limit-exceeded" });
            utilityOracleCount += 1;
          }
        }
        continue;
      }
      if (entry.fixture_id === "EDGE-MINOR-UNIT") {
        const replay = loaded.replay_contract as Record<string, unknown>;
        const baseInput = replay.base_input as Record<string, unknown>;
        const overrides = replay.replay_overrides_by_case as Record<string, Record<string, unknown>>;
        const cases = loaded.case_result_expectations as Record<string, readonly Record<string, unknown>[]>;
        for (const [caseId, expectedResults] of Object.entries(cases)) {
          const override = overrides[caseId];
          expect(override).toBeDefined();
          const input = { ...baseInput, currency: override?.currency_code ?? (baseInput.currency as Record<string, unknown>).code, income: override?.income_raw };
          const context = {
            period_ref: input["comparison-period"],
            currency_code: override?.currency_code,
            tax_basis: input["income-tax-basis"],
          };
          const request = requestFromCalculationFixture({ context, inputs: input }, edgeInjection);
          const results = calculatePurchaseDecision(request);
          expect(results).toHaveLength(5);
          for (const expected of expectedResults) {
            try {
              assertCalculationResult(calculationResult(results, String(expected.formula_id)), expected, request.context.timeContext ?? null);
            } catch (error) {
              const actual = calculationResult(results, String(expected.formula_id));
              throw new Error(`${entry.fixture_id}/${caseId}/${String(expected.formula_id)}: ${error instanceof Error ? error.message : String(error)}; actual=${JSON.stringify({ availability: actual.availability, currencyCode: actual.currencyCode, unit: actual.unit, display: actual.display, periodRef: actual.periodRef, taxBasis: actual.taxBasis, reasonCodes: actual.reasonCodes })}`);
            }
            resultOracleCount += 1;
          }
          caseOracleCount += 1;
        }
        continue;
      }
      if (entry.fixture_id === "EDGE-ROUNDING-TIES") {
        expect(loaded.metadata_contract).toEqual({
          time_context: "not-applicable",
          currency_table_snapshot_id: "not-applicable",
          reason: "rounding vectors call display helpers and create no CalculationResult",
        });
        const roundingCases = loaded.rounding_cases as readonly Record<string, unknown>[];
        for (const item of roundingCases) {
          const exact = item.exact as Record<string, unknown>;
          const rational = exact.rational as Record<string, string>;
          if (item.case_id === "NONZERO-WTE-BELOW-MINIMUM") {
            expect(rationalDisplay({ numerator: BigInt(rational.numerator), denominator: BigInt(rational.denominator) }, 2, "小时", { tinyPositiveText: "<0.01" }).text).toBe("<0.01 小时");
          } else {
            const rounded = roundHalfAwayFromZero({ numerator: BigInt(rational.numerator), denominator: BigInt(rational.denominator) }, 2);
            expect(rounded.decimal).toBe((item.display as Record<string, unknown>).decimal);
          }
          caseOracleCount += 1;
          resultOracleCount += 1;
        }
        continue;
      }
      if (entry.fixture_id === "EDGE-REVISION-LIMIT") {
        const baseline = readFixture("syn-02-complete-purchase-forecast.json");
        const baselineTime = fixtureTimeContext(baseline);
        const sequenceRange = (loaded.revision_envelope_generation_contract as Record<string, unknown>).sequence_range as Record<string, number>;
        const algorithm = (loaded.revision_envelope_generation_contract as Record<string, unknown>).envelope_algorithm as Record<string, unknown>;
        const oldResultTimeContract = algorithm.old_results_generated_at as Record<string, unknown>;
        expect(oldResultTimeContract.sequence_one).toBe("baseline_ref.original_time_context");
        expect(oldResultTimeContract.sequence_greater_than_one).toBe("event[n-1].current_result_generated_at");
        expect(oldResultTimeContract.current_result_generated_at).toBe("event[n].time_context");
        expect((loaded.baseline_ref as Record<string, unknown>).original_time_context).toEqual(exportTimeContext(baselineTime));
        const timeTemplate = (loaded.revision_envelope_generation_contract as Record<string, unknown>).time_context_template as Record<string, unknown>;
        const expectedResultIds = (loaded.baseline_ref as Record<string, unknown>).expected_result_ids as readonly string[];
        let finalResults: readonly CalculationResult[] | null = null;
        const envelopes = Array.from({ length: sequenceRange.count }, (_, index) => {
          const sequence = sequenceRange.first + index;
          const sequencePadded = String(sequence).padStart(3, "0");
          const previousSequencePadded = String(sequence - 1).padStart(3, "0");
          const recordedAt = `${REVISION_TIME_BASE}${sequencePadded}Z`;
          const previousRecordedAt = `${REVISION_TIME_BASE}${previousSequencePadded}Z`;
          const currentTime: CalculationTimeContext = {
            occurredAtUtc: recordedAt,
            recordedAtUtc: recordedAt,
            clockSource: timeTemplate.clock_source as "device-clock",
            timeZoneId: timeTemplate.time_zone_id as string,
            utcOffset: timeTemplate.utc_offset as string,
            timeZoneSource: timeTemplate.time_zone_source as "utc-fallback",
            timeZoneConfirmation: timeTemplate.time_zone_confirmation as "unconfirmed",
          };
          const previousTime: CalculationTimeContext = sequence === sequenceRange.first
            ? baselineTime
            : { ...currentTime, occurredAtUtc: previousRecordedAt, recordedAtUtc: previousRecordedAt };
          const beforeIncome = 10000n + BigInt(sequence - 1);
          const afterIncome = 10000n + BigInt(sequence);
          const beforeResults = calculatePurchaseDecision(revisionCalculationRequest(baseline, beforeIncome, exportTimeContext(previousTime), edgeInjection));
          const currentResults = calculatePurchaseDecision(revisionCalculationRequest(baseline, afterIncome, exportTimeContext(currentTime), edgeInjection));
          assertRevisionCalculation(beforeResults, beforeIncome, previousTime);
          assertRevisionCalculation(currentResults, afterIncome, currentTime);
          if (sequence === sequenceRange.last) finalResults = currentResults;
          const timeContext = exportTimeContext(currentTime);
          const previousTimeContext = exportTimeContext(previousTime);
          const event = {
            sequence,
            event_type: algorithm.event_type,
            event_status: algorithm.event_status,
            actor: algorithm.actor,
            time_context: timeContext,
            field_id: algorithm.field_id,
            before: makeIncomeRevisionValue(beforeIncome),
            after: makeIncomeRevisionValue(afterIncome),
            raw_decimal_before: beforeIncome.toString(),
            raw_decimal_after: afterIncome.toString(),
            confirmed_at: recordedAt,
            invalidated_result_ids: [...expectedResultIds],
            old_results: expectedResultIds.map((formulaId) => {
              const oldResult = oldResultFromCalculation(calculationResult(beforeResults, formulaId), previousTime);
              expect(oldResult.formula_id).toBe(formulaId);
              expect(oldResult.generated_at).toEqual(previousTimeContext);
              return oldResult;
            }),
            ruleset_ref: RULESET_REF,
          };
          expect(Object.keys(event)).toEqual((loaded.revision_envelope_generation_contract as Record<string, unknown>).envelope_fields);
          expect(Object.hasOwn(event, "sessionRevision")).toBe(false);
          expect(event.old_results).toHaveLength(5);
          resultOracleCount += 10;
          caseOracleCount += 1;
          return event;
        });
        expect(finalResults).not.toBeNull();
        expect(envelopes).toHaveLength(sequenceRange.count);
        expect(envelopes.map((event) => event.sequence)).toEqual(Array.from({ length: sequenceRange.count }, (_, index) => sequenceRange.first + index));
        expect((loaded.expected_export as Record<string, unknown>).snapshot_revision).toBe(50);
        expect((loaded.namespace_assertions as Record<string, unknown>).snapshot_revision).toBe((loaded.namespace_assertions as Record<string, unknown>).sessionRevision);
        continue;
      }
      if (entry.fixture_id === "EDGE-FAILURES") {
        const baseline = readFixture("syn-02-complete-purchase-forecast.json");
        const failures = loaded.failure_cases as readonly Record<string, unknown>[];
        expect(failures).toHaveLength(7);
        for (const failure of failures) {
          const caseId = String(failure.case_id);
          const expectedFormula = typeof failure.formula_id === "string" ? failure.formula_id : null;
          if (caseId === "CALC-DIVISION-BY-ZERO" || caseId === "CALC-UNEXPECTED-EXCEPTION") {
            const inputs = (baseline.inputs as readonly Record<string, unknown>[]).map((field) => {
              if (caseId === "CALC-DIVISION-BY-ZERO" && field.field_id === "work-hours") {
                return { ...field, value: { kind: "rational", numerator: "1", denominator: "0", unit: "hour" }, raw: null };
              }
              if (caseId === "CALC-UNEXPECTED-EXCEPTION" && field.field_id === "purchase-price") {
                return { ...field, value: { kind: "money", minor_units: "not-a-number", minor_unit: 2, currency_code: "CNY" }, raw: null };
              }
              return field;
            });
            const request = requestFromCalculationFixture({ ...baseline, inputs }, edgeInjection);
            const results = calculatePurchaseDecision(request);
            expect(expectedFormula).not.toBeNull();
            const actual = calculationResult(results, expectedFormula as string);
            expect(actual.availability).toBe(failure.availability);
            expect(actual.exact).toBeNull();
            expect(actual.display).toBeNull();
            expect(actual.evidenceStatus).toBe(failure.evidence_status);
            expect(actual.primaryReasonCode).toBe(failure.primary_reason_code);
            expect(actual.reasonCodes).toEqual(failure.reason_codes);
            expect(actual.timeContext).toEqual(request.context.timeContext ?? null);
            expect(actual.currencyTableSnapshotId).toBe(CALC_CURRENCY_TABLE_SNAPSHOT_ID);
            resultOracleCount += 1;
          } else if (caseId === "EXPORT-SCHEMA-MISMATCH") {
            const frozen = freezeExportSnapshot(makeExportSource({ unknown_export_field: "synthetic-only" }));
            expect(frozen).toEqual({ ok: false, error: expect.objectContaining({ code: failure.error_code }) });
          } else if (caseId === "EXPORT-RESOURCE-LIMIT") {
            const base = makeExportSource();
            const inputs = base.inputs.map((input) => input.field_id === "value-expectation"
              ? { ...input, value: { kind: "text" as const, text: "x".repeat(65537), text_encoding: "unicode-scalar-v1" as const } }
              : input);
            const frozen = freezeExportSnapshot(makeExportSource({ inputs }));
            expect(frozen).toEqual({ ok: false, error: expect.objectContaining({ code: failure.error_code }) });
          } else if (caseId === "EXPORT-BLOB-CREATION" || caseId === "EXPORT-DOWNLOAD-REQUEST" || caseId === "EXPORT-CLEANUP") {
            const anchor = {
              href: "",
              download: "",
              rel: "",
              click: () => { if (caseId === "EXPORT-DOWNLOAD-REQUEST") throw new Error("synthetic click"); },
              remove: () => undefined,
            };
            const timers: Array<() => void> = [];
            const environment = {
              document: { createElement: () => anchor },
              window: { addEventListener: () => undefined, removeEventListener: () => undefined },
              URL: {
                createObjectURL: () => "blob:synthetic",
                revokeObjectURL: () => { if (caseId === "EXPORT-CLEANUP") throw new Error("synthetic revoke"); },
              },
              Blob: caseId === "EXPORT-BLOB-CREATION" ? class { constructor() { throw new Error("synthetic blob"); } } : Blob,
              setTimeout: (callback: () => void) => { timers.push(callback); return 1; },
            };
            const requested = requestBrowserDownload({
              format: "json",
              text: '{"synthetic":true}\n',
              file_name: "zhiguan-purchase-decision-20260115T000000Z.json",
              mime: "application/json",
              explicit_user_action: true,
              environment: environment as never,
            });
            if (caseId === "EXPORT-CLEANUP") {
              expect(requested.ok).toBe(true);
              if (requested.ok) expect(requested.value.cleanup().ok ? null : requested.value.cleanup_result?.error.code).toBe(failure.error_code);
            } else {
              expect(requested).toEqual({ ok: false, error: expect.objectContaining({ code: failure.error_code }) });
            }
            clearCleanupBlock();
          } else {
            throw new Error(`unhandled synthetic failure case ${caseId}`);
          }
          expect(typeof failure.layer).toBe("string");
          expect(typeof failure.export_semantics).toBe("string");
          caseOracleCount += 1;
        }
      }
    }
    expect(fixtureOracleCount).toBe(19);
    expect(caseOracleCount).toBe(76);
    expect(resultOracleCount).toBe(655);
    expect(utilityOracleCount).toBe(1);
  });

  it("uses null evidence for every not-provided input record", () => {
    for (const entry of manifest.fixtures) {
      const fixture = readFixture(entry.file);
      visit(fixture, (record) => {
        if (record.availability === "not-provided" && typeof record.field_id === "string") {
          expect(Object.hasOwn(record, "evidence_status")).toBe(true);
          expect(record.evidence_status).toBeNull();
        }
      });
    }
  });

  it("keeps work-time-equivalent currency explicitly null", () => {
    for (const entry of manifest.fixtures) {
      const fixture = readFixture(entry.file);
      visit(fixture, (record) => {
        if (record.formula_id === "work-time-equivalent") expect(record.currency_code).toBeNull();
      });
    }
  });

  it("separates invalid input, downstream nulls, and export no-snapshot state", () => {
    for (const file of ["edge-empty-input.json", "edge-zero-input.json", "edge-negative-input.json"]) {
      const fixture = readFixture(file);
      const workflow = fixture.workflow as Record<string, unknown>;
      const expectedExport = fixture.expected_export as Record<string, unknown>;
      expect(workflow.input_availability).toBe("not-provided");
      expect(workflow.input_evidence_status).toBeNull();
      expect(workflow.downstream_result_evidence_status).toBe("insufficient-data");
      expect(expectedExport.snapshot_created).toBe(false);
      expect(expectedExport.null_results_in_snapshot).toBe(false);
      expect(expectedExport.export_error_code).toBe("export-no-input");
    }
  });

  it("keeps the 129-digit rational vector utility-only", () => {
    const fixture = readFixture("edge-numeric-limits.json");
    const utility = (fixture.utility_expectations as readonly Record<string, unknown>[]).find(
      (item) => item.case_id === "RATIONAL-NUMERATOR-129-DIGITS",
    );
    expect(utility?.financial_result).toBe(false);
    expect(utility?.metadata_contract).toEqual({
      time_context: "not-applicable",
      currency_table_snapshot_id: "not-applicable",
      reason: "normalizeRational utility guard creates no CalculationResult",
    });
    expect((fixture.result_expectations as readonly Record<string, unknown>[]).some(
      (item) => item.case_id === "RATIONAL-NUMERATOR-129-DIGITS",
    )).toBe(false);
  });

  it("keeps replayable baselines for currency, Unicode, and revision vectors", () => {
    const minor = readFixture("edge-currency-minor-units.json");
    const minorReplay = minor.replay_contract as Record<string, unknown>;
    expect(minorReplay.base_input).toBeDefined();
    expect((minorReplay.base_input as Record<string, unknown>)["purchase-price"]).toBe("1");
    expect((minorReplay.base_input as Record<string, unknown>)["fixed-cost-total"]).toBe("1");
    expect((minorReplay.base_export_contract as Record<string, unknown>).eligible).toBe(true);
    expect((minorReplay.invalid_case_contract as Record<string, unknown>).export_error_code).toBe("export-pending-edit");
    expect((minorReplay.invalid_case_contract as Record<string, unknown>).does_not_inherit_base_snapshot).toBe(true);
    expect(Object.keys(minorReplay.replay_overrides_by_case as object)).toHaveLength(9);
    for (const file of ["edge-markdown-unicode.json", "edge-invalid-unicode.json", "edge-revision-limit.json"]) {
      const baseline = readFixture(file).baseline_ref as Record<string, unknown>;
      expect(baseline.manifest).toBe("manifest.json");
      expect(typeof baseline.replay_contract).toBe("string");
    }
  });

  it("injects actual invalid Unicode code units before the shared JSON/Markdown preflight", () => {
    const fixture = readFixture("edge-invalid-unicode.json");
    const decodeContract = fixture.decode_contract as Record<string, unknown>;
    expect(decodeContract.runtime_injection_required).toBe(true);
    expect(decodeContract.common_preflight).toBe("preflightUnicode");
    expect(decodeContract.projections).toEqual(["json", "markdown"]);
    const cases = fixture.invalid_text_cases as readonly Record<string, unknown>[];
    const expectedCodeUnits: Record<string, number> = { NUL: 0x0000, "ISOLATED-HIGH-SURROGATE": 0xd800, "ISOLATED-LOW-SURROGATE": 0xdc00 };
    for (const item of cases) {
      const codeUnit = decodeFixtureCodeUnit(item.encoded_scalar_sequence as string);
      const injectedValue = codeUnit + (decodeContract.runtime_guard_suffix as string);
      expect(injectedValue.charCodeAt(0)).toBe(expectedCodeUnits[item.case_id as string]);
      expect(item.runtime_injection_required).toBe(true);
      expect(preflightUnicode({ json_projection: injectedValue })).toEqual({ ok: false, error: expect.objectContaining({ code: "export-invalid-unicode" }) });
      expect(preflightUnicode({ markdown_projection: injectedValue })).toEqual({ ok: false, error: expect.objectContaining({ code: "export-invalid-unicode" }) });
    }
  });

  it("generates legal 50-event revision history and validates the frozen export", () => {
    const fixture = readFixture("edge-revision-limit.json");
    const assertions = fixture.namespace_assertions as Record<string, unknown>;
    expect(typeof assertions.sessionRevision).toBe("number");
    expect(assertions.initial_session_revision).toBe(0);
    expect(assertions.accepted_confirmation_count).toBe(50);
    expect(assertions.session_revision_derived_from_confirmations).toBe(true);
    expect(assertions.snapshot_revision).toBe(assertions.sessionRevision);
    expect(assertions.snapshot_revision_copies_sessionRevision).toBe(true);
    expect(assertions.revision_namespaces).toEqual([
      "periodRef.revision",
      "sessionRevision/snapshot_revision",
      "confirmed-input-revision.sequence",
    ]);
    const generator = fixture.revision_envelope_generation_contract as Record<string, unknown>;
    expect(generator.generator_kind).toBe("deterministic-confirmed-input-revision-v1");
    expect(generator.deterministic).toBe(true);
    expect(generator.generator_output_is_replayable).toBe(true);
    expect(generator.envelope_fields).toEqual([
      "sequence", "event_type", "event_status", "actor", "time_context", "field_id", "before", "after",
      "raw_decimal_before", "raw_decimal_after", "confirmed_at", "invalidated_result_ids", "old_results", "ruleset_ref",
    ]);
    expect((generator.envelope_fields as readonly string[]).includes("sessionRevision")).toBe(false);

    const sequenceRange = generator.sequence_range as Record<string, number>;
    const algorithm = generator.envelope_algorithm as Record<string, unknown>;
    const oldResultTimeContract = algorithm.old_results_generated_at as Record<string, unknown>;
    expect(oldResultTimeContract.sequence_one).toBe("baseline_ref.original_time_context");
    expect(oldResultTimeContract.sequence_greater_than_one).toBe("event[n-1].current_result_generated_at");
    expect(oldResultTimeContract.current_result_generated_at).toBe("event[n].time_context");
    const timeTemplate = generator.time_context_template as Record<string, unknown>;
    const expectedResultIds = (fixture.baseline_ref as Record<string, unknown>).expected_result_ids as readonly string[];
    const requiredOldResultFields = generator.old_result_required_fields as readonly string[];
    const baseline = readFixture("syn-02-complete-purchase-forecast.json");
    const baselineTime = fixtureTimeContext(baseline);
    expect((fixture.baseline_ref as Record<string, unknown>).original_time_context).toEqual(exportTimeContext(baselineTime));
    let finalCalculation: readonly CalculationResult[] | null = null;
    const envelopes = Array.from({ length: sequenceRange.count }, (_, index) => {
      const sequence = sequenceRange.first + index;
      const sequencePadded = String(sequence).padStart(3, "0");
      const previousSequencePadded = String(sequence - 1).padStart(3, "0");
      const recordedAt = `${REVISION_TIME_BASE}${sequencePadded}Z`;
      const previousRecordedAt = `${REVISION_TIME_BASE}${previousSequencePadded}Z`;
      const currentTime: CalculationTimeContext = {
        occurredAtUtc: recordedAt,
        recordedAtUtc: recordedAt,
        clockSource: timeTemplate.clock_source as "device-clock",
        timeZoneId: timeTemplate.time_zone_id as string,
        utcOffset: timeTemplate.utc_offset as string,
        timeZoneSource: timeTemplate.time_zone_source as "utc-fallback",
        timeZoneConfirmation: timeTemplate.time_zone_confirmation as "unconfirmed",
      };
      const previousTime: CalculationTimeContext = sequence === sequenceRange.first
        ? baselineTime
        : {
            ...currentTime,
            occurredAtUtc: previousRecordedAt,
            recordedAtUtc: previousRecordedAt,
          };
      const beforeIncome = 10000n + BigInt(sequence - 1);
      const afterIncome = 10000n + BigInt(sequence);
      const beforeResults = calculatePurchaseDecision(revisionCalculationRequest(baseline, beforeIncome, exportTimeContext(previousTime), currentTime));
      const currentResults = calculatePurchaseDecision(revisionCalculationRequest(baseline, afterIncome, exportTimeContext(currentTime), currentTime));
      assertRevisionCalculation(beforeResults, beforeIncome, previousTime);
      assertRevisionCalculation(currentResults, afterIncome, currentTime);
      if (sequence === sequenceRange.last) finalCalculation = currentResults;
      const event = {
        sequence,
        event_type: algorithm.event_type,
        event_status: algorithm.event_status,
        actor: algorithm.actor,
        time_context: exportTimeContext(currentTime),
        field_id: algorithm.field_id,
        before: makeIncomeRevisionValue(beforeIncome),
        after: makeIncomeRevisionValue(afterIncome),
        raw_decimal_before: beforeIncome.toString(),
        raw_decimal_after: afterIncome.toString(),
        confirmed_at: recordedAt,
        invalidated_result_ids: [...expectedResultIds],
        old_results: expectedResultIds.map((formulaId) => oldResultFromCalculation(calculationResult(beforeResults, formulaId), previousTime)),
        ruleset_ref: RULESET_REF,
      };
      expect(Object.keys(event)).toEqual(generator.envelope_fields);
      expect(Object.hasOwn(event, "sessionRevision")).toBe(false);
      expect(event.time_context).toEqual(expect.objectContaining({
        occurred_at_utc: recordedAt,
        recorded_at_utc: recordedAt,
        clock_source: "device-clock",
        time_zone_id: "Etc/UTC",
        utc_offset: "+00:00",
        time_zone_source: "utc-fallback",
        time_zone_confirmation: "unconfirmed",
      }));
      expect((event.before as Record<string, unknown>).value).toEqual({
        kind: "money",
        minor_units: (beforeIncome * 100n).toString(),
        minor_unit: 2,
        currency_code: "CNY",
      });
      expect((event.after as Record<string, unknown>).value).toEqual({
        kind: "money",
        minor_units: (afterIncome * 100n).toString(),
        minor_unit: 2,
        currency_code: "CNY",
      });
      expect(event.raw_decimal_before).toBe(beforeIncome.toString());
      expect(event.raw_decimal_after).toBe(afterIncome.toString());
      expect(event.old_results).toHaveLength(5);
      for (const oldResult of event.old_results) {
        expect(Object.keys(oldResult)).toEqual(requiredOldResultFields);
        expect(oldResult.generated_at).toEqual(exportTimeContext(previousTime));
        expect(oldResult.ruleset_ref).toBe(RULESET_REF);
      }
      return event;
    });
    expect(envelopes.map((envelope) => envelope.sequence)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect((envelopes[0].before as Record<string, unknown>).value).toEqual(expect.objectContaining({ minor_units: "1000000" }));
    expect((envelopes.at(-1)?.after as Record<string, unknown>).value).toEqual(expect.objectContaining({ minor_units: "1005000" }));
    for (const oldResult of envelopes[0].old_results) expect(oldResult.generated_at).toEqual(exportTimeContext(baselineTime));
    for (const oldResult of envelopes[1].old_results) expect(oldResult.generated_at).toEqual(envelopes[0].time_context);

    expect(finalCalculation).not.toBeNull();
    if (finalCalculation === null) return;
    const finalTime: CalculationTimeContext = {
      occurredAtUtc: "2026-01-15T00:00:00.050Z",
      recordedAtUtc: "2026-01-15T00:00:00.050Z",
      clockSource: "device-clock",
      timeZoneId: "Etc/UTC",
      utcOffset: "+00:00",
      timeZoneSource: "utc-fallback",
      timeZoneConfirmation: "unconfirmed",
    };
    const finalExpectedResults = fixture.final_current_results as readonly Record<string, unknown>[];
    const representativeResults = fixture.representative_current_results as readonly Record<string, unknown>[];
    expect(representativeResults.map((result) => result.formula_id)).toEqual(finalExpectedResults.map((result) => result.formula_id));
    expect(representativeResults.map((result) => (result.exact as Record<string, unknown>).rational ?? (result.exact as Record<string, unknown>).decimal)).toEqual(
      finalExpectedResults.map((result) => (result.exact as Record<string, unknown>).rational ?? (result.exact as Record<string, unknown>).decimal),
    );
    expect(representativeResults.every((result) => result.export_semantics === "current-snapshot")).toBe(true);
    expect(finalExpectedResults.map((result) => result.formula_id)).toEqual(RESULT_FORMULA_IDS);
    expect(finalExpectedResults.map((result) => (result.exact as Record<string, unknown>).rational ?? (result.exact as Record<string, unknown>).decimal)).toEqual([
      { numerator: "1005", denominator: "16" },
      { numerator: "3200", denominator: "201" },
      "4050",
      "3050",
      "-1000",
    ]);
    expect(finalExpectedResults.map((result) => result.display_value ?? (result.display as Record<string, unknown>)?.decimal)).toBeDefined();
    for (const expected of finalExpectedResults) {
      const actual = calculationResult(finalCalculation, String(expected.formula_id));
      const exact = expected.exact as Record<string, unknown>;
      const display = expected.display as Record<string, unknown>;
      expect(actual.availability).toBe(expected.availability);
      expect(actual.evidenceStatus).toBe(expected.evidence_status);
      expect(actual.exact?.rational ?? actual.exact?.decimal).toEqual(exact.rational ?? exact.decimal);
      expect(actual.display?.decimal).toBe(display.decimal);
      expect(actual.display?.relation).toBe(display.relation);
      expect(actual.timeContext).toEqual(finalTime);
    }
    const base = makeExportSource();
    const finalResults = finalCalculation.map((result) => resultRecordFromCalculation(result, finalTime));
    const finalInputs = base.inputs.map((input) => input.field_id === "income"
      ? { ...input, value: { kind: "money" as const, minor_units: "1005000", minor_unit: 2 as const, currency_code: "CNY" }, confirmed_at: finalTime.recordedAtUtc }
      : input.availability === "available" ? { ...input, confirmed_at: finalTime.recordedAtUtc } : input);
    const source = makeExportSource({
      session_revision: 50,
      session_revision_start: 50,
      session_revision_end: 50,
      snapshot_revision: 50,
      snapshot_captured_at: exportTimeContext(finalTime),
      comparison_context: { ...base.comparison_context, time_zone_source: "utc-fallback", time_zone_confirmation: "unconfirmed" },
      inputs: finalInputs,
      results: finalResults,
      confirmed_revisions: envelopes,
    });
    const frozen = freezeExportSnapshot(source);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const serialized = serializeJsonSnapshot(frozen.value, { file_generated_at: exportTimeContext(finalTime), current_session_revision: 50 });
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const wire = JSON.parse(serialized.value.text) as Record<string, unknown>;
    expect(validateWireSnapshot(wire).ok).toBe(true);
    expect((wire.confirmed_revisions as readonly unknown[])).toHaveLength(50);
    expect(wire.snapshot_revision).toBe(50);
    const revisionCases = fixture.revision_cases as readonly Record<string, unknown>[];
    expect(revisionCases.find((item) => item.case_id === "MAX-50")?.expected_session_revision).toBe(50);
    expect(revisionCases.find((item) => item.case_id === "BLOCK-51")?.expected_confirmation).toBe("blocked-before-event");
    expect(revisionCases.find((item) => item.case_id === "BLOCK-51")?.expected_session_revision).toBe(50);
    expect((fixture.expected_export as Record<string, unknown>).snapshot_revision).toBe(50);
  });

  it("replays fixture inputs through the complete JSON/Markdown export chain", () => {
    const markdownFixture = readFixture("edge-markdown-unicode.json");
    const markdownBaseline = readFixture("syn-01-confirmed-no-fixed-cost.json");
    const textCase = markdownFixture.text_case as Record<string, unknown>;
    const markdownReplay = {
      ...markdownBaseline,
      inputs: (markdownBaseline.inputs as readonly Record<string, unknown>[]).map((field) => field.field_id === "value-expectation"
        ? { ...field, raw: textCase.text, value: { kind: "text", text: textCase.text, text_encoding: "unicode-scalar-v1" } }
        : field),
    };
    const cases = [
      readFixture("syn-02-complete-purchase-forecast.json"),
      readFixture("syn-04-missing-hours-local-insufficiency.json"),
      markdownReplay,
    ];
    for (const fixture of cases) {
      const results = calculatePurchaseDecision(requestFromCalculationFixture(fixture, null));
      expect(results).toHaveLength(5);
      const source = fixtureExportSource(fixture, results);
      const fixtureContext = fixture.context as Record<string, unknown>;
      const comparison = source.comparison_context as Record<string, unknown>;
      const sourceInputs = source.inputs as readonly Record<string, unknown>[];
      expect(comparison.period_ref).toEqual(fixtureContext.period_ref ?? null);
      expect(sourceInputs.find((input) => input.field_id === "comparison-period")?.period_ref).toEqual(fixtureContext.period_ref ?? null);
      const frozen = freezeExportSnapshot(source);
      if (!frozen.ok) throw new Error(`${String(fixture.fixture_id)} fixture export failed: ${JSON.stringify(frozen)}`);
      expect(frozen.ok, String(fixture.fixture_id)).toBe(true);
      if (!frozen.ok) continue;
      const time = fixtureTimeContext(fixture);
      const json = serializeJsonSnapshot(frozen.value, { file_generated_at: exportTimeContext(time), current_session_revision: 1 });
      const markdown = serializeMarkdownSnapshot(frozen.value, { file_generated_at: exportTimeContext(time), current_session_revision: 1 });
      expect(markdown.ok, `${String(fixture.fixture_id)} Markdown: ${markdown.ok ? "ok" : markdown.error.code}`).toBe(true);
      expect(json.ok, `${String(fixture.fixture_id)} JSON`).toBe(true);
      if (!json.ok || !markdown.ok) continue;
      expect(compareJsonMarkdownSemantics(json.value, markdown.value), `${String(fixture.fixture_id)} JSON/Markdown equivalence`).toEqual({ ok: true, value: undefined });
      expect(validateWireSnapshot(JSON.parse(json.value.text) as Record<string, unknown>).ok, `${String(fixture.fixture_id)} JSON validation`).toBe(true);
      const decoded = decodeMarkdownSnapshot(markdown.value.text);
      expect(decoded.ok, `${String(fixture.fixture_id)} Markdown decode`).toBe(true);
      if (fixture.fixture_id === "SYN-04") {
        expect(results.filter((result) => result.availability === "unavailable").map((result) => result.formulaId)).toEqual(["income-rate", "work-time-equivalent"]);
        expect(frozen.value.results[0].exact_value).toBeNull();
        expect(frozen.value.results[1].exact_value).toBeNull();
        expect(frozen.value.results[2].availability).toBe("available");
      }
      if (fixture === markdownReplay) {
        expect(json.value.text).toContain("\\u0001");
        expect(markdown.value.text).toContain("<script>alert(1)</script>");
        expect(markdown.value.text).toContain("example.invalid");
        const opening = markdown.value.text.match(/^(\`{3,})json\n/m);
        expect(opening).not.toBeNull();
        if (opening !== null) {
          const fence = opening[1];
          const payloadStart = opening.index as number;
          const payloadEnd = markdown.value.text.indexOf(`\n${fence}\n`, payloadStart + opening[0].length);
          expect(payloadEnd).toBeGreaterThan(payloadStart);
          if (payloadEnd > payloadStart) {
            const outside = `${markdown.value.text.slice(0, payloadStart)}${markdown.value.text.slice(payloadEnd + fence.length + 2)}`;
            expect(outside).not.toMatch(/<\/?[A-Za-z!][^>]*>/);
            expect(outside).not.toMatch(/!?(?:\[[^\]]*\])\([^)]*\)/);
            expect(outside).not.toMatch(/\bhttps?:\/\//i);
          }
        }
        expect(decoded.ok).toBe(true);
        if (decoded.ok) {
          const decodedInput = (decoded.value.inputs as readonly Record<string, unknown>[]).find((input) => input.field_id === "value-expectation");
          expect(decodedInput?.value).toEqual({ kind: "text", text: textCase.text, text_encoding: "unicode-scalar-v1" });
        }
      }
    }
  });

  it("declares complete five-result replay contracts for numeric and minor-unit cases", () => {
    for (const file of ["edge-numeric-limits.json", "edge-currency-minor-units.json"]) {
      const fixture = readFixture(file);
      const replay = fixture.replay_contract as Record<string, unknown>;
      const contract = replay.full_result_set_contract as Record<string, unknown>;
      expect(contract.replay_mode).toBe("complete-five-result-session");
      expect(contract.result_count_per_case).toBe(5);
      expect(contract.formula_order).toEqual([
        "income-rate", "work-time-equivalent", "coverage-available-margin", "purchase-after-margin", "purchase-impact",
      ]);
      expect((contract.base_result_expectations as readonly unknown[])).toHaveLength(5);
      expect(contract.per_case_oracle_key).toBe("case_result_expectations");
      if (file === "edge-numeric-limits.json") expect(contract.invalid_result_template).toBeUndefined();
      else expect((contract.invalid_result_template as Record<string, unknown>).result_ids).toEqual(contract.formula_order);
      const caseExpectations = fixture.case_result_expectations as Record<string, readonly Record<string, unknown>[]>;
      expect(Object.keys(caseExpectations).length).toBeGreaterThan(0);
      for (const [caseId, results] of Object.entries(caseExpectations)) {
        expect(results).toHaveLength(5);
        expect(results.map((result) => result.formula_id)).toEqual(contract.formula_order);
        for (const result of results) {
          expect(result.case_id).toBe(caseId);
          expect(Object.hasOwn(result, "exact")).toBe(true);
          expect(Object.hasOwn(result, "availability")).toBe(true);
          expect(Object.hasOwn(result, "evidence_status")).toBe(true);
          expect(Object.hasOwn(result, "primary_reason_code")).toBe(true);
          expect(Array.isArray(result.reason_codes)).toBe(true);
          expect(Array.isArray(result.dependency_field_ids)).toBe(true);
          expect(typeof result.export_semantics).toBe("string");
        }
      }
      if (file === "edge-numeric-limits.json") {
        const hoursCase = caseExpectations["HOURS-7-INTEGER-DIGITS"];
        expect(hoursCase.slice(0, 2).every((result) => result.availability === "unavailable")).toBe(true);
        expect(hoursCase.slice(2).every((result) => result.availability === "available")).toBe(true);
        expect(caseExpectations["HOURS-4-FRACTION-DIGITS"].slice(0, 2).every((result) => result.availability === "unavailable")).toBe(true);
        expect(caseExpectations["HOURS-4-FRACTION-DIGITS"].slice(2).every((result) => result.availability === "available")).toBe(true);
        expect(caseExpectations["AMOUNT-TOKEN-OVER-32"].every((result) => result.availability === "unavailable")).toBe(true);
        expect(caseExpectations["RAW-FIELD-OVER-64"].every((result) => result.availability === "unavailable")).toBe(true);
      }
    }
  });

  it("blocks context-conflict exports while retaining evidence on the calculation-only projection", () => {
    for (const file of ["edge-period-conflict.json", "edge-currency-conflict.json", "edge-tax-basis-conflict.json"]) {
      const fixture = readFixture(file);
      const expectedExport = fixture.expected_export as Record<string, unknown>;
      const workflow = fixture.workflow as Record<string, unknown>;
      expect(expectedExport.eligible).toBe(false);
      expect(expectedExport.export_error_code).toBe("export-pending-edit");
      expect(expectedExport.snapshot_created).toBe(false);
      expect(expectedExport.null_results_in_snapshot).toBe(false);
      expect(workflow.state).toBe("pending-reconfirmation");
      const inputs = fixture.inputs as Record<string, unknown>;
      expect(Object.values(inputs.evidence_status_by_field as Record<string, unknown>).every((value) => value === "user-confirmed")).toBe(true);
      for (const result of fixture.expected_results as readonly Record<string, unknown>[]) {
        expect(result.export_semantics).toBe("calculation-only-ui-local-result; no-snapshot-json-none");
        expect(String(result.export_semantics)).not.toMatch(/^include-/);
      }
    }
    const negativeMargin = readFixture("edge-negative-margin.json");
    const evidence = (negativeMargin.inputs as Record<string, unknown>).evidence_status_by_field as Record<string, unknown>;
    expect(Object.values(evidence).every((value) => value === "user-confirmed")).toBe(true);
  });

  it("keeps coverage primary reasons separate from covered errors", () => {
    const matrix = JSON.parse(readFileSync(resolve(evidenceRoot, "coverage-matrix.json"), "utf8")) as {
      readonly rows: readonly Record<string, unknown>[];
    };
    expect(matrix.rows).toHaveLength(19);
    for (const row of matrix.rows) {
      expect(Array.isArray(row.primary_reasons)).toBe(true);
      expect(Array.isArray(row.covered_reason_or_error_codes)).toBe(true);
    }
    const failures = matrix.rows.find((row) => row.fixture_id === "EDGE-FAILURES");
    expect(failures?.primary_reasons).toEqual(["division-by-zero", "rule-execution-failed"]);
    expect(failures?.covered_reason_or_error_codes).toContain("export-schema-mismatch");
    const expectedPrimaryReasons: Record<string, string[]> = {
      "EDGE-ZERO": ["zero-not-allowed"],
      "EDGE-NEGATIVE": ["negative-not-allowed"],
      "EDGE-LIMITS": ["numeric-limit-exceeded"],
      "EDGE-MINOR-UNIT": ["fraction-exceeds-currency-minor-unit", "unsupported-currency"],
      "EDGE-MARKDOWN-UNICODE": ["missing-fixed-cost"],
      "EDGE-UNICODE-REJECT": ["missing-fixed-cost"],
    };
    for (const [fixtureId, reasons] of Object.entries(expectedPrimaryReasons)) {
      const row = matrix.rows.find((item) => item.fixture_id === fixtureId);
      expect(row?.primary_reasons).toEqual(reasons);
    }
    const expectedCoveredReasons: Record<string, string[]> = {
      "EDGE-EMPTY": ["missing-fixed-cost", "export-no-input"],
      "EDGE-ZERO": ["export-no-input"],
      "EDGE-NEGATIVE": ["export-no-input"],
      "EDGE-LIMITS": ["export-pending-edit"],
      "EDGE-MINOR-UNIT": ["export-pending-edit"],
    };
    for (const [fixtureId, reasons] of Object.entries(expectedCoveredReasons)) {
      const row = matrix.rows.find((item) => item.fixture_id === fixtureId);
      for (const reason of reasons) expect(row?.covered_reason_or_error_codes).toContain(reason);
      for (const reason of row?.primary_reasons as readonly string[]) expect(reason).not.toMatch(/^export-/);
    }
  });
});
