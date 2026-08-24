/**
 * The calculation domain deliberately uses strings for values which cross a
 * serialization boundary and bigint for values which participate in domain
 * arithmetic.  This module has no browser or application dependencies.
 */

export const RULESET_ID = "purchase-decision-rules" as const;
export const RULESET_VERSION = "1.0.0" as const;
export const RULESET_REF = `${RULESET_ID}@${RULESET_VERSION}` as const;
export const CURRENCY_TABLE_SNAPSHOT_ID =
  "iso4217-list-one@2026-01-01#sha256:838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9" as const;

export const RESULT_ORDER = [
  "income-rate",
  "work-time-equivalent",
  "coverage-available-margin",
  "purchase-after-margin",
  "purchase-impact",
] as const;

export type FormulaId = (typeof RESULT_ORDER)[number];
export const FORMULA_EXPRESSIONS = Object.freeze({
  "income-rate": "(I × Hd) / (S × Hn)",
  "work-time-equivalent": "(P × Hn) / (I × Hd)",
  "coverage-available-margin": "I - F",
  "purchase-after-margin": "(I - F) - P",
  "purchase-impact": "purchase-after-margin - coverage-available-margin = -P",
} as const satisfies Readonly<Record<FormulaId, string>>);
export type FormulaExpression = (typeof FORMULA_EXPRESSIONS)[FormulaId];
export type CalculationSource = "ruleset-derived";
export type PeriodKind = "week" | "month" | "year" | "custom";
export type TaxBasis = "before-tax" | "after-tax";
export type EvidenceStatus =
  | "insufficient-data"
  | "forecast"
  | "estimated"
  | "user-confirmed";
export type ResultAvailability = "available" | "unavailable";
export type FieldAvailability = "available" | "not-provided";
export type RoundingMode = "half-away-from-zero";
export type DisplayRelation = "exact" | "rounded" | "less-than";
export type CoverageStatus = "complete" | "partial" | "unknown";

export type ReasonCode =
  | "missing-income"
  | "missing-work-hours"
  | "missing-purchase-price"
  | "missing-fixed-cost"
  | "comparison-period-unconfirmed"
  | "currency-unconfirmed"
  | "tax-basis-unconfirmed"
  | "input-unconfirmed"
  | "invalid-decimal"
  | "zero-not-allowed"
  | "negative-not-allowed"
  | "fraction-exceeds-currency-minor-unit"
  | "numeric-limit-exceeded"
  | "unsupported-currency"
  | "currency-mismatch"
  | "period-mismatch"
  | "input-reconfirmation-required"
  | "tax-basis-not-after-tax"
  | "fixed-cost-coverage-incomplete"
  | "fixed-cost-coverage-description-missing"
  | "purchase-period-unconfirmed"
  | "division-by-zero"
  | "rule-execution-failed";

export type MinorUnit = 0 | 2 | 3 | 4;

export interface PeriodRef {
  readonly kind: PeriodKind;
  readonly customLabel: string | null;
  readonly revision: string;
}

export interface TimeContext {
  readonly occurredAtUtc: string;
  readonly recordedAtUtc: string;
  readonly clockSource: "device-clock";
  readonly timeZoneId: string;
  readonly utcOffset: string;
  readonly timeZoneSource:
    | "browser-observed"
    | "user-selected"
    | "utc-fallback";
  readonly timeZoneConfirmation:
    | "observed"
    | "user-confirmed"
    | "unconfirmed";
}

export interface CurrencyInfo {
  readonly code: string;
  readonly minorUnit: MinorUnit;
}

export type CurrencyTable = Readonly<Record<string, CurrencyInfo>>;

export interface Money {
  readonly currencyCode: string;
  readonly minorUnit: MinorUnit;
  readonly minorUnits: bigint;
}

export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface ResultExactRational {
  readonly numerator: string;
  readonly denominator: string;
}

export interface ExactValue {
  readonly decimal: string;
  readonly rational?: ResultExactRational;
  readonly minorUnits?: string;
  readonly currencyCode: string | null;
  readonly unit: string;
}

