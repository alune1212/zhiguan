import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, createExportJson } from "../src/app/App";
import { calculateDecision, type DecisionInput } from "../src/domain/calculation";

describe("App", () => {
  it("renders the single-page workbench and its trust boundaries", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("购买决策");
    expect(html).toContain("月收入");
    expect(html).toContain("月工作小时");
    expect(html).toContain("下载当前 JSON");
    expect(html).toContain("数据不足");
    expect(html).toContain("aria-live=\"polite\"");
    expect(html).not.toContain("class=\"result ");
    expect(html).not.toContain("请填写这一项");
  });

  it("exports the current evidence and user decision as JSON", () => {
    const input: DecisionInput = {
      income: "10000", workHours: "160", fixedExpenses: "6000", purchaseAmount: "1000",
      taxBasis: "after-tax", fixedCostCoverage: "complete", purchaseIncluded: "included",
      valueExpectation: "减少通勤时间",
      evidence: { income: "user-confirmed", workHours: "user-confirmed", fixedExpenses: "user-confirmed", purchaseAmount: "user-confirmed" },
    };
    const exported = JSON.parse(createExportJson(input, calculateDecision(input), {
      code: "wait", rationale: "再比较一个月", reviewCondition: "下月工资到账后",
    })) as Record<string, unknown>;
    expect(exported).toMatchObject({
      format: "zhiguan-purchase-decision@1",
      inputs: { fixed_cost_coverage: "complete", purchase_included: "included" },
      decision: { code: "wait", rationale: "再比较一个月", review_condition: "下月工资到账后" },
    });
    expect(exported.exported_at).toEqual(expect.any(String));
  });
});
