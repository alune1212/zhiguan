import { describe, expect, it } from "vitest";

import {
  MAX_CONFIRMED_REVISIONS,
  MAX_OLD_RESULT_SNAPSHOTS,
  createSessionState,
  reduceSession,
  selectCurrentInput,
  selectCurrentResults,
  selectExportEligibility,
  selectWorkflowStatus,
  type CalculationResultEnvelope,
  type OldResultSnapshot,
  type SessionState,
  type SessionCommand,
  type SessionTimeContext,
} from "../../../src/domain/session";

interface Input {
  readonly income: InputEnvelope<string>;
  readonly purchasePrice: InputEnvelope<string>;
  readonly expectation: InputEnvelope<string>;
}

interface InputEnvelope<T> {
  readonly availability: "available" | "not-provided";
  readonly evidenceStatus: "user-confirmed" | "estimated" | null;
  readonly value: T | null;
}

const period = {
  kind: "month",
  customLabel: null,
  revision: "period-1",
} as const;

const timeContext: SessionTimeContext = {
  occurredAtUtc: "2026-08-24T00:00:00.000Z",
  recordedAtUtc: "2026-08-24T00:00:01.000Z",
  clockSource: "device-clock",
  timeZoneId: "Asia/Shanghai",
  utcOffset: "+08:00",
  timeZoneSource: "user-selected",
  timeZoneConfirmation: "user-confirmed",
};

function envelope(value: string, resultIds = ["income-rate", "work-time-equivalent"]): CalculationResultEnvelope<string> {
  return { value, resultIds };
}

function oldResult(index: number): OldResultSnapshot {
  const formulaIds = ["income-rate", "work-time-equivalent"] as const;
  return {
    formulaId: formulaIds[index] ?? "income-rate",
    exactValue: { decimal: String(index) },
    displayValue: { text: String(index) },
    unit: "CNY",
    currencyCode: "CNY",
    periodRef: period,
    taxBasis: "after-tax",
    evidenceStatus: "user-confirmed",
    dependencyIds: ["income"],
    rounding: null,
    rulesetRef: "purchase-decision-rules@1.0.0",
    currencyTableSnapshotId: "currency-snapshot",
    generatedAt: timeContext,
  };
}

function confirmedState(): SessionState<Input, string> {
  const initial = createSessionState<Input, string>({ periodRef: period, timeContext });
  return reduceSession(initial, {
    type: "confirm-input",
    input: {
      income: { availability: "available", evidenceStatus: "user-confirmed", value: "4000" },
      purchasePrice: { availability: "available", evidenceStatus: "user-confirmed", value: "3000" },
      expectation: { availability: "available", evidenceStatus: "user-confirmed", value: "重要体验" },
    },
    result: envelope("initial"),
    timeContext,
  });
}

function input(purchasePrice: string, income = "4000"): Input {
  return {
    income: { availability: "available", evidenceStatus: "user-confirmed", value: income },
    purchasePrice: { availability: "available", evidenceStatus: "user-confirmed", value: purchasePrice },
    expectation: { availability: "available", evidenceStatus: "user-confirmed", value: "重要体验" },
  };
}

