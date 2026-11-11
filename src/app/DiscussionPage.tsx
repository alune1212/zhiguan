import { useEffect, useMemo, useRef, useState } from "react";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CATEGORY_SUGGESTIONS, holdingSuggestionFor } from "../domain/categories";
import { parseAmount } from "../domain/calculation";
import { cardForDiscussion, discussionIsComplete, previewProblems, renderPreview, synthesisPayload, type CitedSpeech } from "../domain/discussion-payload";
import {
  clearDiscussions,
  clearInvalidDiscussions,
  deleteDiscussion,
  readDiscussions,
  upsertDiscussion,
  type DiscussionRecord,
  type DiscussionRound,
  type DiscussionsReadResult,
} from "../domain/discussion-store";
import { buildFactCard, factCardForModel, type FactCard, type FactEvidence, type FactField } from "../domain/fact-card";
import { calculateIncome, type IncomeProfile } from "../domain/income";
import { leaningWording } from "../domain/model-output";
import { defaultPersonas, personaProblems, type Persona } from "../domain/personas";
import type { PurchaseDecisionCode } from "../domain/purchase-snapshot";
import { checkSpeech, sentenceNote, usableText, type SpeechSentence } from "../domain/speech-check";
import { DECISION_OPTIONS } from "./App";
import { loadProvider, parsePurchaseSentence, requestPersona, requestSynthesis, type ProviderStatus } from "./discussion-client";

const EVIDENCE_LABEL: Record<FactEvidence, string> = {
  "user-confirmed": "已确认",
  estimated: "估算",
  forecast: "预测",
  "insufficient-data": "数据不足",
};

const FACT_ROWS: readonly { readonly key: keyof FactCard; readonly label: string }[] = [
  { key: "monthlyIncome", label: "月收入" },
  { key: "hourlyIncome", label: "每小时收入" },
  { key: "workdayIncome", label: "一个工作日的收入" },
  { key: "workTimeEquivalent", label: "工时等价" },
  { key: "availableMargin", label: "本月可用金额" },
  { key: "purchaseAfterMargin", label: "买完后本月还剩" },
  { key: "perUseCost", label: "单次使用成本" },
  { key: "holdingDailyCost", label: "持有日成本" },
  { key: "emergencyFund", label: "应急金" },
  { key: "otherSavings", label: "其他存款" },
  { key: "purchasePrice", label: "购买价格" },
  { key: "frequencyCount", label: "使用次数" },
  { key: "holdingDays", label: "预计持有天数" },
];

interface Draft {
  sentence: string;
  price: string;
  pricePending: string | null;
  priceApproximate: boolean;
  category: string;
  categoryPending: string | null;
  reason: string;
  parsedItem: string | null;
  frequencyPeriod: "" | "day" | "week";
  frequencyCount: string;
  frequencyApproximate: boolean;
  holdingDays: string;
  holdingConfirmed: boolean;
  holdingApproximate: boolean;
  fixedExpenses: string;
  fixedApproximate: boolean;
  fixedComplete: boolean;
  emergencyFund: string;
  emergencyApproximate: boolean;
  otherSavings: string;
  savingsApproximate: boolean;
}

interface RoundSpeech {
  readonly personaId: string;
  readonly name: string;
  readonly status: "waiting" | "done" | "failed";
  readonly usableText: string;
  readonly sentences: readonly SpeechSentence[];
}

interface RoundSynthesis {
  readonly status: "waiting" | "done" | "failed";
  readonly leaning: string | null;
  readonly reasons: readonly SpeechSentence[];
  readonly risks: readonly SpeechSentence[];
  readonly changeConditions: readonly SpeechSentence[];
  readonly disagreements: readonly SpeechSentence[];
  readonly pushbackMissing: boolean;
}

interface RoundView {
  readonly speeches: readonly RoundSpeech[];
  readonly synthesis: RoundSynthesis | null;
}

const EMPTY_DRAFT: Draft = {
  sentence: "",
  price: "",
  pricePending: null,
  priceApproximate: false,
  category: "",
  categoryPending: null,
  reason: "",
  parsedItem: null,
  frequencyPeriod: "",
  frequencyCount: "",
  frequencyApproximate: false,
  holdingDays: "",
  holdingConfirmed: false,
  holdingApproximate: false,
  fixedExpenses: "",
  fixedApproximate: false,
  fixedComplete: false,
  emergencyFund: "",
  emergencyApproximate: false,
  otherSavings: "",
  savingsApproximate: false,
};

