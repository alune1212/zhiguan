import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { holdingSuggestionFor, reasonBlocksPreview } from "../src/domain/categories";
import { calculateDecision } from "../src/domain/calculation";
import {
  DEFAULT_PERSONAS,
  defaultPersonas,
  personaProblems,
} from "../src/domain/personas";
import { buildFactCard, isFactCard, type FactCard } from "../src/domain/fact-card";
import { calculateIncome, defaultProfile, type IncomeProfile } from "../src/domain/income";
import {
  checkSentence,
  checkSpeech,
  parseChineseInteger,
  sentenceNote,
  usableText,
} from "../src/domain/speech-check";
import {
  PROVIDER_NAME,
  discussionIsComplete,
  personaTurnPayload,
  previewProblems,
  renderPreview,
  synthesisPayload,
} from "../src/domain/discussion-payload";
import { leaningWording } from "../src/domain/model-output";
import {
  DISCUSSIONS_STORAGE_KEY,
  clearDiscussions,
  deleteDiscussion,
  readDiscussions,
  upsertDiscussion,
  type DiscussionRecord,
} from "../src/domain/discussion-store";
import { LOCAL_DATA_STORAGE_KEY, commitLocalData, parseLocalBackup, readLocalData } from "../src/domain/local-data";
import { createPortableBackup, parsePortableBackup } from "../src/domain/portable-backup";

const now = new Date("2026-09-23T01:00:00.000Z");
const secret = "sk-test-secret";

function profile(): IncomeProfile {
  return { ...defaultProfile(now), income: "10000", timeZone: "Asia/Shanghai" };
}

