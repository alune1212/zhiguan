import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  App,
  createExportJson,
  DECISION_OPTIONS,
  inputErrorText,
  resultText,
  visibleResultsFor,
} from "../src/app/App";
import { calculateDecision, type CalculationOutput, type DecisionInput } from "../src/domain/calculation";

const baseInput: DecisionInput = {
  income: "10000",
  workHours: "160",
  fixedExpenses: "3000",
  purchaseAmount: "1000",
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

type CalculationResult = CalculationOutput["results"][number];

function resultFor(output: CalculationOutput, id: CalculationResult["id"]): CalculationResult {
  const result = output.results.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`missing result ${id}`);
  return result;
}

describe("App", () => {
  it("renders the smaller purchase flow and its trust boundaries", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("这次购买要花多少工作时间？");
    expect(html).toContain("清空重填");
    expect(html).toContain("先填三个数字");
    expect(html).toContain("金额都填人民币。收入、工作时间和固定支出都填一个月的数；购买价格填这一次要付的金额。");
    expect(html).toContain("这个收入是税前还是到手？");
    expect(html).toContain("每月收入（元）");
    expect(html).toContain("每月工作时间（小时）");
    expect(html).toContain("这笔购买要花多少（元）");
    expect(html).toContain("这些数字里有大概数");
    expect(html).toContain("还想看买完后，这个月剩多少？（可选）");
    expect(html).toContain("没有固定支出可以填 0。");
    expect(html).toContain("确认并查看结果");
    expect(html).toContain("你填写的内容只在当前页面使用。刷新或关闭后会清空，不会上传，也不会保存在浏览器里。");
    expect(html).not.toContain("Goal");
    expect(html).not.toContain("目标进度");
    expect(html).not.toContain("购买前算一算");
    expect(html).not.toContain("数字和状态说明");
    expect(html).not.toContain("class=\"result ");
    expect(html).not.toContain("下载这次记录");
  });

  it("puts the work-time conclusion first and keeps income rate as a supplement", () => {
    const output = calculateDecision(baseInput);
    expect(visibleResultsFor(output, false).map((result) => result.id)).toEqual([
      "work-time-equivalent",
      "income-rate",
    ]);
    expect(resultText(resultFor(output, "work-time-equivalent"), output.inputErrors)).toBe(
      "按这些数字，这笔钱相当于你工作 16.00 小时的收入。",
    );
    expect(resultText(resultFor(output, "income-rate"), output.inputErrors)).toBe(
      "按你填的月收入和工作时间，每小时收入约为 62.50 元。",
    );
  });

  it("only exposes optional margin results after the optional section starts", () => {
    const output = calculateDecision({
      ...baseInput,
      fixedExpenses: "",
      fixedCostCoverage: "",
      purchaseIncluded: "",
      valueExpectation: "记录期待，但不参与计算",
    });
    expect(visibleResultsFor(output, false).map((result) => result.id)).toEqual([
      "work-time-equivalent",
      "income-rate",
    ]);
    expect(visibleResultsFor(output, true).map((result) => result.id)).toEqual([
      "work-time-equivalent",
      "income-rate",
      "available-margin",
      "purchase-after-margin",
    ]);
  });

  it.each([
    {
      fixedExpenses: "3000",
      available: "扣掉固定支出后，本月还剩 7000.00 元。",
      after: "如果把这笔购买算进本月，买完后还剩 6000.00 元。",
    },
    {
      fixedExpenses: "10000",
      available: "扣掉固定支出后，本月刚好没有余量。",
      after: "如果把这笔购买算进本月，买完后还差 1000.00 元。",
    },
    {
      fixedExpenses: "9000",
      available: "扣掉固定支出后，本月还剩 1000.00 元。",
      after: "如果把这笔购买算进本月，买完后本月刚好没有余量。",
    },
    {
      fixedExpenses: "11000",
      available: "扣掉固定支出后，本月还差 1000.00 元。",
      after: "如果把这笔购买算进本月，买完后还差 2000.00 元。",
    },
  ])("explains positive, zero, and negative monthly margin: $fixedExpenses", ({ fixedExpenses, available, after }) => {
    const input = { ...baseInput, fixedExpenses };
    const output = calculateDecision(input);
    expect(resultText(resultFor(output, "available-margin"), output.inputErrors)).toBe(available);
    expect(resultText(resultFor(output, "purchase-after-margin"), output.inputErrors)).toBe(after);
  });

  it("explains missing data and the tax-before limitation without blocking core results", () => {
    const missingIncome: DecisionInput = {
      ...baseInput,
      income: "",
      evidence: { ...baseInput.evidence, income: "" },
    };
    const missingOutput = calculateDecision(missingIncome);
    expect(inputErrorText("income", "missing-input")).toBe("填一下每月收入。");
    expect(resultText(resultFor(missingOutput, "income-rate"), missingOutput.inputErrors)).toBe(
      "还缺每月收入，所以现在算不了每小时收入。",
    );

    const missingFixed = calculateDecision({
      ...baseInput,
      fixedExpenses: "",
      fixedCostCoverage: "",
    });
    expect(resultText(resultFor(missingFixed, "available-margin"), missingFixed.inputErrors)).toBe(
      "还缺每月固定支出，所以现在算不了本月剩余金额。没有固定支出可以填 0。",
    );

    const beforeTax = calculateDecision({ ...baseInput, taxBasis: "before-tax" });
    expect(resultFor(beforeTax, "work-time-equivalent").availability).toBe("available");
    expect(resultText(resultFor(beforeTax, "available-margin"), beforeTax.inputErrors)).toBe(
      "你填的是税前收入，所以现在算不了本月剩余金额。请重新填入税后（到手）收入，并选择“税后（到手）”，再查看结果。",
    );
  });

  it("explains invalid numbers and unconfirmed fixed expenses with a recovery action", () => {
    const invalidPurchase = calculateDecision({ ...baseInput, purchaseAmount: "1,000" });
    expect(inputErrorText("purchaseAmount", "invalid-input")).toBe("只填数字，不要加逗号或“元”。");
    expect(resultText(resultFor(invalidPurchase, "work-time-equivalent"), invalidPurchase.inputErrors)).toBe(
      "先改正购买价格，才能计算买它要花多少工作时间。",
    );

    const unconfirmedFixed = calculateDecision({ ...baseInput, fixedCostCoverage: "" });
    expect(resultText(resultFor(unconfirmedFixed, "available-margin"), unconfirmedFixed.inputErrors)).toBe(
      "还需要确认固定支出已经填全，才能计算本月剩余金额。",
    );
  });

  it("keeps estimated inputs and future margin results explicitly distinct", () => {
    const output = calculateDecision({
      ...baseInput,
      evidence: { ...baseInput.evidence, income: "estimated" },
    });
    expect(resultFor(output, "income-rate")).toMatchObject({
      availability: "available",
      evidenceStatus: "estimated",
    });
    expect(resultFor(output, "work-time-equivalent").evidenceStatus).toBe("estimated");
    expect(resultFor(output, "purchase-after-margin")).toMatchObject({
      availability: "available",
      evidenceStatus: "forecast",
    });
    expect(resultText(resultFor(output, "purchase-after-margin"), output.inputErrors)).toContain("如果把这笔购买算进本月");
  });

  it("keeps the five decision codes while using natural action labels", () => {
    expect(DECISION_OPTIONS).toEqual([
      { code: "buy", label: "现在买" },
      { code: "wait", label: "再等等" },
      { code: "adjust-conditions", label: "换个条件再看" },
      { code: "do-not-buy", label: "这次不买" },
      { code: "undecided", label: "还没想好" },
    ]);
  });

  it("exports negative results with the existing JSON format and compatibility fields", () => {
    const input: DecisionInput = { ...baseInput, fixedExpenses: "11000" };
    const exported = JSON.parse(createExportJson(input, calculateDecision(input), {
      code: "wait", rationale: "再比较一个月", reviewCondition: "下月工资到账后",
    })) as Record<string, unknown>;
    expect(exported).toMatchObject({
      format: "zhiguan-purchase-decision@1",
      currency: "CNY",
      period: "month",
      inputs: {
        fixed_cost_coverage: "complete",
        purchase_included: "included",
        value_expectation: "减少通勤时间",
      },
      decision: { code: "wait", rationale: "再比较一个月", review_condition: "下月工资到账后" },
    });
    const results = exported.results as Array<Record<string, unknown>>;
    expect(results.find((result) => result.id === "available-margin")).toMatchObject({
      exact: { decimal: "-1000.00" },
      display: "-1000.00 元",
    });
    expect(results.find((result) => result.id === "purchase-after-margin")).toMatchObject({
      exact: { decimal: "-2000.00" },
      display: "-2000.00 元",
    });
    expect(results.find((result) => result.id === "purchase-impact")).toMatchObject({
      exact: { decimal: "-1000.00" },
      display: "-1000.00 元",
    });
    expect(exported.exported_at).toEqual(expect.any(String));
  });
});
