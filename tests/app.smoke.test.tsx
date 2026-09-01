import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, createExportJson, createGoalExportJson } from "../src/app/App";
import { calculateDecision, calculateGoalProgress, type DecisionInput, type GoalInput } from "../src/domain/calculation";

describe("App", () => {
  it("renders the single-page workbench and its trust boundaries", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("购买决策");
    expect(html).toContain("月收入");
    expect(html).toContain("月工作小时");
    expect(html).toContain("下载当前 JSON");
    expect(html).toContain("目标名称");
    expect(html).toContain("用户定义单位");
    expect(html).toContain("下载目标 JSON");
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

  it("exports only the current goal snapshot as JSON", () => {
    const input: GoalInput = {
      name: "读完一本书",
      target: "320",
      current: "80",
      unit: "页",
      evidence: { target: "user-confirmed", current: "estimated" },
    };
    const exported = JSON.parse(createGoalExportJson(input, calculateGoalProgress(input))) as Record<string, unknown>;
    expect(exported).toMatchObject({
      format: "zhiguan-goal-progress@1",
      scope: "current-session",
      goal: { name: "读完一本书", target: "320", current: "80", unit: "页", evidence: { target: "user-confirmed", current: "estimated" } },
      result: { availability: "available", evidence_status: "estimated", completed_display: "25.00%", remaining_display: "240.00 页" },
    });
    expect(exported).not.toHaveProperty("inputs");
    expect(exported.exported_at).toEqual(expect.any(String));
  });
});
