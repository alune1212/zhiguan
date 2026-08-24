import {
  MAX_CONFIRMED_REVISIONS,
  MAX_OLD_RESULT_SNAPSHOTS,
  type CalculationResultEnvelope,
  type ConfirmedInputRevision,
  type ConfirmedState,
  type DecisionCode,
  type DraftState,
  type ExportState,
  type OldResultSnapshot,
  type RevisionMetadata,
  type RevisionValue,
  type SessionCommand,
  type SessionError,
  type SessionPhase,
  type SessionInputEnvelope,
  type SessionState,
  type SessionTimeContext,
  type ReviewKind,
} from "./types";
import type { SessionLifecycle } from "./types";
import { RESULT_ORDER } from "../calculation/types";
import type { PeriodRef } from "../calculation/types";

const DEFAULT_RULESET_REF = "purchase-decision-rules@1.0.0";
const DECISION_CODES: readonly DecisionCode[] = [
  "buy",
  "wait",
  "adjust-conditions",
  "do-not-buy",
  "undecided",
];
const REVIEW_KINDS: readonly ReviewKind[] = ["local-date", "condition"];

type InputRecord = Record<string, unknown>;

export interface CreateSessionOptions {
  readonly periodRef?: PeriodRef | null;
  readonly timeContext?: SessionTimeContext | null;
  readonly phase?: SessionPhase;
}

function isRecord(value: unknown): value is InputRecord {
  return typeof value === "object" && value !== null;
}

function freezeValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isRecord(value) && !Array.isArray(value)) {
    return value;
  }

  const objectValue = value as unknown as object;
  if (seen.has(objectValue)) {
    return value;
  }
  seen.add(objectValue);

  if (Array.isArray(value)) {
    for (const item of value) {
      freezeValue(item, seen);
    }
  } else {
    for (const nested of Object.values(value)) {
      freezeValue(nested, seen);
    }
  }

  return Object.freeze(value);
}

function sameValue(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }

  const prior = seen.get(left);
  if (prior === right) {
    return true;
  }
  seen.set(left, right);

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false;
    }
    if (!sameValue(left[key], right[key], seen)) {
      return false;
    }
  }
  return true;
}

function copyEnvelope<TResult>(
  envelope: CalculationResultEnvelope<TResult> | null,
): CalculationResultEnvelope<TResult> | null {
  if (!envelope) {
    return null;
  }
  const resultIds = Object.freeze([...new Set(envelope.resultIds)]);
  return Object.freeze({
    value: freezeValue(envelope.value),
    resultIds,
  });
}

function copyPeriodRef(periodRef: PeriodRef | null | undefined): PeriodRef | null {
  if (!periodRef) {
    return null;
  }
  return Object.freeze({
    kind: periodRef.kind,
    customLabel: periodRef.customLabel,
    revision: periodRef.revision,
  });
}

function copyTimeContext(timeContext: SessionTimeContext | null | undefined): SessionTimeContext | null {
  if (!timeContext) {
    return null;
  }
  return Object.freeze({ ...timeContext });
}

function emptyDerived<TResult>(): SessionState<object, TResult>["derived"] {
  return Object.freeze({
    status: "none" as const,
    envelope: null,
    staleEnvelope: null,
  });
}

function emptyExport(): ExportState {
  return Object.freeze({
    previewStatus: "idle" as const,
    snapshotRevision: null,
  });
}

function clearError<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): SessionState<TInput, TResult> {
  return state.lastError ? { ...state, lastError: null } : state;
}

function withError<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
  code: SessionError["code"],
): SessionState<TInput, TResult> {
  return {
    ...state,
    lastError: Object.freeze({ code }),
  };
}

function invalidateExport(exportState: ExportState): ExportState {
  if (exportState.previewStatus === "idle") {
    return exportState;
  }
  return Object.freeze({
    previewStatus: "stale" as const,
    snapshotRevision: exportState.snapshotRevision,
  });
}

function touch<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): Pick<SessionState<TInput, TResult>, "sessionRevision" | "export" | "lastError"> {
  return {
    sessionRevision: state.sessionRevision + 1,
    export: invalidateExport(state.export),
    lastError: null,
  };
}

