import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENCY_TABLE_SNAPSHOT_ID,
  DEFAULT_CURRENCY_TABLE,
  FORMULA_EXPRESSIONS,
  calculatePurchaseDecision,
  parseMoney,
  parseWorkHours,
  rationalDisplay,
  rationalFromDecimalParts,
  roundHalfAwayFromZero,
  type CalculationRequest,
  type CalculationResult,
  type CurrencyTable,
  type PeriodRef,
  type TimeContext,
} from "../../../src/domain/calculation/index.js";

const fixtureRoot = resolve(process.cwd(), "tests/fixtures/synthetic");
const manifest = JSON.parse(
  readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8"),
) as {
  readonly fixture_count: number;
  readonly fixtures: readonly { readonly fixture_id: string; readonly file: string }[];
};

const SYNTHETIC_TIME_CONTEXT: TimeContext = {
  occurredAtUtc: "2026-01-15T00:00:00.000Z",
  recordedAtUtc: "2026-01-15T00:00:00.000Z",
  clockSource: "device-clock",
  timeZoneId: "Etc/UTC",
  utcOffset: "+00:00",
  timeZoneSource: "user-selected",
  timeZoneConfirmation: "user-confirmed",
};

function periodRef(value: unknown): PeriodRef | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const kind = item.kind === "period-ref" ? item.period_kind : item.kind ?? item.period_kind;
  const revision = item.revision;
  if (
    (kind !== "week" && kind !== "month" && kind !== "year" && kind !== "custom") ||
    typeof revision !== "string"
  ) return null;
  return {
    kind,
    customLabel: (item.customLabel ?? item.custom_label ?? null) as string | null,
    revision,
  };
}

function timeContext(value: unknown): TimeContext | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const mapped = {
    occurredAtUtc: item.occurredAtUtc ?? item.occurred_at_utc,
    recordedAtUtc: item.recordedAtUtc ?? item.recorded_at_utc,
    clockSource: item.clockSource ?? item.clock_source,
    timeZoneId: item.timeZoneId ?? item.time_zone_id,
    utcOffset: item.utcOffset ?? item.utc_offset,
    timeZoneSource: item.timeZoneSource ?? item.time_zone_source,
    timeZoneConfirmation: item.timeZoneConfirmation ?? item.time_zone_confirmation,
  };
  if (Object.values(mapped).some((item) => typeof item !== "string")) return null;
  return mapped as TimeContext;
}

const FIELD_ALIASES: Record<string, string> = {
  "comparison-period": "comparisonPeriod",
  comparison_period: "comparisonPeriod",
  currency: "currency",
  currency_code: "currency",
  income: "income",
  "income-tax-basis": "incomeTaxBasis",
  income_tax_basis: "incomeTaxBasis",
  tax_basis: "incomeTaxBasis",
  "work-hours": "workHours",
  work_hours: "workHours",
  "purchase-price": "purchasePrice",
  purchase_price: "purchasePrice",
  "purchase-period-inclusion": "purchasePeriodInclusion",
  purchase_period_inclusion: "purchasePeriodInclusion",
  "fixed-cost-total": "fixedCostTotal",
  fixed_cost_total: "fixedCostTotal",
  "fixed-cost-coverage": "fixedCostCoverage",
  fixed_cost_coverage: "fixedCostCoverage",
  "fixed-cost-coverage-description": "fixedCostCoverageDescription",
  fixed_cost_coverage_description: "fixedCostCoverageDescription",
  value_expectation: "valueExpectation",
  "value-expectation": "valueExpectation",
};

function fixtureField(field: Record<string, unknown>): Record<string, unknown> {
  return {
    availability: field.availability === "not-provided" ? "not-provided" : "available",
    raw: field.raw,
    value: field.value,
    evidenceStatus: field.evidence_status ?? field.evidenceStatus,
    periodRef: periodRef(field.period_ref ?? field.periodRef),
    currencyCode: field.currency_code ?? field.currencyCode,
    taxBasis: field.tax_basis ?? field.taxBasis,
    assumptions: field.assumptions,
  };
}

