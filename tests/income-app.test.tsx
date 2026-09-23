import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { calculateDecision, type DecisionInput } from "../src/domain/calculation";
import { defaultProfile } from "../src/domain/income";
import { LOCAL_DATA_FORMAT, type FavoriteSnapshot, type LocalDataReadResult } from "../src/domain/local-data";
import { createPurchaseSnapshot } from "../src/domain/purchase-snapshot";
import { FavoriteCard, favoriteRecalculationInput, IncomeApp, isSuccessfulLocalDataRead } from "../src/app/IncomeApp";

const favoriteInput: DecisionInput = {
  income: "8000",
  workHours: "160",
  fixedExpenses: "",
  purchaseAmount: "800",
  taxBasis: "after-tax",
  fixedCostCoverage: "",
  purchaseIncluded: "",
  valueExpectation: "收藏测试",
  evidence: {
    income: "user-confirmed",
    workHours: "user-confirmed",
    fixedExpenses: "",
    purchaseAmount: "user-confirmed",
  },
};

function favoriteSnapshot(input = favoriteInput) {
  return createPurchaseSnapshot(input, calculateDecision(input), {
    code: "wait",
    rationale: "再考虑一下",
    reviewCondition: "",
  }, { comparisonMonth: "2026-09", timeZone: "Asia/Shanghai" }, new Date("2026-09-23T00:00:00.000Z"));
}

describe("IncomeApp first use", () => {
  it("starts with only monthly take-home income and shows the folded, local estimate defaults", () => {
    const html = renderToStaticMarkup(<IncomeApp />);
    const form = html.match(/<form class="income-form"[\s\S]*?<\/form>/u)?.[0];
    const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    expect(form).toBeDefined();
    expect(form).toMatch(/<input\b(?=[^>]*\bid="income-monthly")(?=[^>]*\bname="income")(?=[^>]*\binputMode="decimal")(?=[^>]*\bvalue="")[^>]*>/u);
    expect(form).toContain("只填这一项也能开始");
    expect(form).toContain("默认按周一至周五（双休），每天 09:00–12:00、13:00–18:00（合计 8 小时）");
    expect(form).toContain(`时区 ${deviceTimeZone} 估算`);
    expect(form).toContain("资料仅保存在此浏览器中；清除浏览器数据可能会丢失。");

    expect(form).toContain('data-slot="collapsible"');
    expect(form).toContain('aria-expanded="false"');
    expect(form).toContain("展开详细设置");
    expect(form).not.toContain("每周工作日");
    expect(form).not.toContain("特殊日期");
    expect(form).toContain("保存并开始");
    expect(html).toContain("导入备份");
    expect(html).toContain("没有购买计划也可以直接使用。");
    expect(html).not.toContain('name="purchaseAmount"');
    expect(html).not.toContain('name="fixedExpenses"');
    expect(html).not.toContain("整理这句话");
  });
});

describe("IncomeApp favorites and reload guards", () => {
  it("requires a current profile before creating a recalculation draft", () => {
    const snapshot = favoriteSnapshot();
    expect(favoriteRecalculationInput(snapshot, null, null)).toBeNull();

    const currentProfile = { ...defaultProfile(), income: "9000" };
    expect(favoriteRecalculationInput(snapshot, currentProfile, null)).toMatchObject({
      income: "9000",
      purchaseAmount: "800",
      workHours: "160",
      evidence: { income: "user-confirmed", workHours: "user-confirmed" },
    });
  });

  it("accepts only complete reads before discarding the current draft", () => {
    const ready: LocalDataReadResult = {
      status: "ready",
      document: { format: LOCAL_DATA_FORMAT, revision: "r1", profile: defaultProfile(), favorites: [] },
      raw: "stored-document",
    };
    expect(isSuccessfulLocalDataRead(ready)).toBe(true);
    expect(isSuccessfulLocalDataRead({ status: "empty", document: null, raw: null })).toBe(true);
    expect(isSuccessfulLocalDataRead({ status: "invalid", document: null, raw: "damaged", reason: "malformed" })).toBe(false);
    expect(isSuccessfulLocalDataRead({ status: "unavailable", document: null, raw: null, reason: "storage-unavailable" })).toBe(false);
  });

  it.each(["", "bad-money"])("shows insufficient data for an invalid saved amount: %s", (purchaseAmount) => {
    const snapshot = favoriteSnapshot({
      ...favoriteInput,
      income: "bad-income",
      purchaseAmount,
      evidence: { ...favoriteInput.evidence, income: "", purchaseAmount: "" },
    });
    const favorite: FavoriteSnapshot = {
      id: "favorite-1",
      savedAt: "2026-09-23T00:00:00.000Z",
      snapshot,
    };
    const html = renderToStaticMarkup(<FavoriteCard favorite={favorite} onRecalculate={() => undefined} onDelete={() => undefined} disabled={false} />);

    expect(html).toContain("当时金额 资料不足");
    expect(html).toContain("当时收入 资料不足");
    expect(html).not.toContain("¥.00");
    expect(html).not.toContain("¥bad-money");
    expect(html).not.toContain("¥bad-income");
  });

  it("keeps valid saved amounts formatted as currency", () => {
    const favorite: FavoriteSnapshot = {
      id: "favorite-1",
      savedAt: "2026-09-23T00:00:00.000Z",
      snapshot: favoriteSnapshot(),
    };
    const html = renderToStaticMarkup(<FavoriteCard favorite={favorite} onRecalculate={() => undefined} onDelete={() => undefined} disabled={false} />);
    expect(html).toContain("当时金额 ¥800.00");
    expect(html).toContain("当时收入 ¥8,000.00");
  });
});
