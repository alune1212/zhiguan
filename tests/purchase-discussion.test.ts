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
  PERSONA_INSTRUCTION,
  PROVIDER_NAME,
  SYNTHESIS_INSTRUCTION,
  discussionFingerprint,
  discussionIsComplete,
  personaTurnPayload,
  previewProblems,
  renderPreview,
  synthesisPayload,
  visibleDecision,
} from "../src/domain/discussion-payload";
import { leaningWording, parsePersonaOutput, parseSynthesisOutput } from "../src/domain/model-output";
import {
  DISCUSSIONS_STORAGE_KEY,
  clearDiscussions,
  createWriteQueue,
  deleteDiscussion,
  readDiscussions,
  storageFullNotice,
  upsertDiscussion,
  withUpdatedDecision,
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
    expect(parseChineseInteger("三五")).toBeNull();
    expect(parseChineseInteger("一两")).toBeNull();
    expect(parseChineseInteger("一千零五")).toBe("1005");
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
    expect(checkSentence("相当于１０００元", citations).numberMismatch).toBe(false);
    expect(checkSentence("相当于１０００元", ["16.00"]).numberMismatch).toBe(true);
    expect(checkSentence("１，０００元", citations).numberMismatch).toBe(false);
    expect(checkSentence("相当于１６．００小时", citations).numberMismatch).toBe(false);
    expect(checkSentence("大概３％", citations).numberMismatch).toBe(false);
    expect(checkSentence("大概三五天", ["5"]).numberMismatch).toBe(true);
    expect(checkSentence("值不值得要看你用不用", citations).verdict).toBe(false);
    expect(checkSentence("别买", citations).verdict).toBe(true);
    expect(checkSentence("必须买", citations).verdict).toBe(true);
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
    expect(parseSynthesisOutput({
      leaning: "lean-wait",
      reasons: ["再看一次"],
      risks: ["可能用不上"],
      changeConditions: ["随便"],
      disagreements: ["还没对齐"],
    })).toBeNull();
    expect(parseSynthesisOutput({
      leaning: "lean-wait",
      reasons: ["再看一次"],
      risks: ["可能用不上"],
      changeConditions: ["随便", "如果余量够就等"],
      disagreements: ["还没对齐"],
    })?.changeConditions).toEqual(["随便", "如果余量够就等"]);
    expect(parsePersonaOutput({ personaId: "future-self", points: ["先等"] }, "future-self", "pushback")).toBeNull();
    expect(parsePersonaOutput({ personaId: "family", points: ["先看余量"], pushback: "别买" }, "family", "ordinary")).toBeNull();
    expect(parsePersonaOutput({ personaId: "family", points: ["先看余量"] }, "family", "ordinary")?.pushback).toBeNull();
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
    expect(preview).toContain("factCard.citations");
    expect(preview).toContain("不要出现 pushback 字段");
    expect(preview).toContain("反对意见这次没有可用文本");
    expect(preview).not.toContain("仅反对角色必填，其他人物不要写");
    expect(preview).not.toContain(secret);
    expect(personaProblems(personas)).toEqual([]);
    expect(DEFAULT_PERSONAS.find((persona) => persona.name === "上司")?.enabled).toBe(false);
    expect(DEFAULT_PERSONAS.find((persona) => persona.name === "5 年后的你")?.stance).toBe("pushback");
    expect(personaProblems([{ ...defaultPersonas()[0]!, name: "名".repeat(81) }]).join("")).toContain("请改短");
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
    const same = { calendarStamp: "2026-09|633600|22", price: "1000", category: "家电", reason: "旧的坏了" };
    expect(discussionFingerprint(same)).toBe(discussionFingerprint(same));
    expect(discussionFingerprint(same)).not.toBe(discussionFingerprint({ ...same, calendarStamp: "2026-10|576000|20" }));
    expect(visibleDecision({ fingerprint: "a", decision: "wait", rationale: "再看看" }, "b")).toEqual({ decision: "", rationale: "" });
    expect(visibleDecision({ fingerprint: "a", decision: "wait", rationale: "再看看" }, "a").decision).toBe("wait");
  });

  it("keeps separate stance schemas and refuses invented dissent", () => {
    const ordinary = '{"personaId":"<persona.id>","points":["……"]}';
    const dissenter = '{"personaId":"<persona.id>","points":["……"],"pushback":"……"}';
    for (const instruction of [PERSONA_INSTRUCTION, SYNTHESIS_INSTRUCTION]) {
      expect(instruction).toContain("JSON");
      expect(instruction).toContain("citations");
      expect(instruction).toContain("\n");
    }
    expect(PERSONA_INSTRUCTION).toContain(ordinary);
    expect(PERSONA_INSTRUCTION).toContain(dissenter);
    expect(PERSONA_INSTRUCTION).toContain('persona.stance 是 "ordinary"');
    expect(PERSONA_INSTRUCTION).toContain('persona.stance 是 "pushback"');
    expect(SYNTHESIS_INSTRUCTION).toContain("反对意见这次没有可用文本");
    expect(SYNTHESIS_INSTRUCTION).toContain("lean-buy|lean-wait|lean-skip|lean-adjust|unclear");
  });

  it("gives concrete json examples that contain no copyable numbers", () => {
    const ordinary = exampleJson(PERSONA_INSTRUCTION, "普通人物示例：");
    const dissenter = exampleJson(PERSONA_INSTRUCTION, "反对人物示例：");
    const synthesis = exampleJson(SYNTHESIS_INSTRUCTION, "示例：");
    expect(ordinary).toEqual({
      personaId: "<persona.id>",
      points: ["旧的已经不好用了", "换掉它能少操心"],
    });
    expect(ordinary).not.toHaveProperty("pushback");
    expect(dissenter).toEqual({
      personaId: "<persona.id>",
      points: ["现有的还能用", "余量并不宽裕"],
      pushback: "可以再等等，等现有的彻底不能用，或者余量更宽裕的时候再看",
    });
    expect(synthesis).toEqual({
      leaning: "lean-wait",
      reasons: ["现有的还能用，不是立刻需要"],
      risks: ["会挤占余量"],
      changeConditions: ["如果现有的彻底不能用，就买"],
      disagreements: ["有人觉得现在换更省心，反对的人想再等等"],
    });
    for (const instruction of [PERSONA_INSTRUCTION, SYNTHESIS_INSTRUCTION]) {
      expect(instruction).toContain("示例里没有数字");
      expect(instruction).toContain("数字只能来自 factCard.citations");
    }
  });

  it("explains how round two uses ownSpeech and otherSpeeches", () => {
    expect(PERSONA_INSTRUCTION).toContain("ownSpeech 是你自己第一轮里通过校验的发言");
    expect(PERSONA_INSTRUCTION).toContain("otherSpeeches 是其他人物通过校验的发言");
    expect(PERSONA_INSTRUCTION).toContain("用它们回应彼此");
    expect(PERSONA_INSTRUCTION).toContain("第一轮没有这两个字段");
    expect(PERSONA_INSTRUCTION).toContain("不要把被挡下的句子写回来");
  });

  it("shows pushbackAvailable in the synthesis preview", () => {
    const personas = defaultPersonas();
    const family = personas[0]!;
    const future = personas.find((persona) => persona.id === "future-self")!;
    const base = {
      card: cardFor(),
      category: "家电",
      reason: "旧的坏了",
      personas,
      providerHost: "api.deepseek.com",
    } as const;
    const withPushback = renderPreview({
      ...base,
      round: 2,
      validatedSpeeches: [{ personaId: future.id, name: future.name, text: "先看工时" }],
    });
    const withoutPushback = renderPreview({
      ...base,
      round: 2,
      validatedSpeeches: [{ personaId: family.id, name: family.name, text: "旧的坏了" }],
    });
    const round1 = renderPreview({ ...base, round: 1 });
    expect(withPushback).toContain('"pushbackAvailable": true');
    expect(withoutPushback).toContain('"pushbackAvailable": false');
    expect(round1).toContain('"pushbackAvailable":');
    const sent = synthesisPayload(base.card, "家电", "旧的坏了", personas, [
      { personaId: future.id, name: future.name, text: "先看工时" },
    ]);
    expect(sent.pushbackAvailable).toBe(true);
    expect(withPushback).toContain(JSON.stringify(sent, null, 2));
  });
});

