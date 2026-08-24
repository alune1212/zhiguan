import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  calculatePurchaseDecision,
  type CalculationRequest,
  type CalculationResult,
  type PeriodRef as CalculationPeriodRef,
  type TimeContext as CalculationTimeContext,
} from "../../src/domain/calculation/index.js";

type JsonRecord = Record<string, unknown>;

export interface CalculationVector {
  readonly id: string;
  readonly request: CalculationRequest;
  readonly expected:
    | { readonly kind: "fixture"; readonly results: readonly JsonRecord[] }
    | { readonly kind: "canonical"; readonly results: readonly CalculationResult[] };
}

export interface RoundingVector {
  readonly id: string;
  readonly numerator: string;
  readonly denominator: string;
  readonly displayDigits: number;
  readonly unit: string;
  readonly tinyPositiveText?: string;
  readonly expectedDecimal: string;
  readonly expectedText?: string;
}

export interface RuleVectorCatalog {
  readonly fixtureCount: number;
  readonly caseOracleCount: number;
  readonly resultOracleCount: number;
  readonly calculationResultOracleCount: number;
  readonly fixtureCalculationResultOracleCount: number;
  readonly engineParityResultCount: number;
  readonly roundingOracleCount: number;
  readonly utilityOracleCount: number;
  readonly excludedNonCalculationFailureCount: number;
  readonly vectors: readonly CalculationVector[];
  readonly roundingVectors: readonly RoundingVector[];
  readonly normalizeVector: {
    readonly numerator: string;
    readonly denominator: string;
    readonly expectedReasonCode: string;
  };
}

const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/synthetic/", import.meta.url));
const MANIFEST = readJson("manifest.json");
const SHARED_CONTRACT = MANIFEST.shared_contract as JsonRecord;

const CALC_FIELD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
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
  "value-expectation": "valueExpectation",
  value_expectation: "valueExpectation",
});

function readJson(fileName: string): JsonRecord {
  return JSON.parse(readFileSync(`${FIXTURE_ROOT}${fileName}`, "utf8")) as JsonRecord;
}

function periodRef(value: unknown): CalculationPeriodRef | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as JsonRecord;
  const kind = record.kind === "period-ref"
    ? record.period_kind
    : record.kind ?? record.period_kind;
  if (kind !== "week" && kind !== "month" && kind !== "year" && kind !== "custom") {
    return null;
  }
  if (typeof record.revision !== "string") return null;
  const customLabel = record.customLabel ?? record.custom_label ?? null;
  return {
    kind,
    customLabel: typeof customLabel === "string" ? customLabel : null,
    revision: record.revision,
  };
}

function timeContext(value: unknown): CalculationTimeContext | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as JsonRecord;
  const mapped = {
    occurredAtUtc: record.occurredAtUtc ?? record.occurred_at_utc,
    recordedAtUtc: record.recordedAtUtc ?? record.recorded_at_utc,
    clockSource: record.clockSource ?? record.clock_source,
    timeZoneId: record.timeZoneId ?? record.time_zone_id,
    utcOffset: record.utcOffset ?? record.utc_offset,
    timeZoneSource: record.timeZoneSource ?? record.time_zone_source,
    timeZoneConfirmation:
      record.timeZoneConfirmation ?? record.time_zone_confirmation,
  };
  return Object.values(mapped).every((item) => typeof item === "string")
    ? (mapped as CalculationTimeContext)
    : null;
}

