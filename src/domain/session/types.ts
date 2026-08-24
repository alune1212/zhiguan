import type { PeriodRef } from "../calculation/types";

export type { PeriodRef } from "../calculation/types";

/**
 * The session domain is deliberately an in-memory boundary.  It owns the
 * workflow and revision semantics, while the calculation capability owns all
 * numeric rules.  TResult is therefore opaque here: a calculation envelope is
 * carried through the state machine but never inspected or recomputed.
 */

export const MAX_CONFIRMED_REVISIONS = 50 as const;
export const MAX_OLD_RESULT_SNAPSHOTS = 5 as const;

export type SessionPhase =
  | "input"
  | "confirmation"
  | "understanding"
  | "decision"
  | "review";

export type SessionLifecycle = "active" | "exited";
export type WorkflowStatus =
  | "draft"
  | "confirmed"
  | "derived"
  | "pending-reconfirmation"
  | "stale";

export type EvidenceStatus = "user-confirmed" | "estimated";
export type InputAvailability = "available" | "not-provided";

/** Stable input envelope consumed by the export-eligibility selector. */
export interface SessionInputEnvelope<TValue = unknown> {
  readonly availability: InputAvailability;
  readonly value: TValue | null;
  readonly evidenceStatus: EvidenceStatus | null;
}

export type DecisionCode =
  | "buy"
  | "wait"
  | "adjust-conditions"
  | "do-not-buy"
  | "undecided";

export type ReviewKind = "local-date" | "condition";

