import { describe, expect, it } from "vitest";

import { calculateDecision, type DecisionInput } from "../src/domain/calculation";
import {
  createPurchaseSnapshot,
  isPurchaseSnapshotV2,
  PURCHASE_RULESET_VERSION,
  PURCHASE_SNAPSHOT_FORMAT,
  serializePurchaseSnapshot,
} from "../src/domain/purchase-snapshot";

const baseInput: DecisionInput = {
  income: "8000",
  workHours: "160",
  fixedExpenses: "3000",
  purchaseAmount: "800",
  taxBasis: "after-tax",
  fixedCostCoverage: "complete",
  purchaseIncluded: "included",
  valueExpectation: "减少通勤时间",
  evidence: {
    income: "estimated",
    workHours: "user-confirmed",
    fixedExpenses: "user-confirmed",
    purchaseAmount: "user-confirmed",
  },
};

const decision = { code: "wait" as const, rationale: "再观察一周", reviewCondition: "周末复查" };
const context = { comparisonMonth: "2026-09", timeZone: "Asia/Shanghai" };

describe("purchase snapshot v2", () => {
  it("preserves the five calculation results, decision, basis, and evidence", () => {
    const output = calculateDecision(baseInput);
    const snapshot = createPurchaseSnapshot(baseInput, output, decision, context, new Date("2026-09-22T10:00:00.000Z"));

    expect(snapshot).toMatchObject({
      format: PURCHASE_SNAPSHOT_FORMAT,
      exported_at: "2026-09-22T10:00:00.000Z",
      comparison_month: "2026-09",
      time_zone: "Asia/Shanghai",
      ruleset_version: PURCHASE_RULESET_VERSION,
      inputs: {
        work_hours: "160",
        evidence: { income: "estimated", workHours: "user-confirmed" },
      },
      decision: { code: "wait", rationale: "再观察一周", review_condition: "周末复查" },
    });
    expect(snapshot.inputs.work_time_basis.mode).toBe("monthly");
    expect(snapshot.results).toHaveLength(5);
    expect(snapshot.results[0]).toMatchObject({
      id: "income-rate",
      exact: { numerator: "50", denominator: "1", decimal: "50.00" },
      evidence_status: "estimated",
    });
    expect(isPurchaseSnapshotV2(snapshot)).toBe(true);
    expect(JSON.parse(serializePurchaseSnapshot(snapshot))).toEqual(snapshot);
  });

  it("keeps invalid inputs and insufficient results as an honest snapshot", () => {
    const input: DecisionInput = {
      ...baseInput,
      income: "not-a-number",
      purchaseAmount: "",
      evidence: { ...baseInput.evidence, income: "", purchaseAmount: "" },
    };
    const output = calculateDecision(input);
    const snapshot = createPurchaseSnapshot(input, output, { code: "", rationale: "", reviewCondition: "" }, context);

    expect(snapshot.inputs.income).toBe("not-a-number");
    expect(snapshot.inputs.purchase_amount).toBe("");
    expect(snapshot.results).toHaveLength(5);
    expect(snapshot.results.find((result) => result.id === "income-rate")).toMatchObject({
      availability: "insufficient-data",
      evidence_status: "insufficient-data",
      exact: null,
    });
    expect(snapshot.decision).toEqual({ code: null, rationale: null, review_condition: null });
    expect(isPurchaseSnapshotV2(snapshot)).toBe(true);
  });

  it("does not label planned work-time modes as calendar basis", () => {
    const input: DecisionInput = { ...baseInput, workTime: { mode: "five-day" } };
    const output = calculateDecision(input);
    const snapshot = createPurchaseSnapshot(input, output, decision, context);

    expect(snapshot.inputs.work_time_basis.mode).toBe("five-day");
    expect(snapshot.inputs.work_time_basis.conversion).not.toBeNull();
  });

  it("retains a calendar basis only when its month, zone, and schedule structure agree", () => {
    const input: DecisionInput = {
      ...baseInput,
      workHours: "",
      workTime: {
        mode: "calendar",
        comparisonMonth: "2026-09",
        timeZone: "Asia/Shanghai",
        totalWorkSeconds: "288000",
        workDays: [1, 2, 3, 4, 5],
        periods: [
          { start: "09:00", end: "12:00", endDayOffset: 0 },
          { start: "13:00", end: "18:00", endDayOffset: 0 },
        ],
        exceptions: { "2026-09-30": "rest", "2026-10-01": "work" },
        scheduleSource: "default",
      },
    };
    const output = calculateDecision(input);
    const snapshot = createPurchaseSnapshot(input, output, decision, context);

    expect(snapshot.inputs.work_time_basis).toMatchObject({
      mode: "calendar",
      comparison_month: "2026-09",
      time_zone: "Asia/Shanghai",
      total_work_seconds: "288000",
    });
    expect(isPurchaseSnapshotV2(snapshot)).toBe(true);
    expect(isPurchaseSnapshotV2({ ...snapshot, comparison_month: "2026-10" })).toBe(false);
    expect(isPurchaseSnapshotV2({
      ...snapshot,
      inputs: { ...snapshot.inputs, work_time_basis: { ...snapshot.inputs.work_time_basis, leaked: "unknown" } },
    })).toBe(false);
    expect(isPurchaseSnapshotV2({
      ...snapshot,
      inputs: { ...snapshot.inputs, work_time_basis: { ...snapshot.inputs.work_time_basis, work_days: [1, 1] } },
    })).toBe(false);
  });

  it("preserves exception-only schedules and empty calendars with insufficient results", () => {
    const exceptionOnlyInput: DecisionInput = {
      ...baseInput,
      workHours: "",
      workTime: {
        mode: "calendar",
        comparisonMonth: "2026-09",
        timeZone: "Asia/Shanghai",
        totalWorkSeconds: "28800",
        workDays: [],
        periods: [
          { start: "09:00", end: "12:00", endDayOffset: 0 },
          { start: "13:00", end: "18:00", endDayOffset: 0 },
        ],
        exceptions: { "2026-09-30": "work" },
        scheduleSource: "user-confirmed",
      },
    };
    const exceptionOnlySnapshot = createPurchaseSnapshot(exceptionOnlyInput, calculateDecision(exceptionOnlyInput), decision, context);
    expect(exceptionOnlySnapshot.inputs.work_time_basis).toMatchObject({ mode: "calendar", work_days: [], exceptions: { "2026-09-30": "work" } });
    expect(isPurchaseSnapshotV2(exceptionOnlySnapshot)).toBe(true);

    const emptyCalendarInput: DecisionInput = {
      ...exceptionOnlyInput,
      workTime: {
        mode: "calendar",
        comparisonMonth: "2026-09",
        timeZone: "Asia/Shanghai",
        totalWorkSeconds: "0",
        workDays: [],
        periods: [],
        exceptions: {},
        scheduleSource: "user-confirmed",
      },
    };
    const emptyCalendarSnapshot = createPurchaseSnapshot(emptyCalendarInput, calculateDecision(emptyCalendarInput), decision, context);
    expect(emptyCalendarSnapshot.results.some((result) => result.availability === "insufficient-data")).toBe(true);
    expect(emptyCalendarSnapshot.inputs.work_time_basis).toMatchObject({ mode: "calendar", total_work_seconds: "0", work_days: [], periods: [] });
    expect(isPurchaseSnapshotV2(emptyCalendarSnapshot)).toBe(true);
  });

  it("rejects unsupported formats and malformed dates, time zones, and exact values", () => {
    const snapshot = createPurchaseSnapshot(baseInput, calculateDecision(baseInput), decision, context);

    expect(isPurchaseSnapshotV2({ ...snapshot, format: "zhiguan-purchase-decision@1" })).toBe(false);
    expect(isPurchaseSnapshotV2({ ...snapshot, comparison_month: "2026-13" })).toBe(false);
    expect(isPurchaseSnapshotV2({ ...snapshot, time_zone: "Mars/Olympus" })).toBe(false);
    expect(isPurchaseSnapshotV2({ ...snapshot, results: [{ ...snapshot.results[0], exact: { numerator: "0", denominator: "0", decimal: "0.00" } }, ...snapshot.results.slice(1)] })).toBe(false);
    expect(() => createPurchaseSnapshot(baseInput, calculateDecision(baseInput), decision, { ...context, comparisonMonth: "2026-00" })).toThrow("invalid-comparison-month");
    expect(() => createPurchaseSnapshot(baseInput, calculateDecision(baseInput), decision, { ...context, timeZone: "Mars/Olympus" })).toThrow("invalid-time-zone");
  });

  it("rejects duplicate result ids, inconsistent availability, and unlisted fields", () => {
    const snapshot = createPurchaseSnapshot(baseInput, calculateDecision(baseInput), decision, context);
    const duplicateIds = { ...snapshot, results: [snapshot.results[0], ...snapshot.results.slice(1, 4), snapshot.results[0]] };
    const inconsistentResult = { ...snapshot.results[0], availability: "insufficient-data" as const, exact: { numerator: "1", denominator: "1", decimal: "1.00" } };

    expect(isPurchaseSnapshotV2(duplicateIds)).toBe(false);
    expect(isPurchaseSnapshotV2({ ...snapshot, results: [inconsistentResult, ...snapshot.results.slice(1)] })).toBe(false);
    expect(isPurchaseSnapshotV2({ ...snapshot, transcript: "do not persist me" })).toBe(false);
    expect(isPurchaseSnapshotV2({ ...snapshot, inputs: { ...snapshot.inputs, conversation: "do not persist me" } })).toBe(false);
  });
});