function objectInputField(
  key: string,
  value: unknown,
  objectInputs: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    const periodKey =
      key === "purchase_period_inclusion" ? "purchase_period_ref" : `${key}_period_ref`;
    return {
      availability: "available",
      raw: value,
      value,
      evidenceStatus: "user-confirmed",
      periodRef: periodRef(objectInputs[periodKey]),
    };
  }
  const field = value as Record<string, unknown>;
  const rawValue = field.raw ?? (key === "currency" ? field.code : undefined);
  const nestedValue = field.value ?? field;
  const periodKey =
    key === "purchase_period_inclusion" ? "purchase_period_ref" : `${key}_period_ref`;
  const period = periodRef(field.period_ref ?? field.periodRef ?? objectInputs[periodKey]);
  return {
    availability: "available",
    raw: rawValue,
    value: nestedValue,
    evidenceStatus: field.evidence_status ?? field.evidenceStatus ?? "user-confirmed",
    periodRef: period,
    currencyCode: field.currency_code ?? field.currencyCode,
    taxBasis: field.tax_basis ?? field.taxBasis,
    assumptions: field.assumptions,
  };
}

function requestFromFixture(fixture: Record<string, unknown>): CalculationRequest {
  const rawContext = (fixture.context ?? {}) as Record<string, unknown>;
  const rawPeriod = rawContext.period_ref ?? rawContext.declared_period;
  const contextPeriod = periodRef(rawPeriod);
  const contextCurrency =
    (rawContext.currency_code ?? rawContext.declared_currency_code) as string | undefined;
  const contextTax = (rawContext.tax_basis ?? rawContext.declared_tax_basis) as
    | "before-tax"
    | "after-tax"
    | undefined;
  const rawTimeContext = rawContext.time_context ?? rawContext.timeContext;
  const context = {
    periodRef: contextPeriod,
    currencyCode: contextCurrency ?? null,
    currencyTableSnapshotId:
      (rawContext.currency_table_snapshot_id as string | undefined) ?? CURRENCY_TABLE_SNAPSHOT_ID,
    taxBasis: contextTax ?? null,
    timeContext: timeContext(rawTimeContext),
    rulesetId: "purchase-decision-rules",
    rulesetVersion: "1.0.0",
  };
  const inputList = Array.isArray(fixture.inputs) ? fixture.inputs : [];
  const inputs: Record<string, unknown> = {};
  for (const item of inputList) {
    if (typeof item !== "object" || item === null) continue;
    const field = item as Record<string, unknown>;
    const fieldId = field.field_id;
    if (typeof fieldId !== "string") continue;
    const target = FIELD_ALIASES[fieldId] ?? FIELD_ALIASES[fieldId.replaceAll("-", "_")];
    if (target !== undefined) inputs[target] = fixtureField(field);
  }
  if (!Array.isArray(fixture.inputs) && typeof fixture.inputs === "object" && fixture.inputs !== null) {
    const objectInputs = fixture.inputs as Record<string, unknown>;
    for (const [key, value] of Object.entries(objectInputs)) {
      const target = FIELD_ALIASES[key];
      if (target === undefined) continue;
      inputs[target] = objectInputField(key, value, objectInputs);
    }
    const declared = objectInputs["comparison-period"] ?? objectInputs.comparison_period;
    if (declared !== undefined) {
      inputs.comparisonPeriod = {
        availability: "available",
        raw: typeof declared === "object" && declared !== null ? null : declared,
        value: declared,
        evidenceStatus: "user-confirmed",
        periodRef: periodRef(declared),
      };
    }
  }
  if (inputs.comparisonPeriod === undefined && contextPeriod !== null) {
    inputs.comparisonPeriod = {
      availability: "available",
      raw: contextPeriod.kind,
      value: contextPeriod,
      evidenceStatus: "user-confirmed",
      periodRef: contextPeriod,
    };
  }
  if (inputs.currency === undefined && contextCurrency !== undefined) {
    inputs.currency = {
      availability: "available",
      raw: contextCurrency,
      value: contextCurrency,
      evidenceStatus: "user-confirmed",
    };
  }
  if (inputs.incomeTaxBasis === undefined && contextTax !== undefined) {
    inputs.incomeTaxBasis = {
      availability: "available",
      raw: contextTax,
      value: contextTax,
      evidenceStatus: "user-confirmed",
    };
  }
  return { context, inputs };
}