function cardFor(patch: Partial<Parameters<typeof buildFactCard>[0]> = {}) {
  const result = buildFactCard({
    profile: profile(),
    now,
    price: "1000",
    priceEvidence: "user-confirmed",
    frequency: null,
    holdingDays: null,
    fixedExpenses: null,
    emergencyFund: null,
    otherSavings: null,
    ...patch,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.card;
}

describe("purchase fact card", () => {
  it("matches the existing purchase calculation and omits the live dashboard", () => {
    const card = cardFor();
    const income = calculateIncome(profile(), now);
    const decision = calculateDecision({
      income: "10000",
      workHours: "",
      workTime: income.workTimeInput ?? { mode: "unselected" },
      fixedExpenses: "",
      purchaseAmount: "1000",
      taxBasis: "after-tax",
      fixedCostCoverage: "",
      purchaseIncluded: "",
      valueExpectation: "",
      evidence: { income: "user-confirmed", workHours: "estimated", fixedExpenses: "", purchaseAmount: "user-confirmed" },
    });
    const hourly = decision.results.find((result) => result.id === "income-rate");
    const work = decision.results.find((result) => result.id === "work-time-equivalent");
    expect(card.hourlyIncome.display).toBe(hourly?.exact?.decimal ?? null);
    expect(card.hourlyIncome.evidence).toBe(hourly?.evidenceStatus);
    expect(card.workTimeEquivalent.display).toBe(work?.exact?.decimal ?? null);
    expect(card.workTimeEquivalent.evidence).toBe(work?.evidenceStatus);
    expect(card.monthlyIncome.display).toBe("10000");
    expect(card.purchasePrice.display).toBe("1000");
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain("每秒");
    expect(serialized).not.toContain("todayIncome");
    expect(serialized).not.toContain("perSecond");
    expect(isFactCard(card)).toBe(true);
  });

  it("keeps missing margin, holding days, emergency fund and other savings distinct", () => {
    const bare = cardFor();
    expect(bare.availableMargin).toMatchObject({ display: null, evidence: "insufficient-data" });
    expect(bare.purchaseAfterMargin).toMatchObject({ display: null, evidence: "insufficient-data" });
    expect(bare.holdingDailyCost.display).toBeNull();
    expect(bare.perUseCost.display).toBeNull();
    expect(bare.emergencyFund).toBeUndefined();
    expect(bare.otherSavings).toBeUndefined();
    expect(bare.holdingDays).toBeUndefined();
    expect(JSON.stringify(bare)).not.toContain(String(holdingSuggestionFor("家电")));
    expect(bare.citations).not.toContain("0");

    const savings = cardFor({
      emergencyFund: { amount: "2000", evidence: "user-confirmed" },
      otherSavings: { amount: "8000", evidence: "estimated" },
    });
    expect(savings.emergencyFund).toMatchObject({ display: "2000", evidence: "user-confirmed" });
    expect(savings.otherSavings).toMatchObject({ display: "8000", evidence: "estimated" });
    expect(savings.emergencyFund?.formula).toContain("不与其他存款合并");
    expect(savings.otherSavings?.formula).toContain("不与应急金合并");

    const confirmed = cardFor({
      fixedExpenses: { amount: "3000", evidence: "user-confirmed", complete: true },
      frequency: { period: "week", count: "3", evidence: "user-confirmed" },
      holdingDays: { days: "7", evidence: "user-confirmed" },
    });
    expect(confirmed.availableMargin.display).toBe("7000");
    expect(confirmed.purchaseAfterMargin.evidence).toBe("forecast");
    expect(confirmed.purchaseAfterMargin.display).toBe("6000");
    expect(confirmed.holdingDailyCost.display).toBe("142.86");
    expect(confirmed.perUseCost.display).toBe("333.33");
    expect(confirmed.frequencyCount?.display).toBe("3");
    expect(confirmed.citations).toContain(confirmed.hourlyIncome.display);
    expect(confirmed.citations).not.toContain("62.5");
  });

  it("does not build a card for an invalid price", () => {
    expect(buildFactCard({
      profile: profile(),
      now,
      price: "0",
      priceEvidence: "user-confirmed",
      frequency: null,
      holdingDays: null,
      fixedExpenses: null,
      emergencyFund: null,
      otherSavings: null,
    }).ok).toBe(false);
  });
});

describe("citation and leaning checks", () => {
  const citations = ["1000", "16.00", "62.50", "3", "5"];

  it("parses the simple Chinese amounts used in phase one", () => {
    expect(parseChineseInteger("三")).toBe("3");
    expect(parseChineseInteger("十二")).toBe("12");
    expect(parseChineseInteger("两万")).toBe("20000");
    expect(parseChineseInteger("十")).toBe("10");
    expect(parseChineseInteger("两亿")).toBeNull();
  });

  it("accepts cited literals and blocks invented or pressuring sentences", () => {
    expect(checkSentence("相当于 16.00 小时", citations).numberMismatch).toBe(false);
    expect(checkSentence("这台吸尘器", citations).numberMismatch).toBe(false);
    expect(checkSentence("一个工作日", citations).numberMismatch).toBe(false);
    expect(checkSentence("你每周用 3 次", citations).numberMismatch).toBe(false);
    expect(checkSentence("1,000 元", citations).numberMismatch).toBe(false);
    expect(checkSentence("¥1,000", citations).numberMismatch).toBe(false);
    expect(checkSentence("5 年后的你", citations).numberMismatch).toBe(false);
    expect(checkSentence("大概两万块", citations).numberMismatch).toBe(true);
    expect(checkSentence("62.5 元", citations).numberMismatch).toBe(true);
    expect(checkSentence("这很浪费", citations).pressure).toBe(true);
    expect(checkSentence("你应该买", citations).verdict).toBe(true);
    const checked = checkSpeech("大概两万块。相当于 16.00 小时。这很浪费。", citations);
    expect(usableText(checked)).toBe("相当于 16.00 小时");
    expect(sentenceNote(checked[0]!)).toContain("这句里的数字对不上事实卡，不参与后续讨论");
    expect(sentenceNote(checked[2]!)).toContain("这句可能在施压");
    expect(JSON.stringify(synthesisPayload(cardFor(), "家电", "旧的坏了", defaultPersonas(), [
      { personaId: "family", name: "家人", text: usableText(checked) },
    ]))).not.toContain("两万");
  });

  it("only exposes the five leaning wordings", () => {
    expect(leaningWording("lean-skip")).toBe("更倾向这次先不买");
    expect(leaningWording("lean-buy")).toBe("更倾向现在买");
    expect(leaningWording("lean-wait")).toBe("更倾向再等等");
    expect(leaningWording("lean-adjust")).toBe("更倾向先换个条件");
    expect(leaningWording("unclear")).toBe("这轮没有形成倾向");
    expect(leaningWording("应该买")).toBeNull();
    expect(Object.values({
      "lean-buy": leaningWording("lean-buy"),
      "lean-wait": leaningWording("lean-wait"),
      "lean-skip": leaningWording("lean-skip"),
      "lean-adjust": leaningWording("lean-adjust"),
      unclear: leaningWording("unclear"),
    })).toEqual(["更倾向现在买", "更倾向再等等", "更倾向这次先不买", "更倾向先换个条件", "这轮没有形成倾向"]);
  });
});

describe("discussion payloads", () => {
  it("keeps round 1 to one persona and round 2 to validated speech", () => {
    const card = cardFor();
    const personas = defaultPersonas();
    const family = personas[0]!;
    const future = personas[3]!;
    const round1 = personaTurnPayload(card, "家电", "旧的坏了", family, personas, 1);
    const round1Json = JSON.stringify(round1);
    expect(round1).not.toHaveProperty("ownSpeech");
    expect(round1).not.toHaveProperty("otherSpeeches");
    expect(round1Json).toContain("直接，关心日子稳不稳");
    expect(round1Json).not.toContain("一起商量，不替对方做主");
    expect(round1Json).not.toContain("说实话，但不比较");
    expect(round1Json).not.toContain("只谈工作是否用得上");
    expect(round1Json).not.toContain(secret);
    expect(round1.factCard.citations).toContain("5");
    expect(round1Json).not.toContain(String(holdingSuggestionFor("家电")));

    const round2 = personaTurnPayload(card, "家电", "旧的坏了", family, personas, 2, "旧的坏了", [
      { personaId: future.id, name: future.name, text: "相当于 16.00 小时" },
    ]);
    const round2Json = JSON.stringify(round2);
    expect(round2Json).toContain("相当于 16.00 小时");
    expect(round2Json).not.toContain(future.personality);
    expect(round2Json).not.toContain(future.moneyAttitude);

    const preview = renderPreview({
      round: 1,
      card,
      category: "家电",
      reason: "旧的坏了",
      personas,
      providerHost: "api.deepseek.com",
    });
    expect(preview).toContain(card.monthlyIncome.display ?? "");
    expect(preview).toContain(PROVIDER_NAME);
    expect(preview).toContain("api.deepseek.com");
    expect(preview).toContain("对方收到后是否保留，本产品不能替对方删除");
    expect(preview).toContain("本轮请求次数：5");
    expect(preview).not.toContain(secret);
    expect(personaProblems(personas)).toEqual([]);
    expect(DEFAULT_PERSONAS.find((persona) => persona.name === "上司")?.enabled).toBe(false);
    expect(DEFAULT_PERSONAS.find((persona) => persona.name === "5 年后的你")?.stance).toBe("pushback");
  });

  it("blocks preview until price, category, reason and a dissenter are ready", () => {
    const personas = defaultPersonas();
    expect(previewProblems({
      priceReady: false,
      category: "家电",
      categoryPending: false,
      reason: "旧的坏了",
      parsedItem: null,
      personas,
    }).length).toBeGreaterThan(0);
    expect(reasonBlocksPreview("想买：吸尘器", "吸尘器")).toBe(true);
    expect(reasonBlocksPreview("吸尘器", "吸尘器")).toBe(true);
    expect(reasonBlocksPreview("旧的坏了", "吸尘器")).toBe(false);
    expect(reasonBlocksPreview("吸尘器", null)).toBe(false);
    expect(previewProblems({
      priceReady: true,
      category: "家电",
      categoryPending: true,
      reason: "旧的坏了",
      parsedItem: null,
      personas,
    }).join("")).toContain("类别");
    const withoutPushback = personas.map((persona) => persona.stance === "pushback" ? { ...persona, enabled: false } : persona);
    expect(personaProblems(withoutPushback).join("")).toContain("反对");
    expect(discussionIsComplete({
      synthesisShown: false,
      serviceAvailable: true,
      personaFailed: false,
      synthesisFailed: false,
      hasDecision: true,
    })).toBe(false);
    expect(discussionIsComplete({
      synthesisShown: true,
      serviceAvailable: true,
      personaFailed: false,
      synthesisFailed: false,
      hasDecision: false,
    })).toBe(true);
    expect(discussionIsComplete({
      synthesisShown: false,
      serviceAvailable: false,
      personaFailed: false,
      synthesisFailed: false,
      hasDecision: true,
    })).toBe(true);
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

function record(card: FactCard, id = "discussion-1"): DiscussionRecord {
  return {
    id,
    completedAt: "2026-09-23T01:00:00.000Z",
    updatedAt: "2026-09-23T01:00:00.000Z",
    factCard: card,
    category: "家电",
    reason: "旧的坏了",
    personas: defaultPersonas(),
    round1: { speeches: [], synthesis: null },
    round2: null,
    decision: { code: "wait", rationale: "再看看" },
  };
}

describe("discussion storage and old backups", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, _options: { mode: "exclusive" }, callback: () => Promise<unknown>) => callback(),
      },
    });
    vi.stubGlobal("crypto", { randomUUID: () => "revision-1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a completed discussion outside the income backup fields", async () => {
    const savedProfile = await commitLocalData({ profile: profile(), favorites: [] }, null);
    expect(savedProfile.status).toBe("saved");
    const card = cardFor();
    const saved = await upsertDiscussion(record(card), null);
    expect(saved.status).toBe("saved");
    expect(storage.getItem(DISCUSSIONS_STORAGE_KEY)).toContain("zhiguan-discussions@1");
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).not.toContain("zhiguan-discussions@1");
    const incomeRaw = storage.getItem(LOCAL_DATA_STORAGE_KEY) ?? "";
    expect(parseLocalBackup(incomeRaw).status).toBe("valid");

    const removed = await deleteDiscussion("discussion-1", saved.status === "saved" ? saved.document.revision : null);
    expect(removed.status).toBe("saved");
    if (removed.status === "saved") {
      expect(removed.document.records).toEqual([]);
      expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(incomeRaw);
    }
    const cleared = await clearDiscussions(removed.status === "saved" ? removed.document.revision : null);
    expect(cleared.status).toBe("cleared");
    expect(readDiscussions().status).toBe("empty");
    expect(readLocalData().status).toBe("ready");
  });

  it("imports an old v1 backup without dropping the saved discussion", async () => {
    const savedProfile = await commitLocalData({ profile: profile(), favorites: [] }, null);
    if (savedProfile.status !== "saved") throw new Error("profile");
    const first = await upsertDiscussion(record(cardFor()), null);
    if (first.status !== "saved") throw new Error("discussion");
    vi.stubGlobal("crypto", { randomUUID: () => "revision-2" });
    const backup = JSON.parse(JSON.stringify({ ...savedProfile.document, exported_at: "2026-09-23T02:00:00.000Z" })) as unknown;
    expect(parseLocalBackup(JSON.stringify(backup)).status).toBe("valid");
    const portable = parsePortableBackup(JSON.stringify(backup));
    expect(portable.status).toBe("valid");
    if (portable.status === "valid") expect(portable.kind).toBe("v1");
    expect(readDiscussions().status).toBe("ready");

    const exported = createPortableBackup(savedProfile.document, first.document, new Date("2026-09-23T02:00:00.000Z"));
    const parsed = parsePortableBackup(exported);
    expect(parsed).toMatchObject({ status: "valid", kind: "v2" });
    expect(parseLocalBackup(exported)).toEqual({ status: "invalid", reason: "unsupported-version" });
    expect(exported).not.toContain(secret);
  });
});
