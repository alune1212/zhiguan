import { describe, expect, it } from "vitest";

import {
  calculateDecision,
  parseAmount,
  parseWorkHours,
  resolveWorkTime,
  WORK_TIME_ESTIMATE_RULE,
  type DecisionInput,
} from "../src/domain/calculation";

const baseInput: DecisionInput = {
  income: "10000",
  workHours: "160",
  fixedExpenses: "3000",
  purchaseAmount: "800",
  taxBasis: "after-tax",
  fixedCostCoverage: "complete",
  purchaseIncluded: "included",
  valueExpectation: "减少通勤时间",
  evidence: {
    income: "user-confirmed",
    workHours: "user-confirmed",
    fixedExpenses: "user-confirmed",
    purchaseAmount: "user-confirmed",
  },
};

function result(input: DecisionInput, id: string) {
  const item = calculateDecision(input).results.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing result ${id}`);
  return item;
}

describe("purchase decision calculation", () => {
  it("calculates exact cents and ratios for a complete after-tax input", () => {
    const output = calculateDecision(baseInput);
    expect(output.inputErrors).toEqual({});
    expect(result(baseInput, "income-rate")).toMatchObject({
      availability: "available",
      label: "每小时收入",
      display: "62.50 元/小时",
      evidenceStatus: "user-confirmed",
    });
    expect(result(baseInput, "income-rate").formula).toBe("月收入 ÷ 月工时");
    expect(result(baseInput, "work-time-equivalent")).toMatchObject({
      label: "这笔钱相当于多少工作时间",
      formula: "购买金额 ÷ 每小时收入",
      display: "12.80 小时",
    });
    expect(result(baseInput, "available-margin")).toMatchObject({
      label: "本月可用金额",
      formula: "税后月收入 − 月固定支出",
      display: "7000.00 元",
    });
    expect(result(baseInput, "purchase-after-margin")).toMatchObject({
      label: "买完后本月还剩",
      formula: "税后月收入 − 月固定支出 − 购买金额",
      display: "6200.00 元",
    });
    expect(result(baseInput, "purchase-after-margin").evidenceStatus).toBe("forecast");
    expect(result(baseInput, "purchase-impact")).toMatchObject({
      label: "这笔购买减少的余量",
      formula: "买完后本月还剩 − 本月可用金额",
      display: "-800.00 元",
      evidenceStatus: "forecast",
    });
    expect(result({ ...baseInput, fixedExpenses: "9500" }, "purchase-after-margin").display).toBe("-300.00 元");
  });

  it("reports missing values as insufficient instead of inventing defaults", () => {
    const input: DecisionInput = { ...baseInput, income: "", evidence: { ...baseInput.evidence, income: "" } };
    const output = calculateDecision(input);
    expect(output.inputErrors.income).toBe("missing-input");
    expect(result(input, "income-rate").availability).toBe("insufficient-data");
    expect(result(input, "income-rate").display).toBeNull();
    expect(result(input, "available-margin").reasonCodes).toContain("missing-input");
  });

  it("rejects malformed, zero, and oversized numbers at the boundary", () => {
    expect(parseAmount("1,000")).toEqual({ ok: false, reasonCode: "invalid-input" });
    expect(parseAmount("0", false)).toEqual({ ok: false, reasonCode: "zero-not-allowed" });
    expect(parseAmount("9999999999999999.99")).toEqual({ ok: false, reasonCode: "number-too-large" });
    expect(parseWorkHours("1.0000")).toEqual({ ok: false, reasonCode: "number-too-large" });
    const input: DecisionInput = { ...baseInput, purchaseAmount: "-1" };
    expect(result(input, "purchase-after-margin").availability).toBe("insufficient-data");
    expect(calculateDecision(input).inputErrors.purchaseAmount).toBe("invalid-input");
  });

  it("propagates estimated status and keeps before-tax margin unavailable", () => {
    const estimated: DecisionInput = { ...baseInput, evidence: { ...baseInput.evidence, income: "estimated" } };
    expect(result(estimated, "income-rate").evidenceStatus).toBe("estimated");
    expect(result(estimated, "purchase-after-margin").evidenceStatus).toBe("forecast");

    const beforeTax: DecisionInput = { ...baseInput, taxBasis: "before-tax" };
    expect(result(beforeTax, "income-rate").availability).toBe("available");
    expect(result(beforeTax, "available-margin").availability).toBe("insufficient-data");
    expect(result(beforeTax, "available-margin").reasonCodes).toContain("before-tax-margin-unavailable");
  });

  it("keeps work-time comparison available while margin forecasts wait for confirmations", () => {
    const unconfirmedPurchasePeriod: DecisionInput = { ...baseInput, purchaseIncluded: "" };
    expect(result(unconfirmedPurchasePeriod, "work-time-equivalent").availability).toBe("available");
    expect(result(unconfirmedPurchasePeriod, "purchase-after-margin").availability).toBe("insufficient-data");
    expect(result(unconfirmedPurchasePeriod, "purchase-impact").availability).toBe("insufficient-data");

    const incompleteCoverage: DecisionInput = { ...baseInput, fixedCostCoverage: "partial" };
    expect(calculateDecision(incompleteCoverage).inputErrors.fixedCostCoverage).toBeUndefined();
    expect(result(incompleteCoverage, "available-margin").availability).toBe("insufficient-data");
    expect(result(incompleteCoverage, "available-margin").reasonCodes).toContain("fixed-cost-coverage-required");

    const excludedPurchase: DecisionInput = { ...baseInput, purchaseIncluded: "excluded" };
    expect(calculateDecision(excludedPurchase).inputErrors.purchaseIncluded).toBeUndefined();
    expect(result(excludedPurchase, "work-time-equivalent").availability).toBe("available");
    expect(result(excludedPurchase, "purchase-after-margin").availability).toBe("insufficient-data");
  });

  it("resolves the fixed weekly schedules to estimated monthly hours", () => {
    const fiveDay = resolveWorkTime({ ...baseInput, workTime: { mode: "five-day" } });
    expect(fiveDay).toMatchObject({
      workHours: "173.333",
      evidence: "estimated",
      basis: {
        mode: "five-day",
        days_per_week: "5",
        hours_per_day: "8",
        conversion: WORK_TIME_ESTIMATE_RULE,
      },
      inputErrors: {},
    });

    const sixDay = resolveWorkTime({ ...baseInput, workTime: { mode: "six-day" } });
    expect(sixDay.workHours).toBe("208.000");
    expect(sixDay.evidence).toBe("estimated");
  });

  it("resolves custom decimals with exact arithmetic and half-up precision", () => {
    const resolved = resolveWorkTime({
      ...baseInput,
      workTime: { mode: "custom", daysPerWeek: "4.5", hoursPerDay: "7.25" },
    });
    expect(resolved.workHours).toBe("141.375");
    expect(resolved.basis.days_per_week).toBe("4.5");
    expect(resolved.basis.hours_per_day).toBe("7.25");

    const halfUp = resolveWorkTime({
      ...baseInput,
      workTime: { mode: "custom", daysPerWeek: "0.001", hoursPerDay: "1.5" },
    });
    expect(halfUp.workHours).toBe("0.007");

    const upperBound = resolveWorkTime({
      ...baseInput,
      workTime: { mode: "custom", daysPerWeek: "7", hoursPerDay: "24" },
    });
    expect(upperBound.workHours).toBe("728.000");
    expect(upperBound.inputErrors).toEqual({});
  });

  it.each([
    {
      name: "missing days",
      workTime: { mode: "custom", daysPerWeek: "", hoursPerDay: "8" } as const,
      errors: { workDaysPerWeek: "missing-input" },
    },
    {
      name: "missing hours",
      workTime: { mode: "custom", daysPerWeek: "5", hoursPerDay: "" } as const,
      errors: { workHoursPerDay: "missing-input" },
    },
    {
      name: "malformed days",
      workTime: { mode: "custom", daysPerWeek: "five", hoursPerDay: "8" } as const,
      errors: { workDaysPerWeek: "invalid-input" },
    },
    {
      name: "zero days",
      workTime: { mode: "custom", daysPerWeek: "0", hoursPerDay: "8" } as const,
      errors: { workDaysPerWeek: "zero-not-allowed" },
    },
    {
      name: "too many days",
      workTime: { mode: "custom", daysPerWeek: "7.001", hoursPerDay: "8" } as const,
      errors: { workDaysPerWeek: "out-of-range" },
    },
    {
      name: "too many hours",
      workTime: { mode: "custom", daysPerWeek: "5", hoursPerDay: "24.001" } as const,
      errors: { workHoursPerDay: "out-of-range" },
    },
    {
      name: "too many fraction digits",
      workTime: { mode: "custom", daysPerWeek: "5.0001", hoursPerDay: "8" } as const,
      errors: { workDaysPerWeek: "number-too-large" },
    },
    {
      name: "rounds to zero",
      workTime: { mode: "custom", daysPerWeek: "0.001", hoursPerDay: "0.001" } as const,
      errors: { workDaysPerWeek: "number-too-small", workHoursPerDay: "number-too-small" },
    },
  ])("rejects $name schedule input without using a fallback", ({ workTime, errors }) => {
    const resolved = resolveWorkTime({ ...baseInput, workHours: "160", workTime });
    expect(resolved.workHours).toBe("");
    expect(resolved.evidence).toBe("");
    expect(resolved.inputErrors).toEqual(errors);
    const output = calculateDecision({ ...baseInput, workHours: "160", workTime });
    expect(output.inputErrors.workHours).toBe(Object.values(errors)[0]);
    expect(output.inputErrors).toMatchObject(errors);
    expect(result({ ...baseInput, workHours: "160", workTime }, "work-time-equivalent").availability).toBe("insufficient-data");
  });

  it("forces schedule-derived hours to estimated without changing margin evidence", () => {
    const output = calculateDecision({ ...baseInput, workTime: { mode: "five-day" } });
    expect(output.workTime.evidence).toBe("estimated");
    expect(result({ ...baseInput, workTime: { mode: "five-day" } }, "income-rate").evidenceStatus).toBe("estimated");
    expect(result({ ...baseInput, workTime: { mode: "five-day" } }, "work-time-equivalent").evidenceStatus).toBe("estimated");
    expect(result({ ...baseInput, workTime: { mode: "five-day" } }, "available-margin").evidenceStatus).toBe("user-confirmed");
    expect(result({ ...baseInput, workTime: { mode: "five-day" } }, "purchase-after-margin").evidenceStatus).toBe("forecast");
  });

  it("ignores old monthly hours when no schedule is selected and preserves direct monthly input", () => {
    const unselected = { ...baseInput, workTime: { mode: "unselected" } as const };
    const unselectedOutput = calculateDecision(unselected);
    expect(unselectedOutput.workTime.workHours).toBe("");
    expect(unselectedOutput.inputErrors.workHours).toBe("missing-input");
    expect(result(unselected, "work-time-equivalent").availability).toBe("insufficient-data");
    expect(result(unselected, "available-margin").availability).toBe("available");

    const direct = resolveWorkTime(baseInput);
    expect(direct).toMatchObject({ workHours: "160", evidence: "user-confirmed", basis: { mode: "monthly", conversion: null } });
    expect(result(baseInput, "income-rate").display).toBe("62.50 元/小时");
  });
});
