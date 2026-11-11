import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscussionPage, FactCardView, SavedDiscussionDetail } from "../src/app/DiscussionPage";
import { buildFactCard } from "../src/domain/fact-card";
import type { DiscussionRecord } from "../src/domain/discussion-store";
import { defaultProfile } from "../src/domain/income";
import { defaultPersonas } from "../src/domain/personas";

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

  it("shows a saved discussion as text and keeps its decision editable", () => {
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
    const record: DiscussionRecord = {
      id: "discussion-1",
      completedAt: "2026-09-23T01:00:00.000Z",
      updatedAt: "2026-09-23T01:00:00.000Z",
      factCard: result.card,
      category: "家电",
      reason: "旧的坏了",
      personas: defaultPersonas(),
      round1: {
        speeches: [{ personaId: "family", name: "家人", status: "done", usableText: "先看余量", sentences: [{ text: "先看余量", numberMismatch: false, pressure: false, verdict: false }] }],
        synthesis: null,
      },
      round2: null,
      decision: { code: "wait", rationale: "再看看" },
    };
    const html = renderToStaticMarkup(<SavedDiscussionDetail record={record} onDecision={() => undefined} onRationale={() => undefined} onClose={() => undefined} />);
    expect(html).toContain("这条已保存的讨论");
    expect(html).toContain("旧的坏了");
    expect(html).toContain("先看余量");
    expect(html).toContain("再看看");
    expect(html).toContain("改决定会更新这一条");
    expect(html).not.toContain("<img");
  });
});
