import {
  DICTIONARY_KEYS,
  HISTORY_SCOPE,
  INPUT_FIELD_IDS,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  SNAPSHOT_SCOPE,
} from './constants';
import { fail, success } from './errors';
import { normalizeLineEndings, normalizeUnicodeTree, preflightUnicode, utf8Bytes } from './unicode';
import { validateWireSnapshot } from './validator';
import type {
  ApplicationBuild,
  ComparisonContext,
  ConfirmedRevision,
  Dictionaries,
  ExportResult,
  ExportSnapshotSource,
  ExportSnapshotV1,
  InputRecord,
  Notice,
  ResultRecord,
  SnapshotLifecycle,
  TimeContext,
} from './types';

export const EXPORT_LIMITS = {
  confirmed_revisions: 50,
  old_results_per_revision: 5,
  free_text_utf8_bytes: 64 * 1024,
  snapshot_utf8_bytes: 512 * 1024,
  format_utf8_bytes: 1024 * 1024,
} as const;

const SOURCE_TOP_LEVEL_KEYS = new Set([
  'session_revision',
  'sessionRevision',
  'session_revision_start',
  'sessionRevisionStart',
  'session_revision_end',
  'sessionRevisionEnd',
  'pending_edit',
  'pendingEdit',
  'stale',
  'workflow_status',
  'workflowStatus',
  'confirmed_stability',
  'confirmedStability',
  'derived_status',
  'derivedStatus',
  'snapshot_revision',
  'snapshotRevision',
  'snapshot_captured_at',
  'snapshotCapturedAt',
  'application_build',
  'applicationBuild',
  'ruleset',
  'currency_table',
  'currencyTable',
  'dictionaries',
  'comparison_context',
  'comparisonContext',
  'inputs',
  'results',
  'decision',
  'review',
  'confirmed_revisions',
  'confirmedRevisions',
  'notices',
]);

const emptyTimeContext = (value: unknown): value is TimeContext =>
  typeof value === 'object' && value !== null &&
  ['occurred_at_utc', 'recorded_at_utc', 'clock_source', 'time_zone_id', 'utc_offset', 'time_zone_source', 'time_zone_confirmation'].every((key) => key in value);

function read(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (key in source) return source[key];
  return undefined;
}

/**
 * Source adapters may use one spelling for a field, but they must not send
 * two spellings with different values.  The normalizers intentionally read
 * the first matching alias for ergonomic application integration; this
 * preflight runs before normalization so object-key order can never decide
 * the exported meaning.
 */
const SOURCE_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['session_revision', 'sessionRevision'],
  ['session_revision_start', 'sessionRevisionStart'],
  ['session_revision_end', 'sessionRevisionEnd'],
  ['snapshot_revision', 'snapshotRevision'],
  ['snapshot_captured_at', 'snapshotCapturedAt'],
  ['application_build', 'applicationBuild'],
  ['currency_table', 'currencyTable'],
  ['comparison_context', 'comparisonContext'],
  ['confirmed_revisions', 'confirmedRevisions'],
  ['ruleset_id', 'rulesetId'],
  ['ruleset_version', 'rulesetVersion'],
  ['decision_code', 'decisionCode', 'code'],
  ['pending_edit', 'pendingEdit'],
  ['workflow_status', 'workflowStatus'],
  ['confirmed_stability', 'confirmedStability'],
  ['derived_status', 'derivedStatus'],
  ['field_id', 'fieldId'],
  ['formula_id', 'formulaId'],
  ['evidence_status', 'evidenceStatus'],
  ['currency_code', 'currencyCode'],
  ['currency_table_snapshot_id', 'currencyTableSnapshotId'],
  ['period_ref', 'periodRef'],
  ['period_kind', 'periodKind'],
  ['custom_label', 'customLabel'],
  ['tax_basis', 'taxBasis'],
  ['confirmed_at', 'confirmedAt'],
  ['minor_units', 'minorUnits'],
  ['minor_unit', 'minorUnit'],
  ['text_encoding', 'textEncoding'],
  ['exact_value', 'exact', 'exactValue'],
  ['display_value', 'display', 'displayValue'],
  ['display_digits', 'displayDigits'],
  ['generated_at', 'generatedAt', 'time_context', 'timeContext'],
  ['dependency_field_ids', 'dependencyFieldIds'],
  ['estimated_dependency_field_ids', 'estimatedDependencyFieldIds'],
  ['dependency_ids', 'dependencyIds'],
  ['reason_codes', 'reasonCodes'],
  ['primary_reason_code', 'primaryReasonCode'],
  ['ruleset_ref', 'rulesetRef'],
  ['event_type', 'eventType'],
  ['event_status', 'eventStatus'],
  ['raw_decimal_before', 'rawDecimalBefore'],
  ['raw_decimal_after', 'rawDecimalAfter'],
  ['invalidated_result_ids', 'invalidatedResultIds'],
  ['old_results', 'oldResults'],
  ['local_date', 'localDate'],
  ['condition_text', 'conditionText'],
  ['source_input_ids', 'sourceInputIds'],
  ['time_zone_id', 'timeZoneId'],
  ['utc_offset', 'utcOffset'],
  ['clock_source', 'clockSource'],
  ['time_zone_source', 'timeZoneSource'],
  ['time_zone_confirmation', 'timeZoneConfirmation'],
  ['app_version', 'appVersion'],
  ['git_commit_sha', 'gitCommitSha'],
  ['artifact_manifest_sha256', 'artifactManifestSha256'],
  ['config_version', 'configVersion'],
  ['snapshot_id', 'snapshotId'],
  ['published_on', 'publishedOn'],
  ['read_on', 'readOn'],
];

function sourceValuesEqual(left: unknown, right: unknown, pairs = new WeakMap<object, WeakSet<object>>()): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  const seenRight = pairs.get(left);
  if (seenRight?.has(right)) return true;
  if (seenRight) seenRight.add(right);
  else pairs.set(left, new WeakSet([right]));
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sourceValuesEqual(item, right[index], pairs));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => !hasOwn(rightRecord, key))) return false;
  return leftKeys.every((key) => sourceValuesEqual(leftRecord[key], rightRecord[key], pairs));
}

function hasConflictingSourceAliases(value: unknown, visited = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || visited.has(value)) return false;
  visited.add(value);
  if (Array.isArray(value)) return value.some((item) => hasConflictingSourceAliases(item, visited));
  const record = value as Record<string, unknown>;
  for (const group of SOURCE_ALIAS_GROUPS) {
    const present = group.filter((key) => hasOwn(record, key));
    if (present.length > 1 && present.slice(1).some((key) => !sourceValuesEqual(record[present[0]], record[key]))) return true;
  }
  return Object.values(record).some((item) => hasConflictingSourceAliases(item, visited));
}

/**
 * A source adapter may expose either the wire snake_case name or the
 * application camelCase name.  Seeing both names is only safe when they carry
 * the same scalar value.  In particular, never let the order of object keys
 * decide which session revision is used for the stale check.
 */
function aliasedRevisionConflict(source: Record<string, unknown>): boolean {
  const groups = [
    ['session_revision', 'sessionRevision'],
    ['session_revision_start', 'sessionRevisionStart'],
    ['session_revision_end', 'sessionRevisionEnd'],
    ['snapshot_revision', 'snapshotRevision'],
  ] as const;
  for (const group of groups) {
    const values = group.filter((key) => hasOwn(source, key)).map((key) => numericRevision(source[key]));
    if (values.length > 1 && (values.some((value) => value === null) || values.some((value) => value !== values[0]))) return true;
  }
  return false;
}

function aliasedScalar(source: Record<string, unknown>, ...keys: string[]): { present: boolean; value: unknown; conflict: boolean } {
  const present = keys.filter((key) => hasOwn(source, key));
  if (present.length === 0) return { present: false, value: undefined, conflict: false };
  const first = source[present[0]];
  return {
    present: true,
    value: first,
    conflict: present.slice(1).some((key) => !Object.is(first, source[key])),
  };
}

function validateLifecycleIndicators(raw: Record<string, unknown>): ExportResult<void> {
  const pending = aliasedScalar(raw, 'pending_edit', 'pendingEdit');
  const stale = aliasedScalar(raw, 'stale');
  const workflow = aliasedScalar(raw, 'workflow_status', 'workflowStatus');
  const confirmedStability = aliasedScalar(raw, 'confirmed_stability', 'confirmedStability');
  const derivedStatus = aliasedScalar(raw, 'derived_status', 'derivedStatus');
  if ([pending, stale, workflow, confirmedStability, derivedStatus].some((item) => item.conflict)) return fail('export-schema-mismatch');
  if ((pending.present && typeof pending.value !== 'boolean') || (stale.present && typeof stale.value !== 'boolean')) return fail('export-schema-mismatch');
  const workflowStatuses = new Set(['draft', 'confirmed', 'derived', 'pending-reconfirmation', 'stale']);
  if (workflow.present && (typeof workflow.value !== 'string' || !workflowStatuses.has(workflow.value))) return fail('export-schema-mismatch');
  if (derivedStatus.present && (typeof derivedStatus.value !== 'string' || !workflowStatuses.has(derivedStatus.value))) return fail('export-schema-mismatch');
  if (confirmedStability.present && (confirmedStability.value !== 'stable' && confirmedStability.value !== 'invalidated')) return fail('export-schema-mismatch');
  if (
    pending.value === true ||
    stale.value === true ||
    workflow.value === 'draft' ||
    workflow.value === 'pending-reconfirmation' ||
    workflow.value === 'stale' ||
    derivedStatus.value === 'draft' ||
    derivedStatus.value === 'pending-reconfirmation' ||
    derivedStatus.value === 'stale' ||
    confirmedStability.value === 'invalidated'
  ) return fail('export-pending-edit');
  return success(undefined);
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function hasAnyOwn(source: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => hasOwn(source, key));
}

