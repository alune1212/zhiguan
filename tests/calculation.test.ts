import { describe, expect, it } from "vitest";

import { calculateDecision, calculateGoalProgress, parseAmount, parseWorkHours, type DecisionInput, type GoalInput } from "../src/domain/calculation";

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
      display: "62.50 CNY/小时",
      evidenceStatus: "user-confirmed",
    });
    expect(result(baseInput, "work-time-equivalent").display).toBe("12.80 小时");
    expect(result(baseInput, "available-margin").display).toBe("7000.00 CNY");
    expect(result(baseInput, "purchase-after-margin").display).toBe("6200.00 CNY");
    expect(result(baseInput, "purchase-after-margin").evidenceStatus).toBe("forecast");
    expect(result(baseInput, "purchase-impact").display).toBe("-800.00 CNY");
    expect(result(baseInput, "purchase-impact").evidenceStatus).toBe("forecast");
    expect(result({ ...baseInput, fixedExpenses: "9500" }, "purchase-after-margin").display).toBe("-300.00 CNY");
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
});

describe("goal progress calculation", () => {
  const baseGoal: GoalInput = {
    name: "应急金",
    target: "10000",
    current: "2500",
    unit: "CNY",
    evidence: { target: "user-confirmed", current: "user-confirmed" },
  };

  it("calculates progress and propagates estimated evidence", () => {
    const output = calculateGoalProgress(baseGoal);
    expect(output.inputErrors).toEqual({});
    expect(output.result).toMatchObject({
      id: "goal-progress",
      availability: "available",
      evidenceStatus: "user-confirmed",
      completedDisplay: "25.00%",
      remainingDisplay: "7500.00 CNY",
      formula: "完成比例 = 当前值 ÷ 目标值 × 100%；剩余差距 = max(目标值 − 当前值, 0)",
    });
    expect(output.result.completedRatio).toMatchObject({ numerator: "1", denominator: "4", decimal: "0.25" });
    expect(output.result.remainingGap).toMatchObject({ numerator: "7500", denominator: "1", decimal: "7500.00" });

    const estimated = calculateGoalProgress({
      ...baseGoal,
      evidence: { ...baseGoal.evidence, current: "estimated" },
    });
    expect(estimated.result.evidenceStatus).toBe("estimated");
  });

  it("keeps an empty goal insufficient without inventing values", () => {
    const empty: GoalInput = {
      name: "",
      target: "",
      current: "",
      unit: "",
      evidence: { target: "", current: "" },
    };
    const output = calculateGoalProgress(empty);
    expect(output.inputErrors).toEqual({
      name: "goal-name-required",
      target: "missing-input",
      current: "missing-input",
      unit: "goal-unit-required",
    });
    expect(output.result).toMatchObject({
      availability: "insufficient-data",
      evidenceStatus: "insufficient-data",
      completedRatio: null,
      completedDisplay: null,
      remainingGap: null,
      remainingDisplay: null,
    });
  });

  it("rejects zero targets and negative current values", () => {
    const output = calculateGoalProgress({ ...baseGoal, target: "0", current: "-1" });
    expect(output.inputErrors).toMatchObject({ target: "zero-not-allowed", current: "invalid-input" });
    expect(output.result.availability).toBe("insufficient-data");
    expect(output.result.completedRatio).toBeNull();
    expect(output.result.remainingGap).toBeNull();
    expect(output.result.reasonCodes).toEqual(expect.arrayContaining(["zero-not-allowed", "invalid-input"]));

    const unknownEvidence = calculateGoalProgress({
      ...baseGoal,
      evidence: { target: "unknown", current: "user-confirmed" },
    } as unknown as GoalInput);
    expect(unknownEvidence.inputErrors.target).toBe("evidence-required");
    expect(unknownEvidence.result.availability).toBe("insufficient-data");
  });

  it("shows progress above 100 percent and no negative remaining gap", () => {
    const output = calculateGoalProgress({ ...baseGoal, target: "100", current: "125", unit: "页" });
    expect(output.inputErrors).toEqual({});
    expect(output.result).toMatchObject({
      availability: "available",
      completedDisplay: "125.00%",
      remainingDisplay: "0.00 页",
    });
    expect(output.result.completedRatio).toMatchObject({ numerator: "5", denominator: "4" });
    expect(output.result.remainingGap).toMatchObject({ numerator: "0", denominator: "1" });
  });
});