function arrayField(field: JsonRecord): JsonRecord {
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

function objectField(
  key: string,
  value: unknown,
  objectInputs: JsonRecord,
  contextPeriod: CalculationPeriodRef | null,
): JsonRecord {
  const periodKey = key === "purchase_period_inclusion"
    ? "purchase_period_ref"
    : `${key}_period_ref`;
  const periodEligible = [
    "income",
    "work-hours",
    "work_hours",
    "fixed-cost-total",
    "fixed_cost_total",
    "purchase-period-inclusion",
    "purchase_period_inclusion",
  ].includes(key);
  if (typeof value !== "object" || value === null) {
    return {
      availability: "available",
      raw: value,
      value,
      evidenceStatus: "user-confirmed",
      periodRef:
        periodRef(objectInputs[periodKey]) ??
        (contextPeriod && periodEligible ? contextPeriod : null),
    };
  }
  const field = value as JsonRecord;
  return {
    availability: "available",
    raw: field.raw ?? (key === "currency" ? field.code : undefined),
    value: field.value ?? field,
    evidenceStatus: field.evidence_status ?? field.evidenceStatus ?? "user-confirmed",
    periodRef:
      periodRef(field.period_ref ?? field.periodRef ?? objectInputs[periodKey]) ??
      (contextPeriod && periodEligible ? contextPeriod : null),
    currencyCode: field.currency_code ?? field.currencyCode,
    taxBasis: field.tax_basis ?? field.taxBasis,
    assumptions: field.assumptions,
  };
}

function requestFromFixture(fixture: JsonRecord, injectedTime: unknown): CalculationRequest {
  const rawContext = (fixture.context ?? {}) as JsonRecord;
  const contextPeriod = periodRef(rawContext.period_ref ?? rawContext.declared_period);
  const contextCurrency = rawContext.currency_code ?? rawContext.declared_currency_code;
  const contextTax = rawContext.tax_basis ?? rawContext.declared_tax_basis;
  const inputs: Record<string, unknown> = {};
  const rawInputs = fixture.inputs;

  if (Array.isArray(rawInputs)) {
    for (const item of rawInputs) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as JsonRecord).field_id !== "string"
      ) {
        continue;
      }
      const field = item as JsonRecord;
      const fieldId = field.field_id as string;
      const target = CALC_FIELD_ALIASES[fieldId] ?? CALC_FIELD_ALIASES[fieldId.replaceAll("-", "_")];
      if (target) inputs[target] = arrayField(field);
    }
  } else if (typeof rawInputs === "object" && rawInputs !== null) {
    const objectInputs = rawInputs as JsonRecord;
    const merged =
      typeof objectInputs.valid === "object" &&
      objectInputs.valid !== null &&
      typeof objectInputs.invalid === "object" &&
      objectInputs.invalid !== null
        ? {
            ...(objectInputs.valid as JsonRecord),
            ...(objectInputs.invalid as JsonRecord),
          }
        : objectInputs;
    for (const [key, value] of Object.entries(merged)) {
      const target = CALC_FIELD_ALIASES[key];
      if (target) inputs[target] = objectField(key, value, merged, contextPeriod);
    }
    const declared = merged["comparison-period"] ?? merged.comparison_period;
    if (declared !== undefined) {
      inputs.comparisonPeriod = {
        availability: "available",
        raw: typeof declared === "object" && declared !== null ? null : declared,
        value: declared,
        evidenceStatus: "user-confirmed",
        periodRef: periodRef(declared) ?? contextPeriod,
      };
    }
    if (
      (fixture.fixture_id === "EDGE-ZERO" || fixture.fixture_id === "EDGE-NEGATIVE") &&
      inputs.purchasePeriodInclusion === undefined
    ) {
      inputs.purchasePeriodInclusion = {
        availability: "available",
        raw: true,
        value: true,
        evidenceStatus: "user-confirmed",
        periodRef: contextPeriod,
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
  if (inputs.currency === undefined && typeof contextCurrency === "string") {
    inputs.currency = {
      availability: "available",
      raw: contextCurrency,
      value: contextCurrency,
      evidenceStatus: "user-confirmed",
    };
  }
  if (
    inputs.incomeTaxBasis === undefined &&
    (contextTax === "before-tax" || contextTax === "after-tax")
  ) {
    inputs.incomeTaxBasis = {
      availability: "available",
      raw: contextTax,
      value: contextTax,
      evidenceStatus: "user-confirmed",
    };
  }

  return {
    context: {
      periodRef: contextPeriod,
      currencyCode: typeof contextCurrency === "string" ? contextCurrency : null,
      currencyTableSnapshotId:
        typeof rawContext.currency_table_snapshot_id === "string"
          ? rawContext.currency_table_snapshot_id
          : String(SHARED_CONTRACT.currency_table_snapshot_id),
      taxBasis:
        contextTax === "before-tax" || contextTax === "after-tax" ? contextTax : null,
      timeContext: timeContext(
        rawContext.time_context ?? rawContext.timeContext ?? injectedTime,
      ),
      rulesetId: String(SHARED_CONTRACT.ruleset_id),
      rulesetVersion: String(SHARED_CONTRACT.ruleset_version),
    },
    inputs,
  };
}

function revisionRequest(
  baseline: JsonRecord,
  income: bigint,
  revisionTimeContext: CalculationTimeContext,
  injectedTime: unknown,
): CalculationRequest {
  const baselineInputs = Array.isArray(baseline.inputs)
    ? (baseline.inputs as readonly JsonRecord[])
    : [];
  const inputs = baselineInputs.map((field) =>
    field.field_id === "income"
      ? {
          ...field,
          raw: income.toString(),
          value: {
            kind: "money",
            minor_units: (income * 100n).toString(),
            minor_unit: 2,
            currency_code: "CNY",
          },
        }
      : field,
  );
  return requestFromFixture(
    {
      ...baseline,
      context: {
        ...(baseline.context as JsonRecord),
        time_context: {
          occurred_at_utc: revisionTimeContext.occurredAtUtc,
          recorded_at_utc: revisionTimeContext.recordedAtUtc,
          clock_source: revisionTimeContext.clockSource,
          time_zone_id: revisionTimeContext.timeZoneId,
          utc_offset: revisionTimeContext.utcOffset,
          time_zone_source: revisionTimeContext.timeZoneSource,
          time_zone_confirmation: revisionTimeContext.timeZoneConfirmation,
        },
      },
      inputs,
    },
    injectedTime,
  );
}

function revisionTime(recordedAtUtc: string, template: JsonRecord): CalculationTimeContext {
  return {
    occurredAtUtc: recordedAtUtc,
    recordedAtUtc,
    clockSource: "device-clock",
    timeZoneId: String(template.time_zone_id),
    utcOffset: String(template.utc_offset),
    timeZoneSource: template.time_zone_source as CalculationTimeContext["timeZoneSource"],
    timeZoneConfirmation:
      template.time_zone_confirmation as CalculationTimeContext["timeZoneConfirmation"],
  };
}

function addDirectVector(
  vectors: CalculationVector[],
  fixture: JsonRecord,
  injectedTime: unknown,
): number {
  if (!Array.isArray(fixture.expected_results)) return 0;
  const replaySource = fixture.baseline_ref
    ? readJson(String((fixture.baseline_ref as JsonRecord).file))
    : fixture;
  vectors.push({
    id: String(fixture.fixture_id),
    request: requestFromFixture(replaySource, injectedTime),
    expected: {
      kind: "fixture",
      results: fixture.expected_results as readonly JsonRecord[],
    },
  });
  return fixture.expected_results.length;
}

export function buildRuleVectorCatalog(): RuleVectorCatalog {
  const fixtureEntries = MANIFEST.fixtures as readonly JsonRecord[];
  const edgeInjection = (
    SHARED_CONTRACT.edge_default_time_context_injection as JsonRecord
  ).context;
  const vectors: CalculationVector[] = [];
  const roundingVectors: RoundingVector[] = [];
  let caseOracleCount = 0;
  let resultOracleCount = 0;
  let calculationResultOracleCount = 0;
  let fixtureCalculationResultOracleCount = 0;
  let engineParityResultCount = 0;
  let utilityOracleCount = 0;
  let excludedNonCalculationFailureCount = 0;

  for (const entry of fixtureEntries) {
    const fixture = readJson(String(entry.file));
    const directCount = addDirectVector(vectors, fixture, edgeInjection);
    if (directCount > 0) {
      resultOracleCount += directCount;
      calculationResultOracleCount += directCount;
      fixtureCalculationResultOracleCount += directCount;
      continue;
    }

    if (entry.fixture_id === "EDGE-LIMITS") {
      const baseInput = fixture.base_fixture as JsonRecord;
      const cases = fixture.case_result_expectations as Readonly<
        Record<string, readonly JsonRecord[]>
      >;
      const definitions = fixture.input_cases as readonly JsonRecord[];
      for (const [caseId, expected] of Object.entries(cases)) {
        const definition = definitions.find((item) => item.case_id === caseId);
        if (!definition) throw new Error(`missing limit definition ${caseId}`);
        const input = {
          ...baseInput,
          ...((definition.override as JsonRecord | undefined) ?? {}),
        };
        if (typeof definition.field_id === "string" && definition.raw !== undefined) {
          input[definition.field_id] = definition.raw;
        }
        if (typeof definition.raw_generation === "object" && definition.raw_generation !== null) {
          const generation = definition.raw_generation as JsonRecord;
          const count = Number(
            generation.utf16_code_units ?? generation.decimal_digits ?? 0,
          );
          input[String(definition.field_id)] = String(generation.character ?? "").repeat(count);
        }
        vectors.push({
          id: `EDGE-LIMITS/${caseId}`,
          request: requestFromFixture(
            {
              context: {
                period_ref: input["comparison-period"],
                currency_code: (input.currency as JsonRecord).code,
                tax_basis: input["income-tax-basis"],
              },
              inputs: input,
            },
            edgeInjection,
          ),
          expected: { kind: "fixture", results: expected },
        });
        caseOracleCount += 1;
        resultOracleCount += expected.length;
        calculationResultOracleCount += expected.length;
        fixtureCalculationResultOracleCount += expected.length;
      }
      const utility = (fixture.utility_expectations as readonly JsonRecord[]).find(
        (item) => item.case_id === "RATIONAL-NUMERATOR-129-DIGITS",
      );
      const definition = definitions.find(
        (item) => item.case_id === "RATIONAL-NUMERATOR-129-DIGITS",
      );
      if (!utility || !definition) throw new Error("missing rational limit utility");
      utilityOracleCount += 1;
      continue;
    }

    if (entry.fixture_id === "EDGE-MINOR-UNIT") {
      const replay = fixture.replay_contract as JsonRecord;
      const baseInput = replay.base_input as JsonRecord;
      const overrides = replay.replay_overrides_by_case as Readonly<
        Record<string, JsonRecord>
      >;
      const cases = fixture.case_result_expectations as Readonly<
        Record<string, readonly JsonRecord[]>
      >;
      for (const [caseId, expected] of Object.entries(cases)) {
        const override = overrides[caseId];
        if (!override) throw new Error(`missing minor-unit override ${caseId}`);
        const input = {
          ...baseInput,
          currency: override.currency_code ?? (baseInput.currency as JsonRecord).code,
          income: override.income_raw,
        };
        vectors.push({
          id: `EDGE-MINOR-UNIT/${caseId}`,
          request: requestFromFixture(
            {
              context: {
                period_ref: input["comparison-period"],
                currency_code: override.currency_code,
                tax_basis: input["income-tax-basis"],
              },
              inputs: input,
            },
            edgeInjection,
          ),
          expected: { kind: "fixture", results: expected },
        });
        caseOracleCount += 1;
        resultOracleCount += expected.length;
        calculationResultOracleCount += expected.length;
        fixtureCalculationResultOracleCount += expected.length;
      }
      continue;
    }

    if (entry.fixture_id === "EDGE-ROUNDING-TIES") {
      for (const item of fixture.rounding_cases as readonly JsonRecord[]) {
        const exact = item.exact as JsonRecord;
        const rational = exact.rational as JsonRecord;
        const display = item.display as JsonRecord;
        roundingVectors.push({
          id: `EDGE-ROUNDING-TIES/${String(item.case_id)}`,
          numerator: String(rational.numerator),
          denominator: String(rational.denominator),
          displayDigits: 2,
          unit: "小时",
          tinyPositiveText:
            item.case_id === "NONZERO-WTE-BELOW-MINIMUM" ? "<0.01" : undefined,
          expectedDecimal: String(display.decimal),
          expectedText:
            item.case_id === "NONZERO-WTE-BELOW-MINIMUM"
              ? String(display.text)
              : undefined,
        });
        caseOracleCount += 1;
        resultOracleCount += 1;
      }
      continue;
    }

    if (entry.fixture_id === "EDGE-REVISION-LIMIT") {
      const baseline = readJson("syn-02-complete-purchase-forecast.json");
      const baselineTime = timeContext((baseline.context as JsonRecord).time_context);
      if (!baselineTime) throw new Error("missing revision baseline time context");
      const contract = fixture.revision_envelope_generation_contract as JsonRecord;
      const range = contract.sequence_range as JsonRecord;
      const template = contract.time_context_template as JsonRecord;
      const first = Number(range.first);
      const count = Number(range.count);
      for (let index = 0; index < count; index += 1) {
        const sequence = first + index;
        const currentAt = `2026-01-15T00:00:00.${String(sequence).padStart(3, "0")}Z`;
        const previousAt = `2026-01-15T00:00:00.${String(sequence - 1).padStart(3, "0")}Z`;
        const previousTime =
          sequence === first
            ? baselineTime
            : revisionTime(previousAt, template);
        const beforeRequest = revisionRequest(
          baseline,
          10000n + BigInt(sequence - 1),
          previousTime,
          edgeInjection,
        );
        const afterRequest = revisionRequest(
          baseline,
          10000n + BigInt(sequence),
          revisionTime(currentAt, template),
          edgeInjection,
        );
        vectors.push({
          id: `EDGE-REVISION-LIMIT/${sequence}/before`,
          request: beforeRequest,
          expected: {
            kind: "canonical",
            results: calculatePurchaseDecision(beforeRequest),
          },
        });
        vectors.push({
          id: `EDGE-REVISION-LIMIT/${sequence}/after`,
          request: afterRequest,
          expected: {
            kind: "canonical",
            results: calculatePurchaseDecision(afterRequest),
          },
        });
        caseOracleCount += 1;
        resultOracleCount += 10;
        calculationResultOracleCount += 10;
        engineParityResultCount += 10;
      }
      continue;
    }

    if (entry.fixture_id === "EDGE-FAILURES") {
      const baseline = readJson("syn-02-complete-purchase-forecast.json");
      for (const failure of fixture.failure_cases as readonly JsonRecord[]) {
        const caseId = String(failure.case_id);
        caseOracleCount += 1;
        if (
          caseId !== "CALC-DIVISION-BY-ZERO" &&
          caseId !== "CALC-UNEXPECTED-EXCEPTION"
        ) {
          excludedNonCalculationFailureCount += 1;
          continue;
        }
        const inputs = (baseline.inputs as readonly JsonRecord[]).map((field) => {
          if (caseId === "CALC-DIVISION-BY-ZERO" && field.field_id === "work-hours") {
            return {
              ...field,
              value: { kind: "rational", numerator: "1", denominator: "0", unit: "hour" },
              raw: null,
            };
          }
          if (
            caseId === "CALC-UNEXPECTED-EXCEPTION" &&
            field.field_id === "purchase-price"
          ) {
            return {
              ...field,
              value: {
                kind: "money",
                minor_units: "not-a-number",
                minor_unit: 2,
                currency_code: "CNY",
              },
              raw: null,
            };
          }
          return field;
        });
        vectors.push({
          id: `EDGE-FAILURES/${caseId}`,
          request: requestFromFixture({ ...baseline, inputs }, edgeInjection),
          expected: { kind: "fixture", results: [failure] },
        });
        resultOracleCount += 1;
        calculationResultOracleCount += 1;
        fixtureCalculationResultOracleCount += 1;
      }
    }
  }

  const limits = readJson("edge-numeric-limits.json");
  const definition = (limits.input_cases as readonly JsonRecord[]).find(
    (item) => item.case_id === "RATIONAL-NUMERATOR-129-DIGITS",
  );
  const utility = (limits.utility_expectations as readonly JsonRecord[]).find(
    (item) => item.case_id === "RATIONAL-NUMERATOR-129-DIGITS",
  );
  if (!definition || !utility) throw new Error("missing normalize utility contract");
  const generation = definition.raw_generation as JsonRecord;
  const normalizeVector = {
    numerator: String(generation.character).repeat(Number(generation.decimal_digits)),
    denominator: "1",
    expectedReasonCode: String(utility.workflow_error_code),
  };

  return {
    fixtureCount: fixtureEntries.length,
    caseOracleCount,
    resultOracleCount,
    calculationResultOracleCount,
    fixtureCalculationResultOracleCount,
    engineParityResultCount,
    roundingOracleCount: roundingVectors.length,
    utilityOracleCount,
    excludedNonCalculationFailureCount,
    vectors,
    roundingVectors,
    normalizeVector,
  };
}

export function fixturePeriodRef(value: unknown): CalculationPeriodRef | null {
  return periodRef(value);
}

export function canonicalUnit(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "hour") return "小时";
  return value.replaceAll("/hour", "/小时").replaceAll(" hour", " 小时");
}