function exactSourceKeys(value: unknown, allowed: readonly string[], required: readonly (readonly string[])[] = []): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) return false;
  // A present-but-undefined property is not a wire value.  Reject it here
  // instead of allowing a normalizer's `?? null`/default to invent state.
  if (Object.values(value).some((item) => item === undefined)) return false;
  return required.every((group) => group.some((key) => hasOwn(value, key)));
}

function sourceTextArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => exactSourceKeys(item, ['id', 'text']) && typeof item.id === 'string' && item.id.length > 0 && typeof item.text === 'string' && item.text.length > 0);
}

function sourceStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function sourceTimeContext(value: unknown): boolean {
  return exactSourceKeys(value, [
    'occurred_at_utc',
    'occurredAtUtc',
    'recorded_at_utc',
    'recordedAtUtc',
    'clock_source',
    'clockSource',
    'time_zone_id',
    'timeZoneId',
    'utc_offset',
    'utcOffset',
    'time_zone_source',
    'timeZoneSource',
    'time_zone_confirmation',
    'timeZoneConfirmation',
  ], [
    ['occurred_at_utc', 'occurredAtUtc'],
    ['recorded_at_utc', 'recordedAtUtc'],
    ['clock_source', 'clockSource'],
    ['time_zone_id', 'timeZoneId'],
    ['utc_offset', 'utcOffset'],
    ['time_zone_source', 'timeZoneSource'],
    ['time_zone_confirmation', 'timeZoneConfirmation'],
  ]);
}

function sourcePeriodRef(value: unknown): boolean {
  if (value === null) return true;
  if (!exactSourceKeys(value, [
    'kind', 'period_kind', 'periodKind', 'custom_label', 'customLabel', 'revision',
  ], [
    ['kind', 'period_kind', 'periodKind'], ['custom_label', 'customLabel'], ['revision'],
  ])) return false;
  const source = value as Record<string, unknown>;
  const kind = read(source, 'kind');
  const explicitPeriodKind = read(source, 'period_kind', 'periodKind');
  if (kind !== undefined && kind !== 'period-ref' && explicitPeriodKind !== undefined && kind !== explicitPeriodKind) return false;
  const periodKind = kind === 'period-ref' ? explicitPeriodKind : (kind ?? explicitPeriodKind);
  const customLabel = read(source, 'custom_label', 'customLabel');
  return ['week', 'month', 'year', 'custom'].includes(String(periodKind)) &&
    (customLabel === null || typeof customLabel === 'string') &&
    typeof source.revision === 'string';
}

function sourceTextLike(value: unknown): boolean {
  if (value === null || typeof value === 'string') return true;
  return exactSourceKeys(value, ['kind', 'text', 'text_encoding', 'textEncoding'], [
    ['kind'], ['text'], ['text_encoding', 'textEncoding'],
  ]) && value.kind === 'text' && typeof value.text === 'string' &&
    read(value, 'text_encoding', 'textEncoding') === 'unicode-scalar-v1';
}

function sourceLocalDateLike(value: unknown): boolean {
  if (value === null || typeof value === 'string') return true;
  return exactSourceKeys(value, ['kind', 'value'], [['kind'], ['value']]) &&
    value.kind === 'local-date' && typeof value.value === 'string';
}

function sourceDictionaries(value: unknown): boolean {
  if (!exactSourceKeys(value, DICTIONARY_KEYS, DICTIONARY_KEYS.map((key) => [key]))) return false;
  const source = value as Record<string, unknown>;
  return DICTIONARY_KEYS.every((key) => {
    const entries = source[key];
    if (!Array.isArray(entries)) return false;
    if (key === 'field_definitions') {
      return entries.every((entry) => exactSourceKeys(entry, [
        'id', 'label', 'definition', 'value_kind', 'product_requirement', 'unit_semantics', 'sensitive',
      ], [
        ['id'], ['label'], ['definition'], ['value_kind'], ['product_requirement'], ['unit_semantics'], ['sensitive'],
      ]));
    }
    if (key === 'formula_definitions') {
      return entries.every((entry) => exactSourceKeys(entry, [
        'id', 'label', 'definition', 'expression', 'dependency_field_ids', 'result_unit_semantics',
      ], [
        ['id'], ['label'], ['definition'], ['expression'], ['dependency_field_ids'], ['result_unit_semantics'],
      ]) && sourceStringArray((entry as Record<string, unknown>).dependency_field_ids));
    }
    return entries.every((entry) => exactSourceKeys(entry, ['id', 'label', 'definition'], [
      ['id'], ['label'], ['definition'],
    ]));
  });
}

function sourceValue(value: unknown, fieldId: string, source: Record<string, unknown>): boolean {
  if (value === null) return true;
  if (typeof value === 'string') {
    return fieldId === 'fixed-cost-coverage-description' || fieldId === 'value-expectation' ||
      (['income', 'purchase-price', 'fixed-cost-total'].includes(fieldId) && hasAnyOwn(source, 'currency_code', 'currencyCode') && hasAnyOwn(source, 'minor_unit', 'minorUnit'));
  }
  if (typeof value === 'boolean') return fieldId === 'purchase-period-inclusion';
  if (!isRecord(value)) return false;
  const kind = read(value, 'kind');
  if (kind === 'money') return exactSourceKeys(value, ['kind', 'minor_units', 'minorUnits', 'minor_unit', 'minorUnit', 'currency_code', 'currencyCode'], [
    ['kind'], ['minor_units', 'minorUnits'], ['minor_unit', 'minorUnit'], ['currency_code', 'currencyCode'],
  ]);
  if (kind === 'rational') return exactSourceKeys(value, ['kind', 'numerator', 'denominator', 'unit'], [['kind'], ['numerator'], ['denominator'], ['unit']]);
  if (kind === 'text') return exactSourceKeys(value, ['kind', 'text', 'text_encoding', 'textEncoding'], [['kind'], ['text'], ['text_encoding', 'textEncoding']]);
  if (kind === 'enum') return exactSourceKeys(value, ['kind', 'code'], [['kind'], ['code']]);
  if (kind === 'boolean') return exactSourceKeys(value, ['kind', 'value'], [['kind'], ['value']]);
  if (kind === 'local-date') return exactSourceKeys(value, ['kind', 'value'], [['kind'], ['value']]);
  if (kind === 'period-ref') return exactSourceKeys(value, ['kind', 'period_kind', 'periodKind', 'custom_label', 'customLabel', 'revision'], [['kind'], ['period_kind', 'periodKind'], ['custom_label', 'customLabel'], ['revision']]);
  return false;
}

function sourceExactValue(value: unknown): boolean {
  if (value === null) return true;
  if (!exactSourceKeys(value, ['decimal', 'rational', 'minor_units', 'minorUnits', 'currency_code', 'currencyCode', 'unit'], [['decimal'], ['unit']])) return false;
  const record = value as Record<string, unknown>;
  const rational = read(record, 'rational');
  if (rational !== undefined && rational !== null && !exactSourceKeys(rational, ['numerator', 'denominator'], [['numerator'], ['denominator']])) return false;
  return true;
}

function sourceDisplayValue(value: unknown): boolean {
  return value === null || exactSourceKeys(value, ['text', 'decimal', 'display_digits', 'displayDigits', 'relation'], [['text'], ['decimal'], ['display_digits', 'displayDigits'], ['relation']]);
}

function sourceRounding(value: unknown): boolean {
  return value === null || exactSourceKeys(value, ['mode', 'display_digits', 'displayDigits', 'rounded'], [['mode'], ['display_digits', 'displayDigits'], ['rounded']]);
}

const SOURCE_INPUT_KEYS = [
  'field_id', 'fieldId', 'availability', 'value', 'source', 'evidence_status', 'evidenceStatus', 'unit',
  'currency_code', 'currencyCode', 'currency_table_snapshot_id', 'currencyTableSnapshotId', 'period_ref', 'periodRef',
  'tax_basis', 'taxBasis', 'confirmed_at', 'confirmedAt', 'assumptions', 'limitations', 'minor_unit', 'minorUnit',
] as const;

const SOURCE_RESULT_KEYS = [
  'formula_id', 'formulaId', 'source', 'availability', 'exact_value', 'exact', 'exactValue', 'display_value', 'display',
  'displayValue', 'unit', 'currency_code', 'currencyCode', 'currency_table_snapshot_id', 'currencyTableSnapshotId',
  'period_ref', 'periodRef', 'tax_basis', 'taxBasis', 'evidence_status', 'evidenceStatus', 'dependency_field_ids',
  'dependencyFieldIds', 'estimated_dependency_field_ids', 'estimatedDependencyFieldIds', 'reason_codes', 'reasonCodes',
  'primary_reason_code', 'primaryReasonCode', 'assumptions', 'limitations', 'ruleset_ref', 'rulesetRef', 'generated_at',
  'generatedAt', 'time_context', 'timeContext', 'rounding',
] as const;

