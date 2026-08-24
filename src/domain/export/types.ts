/**
 * The export domain is deliberately independent of React and the browser.
 * Values in this file are the snake_case wire model defined by ADR-0003.
 * The session layer may adapt its own camelCase model at this boundary.
 */

export type Availability = 'available' | 'not-provided';
export type ResultAvailability = 'available' | 'unavailable';
export type EvidenceStatus =
  | 'actual'
  | 'user-confirmed'
  | 'estimated'
  | 'forecast'
  | 'insufficient-data';
export type ProductEvidenceStatus = Exclude<EvidenceStatus, 'actual'>;
export type SourceCode = 'user-input' | 'ruleset-derived' | 'system-event';
export type DecisionCode =
  | 'buy'
  | 'wait'
  | 'adjust-conditions'
  | 'do-not-buy'
  | 'undecided';
export type ResultRelation = 'exact' | 'rounded' | 'less-than';
export type DownloadFormat = 'json' | 'markdown';
export type DownloadState =
  | 'idle'
  | 'previewing'
  | 'ready'
  | 'generating'
  | 'download-requested'
  | 'failed'
  | 'cancelled';
export type SnapshotLifecycle = 'fresh' | 'stale';

export interface TimeContext {
  occurred_at_utc: string;
  recorded_at_utc: string;
  clock_source: string;
  time_zone_id: string;
  utc_offset: string;
  time_zone_source: string;
  time_zone_confirmation: string;
}

export interface PeriodRef {
  kind: 'week' | 'month' | 'year' | 'custom';
  custom_label: string | null;
  revision: string;
}

export interface MoneyValue {
  kind: 'money';
  minor_units: string;
  minor_unit: 0 | 2 | 3 | 4;
  currency_code: string;
}

export interface RationalValue {
  kind: 'rational';
  numerator: string;
  denominator: string;
  unit: string;
}

export interface TextValue {
  kind: 'text';
  text: string;
  text_encoding: 'unicode-scalar-v1';
}

export interface EnumValue {
  kind: 'enum';
  code: string;
}

export interface BooleanValue {
  kind: 'boolean';
  value: boolean;
}

export interface LocalDateValue {
  kind: 'local-date';
  value: string;
}

export interface PeriodRefValue {
  kind: 'period-ref';
  period_kind: PeriodRef['kind'];
  custom_label: string | null;
  revision: string;
}

export type InputValue =
  | MoneyValue
  | RationalValue
  | TextValue
  | EnumValue
  | BooleanValue
  | LocalDateValue
  | PeriodRefValue;

export interface DictionaryText {
  id: string;
  text: string;
}

/** Stable build-defined dictionary entry used by the self-describing wire contract. */
export interface DictionaryEntry {
  id: string;
  label: string;
  definition: string;
}

export interface FieldDefinition extends DictionaryEntry {
  value_kind: InputValue['kind'];
  product_requirement: string;
  unit_semantics: string;
  sensitive: boolean;
}

export interface FormulaDefinition extends DictionaryEntry {
  expression: string;
  dependency_field_ids: string[];
  result_unit_semantics: string;
}

export interface InputRecord {
  field_id: string;
  availability: Availability;
  value: InputValue | null;
  source: SourceCode | null;
  evidence_status: ProductEvidenceStatus | null;
  unit: string | null;
  currency_code: string | null;
  currency_table_snapshot_id: string | null;
  period_ref: PeriodRef | null;
  tax_basis: 'before-tax' | 'after-tax' | null;
  confirmed_at: string | null;
  assumptions: DictionaryText[];
  limitations: DictionaryText[];
}

export interface ExactResultValue {
  /** Canonical terminating decimal, or null when rational is the exact form. */
  decimal: string | null;
  /** Optional exact rational representation for non-terminating division. */
  rational?: {
    numerator: string;
    denominator: string;
  };
  /** Optional exact money representation. */
  minor_units?: string;
  currency_code?: string | null;
  unit: string;
}

export interface DisplayValue {
  text: string;
  decimal: string;
  display_digits: number;
  relation: ResultRelation;
}

export interface RoundingMetadata {
  mode: 'half-away-from-zero';
  display_digits: number;
  rounded: boolean;
}

export interface ResultRecord {
  formula_id: string;
  source: 'ruleset-derived';
  availability: ResultAvailability;
  exact_value: ExactResultValue | null;
  display_value: DisplayValue | null;
  unit: string | null;
  currency_code: string | null;
  currency_table_snapshot_id: string | null;
  period_ref: PeriodRef | null;
  tax_basis: 'before-tax' | 'after-tax' | null;
  evidence_status: ProductEvidenceStatus;
  dependency_field_ids: string[];
  estimated_dependency_field_ids: string[];
  reason_codes: string[];
  primary_reason_code: string | null;
  assumptions: DictionaryText[];
  limitations: DictionaryText[];
  ruleset_ref: 'purchase-decision-rules@1.0.0';
  generated_at: TimeContext;
  rounding: RoundingMetadata | null;
}

export interface DecisionRecord {
  availability: Availability;
  decision_code: DecisionCode | null;
  evidence_status: 'user-confirmed' | null;
  rationale: TextValue | null;
  confirmed_at: string | null;
}

