import { useCallback, useEffect, useReducer, useRef } from "react";

import { bindPagehideCleanup, type LifecycleBinding, type PageLifecycleTarget } from "../adapters/browser/lifecycle";
import { observeDeviceTimeContext } from "../adapters/browser/clock";
import {
  CURRENCY_TABLE_SNAPSHOT_ID,
  RULESET_ID,
  RULESET_VERSION,
  calculatePurchaseDecision,
  type CalculationResult,
  type CalculationInputs,
  type CoverageStatus,
  type PeriodRef,
  type TaxBasis,
} from "../domain/calculation";
import {
  createSessionState,
  reduceSession,
  selectCurrentResults,
  type CalculationResultEnvelope,
  type DecisionCode,
  type OldResultSnapshot,
  type ReviewKind,
  type SessionInputEnvelope,
  type SessionState,
  type SessionTimeContext,
} from "../domain/session";

export const WORKBENCH_FIELD_IDS = [
  "comparison-period",
  "currency",
  "income",
  "income-tax-basis",
  "work-hours",
  "purchase-price",
  "purchase-period-inclusion",
  "fixed-cost-total",
  "fixed-cost-coverage",
  "fixed-cost-coverage-description",
  "value-expectation",
] as const;

export type WorkbenchFieldId = (typeof WORKBENCH_FIELD_IDS)[number];
export type EvidenceChoice = "user-confirmed" | "estimated";

export type NumericEvidenceField =
  | "income"
  | "work-hours"
  | "purchase-price"
  | "fixed-cost-total";

/**
 * Errors are keyed by the control which needs attention.  Evidence status is
 * a separate control from the amount itself, so it deliberately uses an
 * `${fieldId}-evidence` key rather than marking the numeric field invalid.
 */
export type WorkbenchErrorKey =
  | WorkbenchFieldId
  | "period-custom-label"
  | `${NumericEvidenceField}-evidence`;

export interface WorkbenchDraft {
  readonly [key: string]: string;
  readonly "comparison-period": string;
  readonly "period-custom-label": string;
  readonly currency: string;
  readonly income: string;
  readonly "income-tax-basis": string;
  readonly "work-hours": string;
  readonly "purchase-price": string;
  readonly "purchase-period-inclusion": string;
  readonly "fixed-cost-total": string;
  readonly "fixed-cost-coverage": string;
  readonly "fixed-cost-coverage-description": string;
  readonly "value-expectation": string;
}

export type EvidenceDraft = Readonly<Record<NumericEvidenceField, EvidenceChoice | "">>;

/**
 * The application boundary carries user values in SessionInputEnvelope.  It
 * deliberately carries no separate export-eligibility boolean: eligibility
 * is derived by the session/export capabilities from availability, status,
 * and non-empty values.
 */
export type WorkbenchInput = Readonly<
  Record<WorkbenchFieldId, SessionInputEnvelope<unknown>>
>;

export type WorkbenchResults = readonly CalculationResult[];
export type WorkbenchSession = SessionState<WorkbenchInput, WorkbenchResults>;

export interface WorkbenchReviewDraft {
  readonly kind: ReviewKind | "";
  readonly value: string;
}

export interface WorkbenchApplicationState {
  readonly privacyAcknowledged: boolean;
  readonly session: WorkbenchSession;
  readonly draft: WorkbenchDraft;
  readonly evidence: EvidenceDraft;
  readonly inputErrors: Readonly<Partial<Record<WorkbenchErrorKey, string>>>;
  readonly notice: string | null;
  readonly reviewDraft: WorkbenchReviewDraft;
  readonly handoffComplete: boolean;
}