function sourceInputRecord(value: unknown, fieldIdRequired: boolean): boolean {
  if (!exactSourceKeys(value, SOURCE_INPUT_KEYS, [
    ...(fieldIdRequired ? [['field_id', 'fieldId'] as const] : []),
    ['availability'], ['value'], ['source'], ['evidence_status', 'evidenceStatus'], ['unit'],
    ['currency_code', 'currencyCode'], ['currency_table_snapshot_id', 'currencyTableSnapshotId'], ['period_ref', 'periodRef'],
    ['tax_basis', 'taxBasis'], ['confirmed_at', 'confirmedAt'], ['assumptions'], ['limitations'],
  ])) return false;
  const source = value as Record<string, unknown>;
  const fieldId = String(read(source, 'field_id', 'fieldId') ?? '');
  if (!sourceValue(read(source, 'value'), fieldId, source) || !sourcePeriodRef(read(source, 'period_ref', 'periodRef')) || !sourceTextArray(read(source, 'assumptions')) || !sourceTextArray(read(source, 'limitations'))) return false;
  if (read(source, 'availability') === 'not-provided') {
    return read(source, 'value') === null && read(source, 'source') === null && read(source, 'evidence_status', 'evidenceStatus') === null && read(source, 'unit') === null && read(source, 'currency_code', 'currencyCode') === null && read(source, 'currency_table_snapshot_id', 'currencyTableSnapshotId') === null && read(source, 'period_ref', 'periodRef') === null && read(source, 'tax_basis', 'taxBasis') === null && read(source, 'confirmed_at', 'confirmedAt') === null && (read(source, 'assumptions') as unknown[]).length === 0 && (read(source, 'limitations') as unknown[]).length === 0;
  }
  return true;
}

function sourceResultRecord(value: unknown, old = false): boolean {
  const keys = old ? [
    'formula_id', 'formulaId', 'exact_value', 'exact', 'exactValue', 'display_value', 'display', 'displayValue', 'unit',
    'currency_code', 'currencyCode', 'period_ref', 'periodRef', 'tax_basis', 'taxBasis', 'evidence_status', 'evidenceStatus',
    'dependency_ids', 'dependencyIds', 'rounding', 'ruleset_ref', 'rulesetRef', 'currency_table_snapshot_id', 'currencyTableSnapshotId',
    'generated_at', 'generatedAt', 'time_context', 'timeContext',
  ] as const : SOURCE_RESULT_KEYS;
  const required = old ? [
    ['formula_id', 'formulaId'], ['exact_value', 'exact', 'exactValue'], ['display_value', 'display', 'displayValue'], ['unit'],
    ['currency_code', 'currencyCode'], ['period_ref', 'periodRef'], ['tax_basis', 'taxBasis'], ['evidence_status', 'evidenceStatus'],
    ['dependency_ids', 'dependencyIds'], ['rounding'], ['ruleset_ref', 'rulesetRef'], ['currency_table_snapshot_id', 'currencyTableSnapshotId'],
    ['generated_at', 'generatedAt', 'time_context', 'timeContext'],
  ] as const : [
    ['formula_id', 'formulaId'], ['source'], ['availability'], ['exact_value', 'exact', 'exactValue'], ['display_value', 'display', 'displayValue'],
    ['unit'], ['currency_code', 'currencyCode'], ['currency_table_snapshot_id', 'currencyTableSnapshotId'], ['period_ref', 'periodRef'],
    ['tax_basis', 'taxBasis'], ['evidence_status', 'evidenceStatus'], ['dependency_field_ids', 'dependencyFieldIds'],
    ['estimated_dependency_field_ids', 'estimatedDependencyFieldIds'], ['reason_codes', 'reasonCodes'], ['primary_reason_code', 'primaryReasonCode'],
    ['assumptions'], ['limitations'], ['ruleset_ref', 'rulesetRef'], ['generated_at', 'generatedAt', 'time_context', 'timeContext'], ['rounding'],
  ] as const;
  if (!exactSourceKeys(value, keys, required)) return false;
  const source = value as Record<string, unknown>;
  if (!sourceExactValue(read(source, 'exact_value', 'exact', 'exactValue')) || !sourceDisplayValue(read(source, 'display_value', 'display', 'displayValue')) || !sourceRounding(read(source, 'rounding')) || !sourceTimeContext(read(source, 'generated_at', 'generatedAt', 'time_context', 'timeContext')) || !sourcePeriodRef(read(source, 'period_ref', 'periodRef'))) return false;
  if (old) return sourceStringArray(read(source, 'dependency_ids', 'dependencyIds'));
  return sourceStringArray(read(source, 'dependency_field_ids', 'dependencyFieldIds')) && sourceStringArray(read(source, 'estimated_dependency_field_ids', 'estimatedDependencyFieldIds')) && sourceStringArray(read(source, 'reason_codes', 'reasonCodes')) && sourceTextArray(read(source, 'assumptions')) && sourceTextArray(read(source, 'limitations'));
}

function sourceRevisionValue(value: unknown, fieldId: string): boolean {
  if (!exactSourceKeys(value, ['availability', 'value', 'evidence_status', 'evidenceStatus', 'unit', 'currency_code', 'currencyCode', 'period_ref', 'periodRef'], [
    ['availability'], ['value'], ['evidence_status', 'evidenceStatus'], ['unit'], ['currency_code', 'currencyCode'], ['period_ref', 'periodRef'],
  ])) return false;
  const source = value as Record<string, unknown>;
  if (!sourceValue(source.value, fieldId, source) || !sourcePeriodRef(read(source, 'period_ref', 'periodRef'))) return false;
  if (source.availability === 'not-provided') return source.value === null && read(source, 'evidence_status', 'evidenceStatus') === null && source.unit === null && read(source, 'currency_code', 'currencyCode') === null && read(source, 'period_ref', 'periodRef') === null;
  return true;
}

function sourceRevisionRecord(value: unknown): boolean {
  if (!exactSourceKeys(value, [
    'sequence', 'event_type', 'eventType', 'event_status', 'eventStatus', 'actor', 'time_context', 'timeContext', 'field_id', 'fieldId',
    'before', 'after', 'raw_decimal_before', 'rawDecimalBefore', 'raw_decimal_after', 'rawDecimalAfter', 'confirmed_at', 'confirmedAt',
    'invalidated_result_ids', 'invalidatedResultIds', 'old_results', 'oldResults', 'ruleset_ref', 'rulesetRef',
  ], [
    ['sequence'], ['event_type', 'eventType'], ['event_status', 'eventStatus'], ['actor'], ['time_context', 'timeContext'], ['field_id', 'fieldId'],
    ['before'], ['after'], ['raw_decimal_before', 'rawDecimalBefore'], ['raw_decimal_after', 'rawDecimalAfter'], ['confirmed_at', 'confirmedAt'],
    ['invalidated_result_ids', 'invalidatedResultIds'], ['old_results', 'oldResults'], ['ruleset_ref', 'rulesetRef'],
  ])) return false;
  const source = value as Record<string, unknown>;
  const sequence = numericRevision(source.sequence);
  if (sequence === null || sequence < 1) return false;
  const fieldId = String(read(source, 'field_id', 'fieldId') ?? '');
  const oldResults = read(source, 'old_results', 'oldResults');
  const rawBefore = read(source, 'raw_decimal_before', 'rawDecimalBefore');
  const rawAfter = read(source, 'raw_decimal_after', 'rawDecimalAfter');
  return (rawBefore === null || typeof rawBefore === 'string') && (rawAfter === null || typeof rawAfter === 'string') && sourceTimeContext(read(source, 'time_context', 'timeContext')) && sourceRevisionValue(read(source, 'before'), fieldId) && sourceRevisionValue(read(source, 'after'), fieldId) && sourceStringArray(read(source, 'invalidated_result_ids', 'invalidatedResultIds')) && Array.isArray(oldResults) && oldResults.every((item) => sourceResultRecord(item, true));
}