export interface DisplayValue {
  readonly text: string;
  readonly decimal: string;
  readonly displayDigits: number;
  readonly relation: DisplayRelation;
  readonly roundingMode: RoundingMode;
  readonly rounded: boolean;
}

export interface VersionEnvelope {
  readonly rulesetId: typeof RULESET_ID;
  readonly rulesetVersion: typeof RULESET_VERSION;
  readonly rulesetRef: typeof RULESET_REF;
  readonly currencyTableSnapshotId: string;
}

export interface CalculationResult {
  readonly formulaId: FormulaId;
  readonly source: CalculationSource;
  readonly formulaExpression: FormulaExpression;
  readonly availability: ResultAvailability;
  readonly exact: ExactValue | null;
  readonly display: DisplayValue | null;
  readonly unit: string;
  readonly currencyCode: string | null;
  readonly periodRef: PeriodRef | null;
  readonly taxBasis: TaxBasis | null;
  readonly evidenceStatus: EvidenceStatus;
  readonly primaryReasonCode: ReasonCode | null;
  readonly reasonCodes: readonly ReasonCode[];
  readonly dependencyFieldIds: readonly string[];
  readonly estimatedDependencyFieldIds: readonly string[];
  readonly assumptions: readonly string[];
  readonly limitations: readonly string[];
  readonly timeContext: TimeContext | null;
  readonly rounding: {
    readonly mode: RoundingMode;
    readonly displayDigits: number | null;
    readonly rounded: boolean;
  };
  readonly rulesetId: typeof RULESET_ID;
  readonly rulesetVersion: typeof RULESET_VERSION;
  readonly rulesetRef: typeof RULESET_REF;
  readonly currencyTableSnapshotId: string;
}

export interface CalculationContext {
  readonly periodRef?: PeriodRef | null;
  readonly currencyCode?: string | null;
  readonly currencyTableSnapshotId?: string | null;
  readonly taxBasis?: TaxBasis | null;
  readonly timeContext?: TimeContext | null;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly currencyTable?: CurrencyTable;
}

export interface Field<T, TRaw extends string | boolean = string> {
  readonly availability?: FieldAvailability;
  readonly raw?: TRaw | null;
  readonly value?: T | null;
  readonly evidenceStatus?: EvidenceStatus | "actual" | null;
  readonly periodRef?: PeriodRef | null;
  readonly currencyCode?: string | null;
  readonly taxBasis?: TaxBasis | null;
  readonly confirmedAt?: string | null;
  readonly assumptions?: readonly string[];
}

export interface MoneyField extends Field<Money | string> {
  readonly minorUnit?: MinorUnit;
}

export interface WorkHoursField extends Field<Rational | string> {
  readonly unit?: "hour";
}

export interface PurchasePeriodField extends Field<boolean, boolean> {
  readonly periodRef?: PeriodRef | null;
}

export interface CalculationInputs {
  readonly comparisonPeriod?: Field<PeriodRef> | PeriodRef | null;
  readonly currency?: Field<string> | string | null;
  readonly income?: MoneyField | Money | string | null;
  readonly incomeTaxBasis?: Field<TaxBasis> | TaxBasis | null;
  readonly workHours?: WorkHoursField | Rational | string | null;
  readonly purchasePrice?: MoneyField | Money | string | null;
  readonly purchasePeriodInclusion?: PurchasePeriodField | boolean | null;
  readonly fixedCostTotal?: MoneyField | Money | string | null;
  readonly fixedCostCoverage?: Field<CoverageStatus> | CoverageStatus | null;
  readonly fixedCostCoverageDescription?: Field<string> | string | null;
  readonly valueExpectation?: Field<string> | string | null;
  /** Fixture-shaped aliases are accepted at the boundary for deterministic tests. */
  readonly [key: string]: unknown;
}

export interface CalculationRequest {
  readonly context: CalculationContext;
  readonly inputs: CalculationInputs;
}

export interface ParseFailure {
  readonly ok: false;
  readonly reasonCode: ReasonCode;
}

export interface ParseSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;