function fixture(id: string): Record<string, unknown> {
  const entry = manifest.fixtures.find((item) => item.fixture_id === id);
  if (entry === undefined) throw new Error(`missing fixture ${id}`);
  return JSON.parse(readFileSync(resolve(fixtureRoot, entry.file), "utf8")) as Record<string, unknown>;
}

function result(results: readonly CalculationResult[], formulaId: string): CalculationResult {
  const found = results.find((item) => item.formulaId === formulaId);
  if (found === undefined) throw new Error(`missing result ${formulaId}`);
  return found;
}

function canonicalFixtureUnit(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "hour") return "小时";
  return value.replaceAll("/hour", "/小时").replaceAll(" hour", " 小时");
}

function assertExpectedResult(
  actual: CalculationResult,
  expected: Record<string, unknown>,
): void {
  expect(actual.source).toBe("ruleset-derived");
  expect(actual.formulaExpression).toBe(FORMULA_EXPRESSIONS[actual.formulaId]);
  expect(actual.availability).toBe(expected.availability);
  expect(actual.evidenceStatus).toBe(expected.evidence_status);
  expect(actual.primaryReasonCode).toBe(expected.primary_reason_code ?? null);
  if (Array.isArray(expected.reason_codes)) expect(actual.reasonCodes, String(expected.formula_id)).toEqual(expected.reason_codes);
  if (Array.isArray(expected.dependency_field_ids)) {
    expect(actual.dependencyFieldIds).toEqual(expected.dependency_field_ids);
  }
  if (Array.isArray(expected.estimated_dependency_field_ids)) {
    expect(actual.estimatedDependencyFieldIds).toEqual(expected.estimated_dependency_field_ids);
  }
  expect(actual.rulesetRef).toBe("purchase-decision-rules@1.0.0");
  expect(actual.rulesetId).toBe("purchase-decision-rules");
  expect(actual.rulesetVersion).toBe("1.0.0");
  expect(actual.currencyTableSnapshotId).toBe(CURRENCY_TABLE_SNAPSHOT_ID);
  if (actual.formulaId === "income-rate") {
    expect(actual.unit).toBe(`${actual.currencyCode ?? "currency"}/小时`);
  }
  if (actual.formulaId === "work-time-equivalent") expect(actual.unit).toBe("小时");
  if (expected.period_ref !== undefined) expect(actual.periodRef).toEqual(periodRef(expected.period_ref));
  if (expected.tax_basis !== undefined) expect(actual.taxBasis).toBe(expected.tax_basis);

  const expectedExact = expected.exact as Record<string, unknown> | null;
  if (expectedExact === null) {
    expect(actual.exact).toBeNull();
    expect(actual.display).toBeNull();
    return;
  }
  expect(actual.exact).not.toBeNull();
  expect(actual.display).not.toBeNull();
  if (actual.exact !== null) {
    if (expectedExact.rational !== undefined) expect(actual.exact.rational).toEqual(expectedExact.rational);
    if (expectedExact.minor_units !== undefined) expect(actual.exact.minorUnits).toBe(expectedExact.minor_units);
    if (expectedExact.currency_code !== undefined) expect(actual.exact.currencyCode).toBe(expectedExact.currency_code);
    if (expectedExact.unit !== undefined) expect(actual.exact.unit).toBe(canonicalFixtureUnit(expectedExact.unit));
    if (expectedExact.decimal !== undefined && expectedExact.decimal !== null) {
      expect(actual.exact.decimal).toBe(expectedExact.decimal);
    }
  }
  const expectedDisplay = expected.display as Record<string, unknown>;
  if (actual.display !== null) {
    expect(actual.display.decimal).toBe(expectedDisplay.decimal);
    expect(actual.display.displayDigits).toBe(expectedDisplay.display_digits);
    expect(actual.display.relation).toBe(expectedDisplay.relation);
    expect(actual.display.roundingMode).toBe(expectedDisplay.rounding_mode);
    expect(actual.display.rounded).toBe(expectedDisplay.rounded);
    expect(actual.display.text).toBe(canonicalFixtureUnit(expectedDisplay.text) as string);
  }
}