function sourceShapeIsClosed(raw: Record<string, unknown>): boolean {
  const requiredTopLevel: readonly (readonly string[])[] = [
    ['session_revision_start', 'sessionRevisionStart'], ['session_revision_end', 'sessionRevisionEnd'], ['snapshot_revision', 'snapshotRevision'],
    ['snapshot_captured_at', 'snapshotCapturedAt'], ['application_build', 'applicationBuild'], ['ruleset'], ['currency_table', 'currencyTable'],
    ['dictionaries'], ['comparison_context', 'comparisonContext'], ['inputs'], ['results'], ['decision'], ['review'],
    ['confirmed_revisions', 'confirmedRevisions'], ['notices'],
  ];
  if (!requiredTopLevel.every((group) => hasAnyOwn(raw, ...group))) return false;
  if (!sourceTimeContext(read(raw, 'snapshot_captured_at', 'snapshotCapturedAt'))) return false;
  const build = read(raw, 'application_build', 'applicationBuild');
  if (!exactSourceKeys(build, ['app_version', 'appVersion', 'git_commit_sha', 'gitCommitSha', 'artifact_manifest_sha256', 'artifactManifestSha256', 'config_version', 'configVersion'], [
    ['app_version', 'appVersion'], ['git_commit_sha', 'gitCommitSha'], ['artifact_manifest_sha256', 'artifactManifestSha256'], ['config_version', 'configVersion'],
  ])) return false;
  const ruleset = read(raw, 'ruleset');
  if (!exactSourceKeys(ruleset, ['ruleset_id', 'rulesetId', 'ruleset_version', 'rulesetVersion', 'ruleset_ref', 'rulesetRef'], [
    ['ruleset_id', 'rulesetId'], ['ruleset_version', 'rulesetVersion'], ['ruleset_ref', 'rulesetRef'],
  ])) return false;
  const currency = read(raw, 'currency_table', 'currencyTable');
  if (!exactSourceKeys(currency, ['snapshot_id', 'snapshotId', 'source', 'published_on', 'publishedOn', 'read_on', 'readOn', 'bytes', 'sha256'], [
    ['snapshot_id', 'snapshotId'], ['source'], ['published_on', 'publishedOn'], ['read_on', 'readOn'], ['bytes'], ['sha256'],
  ])) return false;
  const dictionaries = read(raw, 'dictionaries');
  if (!sourceDictionaries(dictionaries)) return false;
  if (!Array.isArray(read(raw, 'notices')) || (read(raw, 'notices') as unknown[]).some((item) => !exactSourceKeys(item, ['code', 'text'], [['code'], ['text']]))) return false;
  const comparison = read(raw, 'comparison_context', 'comparisonContext');
  if (!exactSourceKeys(comparison, [
    'period_ref', 'periodRef', 'currency_code', 'currencyCode', 'currency_table_snapshot_id', 'currencyTableSnapshotId', 'tax_basis', 'taxBasis',
    'time_zone_id', 'timeZoneId', 'utc_offset', 'utcOffset', 'time_zone_source', 'timeZoneSource', 'time_zone_confirmation', 'timeZoneConfirmation',
    'source_input_ids', 'sourceInputIds',
  ], [
    ['period_ref', 'periodRef'], ['currency_code', 'currencyCode'], ['currency_table_snapshot_id', 'currencyTableSnapshotId'], ['tax_basis', 'taxBasis'],
    ['time_zone_id', 'timeZoneId'], ['utc_offset', 'utcOffset'], ['time_zone_source', 'timeZoneSource'], ['time_zone_confirmation', 'timeZoneConfirmation'],
    ['source_input_ids', 'sourceInputIds'],
  ])) return false;
  if (!sourcePeriodRef(read(comparison, 'period_ref', 'periodRef'))) return false;
  const inputs = read(raw, 'inputs');
  if (Array.isArray(inputs)) {
    if (inputs.length !== INPUT_FIELD_IDS.length || inputs.some((item) => !sourceInputRecord(item, true))) return false;
  } else if (isRecord(inputs)) {
    if (Object.keys(inputs).length !== INPUT_FIELD_IDS.length || Object.entries(inputs).some(([key, item]) => !INPUT_FIELD_IDS.includes((Object.entries({
      'comparison-period': 'comparisonPeriod', currency: 'currency', income: 'income', 'income-tax-basis': 'incomeTaxBasis', 'work-hours': 'workHours',
      'purchase-price': 'purchasePrice', 'purchase-period-inclusion': 'purchasePeriodInclusion', 'fixed-cost-total': 'fixedCostTotal', 'fixed-cost-coverage': 'fixedCostCoverage',
      'fixed-cost-coverage-description': 'fixedCostCoverageDescription', 'value-expectation': 'valueExpectation',
    }).find(([, alias]) => alias === key)?.[0] ?? key) as (typeof INPUT_FIELD_IDS)[number]) || !sourceInputRecord(item, false))) return false;
  } else return false;
  const results = read(raw, 'results');
  if (!Array.isArray(results) || results.length !== 5 || results.some((item) => !sourceResultRecord(item))) return false;
  const revisions = read(raw, 'confirmed_revisions', 'confirmedRevisions');
  if (!Array.isArray(revisions)) return false;
  if (revisions.some((item) => !sourceRevisionRecord(item))) return false;
  const decision = read(raw, 'decision');
  if (!exactSourceKeys(decision, ['availability', 'decision_code', 'decisionCode', 'code', 'evidence_status', 'evidenceStatus', 'rationale', 'confirmed_at', 'confirmedAt'], [
    ['availability'], ['decision_code', 'decisionCode', 'code'], ['evidence_status', 'evidenceStatus'], ['rationale'], ['confirmed_at', 'confirmedAt'],
  ])) return false;
  if (!sourceTextLike(read(decision, 'rationale'))) return false;
  if (isRecord(decision) && decision.availability === 'not-provided' && (read(decision, 'decision_code', 'decisionCode', 'code') !== null || read(decision, 'evidence_status', 'evidenceStatus') !== null || decision.rationale !== null || read(decision, 'confirmed_at', 'confirmedAt') !== null)) return false;
  const review = read(raw, 'review');
  if (!exactSourceKeys(review, ['availability', 'kind', 'local_date', 'localDate', 'condition_text', 'conditionText', 'evidence_status', 'evidenceStatus', 'confirmed_at', 'confirmedAt'], [
    ['availability'], ['kind'], ['local_date', 'localDate'], ['condition_text', 'conditionText'], ['evidence_status', 'evidenceStatus'], ['confirmed_at', 'confirmedAt'],
  ])) return false;
  if (!sourceLocalDateLike(read(review, 'local_date', 'localDate')) || !sourceTextLike(read(review, 'condition_text', 'conditionText'))) return false;
  if (isRecord(review) && review.availability === 'not-provided' && (review.kind !== null || read(review, 'local_date', 'localDate') !== null || read(review, 'condition_text', 'conditionText') !== null || read(review, 'evidence_status', 'evidenceStatus') !== null || read(review, 'confirmed_at', 'confirmedAt') !== null)) return false;
  return true;
}

