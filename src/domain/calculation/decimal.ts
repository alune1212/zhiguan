import { currencyInfo, DEFAULT_CURRENCY_TABLE } from "./currency.js";
import { normalizeRational, rationalFromDecimalParts } from "./rational.js";
import type {
  CurrencyTable,
  Money,
  ParseResult,
  Rational,
} from "./types.js";

export const MAX_RAW_UTF16_CODE_UNITS = 64;
export const MAX_AMOUNT_TOKEN_LENGTH = 32;
export const MAX_WORK_HOURS_TOKEN_LENGTH = 16;
export const MAX_AMOUNT_INTEGER_DIGITS = 15;
export const MAX_WORK_HOURS_INTEGER_DIGITS = 6;
export const MAX_WORK_HOURS_FRACTION_DIGITS = 3;

export interface ParsedDecimalToken {
  readonly integerPart: string;
  readonly fractionPart: string;
  readonly negative: boolean;
  readonly token: string;
}

export function parseDecimalToken(
  raw: unknown,
  tokenLimit: number,
): ParseResult<ParsedDecimalToken> {
  if (typeof raw !== "string") {
    return { ok: false, reasonCode: "invalid-decimal" };
  }
  if (raw.length > MAX_RAW_UTF16_CODE_UNITS) {
    return { ok: false, reasonCode: "numeric-limit-exceeded" };
  }
  const token = raw.trim();
  if (token.startsWith("-")) {
    return { ok: false, reasonCode: "negative-not-allowed" };
  }
  if (token.startsWith("+")) {
    return { ok: false, reasonCode: "invalid-decimal" };
  }
  if (token.length === 0) {
    return { ok: false, reasonCode: "invalid-decimal" };
  }
  if (token.length > tokenLimit) {
    return { ok: false, reasonCode: "numeric-limit-exceeded" };
  }
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(token)) {
    return { ok: false, reasonCode: "invalid-decimal" };
  }
  const dot = token.indexOf(".");
  return {
    ok: true,
    value: {
      integerPart: dot < 0 ? token : token.slice(0, dot),
      fractionPart: dot < 0 ? "" : token.slice(dot + 1),
      negative: false,
      token,
    },
  };
}

export function parseMoney(
  raw: unknown,
  currencyCode: string,
  table: CurrencyTable = DEFAULT_CURRENCY_TABLE,
): ParseResult<Money> {
  const parsed = parseDecimalToken(raw, MAX_AMOUNT_TOKEN_LENGTH);
  if (!parsed.ok) return parsed;
  const currency = currencyInfo(currencyCode, table);
  if (!currency.ok) return currency;
  if (parsed.value.integerPart.length > MAX_AMOUNT_INTEGER_DIGITS) {
    return { ok: false, reasonCode: "numeric-limit-exceeded" };
  }
  if (parsed.value.fractionPart.length > currency.value.minorUnit) {
    return {
      ok: false,
      reasonCode: "fraction-exceeds-currency-minor-unit",
    };
  }
  const paddedFraction = parsed.value.fractionPart.padEnd(
    currency.value.minorUnit,
    "0",
  );
  const unscaled = `${parsed.value.integerPart}${paddedFraction}`;
  const minorUnits = BigInt(unscaled);
  if (minorUnits === 0n) {
    return { ok: false, reasonCode: "zero-not-allowed" };
  }
  return {
    ok: true,
    value: {
      currencyCode: currency.value.code,
      minorUnit: currency.value.minorUnit,
      minorUnits,
    },
  };
}

export function parseWorkHours(raw: unknown): ParseResult<Rational> {
  const parsed = parseDecimalToken(raw, MAX_WORK_HOURS_TOKEN_LENGTH);
  if (!parsed.ok) return parsed;
  if (
    parsed.value.integerPart.length > MAX_WORK_HOURS_INTEGER_DIGITS ||
    parsed.value.fractionPart.length > MAX_WORK_HOURS_FRACTION_DIGITS
  ) {
    return { ok: false, reasonCode: "numeric-limit-exceeded" };
  }
  const rational = rationalFromDecimalParts(
    parsed.value.integerPart,
    parsed.value.fractionPart,
  );
  if (!rational.ok) return rational;
  if (rational.value.numerator === 0n) {
    return { ok: false, reasonCode: "zero-not-allowed" };
  }
  return rational;
}

export function parseDerivedRational(
  numerator: bigint,
  denominator: bigint,
): ParseResult<Rational> {
  return normalizeRational(numerator, denominator);
}

export function moneyFromMinorUnits(
  minorUnits: bigint,
  currencyCode: string,
  minorUnit: 0 | 2 | 3 | 4,
  table: CurrencyTable = DEFAULT_CURRENCY_TABLE,
): ParseResult<Money> {
  const currency = currencyInfo(currencyCode, table);
  if (!currency.ok || currency.value.minorUnit !== minorUnit) {
    return { ok: false, reasonCode: "unsupported-currency" };
  }
  if (minorUnits <= 0n) {
    return {
      ok: false,
      reasonCode: minorUnits === 0n ? "zero-not-allowed" : "negative-not-allowed",
    };
  }
  if (currencyCode.length !== 3 || !/^[A-Z]{3}$/.test(currencyCode)) {
    return { ok: false, reasonCode: "unsupported-currency" };
  }
  return {
    ok: true,
    value: { currencyCode, minorUnit, minorUnits },
  };
}

export const parseAmount = parseMoney;
export const parseHours = parseWorkHours;