export type WorkbenchAction =
  | { readonly type: "acknowledge-privacy" }
  | { readonly type: "set-field"; readonly fieldId: WorkbenchFieldId | "period-custom-label"; readonly value: string }
  | { readonly type: "set-evidence"; readonly fieldId: NumericEvidenceField; readonly value: EvidenceChoice | "" }
  | { readonly type: "open-confirmation" }
  | { readonly type: "back-to-input" }
  | { readonly type: "confirm-input" }
  | { readonly type: "begin-edit" }
  | { readonly type: "cancel-edit" }
  | { readonly type: "open-decision" }
  | { readonly type: "set-phase"; readonly phase: "input" | "confirmation" | "understanding" | "decision" | "review" }
  | { readonly type: "set-decision"; readonly code: DecisionCode; readonly rationale: string }
  | { readonly type: "set-review-draft"; readonly kind: ReviewKind | ""; readonly value: string }
  | { readonly type: "save-review" }
  | { readonly type: "exit"; readonly reason: "user-exit" | "pagehide" };

export interface WorkbenchClock {
  readonly now: () => SessionTimeContext;
}

export interface WorkbenchApplicationOptions {
  readonly lifecycleTarget?: PageLifecycleTarget | null;
  readonly clock?: WorkbenchClock;
}

const EMPTY_DRAFT: WorkbenchDraft = Object.freeze({
  "comparison-period": "",
  "period-custom-label": "",
  currency: "",
  income: "",
  "income-tax-basis": "",
  "work-hours": "",
  "purchase-price": "",
  "purchase-period-inclusion": "",
  "fixed-cost-total": "",
  "fixed-cost-coverage": "",
  "fixed-cost-coverage-description": "",
  "value-expectation": "",
});

const EMPTY_EVIDENCE: EvidenceDraft = Object.freeze({
  income: "",
  "work-hours": "",
  "purchase-price": "",
  "fixed-cost-total": "",
});

const EMPTY_REVIEW: WorkbenchReviewDraft = Object.freeze({ kind: "", value: "" });

const REQUIRED_FIELD_IDS: readonly WorkbenchFieldId[] = [
  "comparison-period",
  "currency",
  "income",
  "income-tax-basis",
  "work-hours",
  "purchase-price",
  "purchase-period-inclusion",
  "value-expectation",
];

const EVIDENCE_FIELDS: readonly NumericEvidenceField[] = [
  "income",
  "work-hours",
  "purchase-price",
  "fixed-cost-total",
];

const DEFAULT_CLOCK: WorkbenchClock = Object.freeze({
  now: () => observeDeviceTimeContext(),
});

function emptySession(): WorkbenchSession {
  return createSessionState<WorkbenchInput, WorkbenchResults>();
}

export function createInitialWorkbenchState(): WorkbenchApplicationState {
  return Object.freeze({
    privacyAcknowledged: false,
    session: emptySession(),
    draft: EMPTY_DRAFT,
    evidence: EMPTY_EVIDENCE,
    inputErrors: Object.freeze({}),
    notice: null,
    reviewDraft: EMPTY_REVIEW,
    handoffComplete: false,
  });
}

function cloneDraft(draft: WorkbenchDraft): WorkbenchDraft {
  return Object.freeze({ ...draft });
}

function cloneEvidence(evidence: EvidenceDraft): EvidenceDraft {
  return Object.freeze({ ...evidence });
}

function asPeriodRef(draft: WorkbenchDraft): PeriodRef | null {
  const kind = draft["comparison-period"];
  if (kind !== "week" && kind !== "month" && kind !== "year" && kind !== "custom") {
    return null;
  }
  const customLabel = draft["period-custom-label"].trim();
  if (kind === "custom" && customLabel.length === 0) return null;
  return Object.freeze({
    kind,
    customLabel: kind === "custom" ? customLabel : null,
    revision: `period:${kind}:${kind === "custom" ? customLabel : "standard"}`,
  });
}

function asTaxBasis(value: string): TaxBasis | null {
  return value === "before-tax" || value === "after-tax" ? value : null;
}

