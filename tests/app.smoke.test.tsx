import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, createExportJson } from "../src/app/App";
import { calculateDecision, type DecisionInput } from "../src/domain/calculation";

describe("App", () => {
  it("renders the smaller purchase flow and its trust boundaries", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("这笔购买，要花你多少工作时间？");
    expect(html).toContain("先填这三个数字");
    expect(html).toContain("这些数字里有大概数");
    expect(html).toContain("再算算本月买完还剩多少（可选）");
    expect(html).toContain("不会上传，也不会保存在浏览器里");
    expect(html).not.toContain("Goal");
    expect(html).not.toContain("目标进度");
    expect(html).not.toContain("class=\"result ");
    expect(html).not.toContain("下载本次数据");
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
