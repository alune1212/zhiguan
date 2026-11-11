export const LEANING_CODES = ["lean-buy", "lean-wait", "lean-skip", "lean-adjust", "unclear"] as const;
export type LeaningCode = (typeof LEANING_CODES)[number];

export const LEANING_WORDING: Readonly<Record<LeaningCode, string>> = {
  "lean-buy": "更倾向现在买",
  "lean-wait": "更倾向再等等",
  "lean-skip": "更倾向这次先不买",
  "lean-adjust": "更倾向先换个条件",
  unclear: "这轮没有形成倾向",
};

const CHANGE_TAILS = ["就买", "就等", "就先不买", "就换条件"] as const;
const MAX_ITEMS = 8;
const MAX_TEXT = 400;

export interface PersonaModelOutput {
  readonly personaId: string;
  readonly points: readonly string[];
  readonly pushback: string | null;
}

export interface SynthesisModelOutput {
  readonly leaning: LeaningCode;
  readonly reasons: readonly string[];
  readonly risks: readonly string[];
  readonly changeConditions: readonly string[];
  readonly disagreements: readonly string[];
}

export function leaningWording(code: string): string | null {
  return isLeaningCode(code) ? LEANING_WORDING[code] : null;
}

export function isChangeCondition(text: string): boolean {
  return text.includes("如果") && CHANGE_TAILS.some((tail) => text.includes(tail));
}

export function parsePersonaOutput(value: unknown, expectedPersonaId: string): PersonaModelOutput | null {
  if (!isRecord(value)) return null;
  if (value.personaId !== expectedPersonaId) return null;
  const points = stringList(value.points);
  if (!points) return null;
  if (value.pushback === undefined || value.pushback === null) return { personaId: expectedPersonaId, points, pushback: null };
  if (typeof value.pushback !== "string" || value.pushback.trim().length === 0 || [...value.pushback].length > MAX_TEXT) return null;
  return { personaId: expectedPersonaId, points, pushback: value.pushback.trim() };
}

export function parseSynthesisOutput(value: unknown): SynthesisModelOutput | null {
  if (!isRecord(value) || !isLeaningCode(value.leaning)) return null;
  const reasons = stringList(value.reasons);
  const risks = stringList(value.risks);
  const changeConditions = stringList(value.changeConditions);
  const disagreements = stringList(value.disagreements);
  if (!reasons || !risks || !changeConditions || !disagreements || changeConditions.length === 0) return null;
  return { leaning: value.leaning, reasons, risks, changeConditions, disagreements };
}

function isLeaningCode(value: unknown): value is LeaningCode {
  return typeof value === "string" && (LEANING_CODES as readonly string[]).includes(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0 || [...item].length > MAX_TEXT) return null;
    items.push(item.trim());
  }
  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
