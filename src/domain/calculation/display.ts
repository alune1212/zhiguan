import {
  rationalToDecimal,
  rationalToExactEnvelope,
  roundHalfAwayFromZero,
  tenPower,
} from "./rational.js";
import type {
  DisplayValue,
  ExactValue,
  Money,
  Rational,
} from "./types.js";

export const ROUNDING_MODE = "half-away-from-zero" as const;

function formatMinorUnits(minorUnits: bigint, minorUnit: number): string {
  const negative = minorUnits < 0n;
  const absoluteValue = (negative ? -minorUnits : minorUnits).toString();
  if (minorUnit === 0) return `${negative ? "-" : ""}${absoluteValue}`;
  const padded = absoluteValue.padStart(minorUnit + 1, "0");
  const split = padded.length - minorUnit;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function canonicalMoneyDecimal(minorUnits: bigint, minorUnit: number): string {
  const formatted = formatMinorUnits(minorUnits, minorUnit);
  if (!formatted.includes(".")) return formatted;
  return formatted.replace(/0+$/, "").replace(/\.$/, "");
}

function exactMoney(
  minorUnits: bigint,
  currencyCode: string,
  minorUnit: 0 | 2 | 3 | 4,
): ExactValue {
  return {
    decimal: canonicalMoneyDecimal(minorUnits, minorUnit),
    minorUnits: minorUnits.toString(),
    currencyCode,
    unit: currencyCode,
  };
}

export function exactMoneyValue(
  money: Money,
  unit = money.currencyCode,
): ExactValue {
  return {
    decimal: canonicalMoneyDecimal(money.minorUnits, money.minorUnit),
    minorUnits: money.minorUnits.toString(),
    currencyCode: money.currencyCode,
    unit,
  };
}

export function moneyDisplay(
  minorUnits: bigint,
  currencyCode: string,
  minorUnit: 0 | 2 | 3 | 4,
  includeBelowZero = false,
): DisplayValue {
  const decimal = formatMinorUnits(minorUnits, minorUnit);
  const text = `${decimal} ${currencyCode}${
    includeBelowZero && minorUnits < 0n ? "（低于零）" : ""
  }`;
  return {
    text,
    decimal,
    displayDigits: minorUnit,
    relation: "exact",
    roundingMode: ROUNDING_MODE,
    rounded: false,
  };
}

export function rateDisplayDigits(minorUnit: 0 | 2 | 3 | 4): number {
  return minorUnit > 2 ? (minorUnit > 4 ? 4 : minorUnit) : 2;
}

export function rationalDisplay(
  value: Rational,
  displayDigits: number,
  unit: string,
  options: {
    readonly tinyPositiveText?: string;
    readonly currencyCode?: string | null;
  } = {},
): DisplayValue {
  const rounded = roundHalfAwayFromZero(value, displayDigits);
  const tinyPositive =
    options.tinyPositiveText !== undefined &&
    value.numerator > 0n &&
    rounded.scaledInteger === 0n;
  const decimal = rounded.decimal;
  const textDecimal = tinyPositive ? options.tinyPositiveText ?? decimal : decimal;
  return {
    text: `${textDecimal} ${unit}`,
    decimal,
    displayDigits,
    relation: tinyPositive ? "less-than" : rounded.rounded ? "rounded" : "exact",
    roundingMode: ROUNDING_MODE,
    rounded: rounded.rounded || tinyPositive,
  };
}

export function rateDisplay(
  value: Rational,
  currencyCode: string,
  minorUnit: 0 | 2 | 3 | 4,
): DisplayValue {
  return rationalDisplay(value, rateDisplayDigits(minorUnit), `${currencyCode}/小时`);
}

export function workTimeDisplay(value: Rational): DisplayValue {
  return rationalDisplay(value, 2, "小时", { tinyPositiveText: "<0.01" });
}

export function rationalExactValue(
  value: Rational,
  currencyCode: string | null,
  unit: string,
): ExactValue {
  return rationalToExactEnvelope(value, currencyCode, unit);
}

export function moneyExactValue(
  minorUnits: bigint,
  currencyCode: string,
  minorUnit: 0 | 2 | 3 | 4,
): ExactValue {
  return exactMoney(minorUnits, currencyCode, minorUnit);
}

export function moneyToMajorRational(
  minorUnits: bigint,
  minorUnit: 0 | 2 | 3 | 4,
): Rational {
  const denominator = tenPower(minorUnit);
  return { numerator: minorUnits, denominator };
}

export function decimalForRational(value: Rational): string {
  return rationalToDecimal(value);
}
