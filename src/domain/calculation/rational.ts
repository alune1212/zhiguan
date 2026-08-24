import type {
  ParseResult,
  Rational,
  ResultExactRational,
} from "./types.js";

export const MAX_RATIONAL_DIGITS = 128;

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function decimalDigits(value: bigint): number {
  return absolute(value).toString().length;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

function exceedsLimit(value: bigint): boolean {
  return decimalDigits(value) > MAX_RATIONAL_DIGITS;
}

export function tenPower(digits: number): bigint {
  if (digits < 0 || digits % 1 !== 0) {
    throw new Error("invalid decimal scale");
  }
  let result = 1n;
  for (let index = 0; index < digits; index += 1) result *= 10n;
  return result;
}

export function normalizeRational(
  numerator: bigint,
  denominator: bigint,
): ParseResult<Rational> {
  if (denominator === 0n) return { ok: false, reasonCode: "division-by-zero" };
  let normalizedNumerator = numerator;
  let normalizedDenominator = denominator;
  if (normalizedDenominator < 0n) {
    normalizedNumerator = -normalizedNumerator;
    normalizedDenominator = -normalizedDenominator;
  }
  if (normalizedNumerator === 0n) {
    return { ok: true, value: { numerator: 0n, denominator: 1n } };
  }
  const divisor = gcd(normalizedNumerator, normalizedDenominator);
  normalizedNumerator /= divisor;
  normalizedDenominator /= divisor;
  if (
    exceedsLimit(normalizedNumerator) ||
    exceedsLimit(normalizedDenominator)
  ) {
    return { ok: false, reasonCode: "numeric-limit-exceeded" };
  }
  return {
    ok: true,
    value: {
      numerator: normalizedNumerator,
      denominator: normalizedDenominator,
    },
  };
}

export function rationalFromInteger(value: bigint): ParseResult<Rational> {
  return normalizeRational(value, 1n);
}

export function rationalFromDecimalParts(
  integerPart: string,
  fractionPart: string,
  negative = false,
): ParseResult<Rational> {
  if (!/^[0-9]+$/.test(integerPart) || !/^[0-9]*$/.test(fractionPart)) {
    return { ok: false, reasonCode: "invalid-decimal" };
  }
  const scale = fractionPart.length;
  const denominator = tenPower(scale);
  const unscaled = `${integerPart}${fractionPart}`;
  const numerator = BigInt(unscaled === "" ? "0" : unscaled);
  return normalizeRational(negative ? -numerator : numerator, denominator);
}

export function addRationals(
  left: Rational,
  right: Rational,
): ParseResult<Rational> {
  return normalizeRational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function subtractRationals(
  left: Rational,
  right: Rational,
): ParseResult<Rational> {
  return normalizeRational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function multiplyRationals(
  left: Rational,
  right: Rational,
): ParseResult<Rational> {
  return normalizeRational(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

export function divideRationals(
  left: Rational,
  right: Rational,
): ParseResult<Rational> {
  return normalizeRational(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}

export function negateRational(value: Rational): Rational {
  return { numerator: -value.numerator, denominator: value.denominator };
}

function formatScaledInteger(value: bigint, digits: number): string {
  const negative = value < 0n;
  const absoluteValue = absolute(value).toString();
  if (digits === 0) return `${negative ? "-" : ""}${absoluteValue}`;
  const padded = absoluteValue.padStart(digits + 1, "0");
  const split = padded.length - digits;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function finiteDecimalScale(denominator: bigint): number | null {
  let remainder = denominator;
  let twos = 0;
  let fives = 0;
  while (remainder % 2n === 0n) {
    remainder /= 2n;
    twos += 1;
  }
  while (remainder % 5n === 0n) {
    remainder /= 5n;
    fives += 1;
  }
  return remainder === 1n ? (twos > fives ? twos : fives) : null;
}

export function rationalToDecimal(value: Rational): string {
  const scale = finiteDecimalScale(value.denominator);
  if (scale === null) {
    return `${value.numerator.toString()}/${value.denominator.toString()}`;
  }
  const scaled = value.numerator * tenPower(scale);
  const quotient = scaled / value.denominator;
  return formatScaledInteger(quotient, scale).replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1");
}

export interface RoundedRational {
  readonly scaledInteger: bigint;
  readonly decimal: string;
  readonly rounded: boolean;
  readonly exactWasNonZero: boolean;
}

export function roundHalfAwayFromZero(
  value: Rational,
  displayDigits: number,
): RoundedRational {
  const factor = tenPower(displayDigits);
  const scaledNumerator = value.numerator * factor;
  const quotient = scaledNumerator / value.denominator;
  const remainder = scaledNumerator % value.denominator;
  const shouldIncrease = absolute(remainder) * 2n >= value.denominator;
  const roundedInteger =
    shouldIncrease && remainder !== 0n
      ? quotient + (scaledNumerator < 0n ? -1n : 1n)
      : quotient;
  return {
    scaledInteger: roundedInteger,
    decimal: formatScaledInteger(roundedInteger, displayDigits),
    rounded: roundedInteger * value.denominator !== scaledNumerator,
    exactWasNonZero: value.numerator !== 0n,
  };
}

export function rationalToExactEnvelope(
  value: Rational,
  currencyCode: string | null,
  unit: string,
): {
  readonly decimal: string;
  readonly rational: ResultExactRational;
  readonly currencyCode: string | null;
  readonly unit: string;
} {
  return {
    decimal: rationalToDecimal(value),
    rational: {
      numerator: value.numerator.toString(),
      denominator: value.denominator.toString(),
    },
    currencyCode,
    unit,
  };
}

export const reduceRational = normalizeRational;
export const roundRational = roundHalfAwayFromZero;
