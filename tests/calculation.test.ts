import { describe, expect, it } from "vitest";

import { calculateDecision, parseAmount, parseWorkHours, type DecisionInput } from "../src/domain/calculation";

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