function asCoverageStatus(value: string): CoverageStatus | null {
  return value === "complete" || value === "partial" || value === "unknown" ? value : null;
}

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function inputEnvelope<TValue>(
  value: TValue | null,
  evidenceStatus: EvidenceChoice | "",
): SessionInputEnvelope<TValue> {
  if (value === null || value === undefined || (typeof value === "string" && value.trim().length === 0)) {
    return Object.freeze({ availability: "not-provided" as const, value: null, evidenceStatus: null });
  }
  return Object.freeze({
    availability: "available" as const,
    value,
    evidenceStatus: evidenceStatus === "" ? null : evidenceStatus,
  });
}

function buildInput(
  draft: WorkbenchDraft,
  evidence: EvidenceDraft,
): {
  readonly input: WorkbenchInput;
  readonly calculationInputs: CalculationInputs;
  readonly periodRef: PeriodRef | null;
} {
  const periodRef = asPeriodRef(draft);
  const currency = text(draft.currency);
  const taxBasis = asTaxBasis(draft["income-tax-basis"]);
  const coverage = asCoverageStatus(draft["fixed-cost-coverage"]);
  const inclusion =
    draft["purchase-period-inclusion"] === "included"
      ? true
      : draft["purchase-period-inclusion"] === "excluded"
        ? false
        : null;
  const fixedCostTotal = text(draft["fixed-cost-total"]);
  const coverageDescription = text(draft["fixed-cost-coverage-description"]);

  const input = {
    "comparison-period": inputEnvelope(periodRef, "user-confirmed"),
    currency: inputEnvelope(currency, "user-confirmed"),
    income: inputEnvelope(text(draft.income), evidence.income),
    "income-tax-basis": inputEnvelope(taxBasis, "user-confirmed"),
    "work-hours": inputEnvelope(text(draft["work-hours"]), evidence["work-hours"]),
    "purchase-price": inputEnvelope(text(draft["purchase-price"]), evidence["purchase-price"]),
    "purchase-period-inclusion": inputEnvelope(inclusion, "user-confirmed"),
    "fixed-cost-total": inputEnvelope(fixedCostTotal, evidence["fixed-cost-total"]),
    "fixed-cost-coverage": inputEnvelope(coverage, "user-confirmed"),
    "fixed-cost-coverage-description": inputEnvelope(coverageDescription, "user-confirmed"),
    "value-expectation": inputEnvelope(text(draft["value-expectation"]), "user-confirmed"),
  } as const satisfies WorkbenchInput;

  // The session keeps the deliberately small SessionInputEnvelope shape. The
  // calculation boundary receives the same values enriched with explicit
  // period/currency/tax metadata, so the pure kernel can compare contexts
  // without asking the session reducer to understand calculation fields.
  const calculationInputs = {
    comparisonPeriod: {
      ...input["comparison-period"],
      raw: periodRef?.kind ?? null,
      periodRef,
    },
    currency: {
      ...input.currency,
      raw: currency,
    },
    income: {
      ...input.income,
      raw: text(draft.income),
      periodRef,
      currencyCode: currency,
      taxBasis,
    },
    incomeTaxBasis: {
      ...input["income-tax-basis"],
      raw: taxBasis,
      taxBasis,
    },
    workHours: {
      ...input["work-hours"],
      raw: text(draft["work-hours"]),
      periodRef,
      unit: "hour" as const,
    },
    purchasePrice: {
      ...input["purchase-price"],
      raw: text(draft["purchase-price"]),
      periodRef,
      currencyCode: currency,
    },
    purchasePeriodInclusion: {
      ...input["purchase-period-inclusion"],
      raw: inclusion,
      periodRef,
    },
    fixedCostTotal: {
      ...input["fixed-cost-total"],
      raw: fixedCostTotal,
      periodRef,
      currencyCode: currency,
    },
    fixedCostCoverage: {
      ...input["fixed-cost-coverage"],
      raw: coverage,
    },
    fixedCostCoverageDescription: {
      ...input["fixed-cost-coverage-description"],
      raw: coverageDescription,
    },
    valueExpectation: {
      ...input["value-expectation"],
      raw: text(draft["value-expectation"]),
    },
  } satisfies CalculationInputs;

  return { input: Object.freeze(input), calculationInputs, periodRef };
}

