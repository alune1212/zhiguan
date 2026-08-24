import type {
  CalculationResultEnvelope,
  ConfirmedInputRevision,
  DecisionState,
  DraftState,
  ExportState,
  ReviewState,
  SessionState,
  WorkflowStatus,
} from "./types";
import { selectCurrentInput, selectCurrentResults, selectExportEligibility, selectWorkflowStatus } from "./reducer";

export { selectCurrentInput, selectCurrentResults, selectExportEligibility, selectWorkflowStatus };

export function selectDraft<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): DraftState<TInput> | null {
  return state.draft;
}

export function selectConfirmed<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): TInput | null {
  return selectCurrentInput(state);
}

export function selectDerived<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): CalculationResultEnvelope<TResult> | null {
  return selectCurrentResults(state);
}

export function selectDecision<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): DecisionState {
  return state.decision;
}

export function selectReview<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): ReviewState {
  return state.review;
}

export function selectExport<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): ExportState {
  return state.export;
}

export function selectSessionRevision<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): number {
  return state.sessionRevision;
}

export function selectPeriodRevision<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): string | null {
  return state.periodRef?.revision ?? null;
}

export function selectSnapshotRevision<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): number | null {
  return state.export.snapshotRevision;
}

export function selectConfirmedInputRevisions<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): readonly ConfirmedInputRevision[] {
  return state.confirmedInputRevisions;
}

export function selectHasPendingReconfirmation<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): boolean {
  return state.confirmedStability === "invalidated" || state.derived.status === "pending-reconfirmation";
}

export function selectWorkflow<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): WorkflowStatus {
  return selectWorkflowStatus(state);
}

export function selectLifecycle<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): SessionState<TInput, TResult>["lifecycle"] {
  return state.lifecycle;
}

export function selectLastError<TInput extends object, TResult>(
  state: SessionState<TInput, TResult>,
): SessionState<TInput, TResult>["lastError"] {
  return state.lastError;
}
