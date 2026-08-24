import {
  DICTIONARY_KEYS,
  CURRENCY_TABLE_BYTES,
  CURRENCY_TABLE_PUBLISHED_ON,
  CURRENCY_TABLE_READ_ON,
  CURRENCY_TABLE_SHA256,
  CURRENCY_TABLE_SNAPSHOT_ID,
  CONFIG_VERSION,
  DEFAULT_DICTIONARIES,
  FIXED_DICTIONARY_TEXTS,
  HISTORY_SCOPE,
  INPUT_FIELD_IDS,
  FIELD_VALUE_KINDS,
  FIXED_COST_COVERAGE_CODES,
  NOTICE_CODES,
  NOTICE_TEXT,
  RESULT_FORMULA_IDS,
  RESULT_DEPENDENCY_FIELD_IDS,
  REASON_CODES,
  RULESET,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  SNAPSHOT_SCOPE,
  TOP_LEVEL_KEYS,
} from './constants';
import { CURRENCY_MINOR_UNITS } from '../calculation/generated/currency-table';
import { fail, success } from './errors';
import { preflightUnicode } from './unicode';
import type {
  ExportResult,
  InputValue,
  ResultRecord,
  TimeContext,
} from './types';

const TIME_CONTEXT_KEYS = [
  'occurred_at_utc',
  'recorded_at_utc',
  'clock_source',
  'time_zone_id',
  'utc_offset',
  'time_zone_source',
  'time_zone_confirmation',
] as const;

const INPUT_KEYS = [
  'field_id',
  'availability',
  'value',
  'source',
  'evidence_status',
  'unit',
  'currency_code',
  'currency_table_snapshot_id',
  'period_ref',
  'tax_basis',
  'confirmed_at',
  'assumptions',
  'limitations',
] as const;

const RESULT_KEYS = [
  'formula_id',
  'source',
  'availability',
  'exact_value',
  'display_value',
  'unit',
  'currency_code',
  'currency_table_snapshot_id',
  'period_ref',
  'tax_basis',
  'evidence_status',
  'dependency_field_ids',
  'estimated_dependency_field_ids',
  'reason_codes',
  'primary_reason_code',
  'assumptions',
  'limitations',
  'ruleset_ref',
  'generated_at',
  'rounding',
] as const;

const VALUE_KEYS: Record<string, readonly string[]> = {
  money: ['kind', 'minor_units', 'minor_unit', 'currency_code'],
  rational: ['kind', 'numerator', 'denominator', 'unit'],
  text: ['kind', 'text', 'text_encoding'],
  enum: ['kind', 'code'],
  boolean: ['kind', 'value'],
  'local-date': ['kind', 'value'],
  'period-ref': ['kind', 'period_kind', 'custom_label', 'revision'],
};

const EVIDENCE_CODES = new Set(['actual', 'user-confirmed', 'estimated', 'forecast', 'insufficient-data']);

const FORMULA_UNIT_KIND: Record<string, { unit: (currencyCode: string | null) => string | null; currency: boolean }> = {
  'income-rate': { unit: (currencyCode) => currencyCode ? `${currencyCode}/hour` : null, currency: true },
  'work-time-equivalent': { unit: () => 'hour', currency: false },
  'coverage-available-margin': { unit: (currencyCode) => currencyCode, currency: true },
  'purchase-after-margin': { unit: (currencyCode) => currencyCode, currency: true },
  'purchase-impact': { unit: (currencyCode) => currencyCode, currency: true },
};