function exampleJson(instruction: string, label: string): unknown {
  const line = instruction.split("\n").find((item) => item.startsWith(label));
  expect(line, label).toBeDefined();
  const json = line?.slice(label.length) ?? "";
  expect(json).not.toMatch(/\d/u);
  expect(json).not.toMatch(/[零〇一二两三四五六七八九十百千万亿]/u);
  expect(json).not.toContain("……");
  return JSON.parse(json) as unknown;
}

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
    const updated = withUpdatedDecision(record(cardFor()), { code: "buy", rationale: "改成现在买" }, "2026-09-24T00:00:00.000Z");
    expect(updated.id).toBe("discussion-1");
    expect(updated.completedAt).toBe("2026-09-23T01:00:00.000Z");
    expect(updated.factCard).toEqual(record(cardFor()).factCard);
    expect(updated.decision).toEqual({ code: "buy", rationale: "改成现在买" });
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

  it("stores a speech split into more sentences than the old twelve-sentence cap", async () => {
    const split = Array.from({ length: 8 }, () => checkSpeech("先看余量。再看工时", [])).flat();
    expect(split).toHaveLength(16);
    const saved = await upsertDiscussion({
      ...record(cardFor(), "discussion-many"),
      round1: {
        speeches: [{
          personaId: "family",
          name: "家人",
          status: "done",
          usableText: split.map((sentence) => sentence.text).join("。"),
          sentences: split,
        }],
        synthesis: null,
      },
    }, null);
    expect(saved.status).toBe("saved");
  });

  it("writes one revision at a time and refuses a 101st record", async () => {
    const queue = createWriteQueue();
    const seen: Array<string | null> = [];
    let current: string | null = null;
    const first = queue.enqueue(async () => {
      seen.push(current);
      await new Promise((resolve) => setTimeout(resolve, 10));
      current = "r1";
    });
    const second = queue.enqueue(async () => {
      seen.push(current);
      current = "r2";
    });
    await first;
    await second;
    expect(seen).toEqual([null, "r1"]);
    expect(current).toBe("r2");

    let revision: string | null = null;
    for (let index = 0; index < 100; index += 1) {
      const saved = await upsertDiscussion(record(cardFor(), `discussion-${index}`), revision);
      expect(saved.status).toBe("saved");
      if (saved.status === "saved") revision = saved.document.revision;
    }
    expect(await upsertDiscussion(record(cardFor(), "discussion-overflow"), revision)).toEqual({ status: "unavailable", reason: "too-many" });
    expect((await upsertDiscussion(record(cardFor(), "discussion-0"), revision)).status).toBe("saved");
  });

  it("空间写满时保留已有讨论，并说明可以删除旧讨论或导出备份", async () => {
    const saved = await upsertDiscussion(record(cardFor(), "discussion-1"), null);
    if (saved.status !== "saved") throw new Error("seed");
    const oversized: DiscussionRecord = {
      ...record(cardFor(), "discussion-1"),
      round1: {
        speeches: [{
          personaId: "family",
          name: "家人",
          status: "done",
          usableText: "字".repeat(2_000_000),
          sentences: [],
        }],
        synthesis: null,
      },
    };
    const failed = await upsertDiscussion(oversized, saved.document.revision);
    if (failed.status !== "unavailable" || failed.reason !== "storage-full") {
      throw new Error(`expected storage-full, got ${JSON.stringify(failed)}`);
    }
    expect(failed.records).toBe(1);
    // 2_000_000 个汉字本身是 4_000_000 字节的 UTF-16 存储；整份文档只应再多出一小段 JSON。
    expect(failed.bytes).toBeGreaterThan(4_000_000);
    expect(failed.bytes).toBeLessThan(4_200_000);
    expect(failed.bytes % 2).toBe(0);
    const notice = storageFullNotice(failed.records, failed.bytes);
    const shown = (failed.bytes / 1_000_000).toFixed(failed.bytes >= 10_000_000 ? 0 : 1);
    expect(notice).toContain("1 条");
    expect(notice).toContain(`约 ${shown} MB`);
    expect(notice).toContain("删除旧讨论");
    expect(notice).toContain("导出备份");
    const kept = readDiscussions();
    expect(kept.status).toBe("ready");
    if (kept.status === "ready") {
      expect(kept.document.records).toHaveLength(1);
      expect(kept.document.records[0]?.round1.speeches).toEqual([]);
    }
    const oversizedRaw = `${JSON.stringify({ ...saved.document, records: [oversized] })}\n`;
    expect(oversizedRaw.length * 2).toBeGreaterThan(4_000_000);
    storage.setItem(DISCUSSIONS_STORAGE_KEY, oversizedRaw);
    expect(readDiscussions().status).toBe("invalid");
    storage.setItem(DISCUSSIONS_STORAGE_KEY, saved.raw);

    storage.setItem = () => {
      throw Object.assign(new Error("quota"), { name: "QuotaExceededError", code: 22 });
    };
    const quota = await upsertDiscussion(record(cardFor(), "discussion-quota"), saved.document.revision);
    if (quota.status !== "unavailable" || quota.reason !== "storage-full") {
      throw new Error(`expected quota storage-full, got ${JSON.stringify(quota)}`);
    }
    expect(quota.records).toBeGreaterThan(0);
    expect(storageFullNotice(quota.records, quota.bytes)).toContain("删除旧讨论");
    const afterQuota = readDiscussions();
    expect(afterQuota.status).toBe("ready");
    if (afterQuota.status === "ready") expect(afterQuota.document.records.map((item) => item.id)).toEqual(["discussion-1"]);

    storage.setItem = () => {
      throw new Error("blocked");
    };
    await expect(upsertDiscussion(record(cardFor(), "discussion-blocked"), saved.document.revision)).resolves.toEqual({
      status: "unavailable",
      reason: "write-failed",
    });
  });

  it("之前按字符数存下、UTF-8 超过 2MB 的中文文档，读回仍然有效，也能继续写入", async () => {
    const saved = await upsertDiscussion(record(cardFor(), "discussion-1"), null);
    if (saved.status !== "saved") throw new Error("seed");
    const text = "字".repeat(700_000);
    expect(text.length).toBeLessThan(2_000_000);
    expect(text.length * 2).toBeLessThanOrEqual(4_000_000);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(2_000_000);
    const source = saved.document.records[0];
    if (!source) throw new Error("seed record");
    const bloated = {
      ...saved.document,
      records: [{
        ...source,
        round1: {
          speeches: [{ personaId: "family", name: "家人", status: "done" as const, usableText: text, sentences: [] }],
          synthesis: null,
        },
      }],
    };
    const raw = `${JSON.stringify(bloated)}\n`;
    expect(raw.length * 2).toBeLessThanOrEqual(4_000_000);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(2_000_000);
    storage.setItem(DISCUSSIONS_STORAGE_KEY, raw);
    const read = readDiscussions();
    expect(read.status).toBe("ready");
    if (read.status === "ready") expect(read.document.records[0]?.round1.speeches[0]?.usableText).toBe(text);

    const written = await upsertDiscussion({
      ...record(cardFor(), "discussion-1"),
      round1: {
        speeches: [{
          personaId: "family",
          name: "家人",
          status: "done",
          usableText: text,
          sentences: [],
        }],
        synthesis: null,
      },
    }, saved.document.revision);
    expect(written.status).toBe("saved");
    if (written.status === "saved") {
      expect(new TextEncoder().encode(written.raw).length).toBeGreaterThan(2_000_000);
      expect(written.raw.length * 2).toBeLessThanOrEqual(4_000_000);
    }
  });

  it("拿到锁之前另一个标签页已经写过时，不覆盖那份讨论", async () => {
    const saved = await upsertDiscussion(record(cardFor(), "discussion-1"), null);
    if (saved.status !== "saved") throw new Error("seed");
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, _options: { mode: "exclusive" }, callback: () => Promise<unknown>) => {
          const current = JSON.parse(storage.getItem(DISCUSSIONS_STORAGE_KEY) ?? "{}") as { revision: string; records: Array<{ reason: string }> };
          current.revision = "other-tab";
          current.records[0].reason = "另一个标签页留下的";
          storage.setItem(DISCUSSIONS_STORAGE_KEY, JSON.stringify(current));
          return callback();
        },
      },
    });
    const result = await upsertDiscussion({ ...record(cardFor(), "discussion-1"), reason: "本页刚完成的讨论" }, saved.document.revision);
    expect(result).toEqual({ status: "conflict", currentRevision: "other-tab" });
    const raw = storage.getItem(DISCUSSIONS_STORAGE_KEY) ?? "";
    expect(raw).toContain("另一个标签页留下的");
    expect(raw).not.toContain("本页刚完成的讨论");
  });
});
