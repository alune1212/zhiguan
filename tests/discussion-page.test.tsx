import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscussionPage, FactCardView } from "../src/app/DiscussionPage";
import { buildFactCard } from "../src/domain/fact-card";
import { defaultProfile } from "../src/domain/income";

const now = new Date("2026-09-23T01:00:00.000Z");

describe("discussion page markup", () => {
  it("shows the fact card without the per-second dashboard", () => {
    const result = buildFactCard({
      profile: { ...defaultProfile(now), income: "10000", timeZone: "Asia/Shanghai" },
      now,
      price: "1000",
      priceEvidence: "user-confirmed",
      frequency: null,
      holdingDays: null,
      fixedExpenses: null,
      emergencyFund: null,
      otherSavings: null,
    });
    if (!result.ok) throw new Error(result.reason);
    const html = renderToStaticMarkup(<FactCardView card={result.card} />);
    expect(html).toContain("事实卡");
    expect(html).toContain("证据：");
    expect(html).toContain(result.card.monthlyIncome.display ?? "");
    expect(html).not.toContain("元/秒");
    expect(html).not.toContain("今日收入");
    expect(html).not.toContain("<img");
  });

  it("starts on the purchase discussion and keeps the decision choices in text", () => {
    const html = renderToStaticMarkup(<DiscussionPage profile={{ ...defaultProfile(now), income: "10000", timeZone: "Asia/Shanghai" }} now={now} unsaved={false} />);
    expect(html).toContain("讨论这笔购买");
    expect(html).toContain("现在买");
    expect(html).toContain("这次不买");
    expect(html).toContain("全部清除已保存的讨论");
    expect(html).toContain("还没完成的讨论不会自动保存");
    expect(html).toContain('id="purchase-price"');
    expect(html).toContain('for="purchase-price"');
    expect(html).not.toContain("每秒收入");
  });
});
