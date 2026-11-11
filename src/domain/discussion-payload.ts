import type { FactCard } from "./fact-card";
import type { PurchaseDecisionCode } from "./purchase-snapshot";
import { citationsWithPersonas, factCardForModel } from "./fact-card";
import type { Persona } from "./personas";
import { personaProblems } from "./personas";
import { categoryBlocksPreview, reasonBlocksPreview } from "./categories";

export const PROVIDER_NAME = "DeepSeek";
export const RETENTION_NOTICE = "对方收到后是否保留，本产品不能替对方删除";

export const PERSONA_INSTRUCTION = [
  "只使用事实卡 citations 里的数字字面量，不要自己运算，也不要改写这些数字。",
  "算不出的项目用文字说明数据不足，不要补数字，不要把没填的金额写成 0。",
  "不下达买或不买的命令，不使用「应该买」「值得买」「建议购买」「不值得」。",
  "不评价人格，不使用浪费、败家、月光、穷鬼、配不上、丢人、没出息、乱花钱、太冲动、冲动消费、别人都有、再不买就亏、你这种收入。",
  "反对角色必须在 pushback 里写出再等等或不买的理由。其他人物不要写 pushback。",
].join("");

export const SYNTHESIS_INSTRUCTION = [
  "只根据给出的事实卡、类别、理由、启用人物的设定，以及本轮已经通过校验的发言做综合。",
  "不要加入新的用户数据，不要计算，不要把被挡下的句子写回来。",
  "leaning 只能是 lean-buy、lean-wait、lean-skip、lean-adjust、unclear 之一。",
  "changeConditions 至少一条，句子里同时有「如果」和「就买」「就等」「就先不买」或「就换条件」。",
  "不要写应该买、值得买、建议购买、不值得。",
  "反对角色和其他人不同时，disagreements 必须点出分歧。",
  "如果没有可用的反对文本，必须写明反对意见这次没有可用文本，不得补写一段反对。",
].join("");

export interface CitedSpeech {
  readonly personaId: string;
  readonly name: string;
  readonly text: string;
}

export interface PersonaTurnPayload {
  readonly factCard: FactCard;
  readonly category: string;
  readonly reason: string;
  readonly instruction: string;
  readonly persona: Persona;
  readonly ownSpeech?: string;
  readonly otherSpeeches?: readonly CitedSpeech[];
}

export interface SynthesisPayload {
  readonly factCard: FactCard;
  readonly category: string;
  readonly reason: string;
  readonly instruction: string;
  readonly personas: readonly Persona[];
  readonly speeches: readonly CitedSpeech[];
  readonly pushbackAvailable: boolean;
}

export function cardForDiscussion(card: FactCard, personas: readonly Persona[]): FactCard {
  return factCardForModel({ ...card, citations: citationsWithPersonas(card, personas) });
}

export function personaTurnPayload(
  card: FactCard,
  category: string,
  reason: string,
  persona: Persona,
  enabledPersonas: readonly Persona[],
  round: 1 | 2,
  ownSpeech?: string,
  otherSpeeches?: readonly CitedSpeech[],
): PersonaTurnPayload {
  const factCard = cardForDiscussion(card, enabledPersonas);
  if (round === 1) {
    return { factCard, category, reason, instruction: PERSONA_INSTRUCTION, persona: publicPersona(persona) };
  }
  return {
    factCard,
    category,
    reason,
    instruction: PERSONA_INSTRUCTION,
    persona: publicPersona(persona),
    ownSpeech: ownSpeech ?? "",
    otherSpeeches: (otherSpeeches ?? []).map((speech) => ({
      personaId: speech.personaId,
      name: speech.name,
      text: speech.text,
    })),
  };
}

export function synthesisPayload(
  card: FactCard,
  category: string,
  reason: string,
  personas: readonly Persona[],
  speeches: readonly CitedSpeech[],
): SynthesisPayload {
  const enabled = personas.filter((persona) => persona.enabled);
  const usable = speeches.filter((speech) => speech.text.trim().length > 0);
  const pushbackIds = new Set(enabled.filter((persona) => persona.stance === "pushback").map((persona) => persona.id));
  return {
    factCard: cardForDiscussion(card, enabled),
    category,
    reason,
    instruction: SYNTHESIS_INSTRUCTION,
    personas: enabled.map(publicPersona),
    speeches: usable.map((speech) => ({ personaId: speech.personaId, name: speech.name, text: speech.text })),
    pushbackAvailable: usable.some((speech) => pushbackIds.has(speech.personaId)),
  };
}

