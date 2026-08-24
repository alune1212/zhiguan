import {
  CURRENCY_TABLE_SNAPSHOT_ID,
  type CurrencyInfo,
  type CurrencyTable,
  type MinorUnit,
  type ParseResult,
} from "./types.js";
import {
  CURRENCY_MINOR_UNITS,
  CURRENCY_TABLE,
  CURRENCY_TABLE_BYTES,
  CURRENCY_TABLE_PUBLISHED_DATE,
  CURRENCY_TABLE_READ_DATE,
  CURRENCY_TABLE_SHA256,
  CURRENCY_TABLE_SOURCE_NAME,
  CURRENCY_TABLE_SOURCE_URL,
} from "./generated/currency-table.js";

/**
 * This is a small immutable fallback used by the pure kernel.  The build-time
 * currency task may replace the table carrier, but callers can always pass a
 * fixed table explicitly through CalculationContext.  No function here reads
 * the current ISO table or reaches a remote service.
 */
const generatedEntries = Object.entries(CURRENCY_MINOR_UNITS).map(([code, minorUnit]) => [
  code,
  Object.freeze({ code, minorUnit: minorUnit as MinorUnit }),
] as const);

export const DEFAULT_CURRENCY_TABLE: CurrencyTable = Object.freeze(
  Object.fromEntries(generatedEntries) as CurrencyTable,
);

export const CURRENCY_SNAPSHOT_METADATA = Object.freeze({
  snapshotId: CURRENCY_TABLE_SNAPSHOT_ID,
  sourceName: CURRENCY_TABLE_SOURCE_NAME,
  sourceUrl: CURRENCY_TABLE_SOURCE_URL,
  publishedDate: CURRENCY_TABLE_PUBLISHED_DATE,
  readDate: CURRENCY_TABLE_READ_DATE,
  bytes: CURRENCY_TABLE_BYTES,
  sha256: CURRENCY_TABLE_SHA256,
  generatedTable: CURRENCY_TABLE,
});

export interface CurrencySnapshot {
  readonly id: string;
  readonly table: CurrencyTable;
}

export const DEFAULT_CURRENCY_SNAPSHOT: CurrencySnapshot = Object.freeze({
  id: CURRENCY_TABLE_SNAPSHOT_ID,
  table: DEFAULT_CURRENCY_TABLE,
});

export function normalizeCurrencyCode(raw: string): ParseResult<string> {
  if (raw.length > 64) return { ok: false, reasonCode: "numeric-limit-exceeded" };
  const code = raw.trim();
  if (!/^[A-Z]{3}$/.test(code)) {
    return { ok: false, reasonCode: "unsupported-currency" };
  }
  return { ok: true, value: code };
}

export function currencyInfo(
  code: string,
  table: CurrencyTable = DEFAULT_CURRENCY_TABLE,
): ParseResult<CurrencyInfo> {
  const normalized = normalizeCurrencyCode(code);
  if (!normalized.ok) return normalized;
  const entry = table[normalized.value];
  if (
    entry === undefined ||
    entry.code !== normalized.value ||
    !/^[A-Z]{3}$/.test(entry.code) ||
    ![0, 2, 3, 4].includes(entry.minorUnit)
  ) {
    return { ok: false, reasonCode: "unsupported-currency" };
  }
  return { ok: true, value: entry };
}