export interface SessionTimeContext {
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

/**
 * A calculation result envelope is intentionally opaque.  The calculation
 * capability can use its own ResultEnvelope shape as TResult; only stable
 * result identifiers are supplied for revision invalidation and export
 * history.  No formula or numeric value is copied into the session module.
 */
export interface CalculationResultEnvelope<TResult = unknown> {
  readonly value: TResult;
  readonly resultIds: readonly string[];
}

/**
 * The minimum historical projection permitted by ADR-0002/0003.  `unknown`
 * keeps exact numeric representations owned by the calculation/export
 * capabilities rather than re-implementing them here.
 */
export interface OldResultSnapshot {
  readonly formulaId: string;
  readonly exactValue: unknown | null;
  readonly displayValue: unknown | null;
  readonly unit: string | null;
  readonly currencyCode: string | null;
  readonly periodRef: PeriodRef | null;
  readonly taxBasis: string | null;
  readonly evidenceStatus: string;
  readonly dependencyIds: readonly string[];
  readonly rounding: unknown | null;
  readonly rulesetRef: string;
  readonly currencyTableSnapshotId: string;
  readonly generatedAt: SessionTimeContext | null;
}

export interface RevisionValue<TValue = unknown> {
  readonly availability: InputAvailability;
  readonly value: TValue | null;
  readonly evidenceStatus: EvidenceStatus | null;
  readonly unit: string | null;
  readonly currencyCode: string | null;
  readonly periodRef: PeriodRef | null;
}

export interface ConfirmedInputRevision<TValue = unknown> {
  readonly sequence: number;
  readonly eventType: "confirmed-input-revision";
  readonly eventStatus: "actual";
  readonly actor: "user";
  readonly timeContext: SessionTimeContext;
  readonly fieldId: string;
  readonly before: RevisionValue<TValue>;
  readonly after: RevisionValue<TValue>;
  readonly rawDecimalBefore: string | null;
  readonly rawDecimalAfter: string | null;
  readonly confirmedAt: string;
  readonly invalidatedResultIds: readonly string[];
  readonly oldResults: readonly OldResultSnapshot[];
  readonly rulesetRef: string;
}

export interface DraftState<TInput extends object> {
  readonly values: Partial<TInput>;
  readonly fieldIds: readonly string[];
}

export interface ConfirmedState<TInput extends object> {
  readonly value: TInput;
  readonly periodRef: PeriodRef | null;
  readonly confirmedAt: string;
  readonly timeContext: SessionTimeContext | null;
  /** Whether at least one stable, non-not-provided input exists for export. */
  readonly exportEligible: boolean;
}

export type DerivedStatus =
  | "none"
  | "derived"
  | "pending-reconfirmation";

export interface DerivedState<TResult> {
  readonly status: DerivedStatus;
  readonly envelope: CalculationResultEnvelope<TResult> | null;
  /**
   * A stale envelope is retained only long enough to make a revision event's
   * minimal invalidation list. Selectors never expose it as a current result.
   */
  readonly staleEnvelope: CalculationResultEnvelope<TResult> | null;
}

export interface DecisionState {
  readonly availability: "available" | "not-provided";
  readonly code: DecisionCode | null;
  readonly rationale: string | null;
  readonly confirmedAt: string | null;
}

export interface ReviewState {
  readonly availability: "available" | "not-provided";
  readonly kind: ReviewKind | null;
  readonly value: string | null;
  readonly confirmedAt: string | null;
}

export type ExportPreviewStatus = "idle" | "ready" | "stale";

export interface ExportState {
  readonly previewStatus: ExportPreviewStatus;
  /** This is a snapshot revision, never a period or event sequence. */
  readonly snapshotRevision: number | null;
}

export type SessionErrorCode =
  | "session-exited"
  | "revision-limit-exceeded"
  | "old-result-limit-exceeded"
  | "multiple-input-revision-fields"
  | "invalid-revision-results"
  | "revision-field-mismatch"
  | "invalid-period-revision"
  | "invalid-decision"
  | "invalid-review"
  | "not-export-eligible"
  | "invalid-time-context";

export interface SessionError {
  readonly code: SessionErrorCode;
}

export interface SessionState<TInput extends object, TResult = unknown> {
  readonly lifecycle: SessionLifecycle;
  readonly phase: SessionPhase;
  readonly draft: DraftState<TInput> | null;
  readonly confirmed: ConfirmedState<TInput> | null;
  /** A period change or edit makes the prior confirmation non-current. */
  readonly confirmedStability: "stable" | "invalidated";
  readonly derived: DerivedState<TResult>;
  readonly decision: DecisionState;
  readonly review: ReviewState;
  readonly periodRef: PeriodRef | null;
  readonly timeContext: SessionTimeContext | null;
  /** Session revision namespace; never reused as a period or event sequence. */
  readonly sessionRevision: number;
  readonly confirmedInputRevisions: readonly ConfirmedInputRevision[];
  readonly export: ExportState;
  readonly lastError: SessionError | null;
}

export interface RevisionMetadata<TValue = unknown> {
  readonly fieldId: string;
  readonly before?: RevisionValue<TValue>;
  readonly after?: RevisionValue<TValue>;
  readonly rawDecimalBefore?: string | null;
  readonly rawDecimalAfter?: string | null;
  readonly rulesetRef?: string;
  readonly invalidatedResultIds?: readonly string[];
  readonly oldResults?: readonly OldResultSnapshot[];
}

export type SessionCommand<TInput extends object, TResult = unknown> =
  | {
      readonly type: "edit-input";
      readonly fieldId: string;
      readonly value: unknown;
    }
  | {
      readonly type: "cancel-draft";
    }
  | {
      readonly type: "confirm-input";
      readonly input: TInput;
      readonly result: CalculationResultEnvelope<TResult> | null;
      readonly timeContext: SessionTimeContext;
      readonly periodRef?: PeriodRef | null;
      readonly revision?: RevisionMetadata;
    }
  | {
      readonly type: "change-period";
      readonly periodRef: PeriodRef;
    }
  | {
      readonly type: "change-time-context";
      readonly timeContext: SessionTimeContext;
    }
  | {
      readonly type: "set-phase";
      readonly phase: SessionPhase;
    }
  | {
      readonly type: "set-decision";
      readonly code: DecisionCode;
      readonly rationale: string;
      readonly confirmedAt: string;
    }
  | {
      readonly type: "set-review";
      readonly kind: ReviewKind;
      readonly value: string;
      readonly confirmedAt: string;
    }
  | {
      readonly type: "preview-export";
    }
  | {
      readonly type: "invalidate-export-preview";
    }
  | {
      readonly type: "exit";
      readonly reason: "user-exit" | "pagehide";
    };