function draftErrors(draft: WorkbenchDraft, evidence: EvidenceDraft): Partial<Record<WorkbenchErrorKey, string>> {
  const errors: Partial<Record<WorkbenchErrorKey, string>> = {};
  for (const fieldId of REQUIRED_FIELD_IDS) {
    const value = fieldId === "comparison-period" ? draft[fieldId] : draft[fieldId];
    if (value.trim().length === 0) errors[fieldId] = "请补充这一项，或返回退出当前会话。";
  }
  if (draft["comparison-period"] === "custom" && draft["period-custom-label"].trim().length === 0) {
    errors["period-custom-label"] = "自定义周期需要一个简短名称。";
  }
  if (draft.currency.trim().length > 0 && !/^[A-Z]{3}$/u.test(draft.currency.trim())) {
    errors.currency = "请输入 3 位 ISO 4217 大写代码，例如 CNY。";
  }
  for (const fieldId of EVIDENCE_FIELDS) {
    if (draft[fieldId].trim().length > 0 && evidence[fieldId] === "") {
      errors[`${fieldId}-evidence`] = "请标记这是用户确认的输入还是近似输入。";
    }
  }
  if (draft["fixed-cost-total"].trim().length > 0 && draft["fixed-cost-coverage"] === "") {
    errors["fixed-cost-coverage"] = "填写固定成本时，请选择覆盖范围。";
  }
  if (
    draft["fixed-cost-coverage"] === "complete" &&
    draft["fixed-cost-coverage-description"].trim().length === 0
  ) {
    errors["fixed-cost-coverage-description"] = "完整覆盖需要一句不含交易明细的范围说明。";
  }
  return errors;
}

function hasAnyDraftValue(draft: WorkbenchDraft): boolean {
  return Object.entries(draft).some(([key, value]) => key !== "period-custom-label" && value.trim().length > 0);
}

function resultIds(results: WorkbenchResults): readonly string[] {
  return Object.freeze(results.map((result) => result.formulaId));
}

/**
 * A confirmed result is deliberately hidden by selectCurrentResults while an
 * edit is pending.  Revision history still needs the complete previous
 * envelope, including results which may become unavailable after the edit.
 */
function revisionResults(session: WorkbenchSession): WorkbenchResults {
  return session.derived.staleEnvelope?.value ?? session.derived.envelope?.value ?? [];
}

function toOldResult(result: CalculationResult): OldResultSnapshot {
  return Object.freeze({
    formulaId: result.formulaId,
    exactValue: result.exact,
    displayValue: result.display,
    unit: result.unit,
    currencyCode: result.currencyCode,
    periodRef: result.periodRef,
    taxBasis: result.taxBasis,
    evidenceStatus: result.evidenceStatus,
    dependencyIds: Object.freeze([...result.dependencyFieldIds]),
    rounding: result.rounding,
    rulesetRef: result.rulesetRef,
    currencyTableSnapshotId: result.currencyTableSnapshotId,
    generatedAt: result.timeContext as SessionTimeContext | null,
  });
}

function changedField(
  before: WorkbenchInput | null,
  after: WorkbenchInput,
): WorkbenchFieldId | null {
  if (!before) return null;
  const changed = WORKBENCH_FIELD_IDS.filter((fieldId) => {
    const left = before[fieldId];
    const right = after[fieldId];
    return JSON.stringify(left) !== JSON.stringify(right);
  });
  return changed.length === 1 ? changed[0] : null;
}

function inputToRevisionValue(
  fieldId: WorkbenchFieldId,
  input: SessionInputEnvelope<unknown> | undefined,
  periodRef: PeriodRef | null,
  allInput: WorkbenchInput,
) {
  const currencyValue = allInput.currency?.value;
  const currencyCode = typeof currencyValue === "string" && ["income", "purchase-price", "fixed-cost-total"].includes(fieldId)
    ? currencyValue
    : null;
  return {
    availability: input?.availability ?? "not-provided",
    value: input?.value ?? null,
    evidenceStatus: input?.evidenceStatus ?? null,
    unit: fieldId === "work-hours" ? "hour" : fieldId === "income" || fieldId === "purchase-price" || fieldId === "fixed-cost-total" ? currencyCode : null,
    currencyCode,
    periodRef,
  } as const;
}

