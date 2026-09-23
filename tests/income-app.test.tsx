import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { calculateDecision, type DecisionInput } from "../src/domain/calculation";
import { calculateIncome, defaultProfile } from "../src/domain/income";
import { LOCAL_DATA_FORMAT, type FavoriteSnapshot, type LocalDataReadResult } from "../src/domain/local-data";
import { createPurchaseSnapshot } from "../src/domain/purchase-snapshot";
import { FavoriteCard, favoriteRecalculationInput, IncomeApp, isSuccessfulLocalDataRead, rateDisplay } from "../src/app/IncomeApp";

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

  it("keeps small positive per-second rates visible without implying zero", () => {
    const now = new Date("2026-09-23T00:00:00.000Z");
    const normal = calculateIncome({ ...defaultProfile(), income: "100", timeZone: "Asia/Shanghai" }, now);
    expect(normal.status).toBe("available");
    expect(rateDisplay(normal)).toBe("0.00015783 元/秒");

    const tiny = calculateIncome({
      ...defaultProfile(),
      income: "0.01",
      timeZone: "Asia/Shanghai",
      workDays: [1, 2, 3, 4, 5, 6, 7],
      periods: [{ start: "00:00", end: "23:59", endDayOffset: 0 }],
    }, now);
    expect(tiny.status).toBe("available");
    expect(tiny.perSecondIncome?.numerator).not.toBe("0");
    expect(rateDisplay(tiny)).toBe("小于 0.00000001 元/秒");
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

  it("does not reuse a saved calendar when the current schedule has no working time", () => {
    const now = new Date("2026-09-23T00:00:00.000Z");
    const savedProfile = { ...defaultProfile(), income: "8000", timeZone: "Asia/Shanghai" };
    const savedCalendar = calculateIncome(savedProfile, now).workTimeInput;
    expect(savedCalendar?.totalWorkSeconds).toBe("633600");
    const snapshot = favoriteSnapshot({
      ...favoriteInput,
      workHours: "",
      workTime: savedCalendar ?? { mode: "unselected" },
      evidence: { ...favoriteInput.evidence, workHours: "estimated" },
    });
    const currentProfile = { ...savedProfile, income: "9000", workDays: [] };
    const currentCalculation = calculateIncome(currentProfile, now);
    expect(currentCalculation).toMatchObject({ status: "insufficient-data", reason: { code: "no-working-time" }, workTimeInput: null });

    const draft = favoriteRecalculationInput(snapshot, currentProfile, currentCalculation)!;
    expect(snapshot.inputs.work_time_basis.total_work_seconds).toBe("633600");
    expect(snapshot.results.find((result) => result.id === "work-time-equivalent")?.availability).toBe("available");
    expect(draft).toMatchObject({
      income: "9000",
      purchaseAmount: "800",
      workHours: "",
      workTime: { mode: "unselected" },
      evidence: { income: "user-confirmed", workHours: "" },
    });
    expect(calculateDecision(draft).results.find((result) => result.id === "work-time-equivalent")).toMatchObject({
      availability: "insufficient-data",
      evidenceStatus: "insufficient-data",
      exact: null,
    });
    expect(calculateDecision({
      ...draft,
      workTime: { mode: "monthly" },
      workHours: "160",
      evidence: { ...draft.evidence, workHours: "user-confirmed" },
    }).results.find((result) => result.id === "work-time-equivalent")?.availability).toBe("available");

    const validCurrentProfile = { ...savedProfile, income: "9000", workDays: [1, 2, 3, 4] };
    const validCurrentCalculation = calculateIncome(validCurrentProfile, now);
    expect(validCurrentCalculation.workTimeInput?.totalWorkSeconds).toBe("518400");
    expect(favoriteRecalculationInput(snapshot, validCurrentProfile, validCurrentCalculation)).toMatchObject({
      workTime: { mode: "calendar", totalWorkSeconds: "518400" },
      evidence: { workHours: "estimated" },
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