describe("session reducer", () => {
  it("keeps period, session and snapshot revisions in separate namespaces", () => {
    const state = confirmedState();
    expect(state.periodRef?.revision).toBe("period-1");
    expect(state.sessionRevision).toBe(1);
    expect(state.export.snapshotRevision).toBeNull();
    expect(state.confirmedInputRevisions).toHaveLength(0);

    const previewed = reduceSession(state, { type: "preview-export" });
    expect(previewed.export.snapshotRevision).toBe(1);
    expect(previewed.periodRef?.revision).toBe("period-1");
    expect(previewed.confirmedInputRevisions).toHaveLength(0);
  });

  it("invalidates results immediately and does not restore them on draft cancellation", () => {
    const state = confirmedState();
    const edited = reduceSession(state, {
      type: "edit-input",
      fieldId: "purchasePrice",
      value: "3500",
    });

    expect(selectWorkflowStatus(edited)).toBe("pending-reconfirmation");
    expect(selectCurrentResults(edited)).toBeNull();
    expect(selectCurrentInput(edited)).toBeNull();

    const cancelled = reduceSession(edited, { type: "cancel-draft" });
    expect(cancelled.draft).toBeNull();
    expect(selectCurrentResults(cancelled)).toBeNull();
    expect(selectCurrentInput(cancelled)).toBeNull();
    expect(cancelled.confirmedInputRevisions).toHaveLength(0);
    expect(selectWorkflowStatus(cancelled)).toBe("pending-reconfirmation");
  });

  it("reconfirms the same input and recalculates without fabricating a revision event", () => {
    const state = confirmedState();
    const edited = reduceSession(state, {
      type: "edit-input",
      fieldId: "purchasePrice",
      value: "4000",
    });
    const cancelled = reduceSession(edited, { type: "cancel-draft" });
    const reconfirmed = reduceSession(cancelled, {
      type: "confirm-input",
      input: input("3000"),
      result: envelope("recalculated"),
      timeContext: {
        ...timeContext,
        recordedAtUtc: "2026-08-24T00:01:00.000Z",
      },
    });

    expect(selectCurrentResults(reconfirmed)?.value).toBe("recalculated");
    expect(reconfirmed.confirmedInputRevisions).toHaveLength(0);
    expect(selectWorkflowStatus(reconfirmed)).toBe("derived");
  });

  it("keeps the stale envelope internally after cancellation without exposing it as current", () => {
    const state = confirmedState();
    const edited = reduceSession(state, { type: "edit-input", fieldId: "purchasePrice", value: "3500" });
    const cancelled = reduceSession(edited, { type: "cancel-draft" });

    expect(cancelled.derived.staleEnvelope?.value).toBe("initial");
    expect(selectCurrentResults(cancelled)).toBeNull();

    const editedAgain = reduceSession(cancelled, { type: "edit-input", fieldId: "purchasePrice", value: "3600" });
    const reconfirmed = reduceSession(editedAgain, {
      type: "confirm-input",
      input: input("3600"),
      result: envelope("after-cancel-and-reedit"),
      timeContext,
      revision: {
        fieldId: "purchasePrice",
        oldResults: [oldResult(0), oldResult(1)],
      },
    });

    expect(reconfirmed.confirmedInputRevisions).toHaveLength(1);
    expect(reconfirmed.confirmedInputRevisions[0]?.oldResults).toHaveLength(2);
  });

  it("creates exactly one minimal event for one actual changed field", () => {
    const state = confirmedState();
    const edited = reduceSession(state, {
      type: "edit-input",
      fieldId: "purchasePrice",
      value: "3500",
    });
    const next = reduceSession(edited, {
      type: "confirm-input",
        input: input("3500"),
      result: envelope("changed"),
      timeContext,
      revision: {
        fieldId: "purchasePrice",
        before: {
          availability: "available",
          value: "3000",
          evidenceStatus: "user-confirmed",
          unit: "CNY",
          currencyCode: "CNY",
          periodRef: period,
        },
        after: {
          availability: "available",
          value: "3500",
          evidenceStatus: "user-confirmed",
          unit: "CNY",
          currencyCode: "CNY",
          periodRef: period,
        },
        rawDecimalBefore: "3000",
        rawDecimalAfter: "3500",
        invalidatedResultIds: ["work-time-equivalent", "income-rate", "income-rate"],
        oldResults: [oldResult(0), oldResult(1)],
        rulesetRef: "purchase-decision-rules@1.0.0",
      },
    });

    expect(next.confirmedInputRevisions).toHaveLength(1);
    const [event] = next.confirmedInputRevisions;
    expect(event.sequence).toBe(1);
    expect(event.eventStatus).toBe("actual");
    expect(event.fieldId).toBe("purchasePrice");
    expect(event.invalidatedResultIds).toEqual(["income-rate", "work-time-equivalent"]);
    expect(event.oldResults).toHaveLength(2);
    expect(next.sessionRevision).toBeGreaterThan(state.sessionRevision);
    expect(selectCurrentResults(next)?.value).toBe("changed");
  });

  it("fails closed before confirmation when more than one field changed", () => {
    const state = confirmedState();
    const edited = reduceSession(
      reduceSession(state, { type: "edit-input", fieldId: "income", value: "4500" }),
      { type: "edit-input", fieldId: "purchasePrice", value: "3500" },
    );
    const blocked = reduceSession(edited, {
      type: "confirm-input",
      input: input("3500", "4500"),
      result: envelope("not-committed"),
      timeContext,
      revision: { fieldId: "purchasePrice", oldResults: [oldResult(0), oldResult(1)] },
    });

    expect(blocked.lastError?.code).toBe("multiple-input-revision-fields");
    expect(blocked.confirmedInputRevisions).toHaveLength(0);
    expect(selectCurrentResults(blocked)).toBeNull();
  });

  it("does not allow an export-eligibility command override", () => {
    const initial = createSessionState<Input, string>({ periodRef: period, timeContext });
    const missingInput: Input = {
      income: { availability: "not-provided", evidenceStatus: null, value: null },
      purchasePrice: { availability: "not-provided", evidenceStatus: null, value: null },
      expectation: { availability: "not-provided", evidenceStatus: null, value: null },
    };
    const state = reduceSession(initial, {
      type: "confirm-input",
      input: missingInput,
      result: envelope("insufficient"),
      timeContext,
    });

    expect(selectExportEligibility(state)).toBe(false);
    const preview = reduceSession(state, { type: "preview-export" });
    expect(preview.lastError?.code).toBe("not-export-eligible");
  });

  it("rejects an old-result correspondence mismatch before committing", () => {
    const state = confirmedState();
    const edited = reduceSession(state, { type: "edit-input", fieldId: "purchasePrice", value: "3500" });
    const blocked = reduceSession(edited, {
      type: "confirm-input",
      input: input("3500"),
      result: envelope("not-committed"),
      timeContext,
      revision: {
        fieldId: "purchasePrice",
        invalidatedResultIds: ["income-rate"],
        oldResults: [oldResult(1)],
      },
    });

    expect(blocked.lastError?.code).toBe("invalid-revision-results");
    expect(blocked.confirmedInputRevisions).toHaveLength(0);
    expect(selectCurrentResults(blocked)).toBeNull();
  });

  it("rejects revision metadata whose field id is not the unique changed field", () => {
    const state = confirmedState();
    const edited = reduceSession(state, { type: "edit-input", fieldId: "purchasePrice", value: "3500" });
    const blocked = reduceSession(edited, {
      type: "confirm-input",
      input: input("3500"),
      result: envelope("not-committed"),
      timeContext,
      revision: {
        fieldId: "income",
        oldResults: [oldResult(0), oldResult(1)],
      },
    });

    expect(blocked.lastError?.code).toBe("revision-field-mismatch");
    expect(blocked.confirmedInputRevisions).toHaveLength(0);
  });

  it("extracts envelope value and estimated status when defaulting revision metadata", () => {
    const state = confirmedState();
    const edited = reduceSession(state, { type: "edit-input", fieldId: "purchasePrice", value: "3500" });
    const estimatedInput: Input = {
      ...input("3500"),
      purchasePrice: {
        availability: "available",
        evidenceStatus: "estimated",
        value: "3500",
      },
    };
    const next = reduceSession(edited, {
      type: "confirm-input",
      input: estimatedInput,
      result: envelope("estimated-change"),
      timeContext,
      revision: { fieldId: "purchasePrice", oldResults: [oldResult(0), oldResult(1)] },
    });

    const event = next.confirmedInputRevisions[0];
    expect(event?.before.value).toBe("3000");
    expect(event?.after.value).toBe("3500");
    expect(event?.after.evidenceStatus).toBe("estimated");
  });

  it("blocks a revision before mutation at 50 events and rejects overlarge old snapshots", () => {
    let state = confirmedState();
    for (let index = 0; index < MAX_CONFIRMED_REVISIONS; index += 1) {
      const edited = reduceSession(state, {
        type: "edit-input",
        fieldId: "purchasePrice",
        value: String(3001 + index),
      });
      state = reduceSession(edited, {
        type: "confirm-input",
        input: input(String(3001 + index)),
        result: envelope(`result-${index}`),
        timeContext,
        revision: {
          fieldId: "purchasePrice",
          oldResults: [oldResult(0), oldResult(1)],
        },
      });
    }
    expect(state.confirmedInputRevisions).toHaveLength(MAX_CONFIRMED_REVISIONS);

    const edit51 = reduceSession(state, {
      type: "edit-input",
      fieldId: "purchasePrice",
      value: "9999",
    });
    const blocked = reduceSession(edit51, {
      type: "confirm-input",
      input: input("9999"),
      result: envelope("not-committed"),
      timeContext,
      revision: {
        fieldId: "purchasePrice",
        oldResults: [oldResult(0), oldResult(1)],
      },
    });
    expect(blocked.lastError?.code).toBe("revision-limit-exceeded");
    expect(blocked.confirmedInputRevisions).toHaveLength(MAX_CONFIRMED_REVISIONS);
    expect(selectCurrentResults(blocked)).toBeNull();

    const fresh = confirmedState();
    const edit = reduceSession(fresh, { type: "edit-input", fieldId: "purchasePrice", value: "3500" });
    const tooManyOldResults = reduceSession(edit, {
      type: "confirm-input",
      input: input("3500"),
      result: envelope("not-committed"),
      timeContext,
      revision: {
        fieldId: "purchasePrice",
        oldResults: Array.from({ length: MAX_OLD_RESULT_SNAPSHOTS + 1 }, (_, index) => oldResult(index)),
      },
    });
    expect(tooManyOldResults.lastError?.code).toBe("old-result-limit-exceeded");
    expect(tooManyOldResults.confirmedInputRevisions).toHaveLength(0);
    expect(selectCurrentResults(tooManyOldResults)).toBeNull();
  });

  it("stales preview on decision changes and keeps all five decisions unranked", () => {
    let state = reduceSession(confirmedState(), { type: "preview-export" });
    expect(selectExportEligibility(state)).toBe(true);
    expect(state.export.previewStatus).toBe("ready");

    for (const code of ["buy", "wait", "adjust-conditions", "do-not-buy", "undecided"] as const) {
      state = reduceSession(state, {
        type: "set-decision",
        code,
        rationale: "这是用户自己的依据",
        confirmedAt: timeContext.recordedAtUtc,
      });
      expect(state.decision.code).toBe(code);
      expect(state.export.previewStatus).toBe("stale");
      state = reduceSession(state, { type: "preview-export" });
    }
    expect(state.decision.availability).toBe("available");
  });

  it("treats phase navigation as UI-only and leaves session revision and preview stable", () => {
    const previewed = reduceSession(confirmedState(), { type: "preview-export" });
    const sessionRevision = previewed.sessionRevision;
    const navigated = reduceSession(previewed, { type: "set-phase", phase: "decision" });

    expect(navigated.phase).toBe("decision");
    expect(navigated.sessionRevision).toBe(sessionRevision);
    expect(navigated.export.previewStatus).toBe("ready");
    expect(navigated.export.snapshotRevision).toBe(sessionRevision);
  });

  it("validates decision and review enums at runtime", () => {
    const state = confirmedState();
    const invalidDecision = reduceSession(state, {
      type: "set-decision",
      code: "buy-now" as never,
      rationale: "不应接受未知值",
      confirmedAt: timeContext.recordedAtUtc,
    });
    expect(invalidDecision.lastError?.code).toBe("invalid-decision");

    const invalidReview = reduceSession(state, {
      type: "set-review",
      kind: "automatic-reminder" as never,
      value: "不应接受未知值",
      confirmedAt: timeContext.recordedAtUtc,
    });
    expect(invalidReview.lastError?.code).toBe("invalid-review");
  });

  it("rejects non-round-trippable timestamps and invalid timezone metadata", () => {
    const initial = createSessionState<Input, string>({ periodRef: period });
    const invalidTimestamp = reduceSession(initial, {
      type: "confirm-input",
      input: input("3000"),
      result: envelope("not-committed"),
      timeContext: { ...timeContext, occurredAtUtc: "2026-08-24T00:00:00Z" },
    });
    expect(invalidTimestamp.lastError?.code).toBe("invalid-time-context");
    expect(invalidTimestamp.confirmed).toBeNull();

    const invalidCombination = reduceSession(initial, {
      type: "confirm-input",
      input: input("3000"),
      result: envelope("not-committed"),
      timeContext: { ...timeContext, timeZoneSource: "utc-fallback", timeZoneConfirmation: "unconfirmed" },
    });
    expect(invalidCombination.lastError?.code).toBe("invalid-time-context");
    expect(invalidCombination.confirmed).toBeNull();

    const missingTime = reduceSession(initial, {
      type: "confirm-input",
      input: input("3000"),
      result: envelope("not-committed"),
      timeContext: null,
    } as unknown as SessionCommand<Input, string>);
    expect(missingTime.lastError?.code).toBe("invalid-time-context");
    expect(missingTime.confirmed).toBeNull();
  });

  it("clears application-controlled state on exit without claiming remote deletion", () => {
    const state = reduceSession(confirmedState(), { type: "set-review", kind: "condition", value: "使用一段时间后复盘", confirmedAt: timeContext.recordedAtUtc });
    const exited = reduceSession(state, { type: "exit", reason: "user-exit" });
    expect(exited.lifecycle).toBe("exited");
    expect(exited.confirmed).toBeNull();
    expect(exited.derived.envelope).toBeNull();
    expect(exited.confirmedInputRevisions).toHaveLength(0);
    expect(exited.export.snapshotRevision).toBeNull();
  });
});