function numericRevision(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    try {
      const parsed = BigInt(value);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return Number(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = clone(item);
    return copy as T;
  }
  return value;
}

function normalizeInput(value: unknown, fieldId: string): InputRecord {
  const source = (isRecord(value) ? value : {}) as Record<string, unknown>;
  const rawValue = read(source, 'value');
  const normalizedValue = normalizeInputValue(fieldId, rawValue, source);
  const normalizedPeriod = normalizePeriod(read(source, 'period_ref', 'periodRef')) ?? (normalizedValue?.kind === 'period-ref' ? { kind: normalizedValue.period_kind, custom_label: normalizedValue.custom_label, revision: normalizedValue.revision } : null);
  const normalizedCurrency = read(source, 'currency_code', 'currencyCode') ?? (normalizedValue?.kind === 'money' ? normalizedValue.currency_code : normalizedValue?.kind === 'enum' && fieldId === 'currency' ? normalizedValue.code : null);
  const normalizedTaxBasis = read(source, 'tax_basis', 'taxBasis') ?? (normalizedValue?.kind === 'enum' && fieldId === 'income-tax-basis' ? normalizedValue.code : null);
  const result = {
    field_id: fieldId,
    availability: read(source, 'availability') ?? 'not-provided',
    value: normalizedValue,
    source: read(source, 'source') ?? null,
    evidence_status: read(source, 'evidence_status', 'evidenceStatus') ?? null,
    unit: read(source, 'unit') ?? null,
    currency_code: normalizedCurrency,
    currency_table_snapshot_id: read(source, 'currency_table_snapshot_id', 'currencyTableSnapshotId') ?? null,
    period_ref: normalizedPeriod,
    tax_basis: normalizedTaxBasis,
    confirmed_at: read(source, 'confirmed_at', 'confirmedAt') ?? null,
    assumptions: read(source, 'assumptions') ?? [],
    limitations: read(source, 'limitations') ?? [],
  } as InputRecord;
  if (result.availability === 'not-provided') {
    result.value = null;
    result.source = null;
    result.evidence_status = null;
    result.unit = null;
    result.currency_code = null;
    result.confirmed_at = null;
    result.currency_table_snapshot_id = null;
    result.period_ref = null;
    result.tax_basis = null;
  }
  return result;
}

function normalizePeriod(value: unknown): InputRecord['period_ref'] {
  if (!isRecord(value)) return null;
  const rawKind = read(value, 'kind');
  const kind = rawKind === 'period-ref' ? read(value, 'period_kind', 'periodKind') : (rawKind ?? read(value, 'period_kind', 'periodKind'));
  const revision = read(value, 'revision');
  if (!['week', 'month', 'year', 'custom'].includes(String(kind)) || typeof revision !== 'string') return null;
  const customLabel = read(value, 'custom_label', 'customLabel');
  return { kind: kind as 'week' | 'month' | 'year' | 'custom', custom_label: typeof customLabel === 'string' ? customLabel : null, revision };
}

function normalizeInputValue(fieldId: string, value: unknown, source: Record<string, unknown>): InputRecord['value'] {
  if (value === null || value === undefined) value = read(source, 'raw');
  if (value === null || value === undefined) return null;
  if (isRecord(value)) {
    const kind = read(value, 'kind');
    if (kind === 'money' || 'minor_units' in value || 'minorUnits' in value) {
      const minorUnits = read(value, 'minor_units', 'minorUnits');
      const minorUnit = read(value, 'minor_unit', 'minorUnit');
      const currencyCode = read(value, 'currency_code', 'currencyCode') ?? read(source, 'currency_code', 'currencyCode');
      const minorUnitNumber = typeof minorUnit === 'number' && Number.isInteger(minorUnit)
        ? minorUnit
        : typeof minorUnit === 'string' && /^(0|2|3|4)$/.test(minorUnit)
          ? Number(minorUnit)
          : null;
      if ((typeof minorUnits === 'string' || typeof minorUnits === 'bigint') && minorUnitNumber !== null && [0, 2, 3, 4].includes(minorUnitNumber) && typeof currencyCode === 'string') {
        return { kind: 'money', minor_units: String(minorUnits), minor_unit: minorUnitNumber as 0 | 2 | 3 | 4, currency_code: currencyCode };
      }
    }
    if (kind === 'rational' || ('numerator' in value && 'denominator' in value)) {
      const numerator = read(value, 'numerator');
      const denominator = read(value, 'denominator');
      const unit = read(value, 'unit') ?? 'hour';
      if ((typeof numerator === 'string' || typeof numerator === 'bigint') && (typeof denominator === 'string' || typeof denominator === 'bigint') && typeof unit === 'string') return { kind: 'rational', numerator: String(numerator), denominator: String(denominator), unit };
    }
    if (kind === 'text' || 'text' in value) {
      const text = read(value, 'text');
      if (typeof text === 'string') return { kind: 'text', text, text_encoding: 'unicode-scalar-v1' };
    }
    if (kind === 'enum' || 'code' in value) {
      const code = read(value, 'code');
      if (typeof code === 'string') return { kind: 'enum', code };
    }
    if (kind === 'boolean' || typeof value.value === 'boolean') {
      return { kind: 'boolean', value: value.value as boolean };
    }
    const period = normalizePeriod(value);
    if (period) return { kind: 'period-ref', period_kind: period.kind, custom_label: period.custom_label, revision: period.revision };
    return null;
  }
  if (fieldId === 'currency' || fieldId === 'income-tax-basis' || fieldId === 'fixed-cost-coverage') return typeof value === 'string' ? { kind: 'enum', code: value } : null;
  if (fieldId === 'purchase-period-inclusion') return typeof value === 'boolean' ? { kind: 'boolean', value } : null;
  if (fieldId === 'comparison-period') {
    const period = normalizePeriod(value);
    return period ? { kind: 'period-ref', period_kind: period.kind, custom_label: period.custom_label, revision: period.revision } : null;
  }
  if (fieldId === 'fixed-cost-coverage-description' || fieldId === 'value-expectation') return typeof value === 'string' ? { kind: 'text', text: value, text_encoding: 'unicode-scalar-v1' } : null;
  if (['income', 'purchase-price', 'fixed-cost-total'].includes(fieldId) && typeof value === 'string') {
    const currencyCode = read(source, 'currency_code', 'currencyCode');
    const rawMinorUnit = read(source, 'minor_unit', 'minorUnit');
    const minorUnit = typeof rawMinorUnit === 'number' && Number.isInteger(rawMinorUnit)
      ? rawMinorUnit
      : typeof rawMinorUnit === 'string' && /^(0|2|3|4)$/.test(rawMinorUnit)
        ? Number(rawMinorUnit)
        : null;
    if (typeof currencyCode === 'string' && minorUnit !== null && [0, 2, 3, 4].includes(minorUnit)) {
      const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
      if (!match || (match[3] ?? '').length > minorUnit) return null;
      const fraction = (match[3] ?? '').padEnd(minorUnit, '0');
      const digits = `${match[1]}${match[2]}${fraction}`.replace(/^-?0+(?=\d)/, (prefix) => prefix.startsWith('-') ? '-' : '');
      return { kind: 'money', minor_units: digits || '0', minor_unit: minorUnit as 0 | 2 | 3 | 4, currency_code: currencyCode };
    }
  }
  if (fieldId === 'work-hours' && typeof value === 'string') {
    // The session domain normally supplies a normalized rational. If an
    // adapter supplies a raw decimal, parse it with BigInt only; Number and
    // exponentiation by a floating value would silently lose precision.
    if (value.length > 16) return null;
    const token = value.trim();
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/.exec(token);
    if (!match || match[1].length > 6) return null;
    const fraction = match[2] ?? '';
    try {
      let numerator = BigInt(`${match[1]}${fraction}`);
      let denominator = 10n ** BigInt(fraction.length);
      if (numerator <= 0n) return null;
      const gcd = (left: bigint, right: bigint): bigint => {
        let a = left < 0n ? -left : left;
        let b = right < 0n ? -right : right;
        while (b !== 0n) {
          const remainder = a % b;
          a = b;
          b = remainder;
        }
        return a;
      };
      const divisor = gcd(numerator, denominator);
      numerator /= divisor;
      denominator /= divisor;
      return { kind: 'rational', numerator: numerator.toString(), denominator: denominator.toString(), unit: 'hour' };
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeTimeContext(value: unknown): TimeContext | null {
  if (!isRecord(value)) return null;
  const result = {
    occurred_at_utc: read(value, 'occurred_at_utc', 'occurredAtUtc'),
    recorded_at_utc: read(value, 'recorded_at_utc', 'recordedAtUtc'),
    clock_source: read(value, 'clock_source', 'clockSource'),
    time_zone_id: read(value, 'time_zone_id', 'timeZoneId'),
    utc_offset: read(value, 'utc_offset', 'utcOffset'),
    time_zone_source: read(value, 'time_zone_source', 'timeZoneSource'),
    time_zone_confirmation: read(value, 'time_zone_confirmation', 'timeZoneConfirmation'),
  };
  return Object.values(result).every((item) => typeof item === 'string') ? result as TimeContext : null;
}

function normalizeDictionaryTexts(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value) || !sourceTextArray(value)) return [];
  return value.map((item) => ({ id: (item as Record<string, unknown>).id as string, text: (item as Record<string, unknown>).text as string }));
}

function normalizeExactResult(value: unknown): ResultRecord['exact_value'] {
  if (!isRecord(value)) return null;
  const rawDecimal = read(value, 'decimal');
  const unit = read(value, 'unit');
  if ((typeof rawDecimal !== 'string' && rawDecimal !== null) || typeof unit !== 'string') return null;
  const rawRational = read(value, 'rational');
  let rational: { numerator: string; denominator: string } | undefined;
  if (isRecord(rawRational) && (typeof rawRational.numerator === 'string' || typeof rawRational.numerator === 'bigint') && (typeof rawRational.denominator === 'string' || typeof rawRational.denominator === 'bigint')) {
    rational = { numerator: String(rawRational.numerator), denominator: String(rawRational.denominator) };
  }
  // Calculation adapters may carry a non-terminating exact value as
  // `numerator/denominator` in the decimal slot.  Normalize that notation to
  // the wire contract's explicit null decimal + rational pair; validation
  // still checks the rational is canonical and reduced.
  if (typeof rawDecimal === 'string' && /^-?(0|[1-9]\d*)\/[1-9]\d*$/.test(rawDecimal)) {
    const slash = rawDecimal.indexOf('/');
    if (!rational) rational = { numerator: rawDecimal.slice(0, slash), denominator: rawDecimal.slice(slash + 1) };
  }
  if (rawDecimal === null && !rational) return null;
  const result: NonNullable<ResultRecord['exact_value']> = {
    decimal: typeof rawDecimal === 'string' && !rawDecimal.includes('/') ? rawDecimal : null,
    unit,
    currency_code: (read(value, 'currency_code', 'currencyCode') as string | null | undefined) ?? null,
  };
  if (rational) result.rational = rational;
  const minorUnits = read(value, 'minor_units', 'minorUnits');
  if (typeof minorUnits === 'string' || typeof minorUnits === 'bigint') result.minor_units = String(minorUnits);
  return result;
}

function normalizeDisplayResult(value: unknown): ResultRecord['display_value'] {
  if (!isRecord(value)) return null;
  const text = read(value, 'text');
  const decimal = read(value, 'decimal');
  const digits = read(value, 'display_digits', 'displayDigits');
  const relation = read(value, 'relation');
  if (typeof text !== 'string' || typeof decimal !== 'string' || !Number.isInteger(digits) || !['exact', 'rounded', 'less-than'].includes(String(relation))) return null;
  return { text, decimal, display_digits: digits as number, relation: relation as 'exact' | 'rounded' | 'less-than' };
}

function normalizeResult(value: unknown): ResultRecord {
  const source = isRecord(value) ? value : {};
  const formulaId = String(read(source, 'formula_id', 'formulaId') ?? '');
  const exact = normalizeExactResult(read(source, 'exact_value', 'exact', 'exactValue'));
  const display = normalizeDisplayResult(read(source, 'display_value', 'display', 'displayValue'));
  const generated = normalizeTimeContext(read(source, 'generated_at', 'generatedAt', 'time_context', 'timeContext'));
  const rawAvailability = read(source, 'availability');
  const availability = (rawAvailability === 'unavailable' || rawAvailability === 'available' ? rawAvailability : '__invalid__') as ResultRecord['availability'];
  const rawRounding = read(source, 'rounding');
  const rounding = isRecord(rawRounding) ? {
    mode: read(rawRounding, 'mode') as 'half-away-from-zero',
    display_digits: read(rawRounding, 'display_digits', 'displayDigits') as number,
    rounded: read(rawRounding, 'rounded') as boolean,
  } : null;
  const rawEvidenceStatus = read(source, 'evidence_status', 'evidenceStatus');
  const rawPrimaryReason = read(source, 'primary_reason_code', 'primaryReasonCode');
  const dependencyFieldIds = read(source, 'dependency_field_ids', 'dependencyFieldIds') as string[];
  const estimatedDependencyFieldIds = read(source, 'estimated_dependency_field_ids', 'estimatedDependencyFieldIds') as string[];
  const reasonCodes = read(source, 'reason_codes', 'reasonCodes') as string[];
  return {
    formula_id: formulaId as ResultRecord['formula_id'],
    source: read(source, 'source') as ResultRecord['source'],
    availability,
    exact_value: exact,
    display_value: display,
    unit: (read(source, 'unit') as string | null | undefined) ?? null,
    currency_code: (read(source, 'currency_code', 'currencyCode') as string | null | undefined) ?? null,
    currency_table_snapshot_id: (read(source, 'currency_table_snapshot_id', 'currencyTableSnapshotId') as string | null | undefined) ?? null,
    period_ref: normalizePeriod(read(source, 'period_ref', 'periodRef')),
    tax_basis: (read(source, 'tax_basis', 'taxBasis') as 'before-tax' | 'after-tax' | null | undefined) ?? null,
    evidence_status: (typeof rawEvidenceStatus === 'string' ? rawEvidenceStatus : null) as ResultRecord['evidence_status'],
    dependency_field_ids: dependencyFieldIds,
    estimated_dependency_field_ids: estimatedDependencyFieldIds,
    reason_codes: reasonCodes,
    primary_reason_code: (rawPrimaryReason as string | null | undefined) ?? null,
    assumptions: normalizeDictionaryTexts(read(source, 'assumptions')),
    limitations: normalizeDictionaryTexts(read(source, 'limitations')),
    ruleset_ref: read(source, 'ruleset_ref', 'rulesetRef') as ResultRecord['ruleset_ref'],
    generated_at: generated as TimeContext,
    rounding,
  };
}

function normalizeDecision(value: unknown): ExportSnapshotV1['decision'] {
  const source = isRecord(value) ? value : {};
  const rawCode = read(source, 'decision_code', 'decisionCode', 'code');
  const availability = read(source, 'availability');
  const code = rawCode === 'purchase' ? 'buy' : rawCode === 'do-not-purchase' ? 'do-not-buy' : rawCode;
  const rationale = read(source, 'rationale');
  const rationaleValue = isRecord(rationale) && rationale.kind === 'text' && typeof rationale.text === 'string'
    ? { kind: 'text' as const, text: rationale.text, text_encoding: 'unicode-scalar-v1' as const }
    : typeof rationale === 'string' ? { kind: 'text' as const, text: rationale, text_encoding: 'unicode-scalar-v1' as const } : null;
  const confirmedAt = read(source, 'confirmed_at', 'confirmedAt');
  if (availability !== 'available') return { availability: availability as ExportSnapshotV1['decision']['availability'], decision_code: null, evidence_status: null, rationale: null, confirmed_at: null };
  return {
    availability: 'available',
    decision_code: ['buy', 'wait', 'adjust-conditions', 'do-not-buy', 'undecided'].includes(String(code)) ? code as ExportSnapshotV1['decision']['decision_code'] : null,
    evidence_status: read(source, 'evidence_status', 'evidenceStatus') as 'user-confirmed' | null,
    rationale: rationaleValue,
    confirmed_at: typeof confirmedAt === 'string' ? confirmedAt : null,
  };
}

function normalizeReview(value: unknown): ExportSnapshotV1['review'] {
  const source = isRecord(value) ? value : {};
  const availability = read(source, 'availability');
  if (availability !== 'available') return { availability: availability as ExportSnapshotV1['review']['availability'], kind: null, local_date: null, condition_text: null, evidence_status: null, confirmed_at: null };
  const kind = read(source, 'kind');
  const confirmedAt = read(source, 'confirmed_at', 'confirmedAt');
  if (kind === 'local-date') {
    const rawValue = read(source, 'local_date', 'localDate');
    const date = isRecord(rawValue) ? read(rawValue, 'value') : rawValue;
    return { availability: 'available', kind: 'local-date', local_date: typeof date === 'string' ? { kind: 'local-date', value: date } : null, condition_text: null, evidence_status: read(source, 'evidence_status', 'evidenceStatus') as 'user-confirmed' | null, confirmed_at: typeof confirmedAt === 'string' ? confirmedAt : null };
  }
  if (kind !== 'condition') return { availability: 'available', kind: kind as ExportSnapshotV1['review']['kind'], local_date: null, condition_text: null, evidence_status: read(source, 'evidence_status', 'evidenceStatus') as 'user-confirmed' | null, confirmed_at: typeof confirmedAt === 'string' ? confirmedAt : null };
  const rawValue = read(source, 'condition_text', 'conditionText');
  const text = isRecord(rawValue) && rawValue.kind === 'text' ? rawValue.text : rawValue;
  return { availability: 'available', kind: 'condition', local_date: null, condition_text: typeof text === 'string' ? { kind: 'text', text, text_encoding: 'unicode-scalar-v1' } : null, evidence_status: read(source, 'evidence_status', 'evidenceStatus') as 'user-confirmed' | null, confirmed_at: typeof confirmedAt === 'string' ? confirmedAt : null };
}

function normalizeRevisionValue(value: unknown, fieldId: string): ExportSnapshotV1['confirmed_revisions'][number]['before'] {
  const source = isRecord(value) ? value : {};
  const availability = read(source, 'availability');
  const normalizedValue = availability === 'available' ? normalizeInputValue(fieldId, read(source, 'value'), source) : null;
  return {
    availability: availability as ExportSnapshotV1['confirmed_revisions'][number]['before']['availability'],
    value: normalizedValue,
    evidence_status: availability === 'available' ? read(source, 'evidence_status', 'evidenceStatus') as 'user-confirmed' | 'estimated' | null : null,
    unit: availability === 'available' ? read(source, 'unit') as string | null : null,
    currency_code: availability === 'available' ? read(source, 'currency_code', 'currencyCode') as string | null : null,
    period_ref: availability === 'available' ? normalizePeriod(read(source, 'period_ref', 'periodRef')) : null,
  };
}

function normalizeOldResult(value: unknown): ExportSnapshotV1['confirmed_revisions'][number]['old_results'][number] {
  const source = (isRecord(value) ? value : {}) as Record<string, unknown>;
  const normalized = normalizeResult({
    ...source,
    source: 'ruleset-derived',
    availability: read(source, 'exact_value', 'exact', 'exactValue') === null ? 'unavailable' : 'available',
    dependency_field_ids: read(source, 'dependency_ids', 'dependencyIds'),
    estimated_dependency_field_ids: [],
    reason_codes: [],
    primary_reason_code: null,
    assumptions: [],
    limitations: [],
  });
  return {
    formula_id: normalized.formula_id,
    exact_value: normalized.exact_value,
    display_value: normalized.display_value,
    unit: normalized.unit,
    currency_code: normalized.currency_code,
    period_ref: normalized.period_ref,
    tax_basis: normalized.tax_basis,
    evidence_status: normalized.evidence_status,
    dependency_ids: normalized.dependency_field_ids,
    rounding: normalized.rounding,
    ruleset_ref: normalized.ruleset_ref,
    currency_table_snapshot_id: normalized.currency_table_snapshot_id,
    generated_at: normalized.generated_at,
  };
}

function normalizeRevision(value: unknown): ConfirmedRevision {
  const source = isRecord(value) ? value : {};
  const fieldId = String(read(source, 'field_id', 'fieldId') ?? '');
  const oldResultsRaw = read(source, 'old_results', 'oldResults');
  const sequence = numericRevision(source.sequence);
  return {
    sequence: sequence as number,
    event_type: read(source, 'event_type', 'eventType') as ConfirmedRevision['event_type'],
    event_status: read(source, 'event_status', 'eventStatus') as ConfirmedRevision['event_status'],
    actor: read(source, 'actor') as ConfirmedRevision['actor'],
    time_context: normalizeTimeContext(read(source, 'time_context', 'timeContext')) as TimeContext,
    field_id: fieldId,
    before: normalizeRevisionValue(read(source, 'before'), fieldId),
    after: normalizeRevisionValue(read(source, 'after'), fieldId),
    raw_decimal_before: read(source, 'raw_decimal_before', 'rawDecimalBefore') as string | null,
    raw_decimal_after: read(source, 'raw_decimal_after', 'rawDecimalAfter') as string | null,
    confirmed_at: read(source, 'confirmed_at', 'confirmedAt') as string,
    invalidated_result_ids: read(source, 'invalidated_result_ids', 'invalidatedResultIds') as string[],
    old_results: Array.isArray(oldResultsRaw) ? oldResultsRaw.map((item) => normalizeOldResult(item)) : [],
    ruleset_ref: read(source, 'ruleset_ref', 'rulesetRef') as ConfirmedRevision['ruleset_ref'],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBuild(value: unknown): ApplicationBuild | null {
  if (!isRecord(value)) return null;
  const appVersion = read(value, 'app_version', 'appVersion');
  const gitCommitSha = read(value, 'git_commit_sha', 'gitCommitSha');
  const artifactManifestSha = read(value, 'artifact_manifest_sha256', 'artifactManifestSha256');
  const configVersion = read(value, 'config_version', 'configVersion');
  if (typeof appVersion !== 'string' || typeof gitCommitSha !== 'string' || typeof artifactManifestSha !== 'string' || typeof configVersion !== 'string') return null;
  return {
    app_version: appVersion,
    git_commit_sha: gitCommitSha,
    artifact_manifest_sha256: artifactManifestSha,
    config_version: configVersion,
  };
}

function normalizeRuleset(value: unknown): ExportSnapshotV1['ruleset'] | null {
  if (!isRecord(value)) return null;
  return {
    ruleset_id: read(value, 'ruleset_id', 'rulesetId') as ExportSnapshotV1['ruleset']['ruleset_id'],
    ruleset_version: read(value, 'ruleset_version', 'rulesetVersion') as ExportSnapshotV1['ruleset']['ruleset_version'],
    ruleset_ref: read(value, 'ruleset_ref', 'rulesetRef') as ExportSnapshotV1['ruleset']['ruleset_ref'],
  };
}

function normalizeCurrencyTable(value: unknown): ExportSnapshotV1['currency_table'] | null {
  if (!isRecord(value)) return null;
  return {
    snapshot_id: read(value, 'snapshot_id', 'snapshotId') as string,
    source: read(value, 'source') as string,
    published_on: read(value, 'published_on', 'publishedOn') as string,
    read_on: read(value, 'read_on', 'readOn') as string,
    bytes: read(value, 'bytes') as number,
    sha256: read(value, 'sha256') as string,
  };
}

function normalizeComparisonContext(value: unknown): ComparisonContext {
  const source = isRecord(value) ? value : {};
  const period = read(source, 'period_ref', 'periodRef');
  const currency = read(source, 'currency_code', 'currencyCode');
  const table = read(source, 'currency_table_snapshot_id', 'currencyTableSnapshotId');
  const tax = read(source, 'tax_basis', 'taxBasis');
  const sourceInputIds = read(source, 'source_input_ids', 'sourceInputIds');
  return {
    period_ref: period as ComparisonContext['period_ref'],
    currency_code: currency as string | null,
    currency_table_snapshot_id: table as string | null,
    tax_basis: tax as ComparisonContext['tax_basis'],
    time_zone_id: read(source, 'time_zone_id', 'timeZoneId') as string | null,
    utc_offset: read(source, 'utc_offset', 'utcOffset') as string | null,
    time_zone_source: read(source, 'time_zone_source', 'timeZoneSource') as string | null,
    time_zone_confirmation: read(source, 'time_zone_confirmation', 'timeZoneConfirmation') as string | null,
    source_input_ids: sourceInputIds as string[],
  };
}

function normalizedNotices(value: unknown): Notice[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    code: String(isRecord(item) ? item.code ?? '' : ''),
    text: normalizeLineEndings(String(isRecord(item) ? item.text ?? '' : '')),
  }));
}

function normalizedDictionaries(value: unknown): Dictionaries {
  if (!isRecord(value)) return {} as Dictionaries;
  return clone(value as unknown as Dictionaries);
}

function freeTextBytes(snapshot: ExportSnapshotV1): number {
  let bytes = 0;
  const valueTextBytes = (value: unknown): number => {
    if (!isRecord(value)) return 0;
    if (value.kind === 'text' && typeof value.text === 'string') return utf8Bytes(value.text);
    return 0;
  };
  for (const input of snapshot.inputs) {
    bytes += valueTextBytes(input.value);
    if (input.period_ref?.custom_label) bytes += utf8Bytes(input.period_ref.custom_label);
  }
  if (snapshot.decision.rationale) bytes += utf8Bytes(snapshot.decision.rationale.text);
  if (snapshot.review.condition_text) bytes += utf8Bytes(snapshot.review.condition_text.text);
  for (const revision of snapshot.confirmed_revisions) {
    bytes += valueTextBytes(revision.before.value);
    bytes += valueTextBytes(revision.after.value);
    if (revision.before.period_ref?.custom_label) bytes += utf8Bytes(revision.before.period_ref.custom_label);
    if (revision.after.period_ref?.custom_label) bytes += utf8Bytes(revision.after.period_ref.custom_label);
  }
  return bytes;
}

/**
 * Render the compact JSON-equivalent used by the snapshot resource gate.  The
 * serializer itself is pretty printed, but the ADR measures the equivalent
 * fixed-order JSON without indentation.  Keeping this renderer here avoids a
 * snapshot -> JSON -> snapshot module cycle while still using exactly the
 * wire escaping rules (including long control escapes rather than JSON's
 * short `\n`/`\t` forms).
 */
function canonicalJsonString(value: string): string {
  let result = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) as number;
    if (code > 0xffff) index += 1;
    if (code === 0x22) result += '\\"';
    else if (code === 0x5c) result += '\\\\';
    else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x2028 && code <= 0x2029) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f) {
      result += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
    } else {
      result += String.fromCodePoint(code);
    }
  }
  return `${result}"`;
}