export function previewProblems(input: {
  readonly priceReady: boolean;
  readonly category: string;
  readonly categoryPending: boolean;
  readonly reason: string;
  readonly parsedItem: string | null;
  readonly personas: readonly Persona[];
}): readonly string[] {
  const problems: string[] = [];
  if (!input.priceReady) problems.push("价格还没确认，或还不是有效金额。");
  if (categoryBlocksPreview(input.category, input.categoryPending)) problems.push("类别需要填写，且不超过 40 字；识别出的类别要先确认。");
  if (reasonBlocksPreview(input.reason, input.parsedItem)) problems.push("请写下为什么想买。只留下物品名或「想买：」加物品名还不能预览。");
  problems.push(...personaProblems(input.personas));
  return problems;
}

export function renderPreview(input: {
  readonly round: 1 | 2;
  readonly card: FactCard;
  readonly category: string;
  readonly reason: string;
  readonly personas: readonly Persona[];
  readonly providerHost: string;
  readonly validatedSpeeches?: readonly CitedSpeech[];
}): string {
  const enabled = input.personas.filter((persona) => persona.enabled);
  const speeches = input.validatedSpeeches ?? [];
  const turns = enabled.map((persona) => personaTurnPayload(
    input.card,
    input.category.trim(),
    input.reason.trim(),
    persona,
    enabled,
    input.round,
    input.round === 2 ? speeches.find((speech) => speech.personaId === persona.id)?.text ?? "" : undefined,
    input.round === 2 ? speeches.filter((speech) => speech.personaId !== persona.id) : undefined,
  ));
  const synthesis = {
    factCard: cardForDiscussion(input.card, enabled),
    category: input.category.trim(),
    reason: input.reason.trim(),
    instruction: SYNTHESIS_INSTRUCTION,
    personas: enabled.map(publicPersona),
    speeches: input.round === 2
      ? speeches.map((speech) => ({ personaId: speech.personaId, name: speech.name, text: speech.text }))
      : "本轮每位人物通过校验的发言。被挡下的句子不会进入综合。",
  };
  return [
    `服务商：${PROVIDER_NAME}`,
    `主机名：${input.providerHost}`,
    `本轮请求次数：${enabled.length + 1}（每位启用人物一次，再加一次综合）。费用由服务商收取。`,
    RETENTION_NOTICE,
    "一次确认覆盖本轮的人物请求和随后的综合。取消或关闭页面不会自动补发。",
    "每个人物请求只附带该人物自己的设定。",
    "将发送的人物请求：",
    JSON.stringify(turns, null, 2),
    "综合将收到这些部分：事实卡、类别、理由、启用人物的设定，以及本轮通过校验的发言。",
    JSON.stringify(synthesis, null, 2),
  ].join("\n\n");
}

export interface BoundDecision {
  readonly fingerprint: string;
  readonly decision: PurchaseDecisionCode | "";
  readonly rationale: string;
}

export function discussionFingerprint(parts: { readonly calendarStamp: string } & Record<string, unknown>): string {
  return JSON.stringify(parts);
}

export function visibleDecision(bound: BoundDecision, fingerprint: string): Pick<BoundDecision, "decision" | "rationale"> {
  return bound.fingerprint === fingerprint
    ? { decision: bound.decision, rationale: bound.rationale }
    : { decision: "", rationale: "" };
}

export function discussionIsComplete(input: {
  readonly synthesisShown: boolean;
  readonly serviceAvailable: boolean;
  readonly personaFailed: boolean;
  readonly synthesisFailed: boolean;
  readonly hasDecision: boolean;
}): boolean {
  if (input.synthesisShown) return true;
  return input.hasDecision && (!input.serviceAvailable || input.personaFailed || input.synthesisFailed);
}

function publicPersona(persona: Persona): Persona {
  return {
    id: persona.id,
    name: persona.name,
    relationship: persona.relationship,
    personality: persona.personality,
    caresAbout: persona.caresAbout,
    moneyAttitude: persona.moneyAttitude,
    stance: persona.stance,
    enabled: persona.enabled,
  };
}
