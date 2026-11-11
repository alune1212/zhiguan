import {
  calculateDecision,
  exactValueFromRatio,
  formatRational,
  parseAmount,
  parseWorkHours,
  rational,
  type ExactValue,
  type EvidenceStatus,
} from "./calculation";
import { calculateIncome, validateProfile, type IncomeProfile } from "./income";
import { PURCHASE_RULESET_VERSION } from "./purchase-snapshot";
import type { Persona } from "./personas";

export const FACT_CARD_FORMAT = "zhiguan-purchase-fact-card@1" as const;

export type FactEvidence = EvidenceStatus | "forecast" | "insufficient-data";

export interface FactField {
  readonly display: string | null;
  readonly unit: string;
  readonly evidence: FactEvidence;
  readonly formula: string;
  readonly exact: ExactValue | null;
  readonly reason: string | null;
}

export interface FactCard {
  readonly format: typeof FACT_CARD_FORMAT;
  readonly currency: "CNY";
  readonly ruleset: typeof PURCHASE_RULESET_VERSION;
  readonly comparisonMonth: string | null;
  readonly timeZone: string;
  readonly monthlyIncome: FactField;
  readonly hourlyIncome: FactField;
  readonly workdayIncome: FactField;
  readonly workTimeEquivalent: FactField;
  readonly availableMargin: FactField;
  readonly purchaseAfterMargin: FactField;
  readonly perUseCost: FactField;
  readonly holdingDailyCost: FactField;
  readonly emergencyFund?: FactField;
  readonly otherSavings?: FactField;
  readonly purchasePrice: FactField;
  readonly frequencyCount?: FactField;
  readonly holdingDays?: FactField;
  readonly citations: readonly string[];
}

export interface OptionalAmount {
  readonly amount: string;
  readonly evidence: EvidenceStatus;
}

export interface FactCardRequest {
  readonly profile: IncomeProfile;
  readonly now: Date;
  readonly price: string;
  readonly priceEvidence: EvidenceStatus;
  readonly frequency: { readonly period: "day" | "week"; readonly count: string; readonly evidence: EvidenceStatus } | null;
  readonly holdingDays: { readonly days: string; readonly evidence: EvidenceStatus } | null;
  readonly fixedExpenses: (OptionalAmount & { readonly complete: boolean }) | null;
  readonly emergencyFund: OptionalAmount | null;
  readonly otherSavings: OptionalAmount | null;
}

export type FactCardResult =
  | { readonly ok: true; readonly card: FactCard }
  | { readonly ok: false; readonly reason: "invalid-profile" | "invalid-price" };

const MISSING_HOLDING = "持有天数还没确认。未确认的类别参考天数不参与计算，也不进入事实卡。";
const MISSING_MARGIN = "没有提供已完整覆盖的本月固定支出，余量算不出来。没有把缺的支出当成 0。";

export function moneyDisplayFromCents(cents: bigint): string {
  const decimal = formatRational(rational(cents, 100n), 2);
  return decimal.endsWith(".00") ? decimal.slice(0, -3) : decimal;
}