function canonicalJsonCompact(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return canonicalJsonString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite-number');
    return String(value);
  }
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') throw new Error('unsupported-json-value');
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJsonCompact(item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).map(([key, item]) => `${canonicalJsonString(key)}:${canonicalJsonCompact(item)}`).join(',')}}`;
  }
  throw new Error('unsupported-json-value');
}

function snapshotEstimateBytes(snapshot: ExportSnapshotV1): number {
  try {
    const wire = {
      schema_name: snapshot.schema_name,
      schema_version: snapshot.schema_version,
      format_name: 'json',
      format_version: '1.0.0',
      snapshot_scope: snapshot.snapshot_scope,
      history_scope: snapshot.history_scope,
      snapshot_revision: snapshot.snapshot_revision,
      snapshot_captured_at: snapshot.snapshot_captured_at,
      file_generated_at: snapshot.snapshot_captured_at,
      application_build: snapshot.application_build,
      ruleset: snapshot.ruleset,
      currency_table: snapshot.currency_table,
      dictionaries: snapshot.dictionaries,
      comparison_context: snapshot.comparison_context,
      inputs: snapshot.inputs,
      results: snapshot.results,
      decision: snapshot.decision,
      review: snapshot.review,
      confirmed_revisions: snapshot.confirmed_revisions,
      notices: snapshot.notices,
    };
    return utf8Bytes(canonicalJsonCompact(wire));
  } catch {
    return EXPORT_LIMITS.snapshot_utf8_bytes + 1;
  }
}

const lifecycleBySnapshot = new WeakMap<object, SnapshotLifecycle>();

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, visited);
  return Object.freeze(value);
}

function withLifecycle(snapshot: ExportSnapshotV1, lifecycle: SnapshotLifecycle): ExportSnapshotV1 {
  lifecycleBySnapshot.set(snapshot, lifecycle);
  const descriptor = Object.getOwnPropertyDescriptor(snapshot, 'lifecycle');
  if (!descriptor?.get && descriptor?.configurable !== false) {
    Object.defineProperty(snapshot, 'lifecycle', {
      configurable: false,
      enumerable: false,
      get: () => lifecycleBySnapshot.get(snapshot) ?? lifecycle,
    });
  }
  return snapshot;
}

export function isSnapshotStale(snapshot: ExportSnapshotV1, currentSessionRevision: number): boolean {
  return (lifecycleBySnapshot.get(snapshot) ?? snapshot.lifecycle) === 'stale' || snapshot.snapshot_revision !== currentSessionRevision;
}

export function markSnapshotStale(snapshot: ExportSnapshotV1): ExportSnapshotV1 {
  return withLifecycle(snapshot, 'stale');
}

export function assertSnapshotFresh(snapshot: ExportSnapshotV1, currentSessionRevision: number): ExportResult<void> {
  return isSnapshotStale(snapshot, currentSessionRevision) ? fail('export-snapshot-stale') : success(undefined);
}

export function freezeExportSnapshot(source: ExportSnapshotSource): ExportResult<ExportSnapshotV1> {
  const raw = source as unknown as Record<string, unknown>;
  if (!isRecord(raw) || hasConflictingSourceAliases(raw)) return fail('export-schema-mismatch');
  if (aliasedRevisionConflict(raw)) return fail('export-schema-mismatch');
  const start = numericRevision(read(raw, 'session_revision_start', 'sessionRevisionStart', 'session_revision', 'sessionRevision'));
  const end = numericRevision(read(raw, 'session_revision_end', 'sessionRevisionEnd', 'session_revision', 'sessionRevision'));
  if (start === null || end === null) return fail('export-required-metadata-missing');
  if (start !== end) return fail('export-snapshot-stale');
  const sessionRevisionAliases = ['session_revision', 'sessionRevision'].filter((key) => hasOwn(raw, key)).map((key) => numericRevision(raw[key]));
  if (sessionRevisionAliases.length > 0 && (sessionRevisionAliases.some((value) => value === null) || sessionRevisionAliases.some((value) => value !== sessionRevisionAliases[0]) || sessionRevisionAliases[0] !== start)) {
    return fail('export-schema-mismatch');
  }
  const lifecycle = validateLifecycleIndicators(raw);
  if (!lifecycle.ok) return lifecycle;
  if (Object.keys(raw).some((key) => !SOURCE_TOP_LEVEL_KEYS.has(key))) return fail('export-schema-mismatch');
  const rawRevisionCount = read(raw, 'confirmed_revisions', 'confirmedRevisions');
  if (Array.isArray(rawRevisionCount) && rawRevisionCount.length > EXPORT_LIMITS.confirmed_revisions) return fail('export-resource-limit-exceeded');
  if (Array.isArray(rawRevisionCount) && rawRevisionCount.some((revision) => isRecord(revision) && Array.isArray(read(revision, 'old_results', 'oldResults')) && (read(revision, 'old_results', 'oldResults') as unknown[]).length > EXPORT_LIMITS.old_results_per_revision)) return fail('export-resource-limit-exceeded');
  if (!sourceShapeIsClosed(raw)) return fail('export-schema-mismatch');

  const unicodeCheck = preflightUnicode(source);
  if (!unicodeCheck.ok) return unicodeCheck;
  let normalized: Record<string, unknown>;
  try {
    normalized = normalizeUnicodeTree(clone(source)) as unknown as Record<string, unknown>;
  } catch {
    return fail('export-schema-mismatch');
  }
  const build = normalizeBuild(read(normalized, 'application_build', 'applicationBuild'));
  const currencyTable = normalizeCurrencyTable(read(normalized, 'currency_table', 'currencyTable'));
  const ruleset = normalizeRuleset(read(normalized, 'ruleset'));
  if (!build || !currencyTable || !ruleset) return fail('export-required-metadata-missing');
  const rawDictionaries = read(normalized, 'dictionaries');
  if (rawDictionaries !== undefined && !isRecord(rawDictionaries)) return fail('export-schema-mismatch');
  const captured = normalizeTimeContext(read(normalized, 'snapshot_captured_at', 'snapshotCapturedAt'));
  if (!captured || !emptyTimeContext(captured)) return fail('export-required-metadata-missing');

  const inputAliases: Record<string, string> = {
    'comparison-period': 'comparisonPeriod',
    currency: 'currency',
    income: 'income',
    'income-tax-basis': 'incomeTaxBasis',
    'work-hours': 'workHours',
    'purchase-price': 'purchasePrice',
    'purchase-period-inclusion': 'purchasePeriodInclusion',
    'fixed-cost-total': 'fixedCostTotal',
    'fixed-cost-coverage': 'fixedCostCoverage',
    'fixed-cost-coverage-description': 'fixedCostCoverageDescription',
    'value-expectation': 'valueExpectation',
  };
  const rawInputs = read(normalized, 'inputs');
  const inputById = new Map<string, unknown>();
  if (Array.isArray(rawInputs)) {
    const seenInputIds = new Set<string>();
    for (const item of rawInputs) {
      if (!isRecord(item)) return fail('export-schema-mismatch');
      const fieldId = read(item, 'field_id', 'fieldId');
      if (typeof fieldId !== 'string' || !INPUT_FIELD_IDS.includes(fieldId as (typeof INPUT_FIELD_IDS)[number]) || seenInputIds.has(fieldId)) return fail('export-schema-mismatch');
      seenInputIds.add(fieldId);
      inputById.set(fieldId, item);
    }
  } else if (isRecord(rawInputs)) {
    const seenCanonicalInputIds = new Set<string>();
    for (const [key, value] of Object.entries(rawInputs)) {
      const canonicalId = INPUT_FIELD_IDS.find((fieldId) => fieldId === key || inputAliases[fieldId] === key);
      if (!canonicalId || seenCanonicalInputIds.has(canonicalId)) return fail('export-schema-mismatch');
      seenCanonicalInputIds.add(canonicalId);
      inputById.set(key, value);
    }
  }
  const inputs = INPUT_FIELD_IDS.map((fieldId) => normalizeInput(inputById.get(fieldId) ?? (inputById.get(inputAliases[fieldId]) ?? null), fieldId));
  if (!inputs.some((input) => input.availability === 'available' && (input.evidence_status === 'user-confirmed' || input.evidence_status === 'estimated'))) return fail('export-no-input');

  const results = read(normalized, 'results');
  if (!Array.isArray(results) || results.length !== 5) return fail('export-schema-mismatch');
  if (results.some((result) => {
    if (!isRecord(result) || normalizeTimeContext(read(result, 'generated_at', 'generatedAt', 'time_context', 'timeContext')) === null) return true;
    const availability = read(result, 'availability');
    const rounding = read(result, 'rounding');
    return (availability !== 'available' && availability !== 'unavailable') ||
      (availability === 'unavailable' && rounding !== undefined && rounding !== null);
  })) return fail('export-schema-mismatch');
  const rawRevisions = read(normalized, 'confirmed_revisions', 'confirmedRevisions');
  if (rawRevisions !== undefined && !Array.isArray(rawRevisions)) return fail('export-schema-mismatch');
  if (Array.isArray(rawRevisions)) {
    if (rawRevisions.length > EXPORT_LIMITS.confirmed_revisions) return fail('export-resource-limit-exceeded');
    for (const revision of rawRevisions) {
      if (!isRecord(revision) || normalizeTimeContext(read(revision, 'time_context', 'timeContext')) === null || typeof read(revision, 'confirmed_at', 'confirmedAt') !== 'string') return fail('export-schema-mismatch');
      const oldResults = read(revision, 'old_results', 'oldResults');
      if (Array.isArray(oldResults) && oldResults.length > EXPORT_LIMITS.old_results_per_revision) return fail('export-resource-limit-exceeded');
      if (Array.isArray(oldResults) && oldResults.some((oldResult) => !isRecord(oldResult) || normalizeTimeContext(read(oldResult, 'generated_at', 'generatedAt', 'time_context', 'timeContext')) === null)) return fail('export-schema-mismatch');
    }
  }

  const suppliedSnapshotRevision = read(normalized, 'snapshot_revision', 'snapshotRevision');
  if (suppliedSnapshotRevision !== undefined && numericRevision(suppliedSnapshotRevision) !== start) return fail('export-schema-mismatch');
  const snapshotRevision = start;
  const snapshot: ExportSnapshotV1 = {
    schema_name: SCHEMA_NAME,
    schema_version: SCHEMA_VERSION,
    format_name: 'json',
    format_version: '1.0.0',
    snapshot_scope: SNAPSHOT_SCOPE,
    history_scope: HISTORY_SCOPE,
    snapshot_revision: snapshotRevision,
    snapshot_captured_at: captured,
    application_build: build,
    ruleset: ruleset as unknown as ExportSnapshotV1['ruleset'],
    currency_table: currencyTable as unknown as ExportSnapshotV1['currency_table'],
    dictionaries: normalizedDictionaries(rawDictionaries),
    comparison_context: normalizeComparisonContext(read(normalized, 'comparison_context', 'comparisonContext')),
    inputs,
    results: results.map((result) => {
      return normalizeResult(result);
    }),
    decision: normalizeDecision(read(normalized, 'decision')),
    review: normalizeReview(read(normalized, 'review')),
    confirmed_revisions: Array.isArray(rawRevisions) ? rawRevisions.map((item) => normalizeRevision(item)) : [],
    notices: normalizedNotices(read(normalized, 'notices')),
    lifecycle: 'fresh',
  };
  withLifecycle(snapshot, 'fresh');

  if (snapshot.confirmed_revisions.length > EXPORT_LIMITS.confirmed_revisions || snapshot.confirmed_revisions.some((revision) => !Array.isArray(revision.old_results) || revision.old_results.length > EXPORT_LIMITS.old_results_per_revision)) return fail('export-resource-limit-exceeded');
  const measuredFreeText = freeTextBytes(snapshot);
  const measuredSnapshot = snapshotEstimateBytes(snapshot);
  if (measuredFreeText > EXPORT_LIMITS.free_text_utf8_bytes || measuredSnapshot > EXPORT_LIMITS.snapshot_utf8_bytes) return fail('export-resource-limit-exceeded');
  const structural = validateWireSnapshot({
    schema_name: snapshot.schema_name,
    schema_version: snapshot.schema_version,
    format_name: snapshot.format_name,
    format_version: snapshot.format_version,
    snapshot_scope: snapshot.snapshot_scope,
    history_scope: snapshot.history_scope,
    snapshot_revision: snapshot.snapshot_revision,
    snapshot_captured_at: snapshot.snapshot_captured_at,
    file_generated_at: snapshot.snapshot_captured_at,
    application_build: snapshot.application_build,
    ruleset: snapshot.ruleset,
    currency_table: snapshot.currency_table,
    dictionaries: snapshot.dictionaries,
    comparison_context: snapshot.comparison_context,
    inputs: snapshot.inputs,
    results: snapshot.results,
    decision: snapshot.decision,
    review: snapshot.review,
    confirmed_revisions: snapshot.confirmed_revisions,
    notices: snapshot.notices,
  });
  return structural.ok ? success(deepFreeze(snapshot)) : fail(structural.error.code);
}