function rawInputValue(input: SessionInputEnvelope<unknown> | undefined): string | null {
  const value = input?.value;
  return typeof value === "string" ? value : null;
}

function errorMessageForSession(code: string | null | undefined): string | null {
  switch (code) {
    case "multiple-input-revision-fields":
      return "请一次只修改一个已确认字段，再重新确认；旧结果不会恢复。";
    case "revision-limit-exceeded":
      return "当前会话的修订次数已达到上限，请导出可用结果后退出并重新开始。";
    case "old-result-limit-exceeded":
      return "当前修订需要保留的旧结果超过范围，请退出当前会话。";
    case "invalid-time-context":
      return "设备时间上下文暂不可用，请稍后重新确认。";
    case "invalid-revision-results":
      return "当前结果修订关系无法核对，请返回输入后重新确认。";
    default:
      return null;
  }
}

function editSessionInCurrentStage(
  state: WorkbenchApplicationState,
  fieldId: string,
  value: unknown,
) {
  const edited = reduceSession(state.session, { type: "edit-input", fieldId, value });
  // The session reducer correctly records a draft as confirmation work. Keep
  // the editable form visible while the user is still entering values; the
  // explicit "检查输入与口径" action is the boundary into the summary.
  if (state.session.phase === "input") {
    return reduceSession(edited, { type: "set-phase", phase: "input" });
  }
  return edited;
}