function makeDraft<TInput extends object>(
  draft: DraftState<TInput> | null,
  fieldId: string,
  value: unknown,
): DraftState<TInput> {
  const values = { ...(draft?.values ?? {}), [fieldId]: value } as Partial<TInput>;
  const fieldIds = [...new Set([...(draft?.fieldIds ?? []), fieldId])];
  return Object.freeze({
    values: freezeValue(values),
    fieldIds: Object.freeze(fieldIds),
  });
}

function hasStableInput(input: object): boolean {
  for (const value of Object.values(input)) {
    if (!isCommittedInputEnvelope(value)) {
      continue;
    }
    const valueText = typeof value.value === "string" ? value.value.trim() : value.value;
    if (
      value.availability === "available" &&
      (value.evidenceStatus === "user-confirmed" || value.evidenceStatus === "estimated") &&
      valueText !== null &&
      valueText !== undefined &&
      valueText !== ""
    ) {
      return true;
    }
  }
  return false;
}

function isCommittedInputEnvelope(value: unknown): value is SessionInputEnvelope {
  return (
    isRecord(value) &&
    Object.prototype.hasOwnProperty.call(value, "availability") &&
    Object.prototype.hasOwnProperty.call(value, "evidenceStatus") &&
    Object.prototype.hasOwnProperty.call(value, "value")
  );
}

function isDecisionCode(value: unknown): value is DecisionCode {
  return typeof value === "string" && DECISION_CODES.includes(value as DecisionCode);
}

function isReviewKind(value: unknown): value is ReviewKind {
  return typeof value === "string" && REVIEW_KINDS.includes(value as ReviewKind);
}

function changedFields<TInput extends object>(before: TInput | null, after: TInput): string[] {
  if (!before) {
    return [];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const beforeRecord = before as InputRecord;
  const afterRecord = after as InputRecord;
  return [...keys].filter((key) => !sameValue(beforeRecord[key], afterRecord[key]));
}

function defaultRevisionValue(value: unknown, periodRef: PeriodRef | null): RevisionValue {
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, "value")) {
    const rawValue = value.value;
    const available = value.availability === "available"
      ? rawValue !== null && rawValue !== undefined && rawValue !== ""
      : false;
    const evidenceStatus = value.evidenceStatus === "estimated" || value.evidenceStatus === "user-confirmed"
      ? value.evidenceStatus
      : null;
    const nestedPeriod = isPeriodRef(value.periodRef) ? value.periodRef : periodRef;
    return Object.freeze({
      availability: available ? "available" : "not-provided",
      value: available ? freezeValue(rawValue) : null,
      evidenceStatus: available ? evidenceStatus : null,
      unit: typeof value.unit === "string" ? value.unit : null,
      currencyCode: typeof value.currencyCode === "string" ? value.currencyCode : null,
      periodRef: nestedPeriod,
    });
  }

  const available = value !== null && value !== undefined && value !== "";
  return Object.freeze({
    availability: available ? "available" : "not-provided",
    value: available ? freezeValue(value) : null,
    evidenceStatus: null,
    unit: null,
    currencyCode: null,
    periodRef,
  });
}

function isPeriodRef(value: unknown): value is PeriodRef {
  return (
    isRecord(value) &&
    (value.kind === "week" || value.kind === "month" || value.kind === "year" || value.kind === "custom") &&
    (value.customLabel === null || typeof value.customLabel === "string") &&
    typeof value.revision === "string"
  );
}

function copyRevisionValue(value: RevisionValue | undefined, fallback: RevisionValue): RevisionValue {
  if (!value) {
    return fallback;
  }
  return Object.freeze({
    availability: value.availability,
    value: value.value === null ? null : freezeValue(value.value),
    evidenceStatus: value.evidenceStatus,
    unit: value.unit,
    currencyCode: value.currencyCode,
    periodRef: copyPeriodRef(value.periodRef),
  });
}

