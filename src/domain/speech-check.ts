/**
 * 阿拉伯数字一律与引用白名单做精确匹配。
 * 中文数字只在紧挨着单位（元、块、小时、天、次、%）时校验。
 * 「5 年后的你」里的 5 因此必须事先放进白名单，否则会被当成未授权数字。
 */

const PRESSURE_PHRASES = [
  "浪费",
  "败家",
  "月光",
  "穷鬼",
  "配不上",
  "丢人",
  "没出息",
  "乱花钱",
  "太冲动",
  "冲动消费",
  "别人都有",
  "再不买就亏",
  "你这种收入",
] as const;

const VERDICT_PHRASES = ["应该买", "应该不买", "不该买", "值得买", "建议购买", "建议买", "不值得", "别买", "不要买", "必须买", "赶紧买"] as const;

const ARABIC_NUMBER = /[¥￥]?-?\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?|[¥￥]?-?\d+(?:\.\d+)?/gu;
const CHINESE_NUMBER = /[零〇一二两三四五六七八九十百千万亿]+(?=\s*(?:元|块|小时|天|次|%))/gu;

const DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const SMALL_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };

export interface SpeechSentence {
  readonly text: string;
  readonly numberMismatch: boolean;
  readonly pressure: boolean;
  readonly verdict: boolean;
}

export function normalizeNumericLiteral(raw: string): string {
  return raw.normalize("NFKC").replace(/[¥￥]/gu, "").replace(/[,，]/gu, "");
}

export function parseChineseInteger(raw: string): string | null {
  if (!raw || raw.includes("亿")) return null;
  let result = 0;
  let section = 0;
  let number = 0;
  let seenNumber = false;
  let previousNonZeroDigit = false;
  for (const character of raw) {
    if (Object.hasOwn(DIGITS, character)) {
      const nonZero = character !== "零" && character !== "〇";
      if (previousNonZeroDigit && nonZero) return null;
      previousNonZeroDigit = nonZero;
      number = DIGITS[character] ?? 0;
      seenNumber = true;
      continue;
    }
    previousNonZeroDigit = false;
    if (Object.hasOwn(SMALL_UNITS, character)) {
      section += (seenNumber ? number : 1) * (SMALL_UNITS[character] ?? 1);
      number = 0;
      seenNumber = false;
      continue;
    }
    if (character === "万") {
      section += number;
      result += (section === 0 ? 1 : section) * 10000;
      section = 0;
      number = 0;
      seenNumber = false;
      continue;
    }
    return null;
  }
  const total = result + section + number;
  if (!Number.isSafeInteger(total)) return null;
  return String(total);
}

function hasVerdict(text: string): boolean {
  const masked = text.replaceAll("值不值得", "");
  return VERDICT_PHRASES.some((phrase) => masked.includes(phrase));
}

export function splitSentences(text: string): string[] {
  return text.split(/[。！？!?；;\n]+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

export function checkSentence(text: string, citations: readonly string[]): SpeechSentence {
  const normalized = text.normalize("NFKC");
  const allowed = new Set(citations);
  let numberMismatch = false;
  for (const match of normalized.matchAll(ARABIC_NUMBER)) {
    const literal = match[0];
    if (!literal || !allowed.has(normalizeNumericLiteral(literal))) numberMismatch = true;
  }
  for (const match of normalized.matchAll(CHINESE_NUMBER)) {
    const parsed = match[0] ? parseChineseInteger(match[0]) : null;
    if (parsed === null || !allowed.has(parsed)) numberMismatch = true;
  }
  return {
    text,
    numberMismatch,
    pressure: PRESSURE_PHRASES.some((phrase) => text.includes(phrase)),
    verdict: hasVerdict(text),
  };
}

export function checkSpeech(text: string, citations: readonly string[]): SpeechSentence[] {
  return splitSentences(text).map((sentence) => checkSentence(sentence, citations));
}

export function isUsableSentence(sentence: SpeechSentence): boolean {
  return !sentence.numberMismatch && !sentence.pressure && !sentence.verdict;
}

export function usableText(sentences: readonly SpeechSentence[]): string {
  return sentences.filter(isUsableSentence).map((sentence) => sentence.text).join("。");
}

export function sentenceNote(sentence: SpeechSentence): string | null {
  const notes: string[] = [];
  if (sentence.numberMismatch) notes.push("这句里的数字对不上事实卡，不参与后续讨论");
  if (sentence.pressure) notes.push("这句可能在施压");
  if (sentence.verdict) notes.push("这句在替你做决定，不参与后续讨论");
  return notes.length > 0 ? notes.join("。") : null;
}