export function countDisplay(raw: string): string | null {
  const parsed = parseWorkHours(raw.trim());
  if (!parsed.ok) return null;
  const decimal = formatRational(parsed.value, 3);
  return decimal.replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

export function buildFactCard(request: FactCardRequest): FactCardResult {
  const profileCheck = validateProfile(request.profile);
  if (!profileCheck.ok) return { ok: false, reason: "invalid-profile" };
  const parsedPrice = parseAmount(request.price, false);
  if (!parsedPrice.ok) return { ok: false, reason: "invalid-price" };

  const income = calculateIncome(profileCheck.value, request.now);
  const parsedIncome = parseAmount(profileCheck.value.income, false);
  const monthly = parsedIncome.ok
    ? moneyField(parsedIncome.value.cents, "元", "user-confirmed", "已保存资料里的到手月收入", null)
    : missingField("元", "已保存资料里的到手月收入", "到手月收入无法读取。");

  const decision = calculateDecision({
    income: profileCheck.value.income,
    workHours: "",
    workTime: income.workTimeInput ?? { mode: "unselected" },
    fixedExpenses: request.fixedExpenses?.amount ?? "",
    purchaseAmount: request.price.trim(),
    taxBasis: "after-tax",
    fixedCostCoverage: request.fixedExpenses?.complete ? "complete" : "",
    purchaseIncluded: request.fixedExpenses?.complete ? "included" : "",
    valueExpectation: "",
    evidence: {
      income: "user-confirmed",
      workHours: "estimated",
      fixedExpenses: request.fixedExpenses?.evidence ?? "",
      purchaseAmount: request.priceEvidence,
    },
  });
  const hourlyResult = decision.results.find((item) => item.id === "income-rate");
  const workResult = decision.results.find((item) => item.id === "work-time-equivalent");
  const marginResult = decision.results.find((item) => item.id === "available-margin");
  const afterResult = decision.results.find((item) => item.id === "purchase-after-margin");

  const hourly = fromDecision(hourlyResult, "元/小时", "月收入 ÷ 当月计划工作小时", "月工时无法从已保存的作息算出。");
  const workTime = fromDecision(workResult, "小时", "购买金额 ÷ 每小时收入", "工时等价算不出来。");
  const workdayCount = income.plannedWorkDayCount === null ? null : BigInt(income.plannedWorkDayCount);
  const workday = parsedIncome.ok && workdayCount !== null && workdayCount > 0n
    ? moneyField(
      parsedIncome.value.cents,
      "元",
      "estimated",
      "月收入 ÷ 当月计划工作日数",
      null,
      workdayCount,
    )
    : missingField("元", "月收入 ÷ 当月计划工作日数", workdayCount === 0n ? "当月计划工作日数为 0。" : "当月计划工作日算不出来。");

  const marginReady = Boolean(request.fixedExpenses?.complete) && marginResult?.availability === "available" && marginResult.exact;
  const availableMargin = marginReady && marginResult?.exact
    ? fieldFromExact(marginResult.exact, "元", marginResult.evidenceStatus, "税后月收入 − 月固定支出", null)
    : missingField("元", "税后月收入 − 月固定支出", MISSING_MARGIN);
  const afterReady = Boolean(request.fixedExpenses?.complete) && afterResult?.availability === "available" && afterResult.exact;
  const purchaseAfterMargin = afterReady && afterResult?.exact
    ? fieldFromExact(afterResult.exact, "元", "forecast", "税后月收入 − 月固定支出 − 购买金额", null)
    : missingField("元", "税后月收入 − 月固定支出 − 购买金额", MISSING_MARGIN);

  const priceField = moneyField(parsedPrice.value.cents, "元", request.priceEvidence, "本页填写的购买价格", null);
  const frequency = frequencyField(request.frequency);
  const holding = holdingField(request.holdingDays);
  const holdingDailyCost = holding && holding.display && holding.exact
    ? dailyCost(parsedPrice.value.cents, BigInt(holding.display))
    : missingField("元/天", "购买价格 ÷ 已确认的预计持有天数", MISSING_HOLDING);
  const perUseCost = frequency?.display && holding?.display && frequency.exact && request.frequency
    ? perUse(parsedPrice.value.cents, BigInt(holding.display), request.frequency.period, frequency.exact)
    : missingField("元/次", "购买价格 ÷ 持有期内的预计使用次数", frequency?.display ? MISSING_HOLDING : "没有填写可用的使用次数，或持有天数还没确认。");

  const emergency = optionalMoney(request.emergencyFund, "本页填写的应急金，不与其他存款合并");
  const savings = optionalMoney(request.otherSavings, "本页填写的其他存款，不与应急金合并");
  const citations: string[] = [];
  for (const item of [monthly, hourly, workday, workTime, availableMargin, purchaseAfterMargin, perUseCost, holdingDailyCost, emergency, savings, priceField, frequency, holding]) {
    if (item && item !== "omit" && item.display) addCitation(citations, item.display);
  }

  return {
    ok: true,
    card: {
      format: FACT_CARD_FORMAT,
      currency: "CNY",
      ruleset: PURCHASE_RULESET_VERSION,
      comparisonMonth: income.comparisonMonth,
      timeZone: profileCheck.value.timeZone,
      monthlyIncome: monthly,
      hourlyIncome: hourly,
      workdayIncome: workday,
      workTimeEquivalent: workTime,
      availableMargin,
      purchaseAfterMargin,
      perUseCost,
      holdingDailyCost,
      ...(emergency === "omit" ? {} : { emergencyFund: emergency }),
      ...(savings === "omit" ? {} : { otherSavings: savings }),
      purchasePrice: priceField,
      ...(frequency ? { frequencyCount: frequency } : {}),
      ...(holding ? { holdingDays: holding } : {}),
      citations,
    },
  };
}

export function factCardForModel(card: FactCard): FactCard {
  return {
    format: card.format,
    currency: card.currency,
    ruleset: card.ruleset,
    comparisonMonth: card.comparisonMonth,
    timeZone: card.timeZone,
    monthlyIncome: publicField(card.monthlyIncome),
    hourlyIncome: publicField(card.hourlyIncome),
    workdayIncome: publicField(card.workdayIncome),
    workTimeEquivalent: publicField(card.workTimeEquivalent),
    availableMargin: publicField(card.availableMargin),
    purchaseAfterMargin: publicField(card.purchaseAfterMargin),
    perUseCost: publicField(card.perUseCost),
    holdingDailyCost: publicField(card.holdingDailyCost),
    ...(card.emergencyFund ? { emergencyFund: publicField(card.emergencyFund) } : {}),
    ...(card.otherSavings ? { otherSavings: publicField(card.otherSavings) } : {}),
    purchasePrice: publicField(card.purchasePrice),
    ...(card.frequencyCount ? { frequencyCount: publicField(card.frequencyCount) } : {}),
    ...(card.holdingDays ? { holdingDays: publicField(card.holdingDays) } : {}),
    citations: [...card.citations],
  };
}

function publicField(field: FactField): FactField {
  return {
    display: field.display,
    unit: field.unit,
    evidence: field.evidence,
    formula: field.formula,
    exact: field.exact === null ? null : {
      numerator: field.exact.numerator,
      denominator: field.exact.denominator,
      decimal: field.exact.decimal,
    },
    reason: field.reason,
  };
}

export function citationsWithPersonas(card: FactCard, personas: readonly Persona[]): string[] {
  const citations = [...card.citations];
  for (const persona of personas) {
    if (!persona.enabled) continue;
    for (const match of persona.name.matchAll(/\d+(?:\.\d+)?/gu)) {
      const digits = match[0];
      if (digits) addCitation(citations, digits);
    }
  }
  return citations;
}

function displayYuan(exact: ExactValue): string {
  return exact.decimal.endsWith(".00") ? exact.decimal.slice(0, -3) : exact.decimal;
}

function moneyField(
  cents: bigint,
  unit: string,
  evidence: FactEvidence,
  formula: string,
  reason: string | null,
  divisor = 1n,
): FactField {
  const exact = exactValueFromRatio(cents, 100n * divisor);
  return { display: displayYuan(exact), unit, evidence, formula, exact, reason };
}

function fieldFromExact(exact: ExactValue, unit: string, evidence: FactEvidence, formula: string, reason: string | null): FactField {
  const display = unit === "小时" || unit === "元/小时" ? exact.decimal : displayYuan(exact);
  return { display, unit, evidence, formula, exact, reason };
}

function fromDecision(
  result: { readonly availability: string; readonly evidenceStatus: FactEvidence; readonly exact: ExactValue | null; readonly display: string | null } | undefined,
  unit: string,
  formula: string,
  reason: string,
): FactField {
  if (!result || result.availability !== "available" || !result.exact) return missingField(unit, formula, reason);
  return fieldFromExact(result.exact, unit, result.evidenceStatus, formula, null);
}

function missingField(unit: string, formula: string, reason: string): FactField {
  return { display: null, unit, evidence: "insufficient-data", formula, exact: null, reason };
}

function frequencyField(frequency: FactCardRequest["frequency"]): FactField | null {
  if (!frequency) return null;
  const display = countDisplay(frequency.count);
  if (!display) return missingField("次", "本页填写的使用次数", "使用次数无法读取，没有按 0 计算。");
  const parsed = parseWorkHours(frequency.count.trim());
  if (!parsed.ok) return missingField("次", "本页填写的使用次数", "使用次数无法读取，没有按 0 计算。");
  return {
    display,
    unit: frequency.period === "day" ? "次/天" : "次/周",
    evidence: frequency.evidence,
    formula: "本页填写的使用次数",
    exact: exactValueFromRatio(parsed.value.numerator, parsed.value.denominator),
    reason: null,
  };
}

function holdingField(holding: FactCardRequest["holdingDays"]): FactField | null {
  if (!holding) return null;
  if (!/^[1-9]\d{0,4}$/u.test(holding.days.trim())) {
    return missingField("天", "用户确认后的预计持有天数", "持有天数无法读取，没有使用未确认的建议。");
  }
  const days = BigInt(holding.days.trim());
  if (days > 36600n) return missingField("天", "用户确认后的预计持有天数", "持有天数超出可填写范围。");
  return {
    display: days.toString(),
    unit: "天",
    evidence: holding.evidence,
    formula: "用户确认后的预计持有天数",
    exact: exactValueFromRatio(days, 1n),
    reason: null,
  };
}

function dailyCost(priceCents: bigint, days: bigint): FactField {
  const exact = exactValueFromRatio(priceCents, 100n * days);
  return {
    display: displayYuan(exact),
    unit: "元/天",
    evidence: "estimated",
    formula: "购买价格 ÷ 已确认的预计持有天数",
    exact,
    reason: null,
  };
}

function perUse(priceCents: bigint, days: bigint, period: "day" | "week", frequencyExact: ExactValue): FactField {
  const countNumerator = BigInt(frequencyExact.numerator);
  const countDenominator = BigInt(frequencyExact.denominator);
  const usesDenominator = period === "day" ? countDenominator : countDenominator * 7n;
  const exact = exactValueFromRatio(priceCents * usesDenominator, 100n * days * countNumerator);
  return {
    display: displayYuan(exact),
    unit: "元/次",
    evidence: "estimated",
    formula: period === "day"
      ? "购买价格 ÷（已确认持有天数 × 每天次数）"
      : "购买价格 ÷（已确认持有天数 × 每周次数 ÷ 7）",
    exact,
    reason: null,
  };
}

function optionalMoney(input: OptionalAmount | null, formula: string): FactField | "omit" {
  if (!input || input.amount.trim() === "") return "omit";
  const parsed = parseAmount(input.amount, true);
  if (!parsed.ok) return missingField("元", formula, "这个金额无法读取，没有按 0 计算。");
  return moneyField(parsed.value.cents, "元", input.evidence, formula, null);
}

function addCitation(citations: string[], display: string): void {
  if (!citations.includes(display)) citations.push(display);
}

const FACT_EVIDENCE = ["user-confirmed", "estimated", "forecast", "insufficient-data"] as const;
const REQUIRED_FACT_FIELDS = [
  "monthlyIncome",
  "hourlyIncome",
  "workdayIncome",
  "workTimeEquivalent",
  "availableMargin",
  "purchaseAfterMargin",
  "perUseCost",
  "holdingDailyCost",
  "purchasePrice",
] as const;
const OPTIONAL_FACT_FIELDS = ["emergencyFund", "otherSavings", "frequencyCount", "holdingDays"] as const;
const FORBIDDEN_FACT_KEYS = ["perSecondIncome", "todayIncome", "todayElapsed", "perSecond", "holdingSuggestion", "suggestion"] as const;

export function isFactCard(value: unknown): value is FactCard {
  if (!isRecord(value) || value.format !== FACT_CARD_FORMAT || value.currency !== "CNY" || value.ruleset !== PURCHASE_RULESET_VERSION) return false;
  if (FORBIDDEN_FACT_KEYS.some((key) => Object.hasOwn(value, key))) return false;
  if (!Array.isArray(value.citations) || value.citations.length > 64 || value.citations.some((item) => typeof item !== "string" || item.length > 64)) return false;
  if (typeof value.timeZone !== "string" || (value.comparisonMonth !== null && typeof value.comparisonMonth !== "string")) return false;
  for (const key of REQUIRED_FACT_FIELDS) {
    if (!isFactField(value[key])) return false;
  }
  for (const key of OPTIONAL_FACT_FIELDS) {
    if (Object.hasOwn(value, key) && !isFactField(value[key])) return false;
  }
  return true;
}

function isFactField(value: unknown): value is FactField {
  if (!isRecord(value)) return false;
  if (!(value.display === null || typeof value.display === "string")) return false;
  if (typeof value.unit !== "string" || typeof value.formula !== "string") return false;
  if (typeof value.evidence !== "string" || !(FACT_EVIDENCE as readonly string[]).includes(value.evidence)) return false;
  if (!(value.reason === null || typeof value.reason === "string")) return false;
  if (value.exact === null) return value.display === null;
  return isRecord(value.exact)
    && typeof value.exact.numerator === "string"
    && typeof value.exact.denominator === "string"
    && typeof value.exact.decimal === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
