import { describe, expect, it } from "vitest";

import {
  CURRENCY_TABLE_SNAPSHOT_ID,
  RULESET_ID,
  RULESET_VERSION,
  calculatePurchaseDecision,
  type CalculationInputs,
  type CalculationResult,
  type PeriodRef,
} from "../../src/domain/calculation";
import { freezeExportSnapshot } from "../../src/domain/export/snapshot";
import { createSessionState, reduceSession, type SessionTimeContext } from "../../src/domain/session";
import {
  buildExportSnapshotSource,
  type ApplicationBuild,
} from "../../src/application/export-workbench";
import type { WorkbenchInput, WorkbenchResults, WorkbenchSession } from "../../src/application/workbench";

const TIME: SessionTimeContext = {
  occurredAtUtc: "2026-01-15T00:00:00.000Z",
  recordedAtUtc: "2026-01-15T00:00:00.000Z",
  clockSource: "device-clock",
  timeZoneId: "Etc/UTC",
  utcOffset: "+00:00",
  timeZoneSource: "utc-fallback",
  timeZoneConfirmation: "unconfirmed",
};

const PERIOD: PeriodRef = {
  kind: "month",
  customLabel: null,
  revision: "period:month:standard",
};

const BUILD: ApplicationBuild = {
  app_version: "0.1.0",
  git_commit_sha: "a".repeat(40),
  artifact_manifest_sha256: "b".repeat(64),
  config_version: "research-static-config@1.0.0",
};

function envelope(value: unknown, evidenceStatus: "user-confirmed" | "estimated" = "user-confirmed") {
  return { availability: "available" as const, value, evidenceStatus };
}

function sessionWithResults(includeFixedCost = false): WorkbenchSession {
  const input = {
    "comparison-period": envelope(PERIOD),
    currency: envelope("CNY"),
    income: envelope("10000"),
    "income-tax-basis": envelope("before-tax"),
    "work-hours": envelope("160"),
    "purchase-price": envelope("1000"),
    "purchase-period-inclusion": envelope(true),
    "fixed-cost-total": includeFixedCost ? envelope("6000") : { availability: "not-provided" as const, value: null, evidenceStatus: null },
    "fixed-cost-coverage": includeFixedCost ? envelope("complete") : { availability: "not-provided" as const, value: null, evidenceStatus: null },
    "fixed-cost-coverage-description": includeFixedCost ? envelope("已确认固定成本覆盖范围") : { availability: "not-provided" as const, value: null, evidenceStatus: null },
    "value-expectation": envelope("期待"),
  } as WorkbenchInput;
  const calculationInputs = {
    comparisonPeriod: { ...input["comparison-period"], raw: PERIOD.kind, periodRef: PERIOD },
    currency: { ...input.currency, raw: "CNY" },
    income: { ...input.income, raw: "10000", periodRef: PERIOD, currencyCode: "CNY", taxBasis: "before-tax" },
    incomeTaxBasis: { ...input["income-tax-basis"], raw: "before-tax", taxBasis: "before-tax" },
    workHours: { ...input["work-hours"], raw: "160", periodRef: PERIOD, unit: "hour" as const },
    purchasePrice: { ...input["purchase-price"], raw: "1000", periodRef: PERIOD, currencyCode: "CNY" },
    purchasePeriodInclusion: { ...input["purchase-period-inclusion"], raw: true, periodRef: PERIOD },
    fixedCostTotal: { ...input["fixed-cost-total"], raw: includeFixedCost ? "6000" : null, periodRef: PERIOD, currencyCode: "CNY" },
    fixedCostCoverage: { ...input["fixed-cost-coverage"], raw: includeFixedCost ? "complete" : null },
    fixedCostCoverageDescription: { ...input["fixed-cost-coverage-description"], raw: includeFixedCost ? "已确认固定成本覆盖范围" : null },
    valueExpectation: { ...input["value-expectation"], raw: "期待" },
  } satisfies CalculationInputs;
  const results = calculatePurchaseDecision({
    context: {
      periodRef: PERIOD,
      currencyCode: "CNY",
      currencyTableSnapshotId: CURRENCY_TABLE_SNAPSHOT_ID,
      taxBasis: "before-tax",
      timeContext: TIME,
      rulesetId: RULESET_ID,
      rulesetVersion: RULESET_VERSION,
    },
    inputs: calculationInputs,
  });
  const state = createSessionState<WorkbenchInput, WorkbenchResults>();
  return reduceSession(state, {
    type: "confirm-input",
    input,
    result: { value: results, resultIds: results.map((result) => result.formulaId) },
    timeContext: TIME,
    periodRef: PERIOD,
  });
}

function replaceResults(session: WorkbenchSession, mutate: (results: readonly CalculationResult[]) => readonly CalculationResult[]): WorkbenchSession {
  const envelope = session.derived.envelope;
  if (!envelope) throw new Error("test session has no derived envelope");
  return {
    ...session,
    derived: {
      ...session.derived,
      envelope: {
        ...envelope,
        value: mutate(envelope.value),
      },
    },
  } as WorkbenchSession;
}

describe("export workbench source mapping", () => {
  it("preserves declared before-tax context and real unavailable evidence without semantic defaults", () => {
    const result = buildExportSnapshotSource(sessionWithResults(), BUILD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.comparison_context.tax_basis).toBe("before-tax");
    expect(result.value.inputs.find((input) => input.field_id === "income")?.tax_basis).toBe("before-tax");
    expect(result.value.inputs.find((input) => input.field_id === "fixed-cost-total")?.availability).toBe("not-provided");

    const incomeRate = result.value.results.find((item) => item.formula_id === "income-rate");
    const unavailableMargin = result.value.results.find((item) => item.formula_id === "coverage-available-margin");
    expect(incomeRate?.evidence_status).toBe("user-confirmed");
    expect(unavailableMargin?.availability).toBe("unavailable");
    expect(unavailableMargin?.evidence_status).toBe("insufficient-data");
    expect(unavailableMargin?.exact_value).toBeNull();
    expect(unavailableMargin?.display_value).toBeNull();
    expect(freezeExportSnapshot(result.value).ok).toBe(true);
  });

  it("fails closed when a result dictionary is missing instead of emitting an empty dictionary", () => {
    const malformed = replaceResults(sessionWithResults(), (results) => results.map((result, index) => index === 0
      ? { ...result, assumptions: undefined } as unknown as CalculationResult
      : result));
    expect(buildExportSnapshotSource(malformed, BUILD)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "export-schema-mismatch" }),
    });
  });

  it("fails closed when unavailable evidence conflicts with the calculation result", () => {
    const malformed = replaceResults(sessionWithResults(), (results) => results.map((result) => result.availability === "unavailable"
      ? { ...result, evidenceStatus: "forecast" } as CalculationResult
      : result));
    expect(buildExportSnapshotSource(malformed, BUILD)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "export-schema-mismatch" }),
    });
  });

  it("preserves a before-tax fixed-cost session and unavailable margin semantics", () => {
    const result = buildExportSnapshotSource(sessionWithResults(true), BUILD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inputs.find((input) => input.field_id === "fixed-cost-total")?.tax_basis).toBe("before-tax");
    expect(result.value.results.filter((item) => ["coverage-available-margin", "purchase-after-margin", "purchase-impact"].includes(item.formula_id)).every((item) => item.availability === "unavailable" && item.evidence_status === "insufficient-data" && item.tax_basis === "before-tax")).toBe(true);
    expect(freezeExportSnapshot(result.value).ok).toBe(true);
  });
});