function reduceApplication(
  state: WorkbenchApplicationState,
  action: WorkbenchAction,
  clock: WorkbenchClock,
): WorkbenchApplicationState {
  switch (action.type) {
    case "acknowledge-privacy":
      return Object.freeze({
        ...state,
        privacyAcknowledged: true,
        session: state.session.lifecycle === "exited" ? emptySession() : state.session,
        draft: state.session.lifecycle === "exited" ? EMPTY_DRAFT : state.draft,
        evidence: state.session.lifecycle === "exited" ? EMPTY_EVIDENCE : state.evidence,
        reviewDraft: state.session.lifecycle === "exited" ? EMPTY_REVIEW : state.reviewDraft,
        inputErrors: Object.freeze({}),
        notice: null,
      });

    case "set-field": {
      const draft = cloneDraft({ ...state.draft, [action.fieldId]: action.value });
      const session = editSessionInCurrentStage(state, action.fieldId, action.value);
      const inputErrors = { ...state.inputErrors };
      delete inputErrors[action.fieldId as WorkbenchErrorKey];
      if (action.fieldId === "comparison-period") delete inputErrors["period-custom-label"];
      if (action.fieldId === "period-custom-label") delete inputErrors["period-custom-label"];
      return Object.freeze({
        ...state,
        draft,
        session,
        inputErrors: Object.freeze(inputErrors),
        notice: null,
      });
    }

    case "set-evidence": {
      const evidence = cloneEvidence({ ...state.evidence, [action.fieldId]: action.value });
      const session = editSessionInCurrentStage(state, action.fieldId, action.value);
      const inputErrors = { ...state.inputErrors };
      delete inputErrors[`${action.fieldId}-evidence`];
      return Object.freeze({ ...state, evidence, session, inputErrors: Object.freeze(inputErrors), notice: null });
    }

    case "open-confirmation": {
      if (!hasAnyDraftValue(state.draft)) {
        const errors = draftErrors(state.draft, state.evidence);
        return Object.freeze({
          ...state,
          inputErrors: Object.freeze(errors),
          notice: "先填写你愿意用于这次判断的最少信息；不愿继续时可以随时退出。",
        });
      }
      const session = reduceSession(state.session, { type: "set-phase", phase: "confirmation" });
      return Object.freeze({ ...state, session, inputErrors: Object.freeze({}), notice: null });
    }

    case "back-to-input": {
      const session = reduceSession(state.session, { type: "set-phase", phase: "input" });
      return Object.freeze({ ...state, session, notice: null });
    }

    case "confirm-input": {
      const errors = draftErrors(state.draft, state.evidence);

      const { input, calculationInputs, periodRef } = buildInput(state.draft, state.evidence);
      const timeContext = clock.now();
      const currency = text(state.draft.currency);
      const taxBasis = asTaxBasis(state.draft["income-tax-basis"]);
      const results = calculatePurchaseDecision({
        context: {
          periodRef,
          currencyCode: currency,
          currencyTableSnapshotId: CURRENCY_TABLE_SNAPSHOT_ID,
          taxBasis,
          timeContext,
          rulesetId: RULESET_ID,
          rulesetVersion: RULESET_VERSION,
        },
        inputs: calculationInputs,
      });
      const envelope: CalculationResultEnvelope<WorkbenchResults> = Object.freeze({
        value: Object.freeze([...results]),
        resultIds: resultIds(results),
      });
      const previousInput = state.session.confirmed?.value ?? null;
      const changed = changedField(previousInput, input);
      const previousResults = revisionResults(state.session);
      const revision = changed && previousInput
        ? {
            fieldId: changed,
            before: inputToRevisionValue(changed, previousInput[changed], state.session.confirmed?.periodRef ?? null, previousInput),
            after: inputToRevisionValue(changed, input[changed], periodRef, input),
            rawDecimalBefore: rawInputValue(previousInput[changed]),
            rawDecimalAfter: rawInputValue(input[changed]),
            rulesetRef: "purchase-decision-rules@1.0.0",
            invalidatedResultIds: resultIds(previousResults),
            oldResults: Object.freeze(previousResults.map(toOldResult)),
          }
        : undefined;
      const session = reduceSession(state.session, {
        type: "confirm-input",
        input,
        result: envelope,
        timeContext,
        periodRef,
        revision,
      });
      const sessionMessage = errorMessageForSession(session.lastError?.code);
      if (session.lastError) {
        return Object.freeze({
          ...state,
          session,
          inputErrors: Object.freeze(errors),
          notice: sessionMessage ?? "当前输入未能重新确认，请检查后重试。",
        });
      }
      return Object.freeze({
        ...state,
        session,
        inputErrors: Object.freeze(errors),
        notice: null,
        handoffComplete: false,
      });
    }

    case "begin-edit": {
      const committed = state.session.confirmed?.value;
      let session = reduceSession(state.session, { type: "set-phase", phase: "confirmation" });
      if (committed) {
        session = reduceSession(state.session, {
          type: "edit-input",
          fieldId: "comparison-period",
          value: state.draft["comparison-period"],
        });
        session = reduceSession(session, { type: "set-phase", phase: "input" });
      }
      return Object.freeze({
        ...state,
        session,
        notice: committed ? "你可以修改输入；修改后旧结果会立即失效，取消也不会恢复旧结果。" : null,
      });
    }

    case "cancel-edit": {
      const session = reduceSession(state.session, { type: "cancel-draft" });
      return Object.freeze({
        ...state,
        session,
        notice: state.session.confirmed
          ? "已取消这次编辑；旧结果不会恢复，请重新确认当前输入。"
          : null,
      });
    }

    case "open-decision": {
      const session = reduceSession(state.session, { type: "set-phase", phase: "decision" });
      return Object.freeze({ ...state, session, notice: null });
    }

    case "set-phase": {
      const session = reduceSession(state.session, { type: "set-phase", phase: action.phase });
      return Object.freeze({ ...state, session, notice: null });
    }

    case "set-decision": {
      const timeContext = clock.now();
      const session = reduceSession(state.session, {
        type: "set-decision",
        code: action.code,
        rationale: action.rationale,
        confirmedAt: timeContext.recordedAtUtc,
      });
      if (session.lastError) {
        return Object.freeze({ ...state, session, notice: "请填写一句依据或尚待确认条件。" });
      }
      return Object.freeze({
        ...state,
        session,
        handoffComplete: true,
        notice: "你的决定已记录在当前会话内存中；复盘需要在产品外人工完成。",
      });
    }

    case "set-review-draft":
      return Object.freeze({
        ...state,
        reviewDraft: Object.freeze({ kind: action.kind, value: action.value }),
        notice: null,
      });

    case "save-review": {
      const value = state.reviewDraft.value.trim();
      if (state.reviewDraft.kind === "" || value.length === 0) {
        return Object.freeze({ ...state, notice: "复盘条件是可选的；如填写，请同时选择条件或日期。" });
      }
      const timeContext = clock.now();
      const session = reduceSession(state.session, {
        type: "set-review",
        kind: state.reviewDraft.kind,
        value,
        confirmedAt: timeContext.recordedAtUtc,
      });
      return Object.freeze({
        ...state,
        session,
        notice: session.lastError ? "复盘条件暂未记录，请检查内容后重试。" : "复盘交接条件已记录在当前会话内存中。",
      });
    }

    case "exit": {
      const session = reduceSession(state.session, { type: "exit", reason: action.reason });
      return Object.freeze({
        ...state,
        session,
        privacyAcknowledged: false,
        draft: EMPTY_DRAFT,
        evidence: EMPTY_EVIDENCE,
        inputErrors: Object.freeze({}),
        reviewDraft: EMPTY_REVIEW,
        handoffComplete: false,
        notice: null,
      });
    }
  }
}