describe("calculation fixture inventory and contracts", () => {
  it("keeps all 19 vectors synthetic and non-personal", () => {
    expect(manifest.fixture_count).toBe(19);
    expect(manifest.fixtures).toHaveLength(19);
    for (const entry of manifest.fixtures) {
      const loaded = fixture(entry.fixture_id);
      expect(loaded.synthetic_only).toBe(true);
      expect((loaded.evidence as Record<string, unknown>).contains_personal_data).toBe(false);
    }
  });

  it("fails closed when a calculation replay lacks a complete TimeContext", () => {
    const loaded = fixture("SYN-02");
    const request = requestFromFixture({
      ...loaded,
      context: { ...(loaded.context as Record<string, unknown>), time_context: null },
    });
    const results = calculatePurchaseDecision(request);
    expect(results.map((item) => item.formulaId)).toEqual([
      "income-rate",
      "work-time-equivalent",
      "coverage-available-margin",
      "purchase-after-margin",
      "purchase-impact",
    ]);
    expect(results.every((item) => item.source === "ruleset-derived")).toBe(true);
    expect(results.every((item) => item.availability === "unavailable")).toBe(true);
    expect(results.every((item) => item.reasonCodes.includes("rule-execution-failed"))).toBe(true);
    expect(results.every((item) => item.timeContext === null)).toBe(true);
  });
});

describe("restricted exact parser and structured input gates", () => {
  it.each([
    ["10000", true, null],
    ["999999999999999.99", true, null],
    ["0", false, "zero-not-allowed"],
    ["-1", false, "negative-not-allowed"],
    ["+1", false, "invalid-decimal"],
    ["1e2", false, "invalid-decimal"],
    ["1,000", false, "invalid-decimal"],
    ["1.001", false, "fraction-exceeds-currency-minor-unit"],
  ] as const)("parse money %s", (raw, valid, reason) => {
    const parsed = parseMoney(raw, "CNY");
    expect(parsed.ok).toBe(valid);
    if (!valid && reason !== null && parsed.ok === false) expect(parsed.reasonCode).toBe(reason);
  });

  it("accepts declared maxima and rejects excess precision", () => {
    expect(parseMoney("999999999999999.99", "CNY").ok).toBe(true);
    expect(parseWorkHours("999999.999").ok).toBe(true);
    expect(parseWorkHours("1.0000")).toEqual({ ok: false, reasonCode: "numeric-limit-exceeded" });
  });

  it("fails malformed structured rational values as rule failures", () => {
    const results = calculatePurchaseDecision({
      context: {
        periodRef: { kind: "month", customLabel: null, revision: "r1" },
        currencyCode: "CNY",
        currencyTableSnapshotId: CURRENCY_TABLE_SNAPSHOT_ID,
        taxBasis: "after-tax",
        timeContext: SYNTHETIC_TIME_CONTEXT,
        rulesetId: "purchase-decision-rules",
        rulesetVersion: "1.0.0",
      },
      inputs: {
        comparisonPeriod: { raw: "month", value: { kind: "month", customLabel: null, revision: "r1" }, evidenceStatus: "user-confirmed", periodRef: { kind: "month", customLabel: null, revision: "r1" } },
        currency: { raw: "CNY", value: "CNY", evidenceStatus: "user-confirmed" },
        incomeTaxBasis: { raw: "after-tax", value: "after-tax", evidenceStatus: "user-confirmed" },
        income: { raw: "10000", evidenceStatus: "user-confirmed", periodRef: { kind: "month", customLabel: null, revision: "r1" } },
        workHours: { value: { numerator: "--1", denominator: "1" } as unknown as { numerator: bigint; denominator: bigint }, evidenceStatus: "user-confirmed", periodRef: { kind: "month", customLabel: null, revision: "r1" } },
      },
    });
    expect(result(results, "income-rate").primaryReasonCode).toBe("rule-execution-failed");
  });

  it("converts an unexpected request shape into an unavailable envelope", () => {
    const results = calculatePurchaseDecision(null as unknown as CalculationRequest);
    expect(results.every((item) => item.availability === "unavailable")).toBe(true);
    expect(results.every((item) => item.primaryReasonCode === "rule-execution-failed")).toBe(true);
    expect(result(results, "income-rate").unit).toBe("currency/小时");
    expect(result(results, "work-time-equivalent").unit).toBe("小时");
  });
});