function copyOldResults(oldResults: readonly OldResultSnapshot[] | undefined): OldResultSnapshot[] {
  return (oldResults ?? []).map((oldResult) =>
    Object.freeze({
      formulaId: oldResult.formulaId,
      exactValue: oldResult.exactValue === null ? null : freezeValue(oldResult.exactValue),
      displayValue: oldResult.displayValue === null ? null : freezeValue(oldResult.displayValue),
      unit: oldResult.unit,
      currencyCode: oldResult.currencyCode,
      periodRef: copyPeriodRef(oldResult.periodRef),
      taxBasis: oldResult.taxBasis,
      evidenceStatus: oldResult.evidenceStatus,
      dependencyIds: Object.freeze([...oldResult.dependencyIds]),
      rounding: oldResult.rounding === null ? null : freezeValue(oldResult.rounding),
      rulesetRef: oldResult.rulesetRef,
      currencyTableSnapshotId: oldResult.currencyTableSnapshotId,
      generatedAt: copyTimeContext(oldResult.generatedAt),
    }),
  );
}

function getPriorEnvelope<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): CalculationResultEnvelope<TResult> | null {
  return state.derived.staleEnvelope ?? state.derived.envelope;
}

interface RevisionBuildResult {
  readonly ok: true;
  readonly events: readonly ConfirmedInputRevision[];
  readonly staleResultIds: readonly string[];
}

interface RevisionBuildFailure {
  readonly ok: false;
  readonly code:
    | "revision-limit-exceeded"
    | "old-result-limit-exceeded"
    | "multiple-input-revision-fields"
    | "invalid-revision-results"
    | "revision-field-mismatch"
    | "invalid-time-context";
}

function buildRevisionEvents<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
  input: TInput,
  periodRef: PeriodRef | null,
  timeContext: SessionTimeContext | null,
  metadata: RevisionMetadata | undefined,
): RevisionBuildResult | RevisionBuildFailure {
  const changed = changedFields(state.confirmed?.value ?? null, input);
  if (changed.length === 0) {
    if (metadata) {
      return { ok: false, code: "revision-field-mismatch" };
    }
    return { ok: true, events: [], staleResultIds: [] };
  }
  if (changed.length > 1) {
    return { ok: false, code: "multiple-input-revision-fields" };
  }
  if (metadata && metadata.fieldId !== changed[0]) {
    return { ok: false, code: "revision-field-mismatch" };
  }
  if (!timeContext) {
    return { ok: false, code: "invalid-time-context" };
  }

  const priorEnvelope = getPriorEnvelope(state);
  const candidateResultIds = new Set(metadata?.invalidatedResultIds ?? priorEnvelope?.resultIds ?? []);
  const unknownResultId = [...candidateResultIds].some(
    (resultId) => !(RESULT_ORDER as readonly string[]).includes(resultId),
  );
  if (unknownResultId) {
    return { ok: false, code: "invalid-revision-results" };
  }
  const staleResultIds = RESULT_ORDER.filter((resultId) => candidateResultIds.has(resultId));
  const oldResults = copyOldResults(metadata?.oldResults);
  if (staleResultIds.length > MAX_OLD_RESULT_SNAPSHOTS || oldResults.length > MAX_OLD_RESULT_SNAPSHOTS) {
    return { ok: false, code: "old-result-limit-exceeded" };
  }
  if (
    oldResults.length !== staleResultIds.length ||
    oldResults.some((oldResult, index) => oldResult.formulaId !== staleResultIds[index])
  ) {
    return { ok: false, code: "invalid-revision-results" };
  }
  if (state.confirmedInputRevisions.length + changed.length > MAX_CONFIRMED_REVISIONS) {
    return { ok: false, code: "revision-limit-exceeded" };
  }

  const events = changed.map((fieldId, index) => {
    const usesMetadata = metadata?.fieldId === fieldId;
    const beforeValue = state.confirmed?.value
      ? (state.confirmed.value as InputRecord)[fieldId]
      : undefined;
    const afterValue = (input as InputRecord)[fieldId];
    const fallbackBefore = defaultRevisionValue(beforeValue, state.confirmed?.periodRef ?? periodRef);
    const fallbackAfter = defaultRevisionValue(afterValue, periodRef);
    return Object.freeze({
      sequence: state.confirmedInputRevisions.length + index + 1,
      eventType: "confirmed-input-revision" as const,
      eventStatus: "actual" as const,
      actor: "user" as const,
      timeContext: copyTimeContext(timeContext) as SessionTimeContext,
      fieldId,
      before: copyRevisionValue(usesMetadata ? metadata?.before : undefined, fallbackBefore),
      after: copyRevisionValue(usesMetadata ? metadata?.after : undefined, fallbackAfter),
      rawDecimalBefore: usesMetadata ? metadata?.rawDecimalBefore ?? null : null,
      rawDecimalAfter: usesMetadata ? metadata?.rawDecimalAfter ?? null : null,
      confirmedAt: timeContext.recordedAtUtc,
      invalidatedResultIds: Object.freeze([...staleResultIds]),
      oldResults: Object.freeze(oldResults),
      rulesetRef: usesMetadata ? metadata?.rulesetRef ?? DEFAULT_RULESET_REF : DEFAULT_RULESET_REF,
    });
  });

  return { ok: true, events, staleResultIds };
}