export interface ReviewRecord {
  availability: Availability;
  kind: 'local-date' | 'condition' | null;
  local_date: LocalDateValue | null;
  condition_text: TextValue | null;
  evidence_status: 'user-confirmed' | null;
  confirmed_at: string | null;
}

export interface RevisionValue {
  availability: Availability;
  value: InputValue | null;
  evidence_status: ProductEvidenceStatus | null;
  unit: string | null;
  currency_code: string | null;
  period_ref: PeriodRef | null;
}

export interface OldResultSnapshot {
  formula_id: string;
  exact_value: ExactResultValue | null;
  display_value: DisplayValue | null;
  unit: string | null;
  currency_code: string | null;
  period_ref: PeriodRef | null;
  tax_basis: 'before-tax' | 'after-tax' | null;
  evidence_status: ProductEvidenceStatus;
  dependency_ids: string[];
  rounding: RoundingMetadata | null;
  ruleset_ref: 'purchase-decision-rules@1.0.0';
  currency_table_snapshot_id: string | null;
  generated_at: TimeContext;
}

export interface ConfirmedRevision {
  sequence: number;
  event_type: 'confirmed-input-revision';
  event_status: 'actual';
  actor: 'user';
  time_context: TimeContext;
  field_id: string;
  before: RevisionValue;
  after: RevisionValue;
  raw_decimal_before: string | null;
  raw_decimal_after: string | null;
  confirmed_at: string;
  invalidated_result_ids: string[];
  old_results: OldResultSnapshot[];
  ruleset_ref: 'purchase-decision-rules@1.0.0';
}

export interface ApplicationBuild {
  app_version: string;
  git_commit_sha: string;
  artifact_manifest_sha256: string;
  config_version: string;
}

export interface Ruleset {
  ruleset_id: 'purchase-decision-rules';
  ruleset_version: '1.0.0';
  ruleset_ref: 'purchase-decision-rules@1.0.0';
}

export interface CurrencyTable {
  snapshot_id: string;
  source: string;
  published_on: string;
  read_on: string;
  bytes: number;
  sha256: string;
}

export interface ComparisonContext {
  period_ref: PeriodRef | null;
  currency_code: string | null;
  currency_table_snapshot_id: string | null;
  tax_basis: 'before-tax' | 'after-tax' | null;
  time_zone_id: string | null;
  utc_offset: string | null;
  time_zone_source: string | null;
  time_zone_confirmation: string | null;
  source_input_ids: string[];
}

export interface Dictionaries {
  schema_fields: DictionaryEntry[];
  value_kinds: DictionaryEntry[];
  field_definitions: FieldDefinition[];
  formula_definitions: FormulaDefinition[];
  evidence_statuses: DictionaryEntry[];
  availability_codes: DictionaryEntry[];
  source_codes: DictionaryEntry[];
  reason_codes: DictionaryEntry[];
  decision_codes: DictionaryEntry[];
  notice_codes: DictionaryEntry[];
}

export interface Notice {
  code: string;
  text: string;
}

export interface ExportSnapshotV1 {
  schema_name: 'zhiguan.purchase-decision.session-snapshot';
  schema_version: '1.0.0';
  format_name: 'json';
  format_version: '1.0.0';
  snapshot_scope: 'current-session-current-snapshot';
  history_scope: 'current-session-confirmed-revisions';
  snapshot_revision: number;
  snapshot_captured_at: TimeContext;
  application_build: ApplicationBuild;
  ruleset: Ruleset;
  currency_table: CurrencyTable;
  dictionaries: Dictionaries;
  comparison_context: ComparisonContext;
  inputs: InputRecord[];
  results: ResultRecord[];
  decision: DecisionRecord;
  review: ReviewRecord;
  confirmed_revisions: ConfirmedRevision[];
  notices: Notice[];
  /** Internal lifecycle marker. It is intentionally non-enumerable on instances. */
  readonly lifecycle: SnapshotLifecycle;
}

export interface ExportSnapshotSource
  extends Omit<
    ExportSnapshotV1,
    | 'schema_name'
    | 'schema_version'
    | 'format_name'
    | 'format_version'
    | 'snapshot_scope'
    | 'history_scope'
    | 'lifecycle'
    | 'dictionaries'
    | 'notices'
  > {
  session_revision?: number | string;
  session_revision_start?: number | string;
  session_revision_end?: number | string;
  pending_edit?: boolean;
  stale?: boolean;
  dictionaries?: Dictionaries;
  notices?: Notice[];
}

export interface SerializedExport {
  format: DownloadFormat;
  mime: string;
  file_name: string;
  text: string;
  bytes: number;
  /** The semantic snapshot used to produce the representation. */
  snapshot_revision: number;
  snapshot_captured_at: TimeContext;
}

export interface ExportError {
  code:
    | 'export-no-input'
    | 'export-pending-edit'
    | 'export-snapshot-stale'
    | 'export-schema-mismatch'
    | 'export-required-metadata-missing'
    | 'export-invalid-unicode'
    | 'export-resource-limit-exceeded'
    | 'export-serialization-failed'
    | 'export-blob-creation-failed'
    | 'export-download-request-failed'
    | 'export-resource-cleanup-failed'
    | 'export-unsupported-browser'
    | 'export-contract-breach';
  message: string;
}

export type ExportResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExportError };
