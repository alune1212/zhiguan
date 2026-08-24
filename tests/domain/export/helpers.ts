import { CURRENCY_TABLE_BYTES, CURRENCY_TABLE_PUBLISHED_ON, CURRENCY_TABLE_READ_ON, CURRENCY_TABLE_SHA256, CURRENCY_TABLE_SNAPSHOT_ID, DEFAULT_DICTIONARIES, DEFAULT_NOTICES, RESULT_DEPENDENCY_FIELD_IDS } from '../../../src/domain/export/constants';
import type { ExportSnapshotSource, InputRecord, ResultRecord, TimeContext } from '../../../src/domain/export/types';

export const FIXTURE_TIME: TimeContext = {
  occurred_at_utc: '2026-01-15T00:00:00.000Z',
  recorded_at_utc: '2026-01-15T00:00:00.000Z',
  clock_source: 'fixture-explicit',
  time_zone_id: 'Etc/UTC',
  utc_offset: '+00:00',
  time_zone_source: 'fixture',
  time_zone_confirmation: 'confirmed',
};

const PERIOD = { kind: 'month' as const, custom_label: null, revision: 'synthetic-period-r1' };

function input(field_id: string, value: InputRecord['value'], unit: string | null, options: Partial<InputRecord> = {}): InputRecord {
  return {
    field_id,
    availability: value === null ? 'not-provided' : 'available',
    value,
    source: value === null ? null : 'user-input',
    evidence_status: value === null ? null : 'user-confirmed',
    unit,
    currency_code: value?.kind === 'money' ? value.currency_code : null,
    currency_table_snapshot_id: value === null ? null : CURRENCY_TABLE_SNAPSHOT_ID,
    period_ref: ['income', 'work-hours', 'purchase-price', 'fixed-cost-total'].includes(field_id) ? PERIOD : null,
    tax_basis: ['income', 'fixed-cost-total'].includes(field_id) ? 'after-tax' : null,
    confirmed_at: value === null ? null : FIXTURE_TIME.recorded_at_utc,
    assumptions: [],
    limitations: [],
    ...options,
  };
}

function availableResult(formula_id: ResultRecord['formula_id'], decimal: string, unit: string, currency_code: string | null, evidence_status: ResultRecord['evidence_status'] = 'user-confirmed'): ResultRecord {
  return {
    formula_id,
    source: 'ruleset-derived',
    availability: 'available',
    exact_value: { decimal, unit, currency_code },
    display_value: { text: `${decimal} ${unit}`, decimal, display_digits: 2, relation: 'exact' },
    unit,
    currency_code,
    currency_table_snapshot_id: currency_code ? CURRENCY_TABLE_SNAPSHOT_ID : null,
    period_ref: PERIOD,
    tax_basis: 'after-tax',
    evidence_status,
    dependency_field_ids: [...RESULT_DEPENDENCY_FIELD_IDS[formula_id]],
    estimated_dependency_field_ids: [],
    reason_codes: [],
    primary_reason_code: null,
    assumptions: [],
    limitations: formula_id === 'work-time-equivalent'
      ? [{ id: 'work-time-equivalent.limitation-1', text: '这是工作时间比较，不代表体验本身的价值。' }]
      : [],
    ruleset_ref: 'purchase-decision-rules@1.0.0',
    generated_at: FIXTURE_TIME,
    rounding: { mode: 'half-away-from-zero', display_digits: 2, rounded: false },
  };
}

export function makeExportSource(overrides: Record<string, unknown> = {}): ExportSnapshotSource {
  const inputs: InputRecord[] = [
    input('comparison-period', { kind: 'period-ref', period_kind: 'month', custom_label: null, revision: PERIOD.revision }, 'period'),
    input('currency', { kind: 'enum', code: 'CNY' }, 'currency'),
    input('income', { kind: 'money', minor_units: '1000000', minor_unit: 2, currency_code: 'CNY' }, 'CNY'),
    input('income-tax-basis', { kind: 'enum', code: 'after-tax' }, 'tax-basis'),
    input('work-hours', { kind: 'rational', numerator: '160', denominator: '1', unit: 'hour' }, 'hour'),
    input('purchase-price', { kind: 'money', minor_units: '100000', minor_unit: 2, currency_code: 'CNY' }, 'CNY'),
    input('purchase-period-inclusion', { kind: 'boolean', value: true }, 'period-inclusion'),
    input('fixed-cost-total', { kind: 'money', minor_units: '600000', minor_unit: 2, currency_code: 'CNY' }, 'CNY'),
    input('fixed-cost-coverage', { kind: 'enum', code: 'complete' }, 'coverage'),
    input('fixed-cost-coverage-description', { kind: 'text', text: '合成完整覆盖。', text_encoding: 'unicode-scalar-v1' }, 'text'),
    input('value-expectation', { kind: 'text', text: 'pipe | ``` <script>alert(1)</script> link https://example.invalid', text_encoding: 'unicode-scalar-v1' }, 'text'),
  ];
  const results = [
    availableResult('income-rate', '62.5', 'CNY/hour', 'CNY'),
    availableResult('work-time-equivalent', '16', 'hour', null),
    availableResult('coverage-available-margin', '4000', 'CNY', 'CNY'),
    availableResult('purchase-after-margin', '3000', 'CNY', 'CNY', 'forecast'),
    availableResult('purchase-impact', '-1000', 'CNY', 'CNY', 'forecast'),
  ];
  return {
    session_revision: 1,
    session_revision_start: 1,
    session_revision_end: 1,
    snapshot_revision: 1,
    snapshot_captured_at: FIXTURE_TIME,
    application_build: {
      app_version: '0.1.0',
      git_commit_sha: 'a'.repeat(40),
      artifact_manifest_sha256: 'b'.repeat(64),
      config_version: 'research-static-config@1.0.0',
    },
    ruleset: { ruleset_id: 'purchase-decision-rules', ruleset_version: '1.0.0', ruleset_ref: 'purchase-decision-rules@1.0.0' },
    currency_table: {
      snapshot_id: CURRENCY_TABLE_SNAPSHOT_ID,
      source: 'synthetic fixture currency snapshot',
      published_on: CURRENCY_TABLE_PUBLISHED_ON,
      read_on: CURRENCY_TABLE_READ_ON,
      bytes: CURRENCY_TABLE_BYTES,
      sha256: CURRENCY_TABLE_SHA256,
    },
    dictionaries: DEFAULT_DICTIONARIES,
    comparison_context: {
      period_ref: PERIOD,
      currency_code: 'CNY',
      currency_table_snapshot_id: CURRENCY_TABLE_SNAPSHOT_ID,
      tax_basis: 'after-tax',
      time_zone_id: 'Etc/UTC',
      utc_offset: '+00:00',
      time_zone_source: 'fixture',
      time_zone_confirmation: 'confirmed',
      source_input_ids: [],
    },
    inputs,
    results,
    decision: { availability: 'not-provided', decision_code: null, evidence_status: null, rationale: null, confirmed_at: null },
    review: { availability: 'not-provided', kind: null, local_date: null, condition_text: null, evidence_status: null, confirmed_at: null },
    confirmed_revisions: [],
    notices: DEFAULT_NOTICES,
    ...overrides,
  } as unknown as ExportSnapshotSource;
}