const INPUT_UNIT_SEMANTICS: Record<string, string> = {
  'comparison-period': 'period',
  currency: 'currency',
  income: '__currency-code__',
  'income-tax-basis': 'tax-basis',
  'work-hours': 'hour',
  'purchase-price': '__currency-code__',
  'purchase-period-inclusion': 'period-inclusion',
  'fixed-cost-total': '__currency-code__',
  'fixed-cost-coverage': 'coverage',
  'fixed-cost-coverage-description': 'text',
  'value-expectation': 'text',
};

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is RecordLike {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^-?(0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function isStrictSemVer(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function uniqueOrderedStrings(value: unknown, allowed?: readonly string[]): boolean {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return false;
  const values = value as string[];
  if (new Set(values).size !== values.length) return false;
  if (allowed && values.some((item) => !allowed.includes(item))) return false;
  if (allowed) {
    let previous = -1;
    for (const item of values) {
      const current = allowed.indexOf(item);
      if (current <= previous) return false;
      previous = current;
    }
  }
  return true;
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateTimeContext(value: unknown): value is TimeContext {
  return (
    exactKeys(value, TIME_CONTEXT_KEYS) &&
    isIsoInstant(value.occurred_at_utc) &&
    isIsoInstant(value.recorded_at_utc) &&
    isString(value.clock_source) &&
    isString(value.time_zone_id) &&
    /^[-+]\d{2}:\d{2}$/.test(String(value.utc_offset)) &&
    isString(value.time_zone_source) &&
    isString(value.time_zone_confirmation)
  );
}

function validatePeriodRef(value: unknown): boolean {
  if (!exactKeys(value, ['kind', 'custom_label', 'revision'])) return false;
  return (
    ['week', 'month', 'year', 'custom'].includes(String(value.kind)) &&
    nullableString(value.custom_label) &&
    isString(value.revision)
  );
}

function currencyMinorUnit(code: unknown): number | null {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return null;
  if (!Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, code)) return null;
  return CURRENCY_MINOR_UNITS[code as keyof typeof CURRENCY_MINOR_UNITS] ?? null;
}

function validateValue(value: unknown): value is InputValue {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  const keys = VALUE_KEYS[value.kind];
  if (!keys || !exactKeys(value, keys)) return false;
  switch (value.kind) {
    case 'money':
      return (
        typeof value.minor_units === 'string' && /^-?(0|[1-9]\d*)$/.test(value.minor_units) &&
        typeof value.minor_unit === 'number' && [0, 2, 3, 4].includes(value.minor_unit) &&
        currencyMinorUnit(value.currency_code) === value.minor_unit
      );
    case 'rational':
      return (
        typeof value.numerator === 'string' && /^-?(0|[1-9]\d*)$/.test(value.numerator) &&
        typeof value.denominator === 'string' && /^[1-9]\d*$/.test(value.denominator) &&
        isString(value.unit)
      );
    case 'text':
      return typeof value.text === 'string' && value.text_encoding === 'unicode-scalar-v1';
    case 'enum':
      return isString(value.code);
    case 'boolean':
      return typeof value.value === 'boolean';
    case 'local-date':
      return typeof value.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.value);
    case 'period-ref':
      return (
        ['week', 'month', 'year', 'custom'].includes(String(value.period_kind)) &&
        nullableString(value.custom_label) &&
        isString(value.revision)
      );
    default:
      return false;
  }
}

function validateDictionaryTexts(value: unknown, ownerId: string, kind: 'assumption' | 'limitation', required = false): value is Array<{ id: string; text: string }> {
  const fixed = FIXED_DICTIONARY_TEXTS[ownerId];
  if (!fixed || !Array.isArray(value)) return false;
  const expectedTexts = fixed[`${kind}s`];
  if (!required) return value.length === 0;
  if (value.length !== expectedTexts.length) return false;
  return value.every((entry, index) => {
    if (!exactKeys(entry, ['id', 'text']) || !isString(entry.id) || !isString(entry.text)) return false;
    // Rule/kernel notes are namespaced by their owning field or formula and
    // carry a contiguous ordinal.  Their text is also fixed domain metadata;
    // user or adapter prose must never become part of the export contract.
    return entry.id === `${ownerId}.${kind}-${index + 1}` && entry.text === expectedTexts[index];
  });
}

function validateDictionaryEntry(value: unknown): value is { id: string; label: string; definition: string } {
  return exactKeys(value, ['id', 'label', 'definition']) && isString(value.id) && isString(value.label) && isString(value.definition);
}

function validateDictionary(value: unknown, expectedEntries: ReadonlyArray<{ id: string; label: string; definition: string }>): boolean {
  if (!Array.isArray(value) || value.length !== expectedEntries.length) return false;
  return value.every((entry, index) => {
    const expected = expectedEntries[index];
    return validateDictionaryEntry(entry) && entry.id === expected.id && entry.label === expected.label && entry.definition === expected.definition;
  });
}

function validateInputContext(value: RecordLike, expectedId: string): boolean {
  const inputValue = value.value as RecordLike;
  const expectedUnit = INPUT_UNIT_SEMANTICS[expectedId];
  if (expectedUnit !== undefined && expectedUnit !== '__currency-code__' && value.unit !== expectedUnit) return false;
  if (inputValue.kind === 'money') {
    const minorUnit = currencyMinorUnit(inputValue.currency_code);
    if (minorUnit === null || inputValue.minor_unit !== minorUnit || value.currency_code !== inputValue.currency_code || value.unit !== inputValue.currency_code) return false;
    if (value.currency_table_snapshot_id !== CURRENCY_TABLE_SNAPSHOT_ID) return false;
  }
  if (expectedId === 'currency') {
    if (inputValue.kind !== 'enum' || currencyMinorUnit(inputValue.code) === null || value.currency_code !== inputValue.code || value.currency_table_snapshot_id !== CURRENCY_TABLE_SNAPSHOT_ID) return false;
  }
  if (expectedId === 'income-tax-basis' && (inputValue.kind !== 'enum' || value.tax_basis !== inputValue.code)) return false;
  if (expectedId === 'work-hours' && (inputValue.kind !== 'rational' || inputValue.unit !== 'hour')) return false;
  if (expectedId === 'comparison-period' && (inputValue.kind !== 'period-ref' || value.period_ref === null || !samePeriod(value.period_ref, {
    kind: inputValue.period_kind,
    custom_label: inputValue.custom_label,
    revision: inputValue.revision,
  }))) return false;
  return true;
}

function validateFormulaContext(value: RecordLike, expectedId: string, comparison: RecordLike | null): boolean {
  const expected = FORMULA_UNIT_KIND[expectedId];
  if (!expected) return false;
  const comparisonCurrency = comparison?.currency_code;
  const currencyCode = typeof comparisonCurrency === 'string' ? comparisonCurrency : null;
  const expectedUnit = expected.unit(currencyCode);
  const acceptedUnits = expectedId === 'income-rate' && currencyCode
    ? [`${currencyCode}/hour`, `${currencyCode}/小时`]
    : expectedId === 'work-time-equivalent'
      ? ['hour', '小时']
      : expectedUnit === null ? [] : [expectedUnit];
  if (acceptedUnits.length === 0 || !acceptedUnits.includes(String(value.unit))) return false;
  if (expected.currency) {
    if (value.currency_code !== currencyCode || currencyMinorUnit(value.currency_code) === null || value.currency_table_snapshot_id !== CURRENCY_TABLE_SNAPSHOT_ID) return false;
  } else if (value.currency_code !== null || value.currency_table_snapshot_id !== null) {
    return false;
  }
  if (comparison) {
    if (!samePeriod(value.period_ref, comparison.period_ref)) return false;
    if (value.tax_basis !== comparison.tax_basis) return false;
  }
  return true;
}

function validateInput(value: unknown, expectedId: string): boolean {
  if (!exactKeys(value, INPUT_KEYS) || value.field_id !== expectedId) return false;
  if (!['available', 'not-provided'].includes(String(value.availability))) return false;
  if (!nullableString(value.unit) || !nullableString(value.currency_code)) return false;
  if (!nullableString(value.currency_table_snapshot_id)) return false;
  if (value.period_ref !== null && !validatePeriodRef(value.period_ref)) return false;
  if (value.tax_basis !== null && !['before-tax', 'after-tax'].includes(String(value.tax_basis))) return false;
  if (!nullableString(value.confirmed_at) && value.confirmed_at !== null) return false;
  if (!Array.isArray(value.assumptions) || !Array.isArray(value.limitations)) return false;
  if (!validateDictionaryTexts(value.assumptions, expectedId, 'assumption', value.availability === 'available')) return false;
  if (!validateDictionaryTexts(value.limitations, expectedId, 'limitation', value.availability === 'available')) return false;

  if (value.availability === 'not-provided') {
    return value.value === null && value.source === null && value.evidence_status === null && value.unit === null && value.currency_code === null && value.currency_table_snapshot_id === null && value.period_ref === null && value.tax_basis === null && value.confirmed_at === null && (value.assumptions as unknown[]).length === 0 && (value.limitations as unknown[]).length === 0;
  }
  if (!validateValue(value.value)) return false;
  const expectedValueKind = FIELD_VALUE_KINDS[expectedId as keyof typeof FIELD_VALUE_KINDS];
  const inputValue = value.value as unknown as RecordLike;
  if (!validateInputContext(value, expectedId)) return false;
  if (expectedId === 'currency' && (value.currency_code !== inputValue.code || !/^[A-Z]{3}$/.test(String(inputValue.code)))) return false;
  if (expectedId === 'income-tax-basis' && value.tax_basis !== inputValue.code) return false;
  if (expectedId === 'fixed-cost-coverage' && !FIXED_COST_COVERAGE_CODES.includes(String(inputValue.code) as (typeof FIXED_COST_COVERAGE_CODES)[number])) return false;
  return (
    value.value.kind === expectedValueKind &&
    value.source === 'user-input' &&
    (value.evidence_status === 'user-confirmed' || value.evidence_status === 'estimated') &&
    value.confirmed_at !== null
  );
}

function validateExactResult(value: unknown): boolean {
  if (!exactKeysSubset(value, ['decimal', 'rational', 'minor_units', 'currency_code', 'unit'])) return false;
  if ((value.decimal !== null && !isCanonicalDecimal(value.decimal)) || !isString(value.unit)) return false;
  let rational: { numerator: string; denominator: string } | null = null;
  if (value.rational !== undefined) {
    if (!exactKeys(value.rational, ['numerator', 'denominator'])) return false;
    if (typeof value.rational.numerator !== 'string' || typeof value.rational.denominator !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value.rational.numerator) || !/^[1-9]\d*$/.test(value.rational.denominator)) return false;
    try {
      const numerator = BigInt(value.rational.numerator);
      const denominator = BigInt(value.rational.denominator);
      if (greatestCommonDivisor(numerator < 0n ? -numerator : numerator, denominator) !== 1n) return false;
      rational = { numerator: value.rational.numerator, denominator: value.rational.denominator };
    } catch {
      return false;
    }
  }
  if (value.decimal === null && rational === null) return false;
  if (typeof value.decimal === 'string' && rational !== null && !decimalMatchesRational(value.decimal, rational)) return false;
  if (value.minor_units !== undefined && (typeof value.minor_units !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value.minor_units))) return false;
  if (value.currency_code !== undefined && value.currency_code !== null && currencyMinorUnit(value.currency_code) === null) return false;
  return true;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function decimalMatchesRational(decimal: string, rational: { numerator: string; denominator: string }): boolean {
  try {
    const negative = decimal.startsWith('-');
    const unsigned = negative ? decimal.slice(1) : decimal;
    const [whole, fraction = ''] = unsigned.split('.');
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
    const signedNumerator = negative ? -numerator : numerator;
    return signedNumerator * BigInt(rational.denominator) === BigInt(rational.numerator) * denominator;
  } catch {
    return false;
  }
}

function exactKeysSubset(value: unknown, keys: readonly string[]): value is RecordLike {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function validateDisplay(value: unknown): boolean {
  if (!exactKeys(value, ['text', 'decimal', 'display_digits', 'relation'])) return false;
  const displayDigits = value.display_digits;
  return (
    isString(value.text) &&
    isCanonicalDecimal(value.decimal) &&
    Number.isSafeInteger(displayDigits) &&
    (displayDigits as number) >= 0 &&
    ['exact', 'rounded', 'less-than'].includes(String(value.relation))
  );
}

function validateRounding(value: unknown): boolean {
  if (!exactKeys(value, ['mode', 'display_digits', 'rounded'])) return false;
  const displayDigits = value.display_digits;
  return (
    value.mode === 'half-away-from-zero' &&
    Number.isSafeInteger(displayDigits) &&
    (displayDigits as number) >= 0 &&
    typeof value.rounded === 'boolean'
  );
}

function validateResult(value: unknown, expectedId: string, comparison: RecordLike | null): value is ResultRecord {
  if (!exactKeys(value, RESULT_KEYS) || value.formula_id !== expectedId) return false;
  if (value.source !== 'ruleset-derived' || !['available', 'unavailable'].includes(String(value.availability))) return false;
  if (!nullableString(value.unit) || !nullableString(value.currency_code) || !nullableString(value.currency_table_snapshot_id)) return false;
  if (value.currency_code === null ? value.currency_table_snapshot_id !== null : value.currency_table_snapshot_id !== CURRENCY_TABLE_SNAPSHOT_ID) return false;
  if (value.period_ref !== null && !validatePeriodRef(value.period_ref)) return false;
  if (value.tax_basis !== null && !['before-tax', 'after-tax'].includes(String(value.tax_basis))) return false;
  if (!EVIDENCE_CODES.has(String(value.evidence_status)) || value.evidence_status === 'actual') return false;
  const expectedDependencies = RESULT_DEPENDENCY_FIELD_IDS[expectedId as keyof typeof RESULT_DEPENDENCY_FIELD_IDS];
  if (!expectedDependencies || !uniqueOrderedStrings(value.dependency_field_ids, expectedDependencies)) return false;
  if (!uniqueOrderedStrings(value.estimated_dependency_field_ids, expectedDependencies)) return false;
  if (!uniqueOrderedStrings(value.reason_codes, REASON_CODES)) return false;
  const reasonCodes = value.reason_codes as string[];
  if (value.primary_reason_code !== null && typeof value.primary_reason_code !== 'string') return false;
  if (reasonCodes.length === 0 && value.primary_reason_code !== null) return false;
  if (reasonCodes.length > 0 && value.primary_reason_code !== reasonCodes[0]) return false;
  const dependencyIds = value.dependency_field_ids as string[];
  const estimatedDependencyIds = value.estimated_dependency_field_ids as string[];
  if (estimatedDependencyIds.some((id) => !dependencyIds.includes(id))) return false;
  if (!validateDictionaryTexts(value.assumptions, expectedId, 'assumption', value.availability === 'available')) return false;
  if (!validateDictionaryTexts(value.limitations, expectedId, 'limitation', value.availability === 'available')) return false;
  if (value.ruleset_ref !== RULESET.ruleset_ref || !validateTimeContext(value.generated_at)) return false;
  if (value.rounding !== null && !validateRounding(value.rounding)) return false;
  if (!validateFormulaContext(value, expectedId, comparison)) return false;
  if (value.availability === 'available') {
    const exactValue = value.exact_value;
    if (!isRecord(exactValue)) return false;
    return (
      (value.evidence_status === 'user-confirmed' || value.evidence_status === 'estimated' || value.evidence_status === 'forecast') &&
      validateExactResult(exactValue) &&
      exactValue.unit === value.unit &&
      (exactValue.currency_code ?? null) === value.currency_code &&
      value.display_value !== null &&
      validateDisplay(value.display_value) &&
      value.rounding !== null &&
      validateRounding(value.rounding)
    );
  }
  return (
    value.exact_value === null &&
    value.display_value === null &&
    value.rounding === null &&
    value.evidence_status === 'insufficient-data' &&
    Array.isArray(value.reason_codes) &&
    reasonCodes.length > 0
  );
}

function validateDecision(value: unknown): boolean {
  if (!exactKeys(value, ['availability', 'decision_code', 'evidence_status', 'rationale', 'confirmed_at'])) return false;
  if (value.availability === 'not-provided') {
    return value.decision_code === null && value.evidence_status === null && value.rationale === null && value.confirmed_at === null;
  }
  return (
    value.availability === 'available' &&
    ['buy', 'wait', 'adjust-conditions', 'do-not-buy', 'undecided'].includes(String(value.decision_code)) &&
    value.evidence_status === 'user-confirmed' &&
    isTextValue(value.rationale) &&
    value.rationale.text.length > 0 &&
    isIsoInstant(value.confirmed_at)
  );
}

function isTextValue(value: unknown): value is { kind: 'text'; text: string; text_encoding: 'unicode-scalar-v1' } {
  return exactKeys(value, ['kind', 'text', 'text_encoding']) && value.kind === 'text' && typeof value.text === 'string' && value.text_encoding === 'unicode-scalar-v1';
}

function validateReview(value: unknown): boolean {
  if (!exactKeys(value, ['availability', 'kind', 'local_date', 'condition_text', 'evidence_status', 'confirmed_at'])) return false;
  if (value.availability === 'not-provided') {
    return value.kind === null && value.local_date === null && value.condition_text === null && value.evidence_status === null && value.confirmed_at === null;
  }
  if (value.availability !== 'available' || value.evidence_status !== 'user-confirmed' || !isIsoInstant(value.confirmed_at)) return false;
  if (value.kind === 'local-date') return exactKeys(value.local_date, ['kind', 'value']) && value.local_date.kind === 'local-date' && /^\d{4}-\d{2}-\d{2}$/.test(String(value.local_date.value)) && value.condition_text === null;
  if (value.kind === 'condition') return value.local_date === null && isTextValue(value.condition_text) && value.condition_text.text.length > 0;
  return false;
}

function validateRevision(value: unknown, comparison: RecordLike | null = null): boolean {
  const keys = ['sequence', 'event_type', 'event_status', 'actor', 'time_context', 'field_id', 'before', 'after', 'raw_decimal_before', 'raw_decimal_after', 'confirmed_at', 'invalidated_result_ids', 'old_results', 'ruleset_ref'];
  if (!exactKeys(value, keys) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return false;
  if (value.event_type !== 'confirmed-input-revision' || value.event_status !== 'actual' || value.actor !== 'user' || !validateTimeContext(value.time_context) || !INPUT_FIELD_IDS.includes(value.field_id as (typeof INPUT_FIELD_IDS)[number])) return false;
  const fieldId = value.field_id as string;
  if (!validateRevisionValue(value.before, fieldId) || !validateRevisionValue(value.after, fieldId)) return false;
  if ((value.raw_decimal_before !== null && (!isCanonicalDecimal(value.raw_decimal_before) || value.raw_decimal_before.length > 64)) || (value.raw_decimal_after !== null && (!isCanonicalDecimal(value.raw_decimal_after) || value.raw_decimal_after.length > 64)) || !isIsoInstant(value.confirmed_at)) return false;
  if (!uniqueOrderedStrings(value.invalidated_result_ids, RESULT_FORMULA_IDS)) return false;
  const invalidatedIds = value.invalidated_result_ids as string[];
  if (!Array.isArray(value.old_results) || value.old_results.length !== invalidatedIds.length || value.old_results.length > 5) return false;
  for (let index = 0; index < value.old_results.length; index += 1) {
    if (!validateOldResult(value.old_results[index], invalidatedIds[index], comparison)) return false;
  }
  return value.ruleset_ref === RULESET.ruleset_ref;
}

function validateRevisionValue(value: unknown, fieldId: string): boolean {
  if (!exactKeys(value, ['availability', 'value', 'evidence_status', 'unit', 'currency_code', 'period_ref'])) return false;
  if (!['available', 'not-provided'].includes(String(value.availability)) || !nullableString(value.unit) || !nullableString(value.currency_code)) return false;
  if (value.period_ref !== null && !validatePeriodRef(value.period_ref)) return false;
  if (value.availability === 'not-provided') return value.value === null && value.evidence_status === null && value.unit === null && value.currency_code === null && value.period_ref === null;
  return validateValue(value.value) && value.value.kind === FIELD_VALUE_KINDS[fieldId as keyof typeof FIELD_VALUE_KINDS] && validateRevisionValueContext(value as RecordLike, fieldId) && (value.evidence_status === 'user-confirmed' || value.evidence_status === 'estimated');
}

function validateRevisionValueContext(value: RecordLike, fieldId: string): boolean {
  const inputValue = value.value as RecordLike;
  const expectedUnit = INPUT_UNIT_SEMANTICS[fieldId];
  if (expectedUnit !== undefined && expectedUnit !== '__currency-code__' && value.unit !== expectedUnit) return false;
  if (fieldId === 'currency') {
    return inputValue.kind === 'enum' && currencyMinorUnit(inputValue.code) !== null && value.unit === 'currency' && value.currency_code === inputValue.code;
  }
  if (inputValue.kind === 'money') {
    return value.unit === inputValue.currency_code && value.currency_code === inputValue.currency_code && currencyMinorUnit(inputValue.currency_code) === inputValue.minor_unit;
  }
  if (value.currency_code !== null) return false;
  if (fieldId === 'comparison-period') {
    return inputValue.kind === 'period-ref' && value.period_ref !== null && samePeriod(value.period_ref, {
      kind: inputValue.period_kind,
      custom_label: inputValue.custom_label,
      revision: inputValue.revision,
    });
  }
  if (fieldId === 'income-tax-basis') return inputValue.kind === 'enum' && value.unit === 'tax-basis' && ['before-tax', 'after-tax'].includes(String(inputValue.code));
  if (fieldId === 'work-hours') return inputValue.kind === 'rational' && inputValue.unit === 'hour' && value.unit === 'hour';
  if (fieldId === 'purchase-period-inclusion') return inputValue.kind === 'boolean' && value.unit === 'period-inclusion';
  if (fieldId === 'fixed-cost-coverage') return inputValue.kind === 'enum' && FIXED_COST_COVERAGE_CODES.includes(inputValue.code as (typeof FIXED_COST_COVERAGE_CODES)[number]) && value.unit === 'coverage';
  return (fieldId === 'fixed-cost-coverage-description' || fieldId === 'value-expectation') && inputValue.kind === 'text' && value.unit === 'text';
}

function validateOldResult(value: unknown, expectedId: string, comparison: RecordLike | null = null): boolean {
  const keys = ['formula_id', 'exact_value', 'display_value', 'unit', 'currency_code', 'period_ref', 'tax_basis', 'evidence_status', 'dependency_ids', 'rounding', 'ruleset_ref', 'currency_table_snapshot_id', 'generated_at'];
  if (!exactKeys(value, keys) || value.formula_id !== expectedId || !nullableString(value.unit) || !nullableString(value.currency_code) || (value.period_ref !== null && !validatePeriodRef(value.period_ref)) || (value.tax_basis !== null && !['before-tax', 'after-tax'].includes(String(value.tax_basis))) || !EVIDENCE_CODES.has(String(value.evidence_status)) || value.evidence_status === 'actual' || !uniqueOrderedStrings(value.dependency_ids, RESULT_DEPENDENCY_FIELD_IDS[expectedId as keyof typeof RESULT_DEPENDENCY_FIELD_IDS]) || (value.rounding !== null && !validateRounding(value.rounding)) || value.ruleset_ref !== RULESET.ruleset_ref || !nullableString(value.currency_table_snapshot_id) || (value.currency_code === null ? value.currency_table_snapshot_id !== null : value.currency_table_snapshot_id !== CURRENCY_TABLE_SNAPSHOT_ID) || !validateTimeContext(value.generated_at)) return false;
  if (value.exact_value !== null) {
    if (!isRecord(value.exact_value) || !validateExactResult(value.exact_value) || value.exact_value.unit !== value.unit || (value.exact_value.currency_code ?? null) !== value.currency_code) return false;
  }
  if (comparison !== null && !validateFormulaContext(value, expectedId, comparison)) return false;
  return value.exact_value === null || value.display_value !== null && validateDisplay(value.display_value);
}

function validateDictionaries(value: unknown): boolean {
  if (!exactKeys(value, DICTIONARY_KEYS)) return false;
  const dictionary = value as RecordLike;
  if (!validateDictionary(dictionary.schema_fields, DEFAULT_DICTIONARIES.schema_fields)) return false;
  if (!validateDictionary(dictionary.value_kinds, DEFAULT_DICTIONARIES.value_kinds)) return false;
  if (!Array.isArray(dictionary.field_definitions) || dictionary.field_definitions.length !== INPUT_FIELD_IDS.length) return false;
  if (dictionary.field_definitions.some((entry, index) => {
    const expected = DEFAULT_DICTIONARIES.field_definitions[index];
    return !exactKeys(entry, ['id', 'label', 'definition', 'value_kind', 'product_requirement', 'unit_semantics', 'sensitive']) ||
      !validateDictionaryEntry({ id: entry.id, label: entry.label, definition: entry.definition }) ||
      typeof entry.value_kind !== 'string' || !isString(entry.product_requirement) || !isString(entry.unit_semantics) || typeof entry.sensitive !== 'boolean' ||
      entry.id !== expected.id || entry.label !== expected.label || entry.definition !== expected.definition || entry.value_kind !== expected.value_kind ||
      entry.product_requirement !== expected.product_requirement || entry.unit_semantics !== expected.unit_semantics || entry.sensitive !== expected.sensitive;
  })) return false;
  if (!Array.isArray(dictionary.formula_definitions) || dictionary.formula_definitions.length !== RESULT_FORMULA_IDS.length) return false;
  if (dictionary.formula_definitions.some((entry, index) => {
    const expected = DEFAULT_DICTIONARIES.formula_definitions[index];
    return !exactKeys(entry, ['id', 'label', 'definition', 'expression', 'dependency_field_ids', 'result_unit_semantics']) ||
      !validateDictionaryEntry({ id: entry.id, label: entry.label, definition: entry.definition }) ||
      !isString(entry.expression) || !uniqueOrderedStrings(entry.dependency_field_ids, RESULT_DEPENDENCY_FIELD_IDS[entry.id as keyof typeof RESULT_DEPENDENCY_FIELD_IDS]) ||
      !isString(entry.result_unit_semantics) || entry.id !== expected.id || entry.label !== expected.label || entry.definition !== expected.definition ||
      entry.expression !== expected.expression || entry.result_unit_semantics !== expected.result_unit_semantics ||
      JSON.stringify(entry.dependency_field_ids) !== JSON.stringify(expected.dependency_field_ids);
  })) return false;
  if (!validateDictionary(dictionary.evidence_statuses, DEFAULT_DICTIONARIES.evidence_statuses)) return false;
  if (!validateDictionary(dictionary.availability_codes, DEFAULT_DICTIONARIES.availability_codes)) return false;
  if (!validateDictionary(dictionary.source_codes, DEFAULT_DICTIONARIES.source_codes)) return false;
  if (!validateDictionary(dictionary.reason_codes, DEFAULT_DICTIONARIES.reason_codes)) return false;
  if (!validateDictionary(dictionary.decision_codes, DEFAULT_DICTIONARIES.decision_codes)) return false;
  return validateDictionary(dictionary.notice_codes, DEFAULT_DICTIONARIES.notice_codes);
}

function validateWire(value: unknown): boolean {
  if (!exactKeys(value, TOP_LEVEL_KEYS)) return false;
  if (value.schema_name !== SCHEMA_NAME || value.schema_version !== SCHEMA_VERSION || value.format_name !== 'json' || value.format_version !== '1.0.0' || value.snapshot_scope !== SNAPSHOT_SCOPE || value.history_scope !== HISTORY_SCOPE) return false;
  if (!isSafeInteger(value.snapshot_revision) || !validateTimeContext(value.snapshot_captured_at) || !validateTimeContext(value.file_generated_at)) return false;
  if (!exactKeys(value.application_build, ['app_version', 'git_commit_sha', 'artifact_manifest_sha256', 'config_version']) || !isStrictSemVer(value.application_build.app_version) || !/^[0-9a-f]{40}$/.test(String(value.application_build.git_commit_sha)) || !/^[0-9a-f]{64}$/.test(String(value.application_build.artifact_manifest_sha256)) || value.application_build.config_version !== CONFIG_VERSION) return false;
  if (!exactKeys(value.ruleset, ['ruleset_id', 'ruleset_version', 'ruleset_ref']) || value.ruleset.ruleset_id !== RULESET.ruleset_id || value.ruleset.ruleset_version !== RULESET.ruleset_version || value.ruleset.ruleset_ref !== RULESET.ruleset_ref) return false;
  if (!exactKeys(value.currency_table, ['snapshot_id', 'source', 'published_on', 'read_on', 'bytes', 'sha256']) || value.currency_table.snapshot_id !== CURRENCY_TABLE_SNAPSHOT_ID || !isString(value.currency_table.source) || value.currency_table.published_on !== CURRENCY_TABLE_PUBLISHED_ON || value.currency_table.read_on !== CURRENCY_TABLE_READ_ON || value.currency_table.bytes !== CURRENCY_TABLE_BYTES || value.currency_table.sha256 !== CURRENCY_TABLE_SHA256) return false;
  if (!validateDictionaries(value.dictionaries)) return false;
  if (!exactKeys(value.comparison_context, ['period_ref', 'currency_code', 'currency_table_snapshot_id', 'tax_basis', 'time_zone_id', 'utc_offset', 'time_zone_source', 'time_zone_confirmation', 'source_input_ids'])) return false;
  if (value.comparison_context.period_ref !== null && !validatePeriodRef(value.comparison_context.period_ref)) return false;
  if (!nullableString(value.comparison_context.currency_code) || !nullableString(value.comparison_context.currency_table_snapshot_id) || (value.comparison_context.tax_basis !== null && !['before-tax', 'after-tax'].includes(String(value.comparison_context.tax_basis))) || !nullableString(value.comparison_context.time_zone_id) || !nullableString(value.comparison_context.utc_offset) || !nullableString(value.comparison_context.time_zone_source) || !nullableString(value.comparison_context.time_zone_confirmation) || !uniqueOrderedStrings(value.comparison_context.source_input_ids, INPUT_FIELD_IDS)) return false;
  if (!Array.isArray(value.inputs) || value.inputs.length !== INPUT_FIELD_IDS.length || value.inputs.some((entry, index) => !validateInput(entry, INPUT_FIELD_IDS[index]))) return false;
  const inputRecords = value.inputs as RecordLike[];
  const currencyTable = value.currency_table as RecordLike;
  if (inputRecords.some((entry) => entry.availability === 'available' && entry.currency_table_snapshot_id !== currencyTable.snapshot_id)) return false;
  const periodInput = inputRecords.find((entry) => entry.field_id === 'comparison-period');
  if (periodInput?.availability === 'available') {
    if (value.comparison_context.period_ref === null || !samePeriod(value.comparison_context.period_ref, periodInput.period_ref)) return false;
  } else if (value.comparison_context.period_ref !== null) return false;
  const currencyInput = inputRecords.find((entry) => entry.field_id === 'currency');
  const currencyValue = isRecord(currencyInput?.value) && currencyInput.value.kind === 'enum' ? currencyInput.value.code : null;
  if (currencyInput?.availability === 'available') {
    if (value.comparison_context.currency_code !== currencyValue || value.comparison_context.currency_table_snapshot_id !== CURRENCY_TABLE_SNAPSHOT_ID) return false;
  } else if (value.comparison_context.currency_code !== null || value.comparison_context.currency_table_snapshot_id !== null) return false;
  const taxInput = inputRecords.find((entry) => entry.field_id === 'income-tax-basis');
  const taxValue = isRecord(taxInput?.value) && taxInput.value.kind === 'enum' ? taxInput.value.code : null;
  if (taxInput?.availability === 'available') {
    if (value.comparison_context.tax_basis !== taxValue) return false;
  } else if (value.comparison_context.tax_basis !== null) return false;
  const incomeInput = inputRecords.find((entry) => entry.field_id === 'income');
  if (incomeInput?.availability === 'available' && incomeInput.tax_basis !== value.comparison_context.tax_basis) return false;
  const fixedCostInput = inputRecords.find((entry) => entry.field_id === 'fixed-cost-total');
  if (fixedCostInput?.availability === 'available' && fixedCostInput.tax_basis !== value.comparison_context.tax_basis) return false;
  if ((value.comparison_context.source_input_ids as string[]).some((id) => !inputRecords.some((entry) => entry.field_id === id))) return false;
  const comparison = value.comparison_context as RecordLike;
  if (!Array.isArray(value.results) || value.results.length !== RESULT_FORMULA_IDS.length || value.results.some((entry, index) => !validateResult(entry, RESULT_FORMULA_IDS[index], comparison))) return false;
  if (!validateDecision(value.decision) || !validateReview(value.review)) return false;
  if (!Array.isArray(value.confirmed_revisions) || value.confirmed_revisions.length > 50) return false;
  let previous = 0;
  for (const revision of value.confirmed_revisions) {
    if (!validateRevision(revision, comparison) || revision.sequence <= previous) return false;
    previous = revision.sequence;
  }
  if (!Array.isArray(value.notices) || value.notices.length !== NOTICE_CODES.length || value.notices.some((notice, index) => !exactKeys(notice, ['code', 'text']) || notice.code !== NOTICE_CODES[index] || notice.text !== NOTICE_TEXT[NOTICE_CODES[index]])) return false;
  return true;
}

function samePeriod(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && left.kind === right.kind && left.custom_label === right.custom_label && left.revision === right.revision;
}

export function validateWireSnapshot(value: unknown): ExportResult<void> {
  const unicode = preflightUnicode(value);
  return unicode.ok && validateWire(value) ? success(undefined) : fail(unicode.ok ? 'export-schema-mismatch' : unicode.error.code);
}

export function assertWireSnapshot(value: unknown): asserts value is RecordLike {
  const result = validateWireSnapshot(value);
  if (!result.ok) throw new Error(result.error.code);
}

/**
 * Parse JSON while rejecting duplicate object names. Native JSON.parse silently
 * keeps the last duplicate key, which is not acceptable for this wire contract.
 */
export function parseJsonWithUniqueKeys(text: string): ExportResult<unknown> {
  try {
    const parser = new JsonParser(text);
    const value = parser.parse();
    return success(value);
  } catch {
    return fail('export-schema-mismatch');
  }
}

class JsonParser {
  private index = 0;

  public constructor(private readonly source: string) {}

  public parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new Error('trailing');
    return value;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    const current = this.source[this.index];
    if (current === '{') return this.parseObject();
    if (current === '[') return this.parseArray();
    if (current === '"') return this.parseString();
    if (this.source.startsWith('true', this.index)) {
      this.index += 4;
      return true;
    }
    if (this.source.startsWith('false', this.index)) {
      this.index += 5;
      return false;
    }
    if (this.source.startsWith('null', this.index)) {
      this.index += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseObject(): RecordLike {
    this.index += 1;
    this.skipWhitespace();
    const result: RecordLike = {};
    const keys = new Set<string>();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return result;
    }
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') throw new Error('key');
      const key = this.parseString();
      if (keys.has(key)) throw new Error('duplicate');
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ':') throw new Error('colon');
      this.index += 1;
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ',') throw new Error('comma');
      this.index += 1;
    }
  }

  private parseArray(): unknown[] {
    this.index += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.source[this.index] === ']') {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ',') throw new Error('comma');
      this.index += 1;
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '\\') {
        this.index += 2;
        if (this.source[this.index - 1] === 'u') this.index += 4;
        continue;
      }
      if (character === '"') {
        this.index += 1;
        const literal = this.source.slice(start, this.index);
        return JSON.parse(literal) as string;
      }
      if (character < ' ') throw new Error('control');
      this.index += 1;
    }
    throw new Error('unterminated');
  }

  private parseNumber(): number {
    const match = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error('number');
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error('number');
    this.index += match[0].length;
    return value;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? '')) this.index += 1;
  }
}