const STRICT_UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UTC_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function isStrictUtcIso(value: string): boolean {
  if (!STRICT_UTC_ISO.test(value)) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isValidTimeZoneId(value: string): boolean {
  if (value === "Etc/UTC" || value === "UTC") {
    return true;
  }
  if (!/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+$/.test(value)) {
    return false;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

function isValidUtcOffset(value: string): boolean {
  const match = UTC_OFFSET.exec(value);
  if (!match) {
    return false;
  }
  return Number(match[2]) <= 23 && Number(match[3]) <= 59;
}

function isValidTimeContext(value: unknown): value is SessionTimeContext {
  if (!isRecord(value)) {
    return false;
  }
  const timeContext = value as Partial<SessionTimeContext>;
  if (
    timeContext.clockSource !== "device-clock" ||
    typeof timeContext.occurredAtUtc !== "string" ||
    typeof timeContext.recordedAtUtc !== "string" ||
    typeof timeContext.timeZoneId !== "string" ||
    typeof timeContext.utcOffset !== "string" ||
    !isStrictUtcIso(timeContext.occurredAtUtc) ||
    !isStrictUtcIso(timeContext.recordedAtUtc) ||
    !isValidTimeZoneId(timeContext.timeZoneId) ||
    !isValidUtcOffset(timeContext.utcOffset)
  ) {
    return false;
  }
  if (timeContext.timeZoneSource === "utc-fallback") {
    return (
      timeContext.timeZoneId === "Etc/UTC" &&
      timeContext.utcOffset === "+00:00" &&
      timeContext.timeZoneConfirmation === "unconfirmed"
    );
  }
  if (timeContext.timeZoneSource === "browser-observed") {
    return timeContext.timeZoneConfirmation === "observed" || timeContext.timeZoneConfirmation === "unconfirmed";
  }
  if (timeContext.timeZoneSource === "user-selected") {
    return timeContext.timeZoneConfirmation === "user-confirmed" || timeContext.timeZoneConfirmation === "unconfirmed";
  }
  return false;
}

function applyConfirmed<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
  command: Extract<SessionCommand<TInput, TResult>, { type: "confirm-input" }>,
): SessionState<TInput, TResult> {
  if (!isValidTimeContext(command.timeContext)) {
    return withError(state, "invalid-time-context");
  }
  const timeContext = command.timeContext;
  const periodRef = copyPeriodRef(command.periodRef === undefined ? state.periodRef : command.periodRef);
  const eventsResult = buildRevisionEvents(
    state,
    command.input,
    periodRef,
    timeContext,
    command.revision,
  );
  if (!eventsResult.ok) {
    return withError(state, eventsResult.code);
  }

  const input = freezeValue({ ...command.input }) as TInput;
  const envelope = copyEnvelope(command.result);
  const confirmed: ConfirmedState<TInput> = Object.freeze({
    value: input,
    periodRef,
    confirmedAt: timeContext.recordedAtUtc,
    timeContext: copyTimeContext(timeContext),
    exportEligible: hasStableInput(input),
  });
  const derived = Object.freeze({
    status: envelope ? ("derived" as const) : ("none" as const),
    envelope,
    staleEnvelope: null,
  });
  const nextPhase: SessionPhase =
    state.phase === "input" || state.phase === "confirmation" ? "understanding" : state.phase;
  return {
    ...state,
    ...touch(state),
    phase: nextPhase,
    draft: null,
    confirmed,
    confirmedStability: "stable",
    derived,
    periodRef,
    timeContext: copyTimeContext(timeContext),
    confirmedInputRevisions: Object.freeze([
      ...state.confirmedInputRevisions,
      ...eventsResult.events,
    ]),
  };
}

function rejectIfExited<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): SessionState<TInput, TResult> | null {
  return state.lifecycle === "exited" ? withError(state, "session-exited") : null;
}

export function createSessionState<TInput extends object, TResult = unknown>(
  options: CreateSessionOptions = {},
): SessionState<TInput, TResult> {
  return Object.freeze({
    lifecycle: "active" as const,
    phase: options.phase ?? ("input" as const),
    draft: null,
    confirmed: null,
    confirmedStability: "stable" as const,
    derived: emptyDerived<TResult>(),
    decision: Object.freeze({
      availability: "not-provided" as const,
      code: null,
      rationale: null,
      confirmedAt: null,
    }),
    review: Object.freeze({
      availability: "not-provided" as const,
      kind: null,
      value: null,
      confirmedAt: null,
    }),
    periodRef: copyPeriodRef(options.periodRef),
    timeContext: copyTimeContext(options.timeContext),
    sessionRevision: 0,
    confirmedInputRevisions: Object.freeze([]),
    export: emptyExport(),
    lastError: null,
  });
}

export function reduceSession<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
  command: SessionCommand<TInput, TResult>,
): SessionState<TInput, TResult> {
  const exitedError = rejectIfExited(state);
  if (exitedError && command.type !== "exit") {
    return exitedError;
  }

  switch (command.type) {
    case "edit-input": {
      const staleEnvelope = state.derived.staleEnvelope ?? state.derived.envelope;
      const derived = Object.freeze({
        status: state.confirmed ? ("pending-reconfirmation" as const) : ("none" as const),
        envelope: null,
        staleEnvelope: state.confirmed ? staleEnvelope : null,
      });
      return {
        ...state,
        ...touch(state),
        phase: "confirmation",
        draft: makeDraft(state.draft, command.fieldId, command.value),
        confirmedStability: state.confirmed ? "invalidated" : state.confirmedStability,
        derived,
      };
    }

    case "cancel-draft": {
      if (!state.draft) {
        return clearError(state);
      }
      if (!state.confirmed) {
        return {
          ...state,
          ...touch(state),
          draft: null,
          derived: emptyDerived<TResult>(),
        };
      }
      return {
        ...state,
        ...touch(state),
        draft: null,
        confirmedStability: "invalidated",
        derived: Object.freeze({
          status: "pending-reconfirmation" as const,
          envelope: null,
          staleEnvelope: state.derived.staleEnvelope,
        }),
      };
    }

    case "confirm-input":
      return applyConfirmed(state, command);

    case "change-period": {
      if (!command.periodRef.revision.trim()) {
        return withError(state, "invalid-period-revision");
      }
      if (state.periodRef && state.periodRef.revision === command.periodRef.revision) {
        if (sameValue(state.periodRef, command.periodRef)) {
          return clearError(state);
        }
        return withError(state, "invalid-period-revision");
      }
      const periodRef = copyPeriodRef(command.periodRef);
      return {
        ...state,
        ...touch(state),
        phase: "confirmation",
        draft: null,
        periodRef,
        confirmedStability: state.confirmed ? "invalidated" : state.confirmedStability,
        derived: state.confirmed
          ? Object.freeze({
              status: "pending-reconfirmation" as const,
              envelope: null,
              staleEnvelope: null,
            })
          : emptyDerived<TResult>(),
      };
    }

    case "change-time-context": {
      if (!isValidTimeContext(command.timeContext)) {
        return withError(state, "invalid-time-context");
      }
      const timeContext = copyTimeContext(command.timeContext);
      if (sameValue(state.timeContext, timeContext)) {
        return clearError(state);
      }
      return {
        ...state,
        ...touch(state),
        timeContext,
        phase: state.confirmed ? "confirmation" : state.phase,
        confirmedStability: state.confirmed ? "invalidated" : state.confirmedStability,
        derived: state.confirmed
          ? Object.freeze({
              status: "pending-reconfirmation" as const,
              envelope: null,
              staleEnvelope: state.derived.envelope,
            })
          : state.derived,
      };
    }

    case "set-phase":
      return {
        ...state,
        lastError: null,
        phase: command.phase,
      };

    case "set-decision": {
      if (
        !isDecisionCode(command.code) ||
        typeof command.rationale !== "string" ||
        typeof command.confirmedAt !== "string" ||
        !command.rationale.trim() ||
        !command.confirmedAt.trim()
      ) {
        return withError(state, "invalid-decision");
      }
      const decision = Object.freeze({
        availability: "available" as const,
        code: command.code,
        rationale: command.rationale,
        confirmedAt: command.confirmedAt,
      });
      return {
        ...state,
        ...touch(state),
        phase: "decision",
        decision,
      };
    }

    case "set-review": {
      if (
        !isReviewKind(command.kind) ||
        typeof command.value !== "string" ||
        typeof command.confirmedAt !== "string" ||
        !command.value.trim() ||
        !command.confirmedAt.trim()
      ) {
        return withError(state, "invalid-review");
      }
      const review = Object.freeze({
        availability: "available" as const,
        kind: command.kind,
        value: command.value,
        confirmedAt: command.confirmedAt,
      });
      return {
        ...state,
        ...touch(state),
        phase: "review",
        review,
      };
    }

    case "preview-export": {
      const eligible =
        state.lifecycle === "active" &&
        state.confirmed !== null &&
        state.confirmedStability === "stable" &&
        state.draft === null &&
        state.confirmed.exportEligible;
      if (!eligible) {
        return withError(state, "not-export-eligible");
      }
      return {
        ...state,
        lastError: null,
        export: Object.freeze({
          previewStatus: "ready" as const,
          snapshotRevision: state.sessionRevision,
        }),
      };
    }

    case "invalidate-export-preview":
      return {
        ...state,
        lastError: null,
        export: state.export.previewStatus === "idle"
          ? state.export
          : Object.freeze({
              previewStatus: "stale" as const,
              snapshotRevision: state.export.snapshotRevision,
            }),
      };

    case "exit": {
      const nextRevision = state.sessionRevision + 1;
      return Object.freeze({
        lifecycle: "exited" as SessionLifecycle,
        phase: state.phase,
        draft: null,
        confirmed: null,
        confirmedStability: "invalidated" as const,
        derived: emptyDerived<TResult>(),
        decision: Object.freeze({
          availability: "not-provided" as const,
          code: null,
          rationale: null,
          confirmedAt: null,
        }),
        review: Object.freeze({
          availability: "not-provided" as const,
          kind: null,
          value: null,
          confirmedAt: null,
        }),
        periodRef: null,
        timeContext: null,
        sessionRevision: nextRevision,
        confirmedInputRevisions: Object.freeze([]),
        export: emptyExport(),
        lastError: null,
      });
    }
  }
}

export function selectWorkflowStatus<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): "draft" | "confirmed" | "derived" | "pending-reconfirmation" | "stale" {
  if (state.confirmedStability === "invalidated") {
    return "pending-reconfirmation";
  }
  if (!state.confirmed) {
    return "draft";
  }
  if (state.export.previewStatus === "stale") {
    return "stale";
  }
  if (state.derived.status === "derived") {
    return "derived";
  }
  return "confirmed";
}

export function selectCurrentInput<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): TInput | null {
  return state.confirmedStability === "stable" ? state.confirmed?.value ?? null : null;
}

export function selectCurrentResults<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): CalculationResultEnvelope<TResult> | null {
  return state.derived.status === "derived" ? state.derived.envelope : null;
}

export function selectExportEligibility<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): boolean {
  return (
    state.lifecycle === "active" &&
    state.confirmed !== null &&
    state.confirmedStability === "stable" &&
    state.draft === null &&
    state.confirmed.exportEligible
  );
}

export function selectCanGenerateSnapshot<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): boolean {
  return selectExportEligibility(state) && state.export.previewStatus === "ready";
}