export function FactCardView({ card }: { readonly card: FactCard }) {
  return (
    <div className="fact-card">
      <h2 id="fact-card-heading">事实卡</h2>
      <p>这些数字由已保存的收入资料和本页已确认的输入算出。模型不参与计算。看板上随时变化的累计和速率不在这张卡上。</p>
      <dl className="fact-list">
        {FACT_ROWS.map((row) => {
          const field = card[row.key];
          if (!isFactField(field)) return null;
          return (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>
                {field.display === null ? "没有可展示的数字" : <strong>{field.display} {field.unit}</strong>}
                <span>证据：{EVIDENCE_LABEL[field.evidence]}</span>
                <span>{field.display === null ? field.reason : field.formula}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p>可引用的数字：{card.citations.length > 0 ? card.citations.join("、") : "这一项还没有可引用的数字。"}</p>
    </div>
  );
}

export function DiscussionPage({ profile, now, unsaved }: { readonly profile: IncomeProfile; readonly now: Date; readonly unsaved: boolean }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [personas, setPersonas] = useState<Persona[]>(() => defaultPersonas());
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerKnown, setProviderKnown] = useState(false);
  const [round1, setRound1] = useState<RoundView | null>(null);
  const [round2, setRound2] = useState<RoundView | null>(null);
  const [decision, setDecision] = useState<PurchaseDecisionCode | "">("");
  const [rationale, setRationale] = useState("");
  const [preview, setPreview] = useState<{ readonly round: 1 | 2; readonly text: string } | null>(null);
  const [library, setLibrary] = useState<DiscussionsReadResult>({ status: "empty" });
  const [notice, setNotice] = useState<string | null>(null);
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ readonly kind: "delete" | "clear"; readonly id?: string } | null>(null);
  const generationRef = useRef(0);
  const recordIdRef = useRef<string | null>(null);
  const completedAtRef = useRef<string | null>(null);
  const savedSnapshotRef = useRef("");
  const revisionRef = useRef<string | null>(null);
  const confirmedRef = useRef<string | null>(null);
  const speechHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const stored = readDiscussions();
    setLibrary(stored);
    if (stored.status === "ready" && stored.document.personas.length > 0) setPersonas(stored.document.personas.map((persona) => ({ ...persona })));
    const controller = new AbortController();
    void loadProvider(controller.signal).then((status) => {
      if (controller.signal.aborted) return;
      setProvider(status);
      setProviderKnown(true);
    }).catch(() => {
      if (!controller.signal.aborted) setProviderKnown(true);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    revisionRef.current = library.status === "ready" ? library.document.revision : null;
  }, [library]);

  const priceReady = draft.pricePending === null && parseAmount(draft.price, false).ok;
  const categoryPending = draft.categoryPending !== null && draft.category === draft.categoryPending;
  const suggestion = categoryPending ? null : holdingSuggestionFor(draft.category);
  const frequency = draft.frequencyPeriod && draft.frequencyCount.trim()
    ? { period: draft.frequencyPeriod, count: draft.frequencyCount, evidence: draft.frequencyApproximate ? "estimated" as const : "user-confirmed" as const }
    : null;
  const nowRef = useRef(now);
  nowRef.current = now;
  const calendarStamp = useMemo(() => {
    const income = calculateIncome(profile, now);
    return `${income.status}|${income.comparisonMonth ?? ""}|${income.totalWorkSeconds ?? ""}|${income.plannedWorkDayCount ?? ""}`;
  }, [now, profile]);
  const fact = useMemo(() => priceReady ? buildFactCard({
    profile,
    now: nowRef.current,
    price: draft.price,
    priceEvidence: draft.priceApproximate ? "estimated" : "user-confirmed",
    frequency,
    holdingDays: draft.holdingConfirmed ? { days: draft.holdingDays, evidence: draft.holdingApproximate ? "estimated" : "user-confirmed" } : null,
    fixedExpenses: draft.fixedExpenses.trim() ? { amount: draft.fixedExpenses, evidence: draft.fixedApproximate ? "estimated" : "user-confirmed", complete: draft.fixedComplete } : null,
    emergencyFund: draft.emergencyFund.trim() ? { amount: draft.emergencyFund, evidence: draft.emergencyApproximate ? "estimated" : "user-confirmed" } : null,
    otherSavings: draft.otherSavings.trim() ? { amount: draft.otherSavings, evidence: draft.savingsApproximate ? "estimated" : "user-confirmed" } : null,
  }) : { ok: false as const, reason: "invalid-price" as const }, [calendarStamp, draft, frequency, priceReady, profile]);

  const fingerprint = JSON.stringify({
    income: profile.income,
    updatedAt: profile.updatedAt,
    timeZone: profile.timeZone,
    workDays: profile.workDays,
    periods: profile.periods,
    exceptions: profile.exceptions,
    price: priceReady ? draft.price : "",
    priceApproximate: draft.priceApproximate,
    category: categoryPending ? "" : draft.category.trim(),
    reason: draft.reason.trim(),
    frequency,
    holding: draft.holdingConfirmed ? [draft.holdingDays, draft.holdingApproximate] : null,
    fixed: draft.fixedExpenses.trim() ? [draft.fixedExpenses, draft.fixedComplete, draft.fixedApproximate] : null,
    emergency: draft.emergencyFund.trim() ? [draft.emergencyFund, draft.emergencyApproximate] : null,
    savings: draft.otherSavings.trim() ? [draft.otherSavings, draft.savingsApproximate] : null,
    personas,
  });

  useEffect(() => {
    generationRef.current += 1;
    setRound1(null);
    setRound2(null);
    recordIdRef.current = null;
    completedAtRef.current = null;
    savedSnapshotRef.current = "";
    confirmedRef.current = null;
  }, [fingerprint]);

  const card = fact.ok ? fact.card : null;
  const problems = previewProblems({
    priceReady,
    category: draft.category,
    categoryPending,
    reason: draft.reason,
    parsedItem: draft.parsedItem,
    personas,
  });
  const serviceAvailable = provider?.available === true;
  const personaFailed = Boolean(round1?.speeches.some((speech) => speech.status === "failed") || round2?.speeches.some((speech) => speech.status === "failed"));
  const synthesisFailed = round1?.synthesis?.status === "failed" || round2?.synthesis?.status === "failed";
  const synthesisShown = round1?.synthesis?.status === "done" || round2?.synthesis?.status === "done";
  const roundBusy = Boolean(round1?.speeches.some((speech) => speech.status === "waiting") || round1?.synthesis?.status === "waiting"
    || round2?.speeches.some((speech) => speech.status === "waiting") || round2?.synthesis?.status === "waiting");
  const complete = !roundBusy && card !== null && problems.length === 0 && discussionIsComplete({
    synthesisShown,
    serviceAvailable,
    personaFailed,
    synthesisFailed,
    hasDecision: decision !== "",
  });
  const saveSnapshot = JSON.stringify({ fingerprint, round1, round2, decision, rationale, complete });

  useEffect(() => {
    if (!complete || !card) return;
    if (savedSnapshotRef.current === saveSnapshot) return;
    const id = recordIdRef.current ?? globalThis.crypto.randomUUID();
    recordIdRef.current = id;
    completedAtRef.current ??= new Date().toISOString();
    const record = toRecord(id, completedAtRef.current, card, draft, personas, round1, round2, decision, rationale);
    if (!record) {
      setNotice("这次讨论还不能写入本地。");
      return;
    }
    let cancelled = false;
    void upsertDiscussion(record, revisionRef.current).then((result) => {
      if (cancelled) return;
      if (result.status === "saved") {
        savedSnapshotRef.current = saveSnapshot;
        revisionRef.current = result.document.revision;
        setLibrary({ status: "ready", document: result.document, raw: result.raw });
        setNotice("这次讨论已保存在此浏览器。");
      } else {
        setNotice("这次没有写入本地。页面上的内容还在，刷新后可能丢失。");
      }
    });
    return () => { cancelled = true; };
  }, [card, complete, draft, decision, personas, rationale, round1, round2, saveSnapshot]);

  const updateDraft = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const applyParse = async () => {
    const text = draft.sentence.trim();
    if (!text) return;
    setParseNotice(null);
    const parsed = await parsePurchaseSentence(text);
    if (!parsed) {
      setParseNotice("这次没有识别出来。可以直接填写，不会自动重试。");
      return;
    }
    setDraft((current) => {
      const next = { ...current, parsedItem: parsed.item ?? current.parsedItem };
      if (parsed.item && current.reason.trim() === "") next.reason = `想买：${parsed.item}`;
      if (parsed.price && current.price.trim() === "" && parseAmount(parsed.price, false).ok) {
        next.price = parsed.price.trim();
        next.pricePending = next.price;
        next.priceApproximate = parsed.priceApproximate;
      }
      if (parsed.category && current.category.trim() === "") {
        next.category = parsed.category;
        next.categoryPending = parsed.category;
      }
      return next;
    });
    setParseNotice("识别结果已填进空白栏，价格和类别要确认后才进入事实卡。已写过的理由没有被覆盖。");
  };

  const openPreview = (round: 1 | 2) => {
    if (!card || !provider?.available || problems.length > 0) return;
    const validated = round === 2 ? validatedSpeeches(round1) : [];
    setPreview({
      round,
      text: renderPreview({
        round,
        card,
        category: draft.category,
        reason: draft.reason,
        personas,
        providerHost: provider.host,
        validatedSpeeches: validated,
      }),
    });
  };

  const sendRound = async (round: 1 | 2) => {
    if (!card || !provider?.available) return;
    const enabled = personas.filter((persona) => persona.enabled);
    const sharedCard = cardForDiscussion(card, enabled);
    const category = draft.category.trim();
    const reason = draft.reason.trim();
    const prior = validatedSpeeches(round1);
    const generation = ++generationRef.current;
    confirmedRef.current = fingerprint;
    const waiting: RoundView = {
      speeches: enabled.map((persona) => ({ personaId: persona.id, name: persona.name, status: "waiting", usableText: "", sentences: [] })),
      synthesis: null,
    };
    if (round === 1) setRound1(waiting);
    else setRound2(waiting);
    setPreview(null);
    const settled = await Promise.all(enabled.map(async (persona) => {
      const others = prior.filter((speech) => speech.personaId !== persona.id);
      const own = prior.find((speech) => speech.personaId === persona.id)?.text ?? "";
      const body = round === 1
        ? { factCard: sharedCard, category, reason, persona, round: 1 }
        : { factCard: sharedCard, category, reason, persona, round: 2, ownSpeech: own, otherSpeeches: others };
      const result = await requestPersona(body);
      return result === "failed" ? failedSpeech(persona) : doneSpeech(persona, result.points, result.pushback, sharedCard.citations);
    }));
    if (generation !== generationRef.current) return;
    const usable = settled.filter((speech) => speech.usableText.trim().length > 0).map((speech) => ({ personaId: speech.personaId, name: speech.name, text: speech.usableText }));
    let synthesis: RoundView["synthesis"] = { status: "failed", leaning: null, reasons: [], risks: [], changeConditions: [], disagreements: [], pushbackMissing: !hasPushback(enabled, usable) };
    if (usable.length > 0) {
      const payload = synthesisPayload(card, category, reason, enabled, usable);
      const result = await requestSynthesis({
        factCard: payload.factCard,
        category: payload.category,
        reason: payload.reason,
        personas: payload.personas,
        speeches: payload.speeches,
      });
      if (generation !== generationRef.current) return;
      synthesis = result === "failed" ? synthesis : doneSynthesis(result, payload.factCard.citations, !payload.pushbackAvailable);
    }
    const next = { speeches: settled, synthesis };
    if (round === 1) setRound1(next);
    else setRound2(next);
    speechHeadingRef.current?.focus();
  };

  const retryPersona = async (round: 1 | 2, personaId: string) => {
    if (!card || confirmedRef.current !== fingerprint || !provider?.available) return;
    const source = round === 1 ? round1 : round2;
    const persona = personas.find((item) => item.id === personaId);
    if (!source || !persona) return;
    const generation = ++generationRef.current;
    const enabled = personas.filter((item) => item.enabled);
    const sharedCard = cardForDiscussion(card, enabled);
    const mark = (status: RoundSpeech["status"], speech?: RoundSpeech) => {
      const speeches = source.speeches.map((item) => item.personaId === personaId ? (speech ?? { ...item, status }) : item);
      const next = { speeches, synthesis: source.synthesis };
      if (round === 1) setRound1(next);
      else setRound2(next);
    };
    mark("waiting");
    const prior = round === 2 ? validatedSpeeches(round1) : [];
    const result = await requestPersona(round === 1
      ? { factCard: sharedCard, category: draft.category.trim(), reason: draft.reason.trim(), persona, round: 1 }
      : {
        factCard: sharedCard,
        category: draft.category.trim(),
        reason: draft.reason.trim(),
        persona,
        round: 2,
        ownSpeech: prior.find((speech) => speech.personaId === persona.id)?.text ?? "",
        otherSpeeches: prior.filter((speech) => speech.personaId !== persona.id),
      });
    if (generation !== generationRef.current) return;
    const speech = result === "failed" ? failedSpeech(persona) : doneSpeech(persona, result.points, result.pushback, sharedCard.citations);
    mark(speech.status, speech);
    if (speech.status === "done") void sendSynthesisAgain(round, generation, sharedCard, enabled, source.speeches.map((item) => item.personaId === personaId ? speech : item));
  };

  const sendSynthesisAgain = async (round: 1 | 2, generation: number, sharedCard: FactCard, enabled: readonly Persona[], speeches: readonly RoundSpeech[]) => {
    const usable = speeches.filter((speech) => speech.usableText.trim()).map((speech) => ({ personaId: speech.personaId, name: speech.name, text: speech.usableText }));
    if (usable.length === 0 || generation !== generationRef.current) return;
    const payload = synthesisPayload(sharedCard, draft.category.trim(), draft.reason.trim(), enabled, usable);
    const result = await requestSynthesis({ factCard: payload.factCard, category: payload.category, reason: payload.reason, personas: payload.personas, speeches: payload.speeches });
    if (generation !== generationRef.current) return;
    const synthesis = result === "failed"
      ? { status: "failed" as const, leaning: null, reasons: [], risks: [], changeConditions: [], disagreements: [], pushbackMissing: !payload.pushbackAvailable }
      : doneSynthesis(result, payload.factCard.citations, !payload.pushbackAvailable);
    const next = { speeches, synthesis };
    if (round === 1) setRound1(next);
    else setRound2(next);
  };

  const removeSaved = async (id: string) => {
    const result = await deleteDiscussion(id, revisionRef.current);
    if (result.status === "saved") {
      revisionRef.current = result.document.revision;
      setLibrary({ status: "ready", document: result.document, raw: result.raw });
      setNotice("已删除这一条讨论。收入资料还在。");
    } else setNotice("没有删成。已保存的讨论还在。");
  };

  const clearSaved = async () => {
    const result = library.status === "invalid"
      ? await clearInvalidDiscussions(library.raw)
      : await clearDiscussions(revisionRef.current);
    if (result.status === "cleared") {
      revisionRef.current = null;
      setLibrary({ status: "empty" });
      setPersonas(defaultPersonas());
      setNotice("已保存的讨论已全部清除。收入资料还在。");
    } else setNotice("没有清除。已保存的讨论还在。");
  };

  return (
    <div className="discussion-page">
      {unsaved ? <p className="income-unsaved-warning" role="status">收入资料还没写进浏览器，这次只在当前页面临时使用。</p> : null}
      <section className="intro" aria-labelledby="discussion-heading">
        <p className="eyebrow">购买决策讨论</p>
        <h1 id="discussion-heading" tabIndex={-1}>讨论这笔购买</h1>
        <p>写下价格、类别和为什么想买。事实卡先在本地算好；人物讨论要等你看完即将发送的全文并确认。买不买仍然由你选择。</p>
        <p>还没完成的讨论不会自动保存，刷新后可能丢失。完成后会留在此浏览器，可以删除单条或全部清除。</p>
      </section>

      <section className="card" aria-labelledby="parse-heading">
        <h2 id="parse-heading">用一句话说明</h2>
        <p>可以跳过。这句话只用来预填物品、价格和类别，不会发送收入资料，也不会生成购买建议。</p>
        <label htmlFor="purchase-sentence">想买什么、多少钱、什么类别</label>
        <textarea id="purchase-sentence" rows={3} value={draft.sentence} onChange={(event) => updateDraft({ sentence: event.currentTarget.value })} />
        <Button type="button" variant="secondary" onClick={() => void applyParse()} disabled={draft.sentence.trim().length === 0}>识别价格和类别</Button>
        {parseNotice ? <p role="status">{parseNotice}</p> : null}
      </section>

      <section className="card" aria-labelledby="purchase-input-heading">
        <h2 id="purchase-input-heading">这笔购买</h2>
        <div className="field">
          <label htmlFor="purchase-price">购买价格（元）</label>
          <input id="purchase-price" inputMode="decimal" autoComplete="off" value={draft.price} onChange={(event) => {
            const price = event.currentTarget.value;
            updateDraft({ price, pricePending: draft.pricePending !== null && price !== draft.pricePending ? null : draft.pricePending });
          }} />
          <label className="check-line"><Checkbox id="price-approximate" checked={draft.priceApproximate} onCheckedChange={(checked) => updateDraft({ priceApproximate: checked === true })} />这是大概数</label>
          {draft.pricePending !== null ? <p>这是识别出的价格，确认前不进入事实卡。<Button type="button" onClick={() => updateDraft({ pricePending: null })}>确认价格</Button></p> : null}
        </div>
        <div className="field">
          <label htmlFor="purchase-category">类别</label>
          <input id="purchase-category" maxLength={40} value={draft.category} aria-describedby="category-hint" onChange={(event) => {
            const category = event.currentTarget.value;
            updateDraft({ category, categoryPending: draft.categoryPending !== null && category !== draft.categoryPending ? null : draft.categoryPending });
          }} />
          <p id="category-hint">自由填写，最长 40 字。快捷项会写入同一个字段，之后仍可修改。</p>
          <div className="discussion-picks" role="group" aria-label="常用类别">
            {CATEGORY_SUGGESTIONS.map((item) => (
              <Button key={item.label} type="button" variant="outline" onClick={() => updateDraft({ category: item.label, categoryPending: null })}>{item.label}</Button>
            ))}
          </div>
          {draft.categoryPending !== null ? <p>这是识别出的类别，确认前不能进入预览。<Button type="button" onClick={() => updateDraft({ categoryPending: null })}>确认类别</Button></p> : null}
          {suggestion !== null ? <p>「{draft.category.trim()}」常见会持有 {suggestion} 天。这只是建议，确认后才参与计算，也不会提前进入事实卡。<Button type="button" variant="secondary" onClick={() => updateDraft({ holdingDays: String(suggestion), holdingConfirmed: true })}>确认按 {suggestion} 天计算</Button></p> : null}
        </div>
        <div className="field">
          <label htmlFor="purchase-reason">为什么想买</label>
          <textarea id="purchase-reason" rows={4} maxLength={500} value={draft.reason} aria-describedby="reason-hint" onChange={(event) => updateDraft({ reason: event.currentTarget.value })} />
          <p id="reason-hint">{draft.parsedItem ? `请写下为什么想买。只留下「${draft.parsedItem}」或「想买：${draft.parsedItem}」还不能预览。` : "最长 500 字。超长时请改短，不会截断后发送。"}</p>
        </div>
        <fieldset>
          <legend>使用频率（可选）</legend>
          <label htmlFor="frequency-period">按天还是按周</label>
          <select id="frequency-period" value={draft.frequencyPeriod} onChange={(event) => updateDraft({ frequencyPeriod: event.currentTarget.value as Draft["frequencyPeriod"] })}>
            <option value="">先不填</option>
            <option value="day">每天</option>
            <option value="week">每周</option>
          </select>
          <label htmlFor="frequency-count">次数</label>
          <input id="frequency-count" inputMode="decimal" value={draft.frequencyCount} onChange={(event) => updateDraft({ frequencyCount: event.currentTarget.value })} />
          <label className="check-line"><Checkbox id="frequency-approximate" checked={draft.frequencyApproximate} onCheckedChange={(checked) => updateDraft({ frequencyApproximate: checked === true })} />次数是大概数</label>
        </fieldset>
        <div className="field">
          <label htmlFor="holding-days">预计持有天数（可选）</label>
          <input id="holding-days" inputMode="numeric" value={draft.holdingDays} onChange={(event) => updateDraft({ holdingDays: event.currentTarget.value, holdingConfirmed: false })} />
          <Button type="button" variant="secondary" onClick={() => updateDraft({ holdingConfirmed: /^[1-9]\d{0,4}$/u.test(draft.holdingDays.trim()) })}>确认这个天数</Button>
          <label className="check-line"><Checkbox id="holding-approximate" checked={draft.holdingApproximate} onCheckedChange={(checked) => updateDraft({ holdingApproximate: checked === true })} />天数是大概数</label>
          <p>{draft.holdingConfirmed ? "这个天数已确认，会参与日均成本。" : "未确认的天数和类别建议都不会参与计算。"}</p>
        </div>
        <fieldset>
          <legend>本月固定支出（可选）</legend>
          <label htmlFor="fixed-expenses">金额（元）</label>
          <input id="fixed-expenses" inputMode="decimal" value={draft.fixedExpenses} onChange={(event) => updateDraft({ fixedExpenses: event.currentTarget.value })} />
          <label className="check-line"><Checkbox id="fixed-complete" checked={draft.fixedComplete} onCheckedChange={(checked) => updateDraft({ fixedComplete: checked === true })} />已经包含本月全部固定支出</label>
          <label className="check-line"><Checkbox id="fixed-approximate" checked={draft.fixedApproximate} onCheckedChange={(checked) => updateDraft({ fixedApproximate: checked === true })} />支出是大概数</label>
          <p>不填，或还没确认已经填全时，两项余量都是数据不足，不会显示成 0。</p>
        </fieldset>
        <div className="field">
          <label htmlFor="emergency-fund">应急金（可选，元）</label>
          <input id="emergency-fund" inputMode="decimal" value={draft.emergencyFund} onChange={(event) => updateDraft({ emergencyFund: event.currentTarget.value })} />
          <label className="check-line"><Checkbox id="emergency-approximate" checked={draft.emergencyApproximate} onCheckedChange={(checked) => updateDraft({ emergencyApproximate: checked === true })} />应急金是大概数</label>
        </div>
        <div className="field">
          <label htmlFor="other-savings">其他存款（可选，元）</label>
          <input id="other-savings" inputMode="decimal" value={draft.otherSavings} onChange={(event) => updateDraft({ otherSavings: event.currentTarget.value })} />
          <label className="check-line"><Checkbox id="savings-approximate" checked={draft.savingsApproximate} onCheckedChange={(checked) => updateDraft({ savingsApproximate: checked === true })} />其他存款是大概数</label>
          <p>应急金和其他存款分开填写。没填的那一项不会出现，也不会并进另一项。</p>
        </div>
      </section>

      <section>
        {card ? <FactCardView card={card} /> : <p role="status">填入有效且已确认的价格后，这里显示事实卡。这一步不会请求模型。</p>}
      </section>

      <section className="card" aria-labelledby="persona-heading">
        <h2 id="persona-heading">人物</h2>
        <p>启用 1 到 5 位，其中至少一位反对这笔开销。出厂时上司关闭，「5 年后的你」负责反对。这些句子都可以改。</p>
        {personaProblems(personas).map((problem) => <p key={problem} role="status">{problem}</p>)}
        <div className="discussion-people">
          {personas.map((persona) => (
            <fieldset key={persona.id} className="persona-card">
              <legend>{persona.name || "未命名人物"}</legend>
              {([
                ["name", "姓名"],
                ["relationship", "关系"],
                ["personality", "性格"],
                ["caresAbout", "在意什么"],
                ["moneyAttitude", "对钱的态度"],
              ] as const).map(([key, label]) => (
                <label key={key} htmlFor={`${persona.id}-${key}`}>{label}
                  <input id={`${persona.id}-${key}`} maxLength={80} value={persona[key]} onChange={(event) => setPersonas((current) => current.map((item) => item.id === persona.id ? { ...item, [key]: event.currentTarget.value } : item))} />
                </label>
              ))}
              <label htmlFor={`${persona.id}-stance`}>立场
                <select id={`${persona.id}-stance`} value={persona.stance} onChange={(event) => setPersonas((current) => current.map((item) => item.id === persona.id ? { ...item, stance: event.currentTarget.value === "pushback" ? "pushback" : "ordinary" } : item))}>
                  <option value="ordinary">普通</option>
                  <option value="pushback">反对</option>
                </select>
              </label>
              <label className="check-line"><Checkbox id={`${persona.id}-enabled`} checked={persona.enabled} onCheckedChange={(checked) => setPersonas((current) => current.map((item) => item.id === persona.id ? { ...item, enabled: checked === true } : item))} />启用</label>
              <Button type="button" variant="ghost" disabled={personas.length <= 1} onClick={() => setPersonas((current) => current.filter((item) => item.id !== persona.id))}>移出这位</Button>
            </fieldset>
          ))}
        </div>
        <Button type="button" variant="secondary" disabled={personas.length >= 5} onClick={() => setPersonas((current) => [...current, {
          id: globalThis.crypto.randomUUID(),
          name: "新人物",
          relationship: "新人物",
          personality: "只谈这笔购买",
          caresAbout: "价格和使用假设",
          moneyAttitude: "不评价人",
          stance: "ordinary",
          enabled: true,
        }])}>新增人物</Button>
      </section>

      <section className="card" aria-labelledby="send-heading">
        <h2 id="send-heading">发送讨论</h2>
        {!providerKnown ? <p role="status">正在查看讨论服务。</p> : null}
        {providerKnown && !serviceAvailable ? <p role="status">讨论暂时不可用。事实卡和五种决定仍然可以用。不会自动重试。</p> : null}
        {problems.map((problem) => <p key={problem}>{problem}</p>)}
        <Button type="button" disabled={!card || !serviceAvailable || problems.length > 0 || roundBusy} onClick={() => openPreview(1)}>预览第一轮全文</Button>
        {round1 && !roundBusy ? <Button type="button" variant="secondary" disabled={!card || !serviceAvailable || problems.length > 0} onClick={() => openPreview(2)}>让他们回应彼此</Button> : null}
      </section>

      {round1 ? <RoundViewSection title="第一轮" round={round1} canRetry={confirmedRef.current === fingerprint && serviceAvailable && !roundBusy} onRetry={(id) => void retryPersona(1, id)} headingRef={speechHeadingRef} /> : null}
      {round2 ? <RoundViewSection title="第二轮" round={round2} canRetry={confirmedRef.current === fingerprint && serviceAvailable && !roundBusy} onRetry={(id) => void retryPersona(2, id)} /> : null}

      <section className="card" aria-labelledby="decision-title">
        <h2 id="decision-title">你的决定</h2>
        {synthesisShown ? <p>这是倾向，不是决定。</p> : <p>讨论没有替你勾选。你可以直接选择。</p>}
        <RadioGroup className="decision-options" name="purchase-decision" value={decision} aria-labelledby="decision-title" onValueChange={(value) => setDecision(value as PurchaseDecisionCode)}>
          {DECISION_OPTIONS.map((option) => (
            <label key={option.code} htmlFor={`discussion-decision-${option.code}`}>
              <RadioGroupItem id={`discussion-decision-${option.code}`} value={option.code} />
              {option.label}
            </label>
          ))}
        </RadioGroup>
        <label htmlFor="decision-note">自己的依据（可选，只留在本地）</label>
        <textarea id="decision-note" rows={3} maxLength={2000} value={rationale} onChange={(event) => setRationale(event.currentTarget.value)} />
      </section>

      <section className="card" aria-labelledby="saved-heading">
        <h2 id="saved-heading">已保存的讨论</h2>
        {library.status === "invalid" ? <p role="alert">已保存的讨论无法读取，没有改写它们。</p> : null}
        {library.status === "ready" && library.document.records.length > 0 ? (
          <ul className="saved-discussions">
            {library.document.records.map((item) => (
              <li key={item.id}>
                <p>{item.category} · {item.factCard.purchasePrice.display ?? "价格未显示"} 元 · {item.decision ? DECISION_OPTIONS.find((option) => option.code === item.decision?.code)?.label : "还没有选择"}</p>
                <Button type="button" variant="destructive" onClick={() => setConfirming({ kind: "delete", id: item.id })}>删除这条讨论</Button>
              </li>
            ))}
          </ul>
        ) : <p>还没有已保存的讨论。</p>}
        <Button type="button" variant="destructive" disabled={library.status === "empty"} onClick={() => setConfirming({ kind: "clear" })}>全部清除已保存的讨论</Button>
      </section>
      {notice ? <p className="income-notice" role="status">{notice}</p> : null}

      <AlertDialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <AlertDialogContent className="discussion-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>确认发送这一轮？</AlertDialogTitle>
            <AlertDialogDescription>下面是即将发送的全文，可以选择复制。不确认就不会发送。</AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="discussion-preview" tabIndex={0}>{preview?.text}</pre>
          <AlertDialogFooter>
            <AlertDialogCancel>先不发送</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (preview) void sendRound(preview.round); }}>确认发送</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.kind === "clear" ? "清除全部已保存的讨论？" : "删除这条讨论？"}</AlertDialogTitle>
            <AlertDialogDescription>只删除此浏览器里的讨论记录，不删除收入资料，也不能撤回已经发送的请求。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              const action = confirming;
              setConfirming(null);
              if (action?.kind === "clear") void clearSaved();
              else if (action?.id) void removeSaved(action.id);
            }}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoundViewSection({ title, round, canRetry, onRetry, headingRef }: {
  readonly title: string;
  readonly round: RoundView;
  readonly canRetry: boolean;
  readonly onRetry: (personaId: string) => void;
  readonly headingRef?: { readonly current: HTMLHeadingElement | null };
}) {
  const leaning = round.synthesis?.leaning ? leaningWording(round.synthesis.leaning) : null;
  return (
    <section className="card" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`} tabIndex={-1} ref={headingRef}>{title}</h2>
      {round.speeches.map((speech) => (
        <article key={speech.personaId} aria-labelledby={`${speech.personaId}-speech`}>
          <h3 id={`${speech.personaId}-speech`}>{speech.name}</h3>
          <p role="status">{speech.status === "waiting" ? "正在生成" : speech.status === "failed" ? "这次没生成" : "已生成"}</p>
          {speech.sentences.map((sentence, index) => (
            <p key={`${sentence.text}-${index}`}>{sentence.text}{sentenceNote(sentence) ? <span className="speech-note"> {sentenceNote(sentence)}</span> : null}</p>
          ))}
          {speech.status === "failed" ? <Button type="button" variant="secondary" disabled={!canRetry} onClick={() => onRetry(speech.personaId)}>重试这一位</Button> : null}
        </article>
      ))}
      {round.synthesis ? (
        <div>
          <h3>综合</h3>
          {round.synthesis.status === "waiting" ? <p role="status">正在生成综合。</p> : null}
          {round.synthesis.status === "failed" ? <p role="status">综合这次没生成。前面的发言还在，你仍然可以做决定。不会自动重试。</p> : null}
          {leaning ? <p>倾向：{leaning}</p> : null}
          <p>这是倾向，不是决定。</p>
          {round.synthesis.pushbackMissing ? <p>反对意见这次没有可用文本。</p> : null}
          <SentenceGroup label="理由" sentences={round.synthesis.reasons} />
          <SentenceGroup label="风险" sentences={round.synthesis.risks} />
          <SentenceGroup label="改变条件" sentences={round.synthesis.changeConditions} />
          <SentenceGroup label="分歧" sentences={round.synthesis.disagreements} />
        </div>
      ) : null}
    </section>
  );
}

function SentenceGroup({ label, sentences }: { readonly label: string; readonly sentences: readonly SpeechSentence[] }) {
  if (sentences.length === 0) return null;
  return (
    <div>
      <h4>{label}</h4>
      {sentences.map((sentence, index) => <p key={`${label}-${index}`}>{sentence.text}{sentenceNote(sentence) ? <span className="speech-note"> {sentenceNote(sentence)}</span> : null}</p>)}
    </div>
  );
}

function isFactField(value: FactCard[keyof FactCard]): value is FactField {
  return typeof value === "object" && value !== null && "evidence" in value && "display" in value;
}

function failedSpeech(persona: Persona): RoundSpeech {
  return { personaId: persona.id, name: persona.name, status: "failed", usableText: "", sentences: [] };
}

function doneSpeech(persona: Persona, points: readonly string[], pushback: string | null, citations: readonly string[]): RoundSpeech {
  const sentences = [...points.flatMap((point) => checkSpeech(point, citations)), ...(pushback ? checkSpeech(pushback, citations) : [])];
  return { personaId: persona.id, name: persona.name, status: "done", usableText: usableText(sentences), sentences };
}

function doneSynthesis(result: { readonly leaning: string; readonly reasons: readonly string[]; readonly risks: readonly string[]; readonly changeConditions: readonly string[]; readonly disagreements: readonly string[] }, citations: readonly string[], pushbackMissing: boolean): RoundView["synthesis"] {
  const leaning = leaningWording(result.leaning);
  if (!leaning) return { status: "failed", leaning: null, reasons: [], risks: [], changeConditions: [], disagreements: [], pushbackMissing };
  return {
    status: "done",
    leaning: result.leaning,
    reasons: result.reasons.flatMap((item) => checkSpeech(item, citations)),
    risks: result.risks.flatMap((item) => checkSpeech(item, citations)),
    changeConditions: result.changeConditions.flatMap((item) => checkSpeech(item, citations)),
    disagreements: result.disagreements.flatMap((item) => checkSpeech(item, citations)),
    pushbackMissing,
  };
}

function validatedSpeeches(round: RoundView | null): CitedSpeech[] {
  if (!round) return [];
  return round.speeches.filter((speech) => speech.status === "done" && speech.usableText.trim().length > 0).map((speech) => ({
    personaId: speech.personaId,
    name: speech.name,
    text: speech.usableText,
  }));
}

function hasPushback(personas: readonly Persona[], speeches: readonly CitedSpeech[]): boolean {
  const ids = new Set(personas.filter((persona) => persona.enabled && persona.stance === "pushback").map((persona) => persona.id));
  return speeches.some((speech) => ids.has(speech.personaId));
}

function toRecord(
  id: string,
  completedAt: string,
  card: FactCard,
  draft: Draft,
  personas: readonly Persona[],
  round1: RoundView | null,
  round2: RoundView | null,
  decision: PurchaseDecisionCode | "",
  rationale: string,
): DiscussionRecord | null {
  const record: DiscussionRecord = {
    id,
    completedAt,
    updatedAt: new Date().toISOString(),
    factCard: factCardForModel(card),
    category: draft.category.trim(),
    reason: draft.reason.trim(),
    personas: personas.map((persona) => ({ ...persona })),
    round1: toStoredRound(round1),
    round2: round2 ? toStoredRound(round2) : null,
    decision: decision === "" ? null : { code: decision, rationale },
  };
  return record;
}

function toStoredRound(round: RoundView | null): DiscussionRound {
  const speeches = (round?.speeches ?? []).filter((speech) => speech.status !== "waiting").map((speech) => ({
    personaId: speech.personaId,
    name: speech.name,
    status: speech.status === "failed" ? "failed" as const : "done" as const,
    usableText: speech.usableText,
    sentences: speech.sentences.map((sentence) => ({
      text: sentence.text,
      numberMismatch: sentence.numberMismatch,
      pressure: sentence.pressure,
      verdict: sentence.verdict,
    })),
  }));
  const synthesis = round?.synthesis && round.synthesis.status !== "waiting" ? {
    status: round.synthesis.status,
    leaning: round.synthesis.leaning,
    reasons: round.synthesis.reasons,
    risks: round.synthesis.risks,
    changeConditions: round.synthesis.changeConditions,
    disagreements: round.synthesis.disagreements,
    pushbackMissing: round.synthesis.pushbackMissing,
  } : null;
  return { speeches, synthesis };
}