export interface WorkbenchController extends WorkbenchApplicationState {
  readonly dispatch: (action: WorkbenchAction) => void;
  readonly start: () => void;
  readonly setField: (fieldId: WorkbenchFieldId | "period-custom-label", value: string) => void;
  readonly setEvidence: (fieldId: NumericEvidenceField, value: EvidenceChoice | "") => void;
  readonly openConfirmation: () => void;
  readonly confirmInput: () => void;
  readonly exit: () => void;
}

export function useWorkbenchController(options: WorkbenchApplicationOptions = {}): WorkbenchController {
  const optionsRef = useRef(options);
  const clock = optionsRef.current.clock ?? DEFAULT_CLOCK;
  const lifecycleBindingRef = useRef<LifecycleBinding | null>(null);
  const [state, dispatch] = useReducer(
    (current: WorkbenchApplicationState, action: WorkbenchAction) => reduceApplication(current, action, clock),
    undefined,
    createInitialWorkbenchState,
  );

  useEffect(() => {
    const target = optionsRef.current.lifecycleTarget ?? (typeof window === "undefined" ? null : window);
    if (!target) return undefined;
    const binding = bindPagehideCleanup(target, () => {
      dispatch({ type: "exit", reason: "pagehide" });
    });
    lifecycleBindingRef.current = binding;
    return () => {
      lifecycleBindingRef.current = null;
      binding.detach();
    };
  }, []);

  const send = useCallback((action: WorkbenchAction) => dispatch(action), []);
  const start = useCallback(() => {
    lifecycleBindingRef.current?.reset();
    send({ type: "acknowledge-privacy" });
  }, [send]);
  const setField = useCallback(
    (fieldId: WorkbenchFieldId | "period-custom-label", value: string) => send({ type: "set-field", fieldId, value }),
    [send],
  );
  const setEvidence = useCallback(
    (fieldId: NumericEvidenceField, value: EvidenceChoice | "") => send({ type: "set-evidence", fieldId, value }),
    [send],
  );
  const openConfirmation = useCallback(() => send({ type: "open-confirmation" }), [send]);
  const confirmInput = useCallback(() => send({ type: "confirm-input" }), [send]);
  const exit = useCallback(() => send({ type: "exit", reason: "user-exit" }), [send]);

  return {
    ...state,
    dispatch: send,
    start,
    setField,
    setEvidence,
    openConfirmation,
    confirmInput,
    exit,
  };
}

export function resultsForState(state: WorkbenchApplicationState): WorkbenchResults {
  return selectCurrentResults(state.session)?.value ?? [];
}