describe("exact rounding, explicit time, and local isolation", () => {
  it("accepts the application SessionInputEnvelope wrapper without raw mirrors", () => {
    const currentPeriod: PeriodRef = { kind: "month", customLabel: null, revision: "r1" };
    const results = calculatePurchaseDecision({
      context: {
        periodRef: currentPeriod,
        currencyCode: "CNY",
        currencyTableSnapshotId: CURRENCY_TABLE_SNAPSHOT_ID,
        taxBasis: "after-tax",
        timeContext: SYNTHETIC_TIME_CONTEXT,
        rulesetId: "purchase-decision-rules",
        rulesetVersion: "1.0.0",
      },
      inputs: {
        comparisonPeriod: {
          availability: "available",
          value: currentPeriod,
          evidenceStatus: "user-confirmed",
        },
        currency: {
          availability: "available",
          value: "CNY",
          evidenceStatus: "user-confirmed",
        },
        incomeTaxBasis: {
          availability: "available",
          value: "after-tax",
          evidenceStatus: "user-confirmed",
        },
        income: {
          availability: "available",
          value: "10000",
          evidenceStatus: "user-confirmed",
          periodRef: currentPeriod,
          currencyCode: "CNY",
          taxBasis: "after-tax",
        },
        workHours: {
          availability: "available",
          value: "160",
          evidenceStatus: "user-confirmed",
          periodRef: currentPeriod,
        },
        purchasePrice: {
          availability: "available",
          value: "800",
          evidenceStatus: "user-confirmed",
          periodRef: currentPeriod,
          currencyCode: "CNY",
        },
        purchasePeriodInclusion: {
          availability: "available",
          value: true,
          raw: true,
          evidenceStatus: "user-confirmed",
          periodRef: currentPeriod,
        },
        fixedCostTotal: {
          availability: "available",
          value: "1000",
          evidenceStatus: "user-confirmed",
          periodRef: currentPeriod,
          currencyCode: "CNY",
        },
        fixedCostCoverage: {
          availability: "available",
          value: "complete",
          evidenceStatus: "user-confirmed",
        },
        fixedCostCoverageDescription: {
          availability: "available",
          value: "synthetic complete coverage",
          evidenceStatus: "user-confirmed",
        },
      },
    });
    expect(result(results, "income-rate")).toMatchObject({
      availability: "available",
      unit: "CNY/小时",
    });
    expect(result(results, "income-rate").display?.text).toBe("62.50 CNY/小时");
    expect(result(results, "work-time-equivalent")).toMatchObject({
      availability: "available",
      unit: "小时",
    });
    expect(result(results, "work-time-equivalent").display?.text).toBe("12.80 小时");
    expect(result(results, "work-time-equivalent").limitations).toEqual([
      "这是工作时间比较，不代表体验本身的价值。",
    ]);
    expect(result(results, "purchase-after-margin").availability).toBe("available");
    expect(result(results, "purchase-impact").availability).toBe("available");
  });

  it("rounds positive and negative ties away from zero and keeps tiny hours visible", () => {
    const positive = rationalFromDecimalParts("1", "005");
    expect(positive.ok).toBe(true);
    if (positive.ok) {
      expect(roundHalfAwayFromZero(positive.value, 2).decimal).toBe("1.01");
      expect(roundHalfAwayFromZero({ numerator: -positive.value.numerator, denominator: positive.value.denominator }, 2).decimal).toBe("-1.01");
      expect(rationalDisplay({ numerator: 1n, denominator: 1000n }, 2, "小时", { tinyPositiveText: "<0.01" }).text).toBe("<0.01 小时");
    }
  });

  it("requires complete time context and rejects a custom table pretending to be SIX", () => {
    const base = {
      periodRef: { kind: "month" as const, customLabel: null, revision: "r1" },
      currencyCode: "CNY",
      currencyTableSnapshotId: CURRENCY_TABLE_SNAPSHOT_ID,
      taxBasis: "after-tax" as const,
      timeContext: null,
      rulesetId: "purchase-decision-rules",
      rulesetVersion: "1.0.0",
    };
    const inputs: CalculationRequest["inputs"] = {
      comparisonPeriod: { raw: "month", value: base.periodRef, evidenceStatus: "user-confirmed", periodRef: base.periodRef },
      currency: { raw: "CNY", value: "CNY", evidenceStatus: "user-confirmed" },
      incomeTaxBasis: { raw: "after-tax", value: "after-tax", evidenceStatus: "user-confirmed" },
      income: { raw: "10000", evidenceStatus: "user-confirmed", periodRef: base.periodRef },
      workHours: { raw: "160", evidenceStatus: "user-confirmed", periodRef: base.periodRef },
      purchasePrice: { raw: "1000", evidenceStatus: "user-confirmed" },
    };
    const missingTime = calculatePurchaseDecision({ context: base, inputs });
    expect(missingTime.every((item) => item.reasonCodes.includes("rule-execution-failed"))).toBe(true);
    const evaluateTime = (timeContext: unknown) =>
      calculatePurchaseDecision({
        context: { ...base, timeContext } as CalculationRequest["context"],
        inputs,
      });
    const observedBrowserZone = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      timeZoneId: "Asia/Shanghai",
      timeZoneSource: "browser-observed",
      timeZoneConfirmation: "observed",
    });
    const utcFallback = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      timeZoneId: "Etc/UTC",
      timeZoneSource: "utc-fallback",
      timeZoneConfirmation: "unconfirmed",
    });
    expect(result(observedBrowserZone, "income-rate").availability).toBe("available");
    expect(result(utcFallback, "income-rate").availability).toBe("available");
    const invalidCalendar = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      occurredAtUtc: "2026-02-30T00:00:00.000Z",
    });
    const invalidRecordedCalendar = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      recordedAtUtc: "2026-02-30T00:00:00.000Z",
    });
    const missingMilliseconds = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      occurredAtUtc: "2026-01-15T00:00:00Z",
    });
    const nonCanonicalMilliseconds = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      occurredAtUtc: "2026-01-15T00:00:00.00Z",
    });
    const ordinaryTimeZone = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      timeZoneId: "UTC",
    });
    const fallbackWithNamedZone = evaluateTime({
      ...SYNTHETIC_TIME_CONTEXT,
      timeZoneId: "Asia/Shanghai",
      timeZoneSource: "utc-fallback",
      timeZoneConfirmation: "unconfirmed",
    });
    for (const invalid of [
      invalidCalendar,
      invalidRecordedCalendar,
      missingMilliseconds,
      nonCanonicalMilliseconds,
      ordinaryTimeZone,
      fallbackWithNamedZone,
    ]) {
      expect(invalid.every((item) => item.reasonCodes.includes("rule-execution-failed"))).toBe(true);
    }
    const contextWithoutRuleset = { ...base } as Record<string, unknown>;
    delete contextWithoutRuleset.rulesetId;
    delete contextWithoutRuleset.rulesetVersion;
    const missingRuleset = calculatePurchaseDecision({
      context: contextWithoutRuleset as unknown as CalculationRequest["context"],
      inputs,
    });
    expect(missingRuleset.every((item) => item.reasonCodes.includes("rule-execution-failed"))).toBe(true);
    const customTable = { ...DEFAULT_CURRENCY_TABLE, CNY: { code: "CNY", minorUnit: 2 } } as CurrencyTable;
    const custom = calculatePurchaseDecision({
      context: { ...base, timeContext: SYNTHETIC_TIME_CONTEXT, currencyTable: customTable },
      inputs,
    });
    expect(custom.every((item) => item.reasonCodes.includes("rule-execution-failed"))).toBe(true);
    const wrongVersion = calculatePurchaseDecision({
      context: {
        ...base,
        timeContext: SYNTHETIC_TIME_CONTEXT,
        rulesetVersion: "2.0.0",
      },
      inputs,
    });
    expect(wrongVersion.every((item) => item.reasonCodes.includes("rule-execution-failed"))).toBe(true);
  });

  it("keeps period and purchase-period conflicts local", () => {
    const base = requestFromFixture(fixture("EDGE-PERIOD-CONFLICT"));
    const request: CalculationRequest = {
      ...base,
      context: { ...base.context, timeContext: SYNTHETIC_TIME_CONTEXT },
    };
    const results = calculatePurchaseDecision(request);
    expect(result(results, "income-rate").primaryReasonCode).toBe("period-mismatch");
    expect(result(results, "work-time-equivalent").primaryReasonCode).toBe("period-mismatch");
    expect(result(results, "coverage-available-margin").availability).toBe("available");
    expect(result(results, "purchase-after-margin"), JSON.stringify(result(results, "purchase-after-margin"))).toMatchObject({ availability: "available" });
    expect(result(results, "purchase-impact"), JSON.stringify(result(results, "purchase-impact"))).toMatchObject({ availability: "available" });
  });

  it("keeps currency conflicts and field tax conflicts local", () => {
    const currencyBase = requestFromFixture(fixture("EDGE-CURRENCY-CONFLICT"));
    const currencyResults = calculatePurchaseDecision({
      ...currencyBase,
      context: { ...currencyBase.context, timeContext: SYNTHETIC_TIME_CONTEXT },
      inputs: {
        ...currencyBase.inputs,
        income: { ...(currencyBase.inputs.income as Record<string, unknown>), periodRef: currencyBase.context.periodRef },
        workHours: { ...(currencyBase.inputs.workHours as Record<string, unknown>), periodRef: currencyBase.context.periodRef },
        fixedCostTotal: { ...(currencyBase.inputs.fixedCostTotal as Record<string, unknown>), periodRef: currencyBase.context.periodRef },
        purchasePeriodInclusion: { ...(currencyBase.inputs.purchasePeriodInclusion as Record<string, unknown>), periodRef: currencyBase.context.periodRef },
      },
    });
    expect(result(currencyResults, "income-rate").availability).toBe("available");
    expect(result(currencyResults, "coverage-available-margin").availability).toBe("available");
    expect(result(currencyResults, "work-time-equivalent").primaryReasonCode).toBe("currency-mismatch");
    expect(result(currencyResults, "purchase-after-margin").primaryReasonCode).toBe("currency-mismatch");

    const taxBase = requestFromFixture(fixture("SYN-02"));
    const taxResults = calculatePurchaseDecision({
      ...taxBase,
      inputs: {
        ...taxBase.inputs,
        fixedCostTotal: {
          ...(taxBase.inputs.fixedCostTotal as Record<string, unknown>),
          taxBasis: "before-tax",
        },
      },
    });
    expect(result(taxResults, "income-rate").availability).toBe("available");
    expect(result(taxResults, "work-time-equivalent").availability).toBe("available");
    expect(result(taxResults, "coverage-available-margin").primaryReasonCode).toBe("tax-basis-unconfirmed");
    expect(result(taxResults, "purchase-after-margin").primaryReasonCode).toBe("tax-basis-unconfirmed");
  });

  it("keeps negative margins exact and visible", () => {
    const base = requestFromFixture(fixture("EDGE-NEGATIVE-MARGIN"));
    const request: CalculationRequest = {
      ...base,
      context: { ...base.context, timeContext: SYNTHETIC_TIME_CONTEXT },
      inputs: {
        ...base.inputs,
        income: { ...(base.inputs.income as Record<string, unknown>), periodRef: base.context.periodRef },
        workHours: { ...(base.inputs.workHours as Record<string, unknown>), periodRef: base.context.periodRef },
        fixedCostTotal: { ...(base.inputs.fixedCostTotal as Record<string, unknown>), periodRef: base.context.periodRef },
        purchasePeriodInclusion: { ...(base.inputs.purchasePeriodInclusion as Record<string, unknown>), periodRef: base.context.periodRef },
        fixedCostCoverageDescription: {
          availability: "available",
          raw: "synthetic complete coverage",
          value: "synthetic complete coverage",
          evidenceStatus: "user-confirmed",
        },
      },
    };
    const results = calculatePurchaseDecision(request);
    expect(result(results, "coverage-available-margin").exact?.minorUnits).toBe("-20000");
    expect(result(results, "coverage-available-margin").display?.text).toContain("低于零");
    expect(result(results, "purchase-impact").evidenceStatus).toBe("forecast");
  });

  it("requires user confirmation for an estimated purchase-period inclusion", () => {
    const base = requestFromFixture(fixture("SYN-02"));
    const results = calculatePurchaseDecision({
      ...base,
      inputs: {
        ...base.inputs,
        purchasePeriodInclusion: {
          ...(base.inputs.purchasePeriodInclusion as Record<string, unknown>),
          evidenceStatus: "estimated",
        },
      },
    });
    expect(result(results, "income-rate").availability).toBe("available");
    expect(result(results, "work-time-equivalent").availability).toBe("available");
    expect(result(results, "purchase-after-margin").primaryReasonCode).toBe("purchase-period-unconfirmed");
    expect(result(results, "purchase-impact").primaryReasonCode).toBe("purchase-period-unconfirmed");
  });

  it("rejects a missing purchase-period revision without blocking local rates", () => {
    const base = requestFromFixture(fixture("SYN-02"));
    const results = calculatePurchaseDecision({
      ...base,
      inputs: {
        ...base.inputs,
        purchasePeriodInclusion: {
          ...(base.inputs.purchasePeriodInclusion as Record<string, unknown>),
          periodRef: null,
        },
      },
    });
    expect(result(results, "income-rate").availability).toBe("available");
    expect(result(results, "work-time-equivalent").availability).toBe("available");
    expect(result(results, "purchase-after-margin").primaryReasonCode).toBe("purchase-period-unconfirmed");
    expect(result(results, "purchase-impact").primaryReasonCode).toBe("purchase-period-unconfirmed");
  });

  it("does not allow structured values to bypass input limits", () => {
    const base = requestFromFixture(fixture("SYN-02"));
    const oversizedMoney = calculatePurchaseDecision({
      ...base,
      inputs: {
        ...base.inputs,
        income: {
          value: {
            minor_units: "1".padEnd(18, "0"),
            currency_code: "CNY",
            minor_unit: 2,
          },
          evidenceStatus: "user-confirmed",
          periodRef: base.context.periodRef,
        },
      },
    });
    expect(result(oversizedMoney, "income-rate").primaryReasonCode).toBe("numeric-limit-exceeded");
    const oversizedHours = calculatePurchaseDecision({
      ...base,
      inputs: {
        ...base.inputs,
        workHours: {
          value: { numerator: "1000000", denominator: "1" } as unknown as { numerator: bigint; denominator: bigint },
          evidenceStatus: "user-confirmed",
          periodRef: base.context.periodRef,
        },
      },
    });
    expect(result(oversizedHours, "income-rate").primaryReasonCode).toBe("numeric-limit-exceeded");
  });
});
