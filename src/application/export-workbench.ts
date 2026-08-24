import { useCallback, useEffect, useRef, useState } from "react";

import {
  CURRENCY_SNAPSHOT_METADATA,
  DEFAULT_CURRENCY_TABLE,
  CURRENCY_TABLE_SNAPSHOT_ID,
  currencyInfo,
  parseMoney,
  parseWorkHours,
  type CalculationResult,
  type CurrencyInfo,
  type PeriodRef as CalculationPeriodRef,
  type TimeContext as CalculationTimeContext,
} from "../domain/calculation";
import {
  DEFAULT_DICTIONARIES,
  DEFAULT_NOTICES,
  RULESET,
  INPUT_FIELD_IDS,
} from "../domain/export/constants";
import { exportError, fail } from "../domain/export/errors";
import {
  serializeJsonSnapshot,
  type SerializeJsonOptions,
} from "../domain/export/json";
import {
  serializeMarkdownSnapshot,
  type SerializeMarkdownOptions,
} from "../domain/export/markdown";
import { previewExport, type ExportPreview } from "../domain/export/preview";
import {
  freezeExportSnapshot,
  markSnapshotStale,
} from "../domain/export/snapshot";
import {
  createExportFormatStates,
  transitionExportState,
  type FormatExportState,
} from "../domain/export/state";
import {
  type ApplicationBuild,
  type DownloadFormat,
  type ExportError,
  type ExportResult,
  type ExportSnapshotSource,
  type ExportSnapshotV1,
  type InputRecord,
  type OldResultSnapshot as ExportOldResultSnapshot,
  type ResultRecord,
  type TextValue,
  type BooleanValue,
  type EnumValue,
  type PeriodRefValue,
  type DictionaryText,
  type TimeContext,
} from "../domain/export/types";
import {
  type ConfirmedInputRevision,
  type DecisionCode,
  type SessionInputEnvelope,
  type SessionTimeContext,
} from "../domain/session";
import type {
  WorkbenchInput,
  WorkbenchResults,
  WorkbenchSession,
} from "./workbench";
import type { BuildIdentityGate } from "../adapters/browser/build-metadata";
import {
  requestBrowserDownload,
  type DownloadRequest,
} from "../adapters/browser/download";
import {
  markCleanupBlocked,
  type DownloadEnvironment,
} from "../adapters/browser/download-lifecycle";
import type { PageLifecycleTarget } from "../adapters/browser/lifecycle";

/**
 * The application layer owns composition and lifecycle.  The calculation and
 * export capabilities remain pure: this file adapts the in-memory workbench
 * session into their fixed wire contracts and does not reimplement formulas.
 */

export type ExportFormat = DownloadFormat;

export interface ExportWorkbenchOptions {
  readonly buildIdentityGate: Readonly<BuildIdentityGate>;
  readonly fileClock?: () => SessionTimeContext;
  readonly downloadEnvironment?: DownloadEnvironment;
  readonly lifecycleTarget?: PageLifecycleTarget | null;
}

export interface ExportFormatViewState extends FormatExportState {
  readonly preview: ExportPreview | null;
}

export interface ExportWorkbenchState {
  readonly canExport: boolean;
  readonly buildVerified: boolean;
  readonly buildNotice: string | null;
  readonly snapshot: ExportSnapshotV1 | null;
  readonly snapshotRevision: number | null;
  readonly snapshotStale: boolean;
  readonly paused: boolean;
  readonly pauseError: ExportError | null;
  readonly cleanupBlocked: boolean;
  readonly error: ExportError | null;
  readonly json: ExportFormatViewState;
  readonly markdown: ExportFormatViewState;
}

export interface ExportWorkbenchController extends ExportWorkbenchState {
  readonly open: () => void;
  readonly preview: (format: ExportFormat) => void;
  readonly confirm: (format: ExportFormat) => void;
  readonly cancel: (format: ExportFormat) => void;
  readonly reset: () => void;
  readonly cleanup: () => ExportResult<void>;
}

const EMPTY_FORMAT_STATE = (): ExportFormatViewState => ({
  ...createExportFormatStates().json,
  preview: null,
});

function clearFormatStateAfterCleanup(
  state: ExportFormatViewState,
  error: ExportError | null = null,
): ExportFormatViewState {
  // A browser download request is already outside application control after
  // the synchronous click. Resource cleanup must not rewrite that user-visible
  // fact to idle; only the preview/serialized references are cleared.
  if (state.state === "download-requested") {
    return { state: "download-requested", error, preview: null };
  }
  return { ...EMPTY_FORMAT_STATE(), error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: string): TextValue {
  return {
    kind: "text",
    text: value,
    text_encoding: "unicode-scalar-v1",
  };
}

function enumValue(code: string): EnumValue {
  return { kind: "enum", code };
}

function booleanValue(value: boolean): BooleanValue {
  return { kind: "boolean", value };
}

function periodValue(period: CalculationPeriodRef): PeriodRefValue {
  return {
    kind: "period-ref",
    period_kind: period.kind,
    custom_label: period.customLabel,
    revision: period.revision,
  };
}

function wirePeriod(period: CalculationPeriodRef | null | undefined) {
  return period
    ? { kind: period.kind, custom_label: period.customLabel, revision: period.revision }
    : null;
}

function wireTime(time: SessionTimeContext | CalculationTimeContext | null | undefined): TimeContext | null {
  if (!time || typeof time !== "object") return null;
  if (
    typeof time.occurredAtUtc !== "string" ||
    typeof time.recordedAtUtc !== "string" ||
    typeof time.clockSource !== "string" ||
    typeof time.timeZoneId !== "string" ||
    typeof time.utcOffset !== "string" ||
    typeof time.timeZoneSource !== "string" ||
    typeof time.timeZoneConfirmation !== "string"
  ) return null;
  return {
    occurred_at_utc: time.occurredAtUtc,
    recorded_at_utc: time.recordedAtUtc,
    clock_source: time.clockSource,
    time_zone_id: time.timeZoneId,
    utc_offset: time.utcOffset,
    time_zone_source: time.timeZoneSource,
    time_zone_confirmation: time.timeZoneConfirmation,
  };
}

function dictionaryTexts(values: readonly string[], prefix: string): DictionaryText[] {
  return values.map((text, index) => ({ id: `${prefix}-${index + 1}`, text }));
}

function availableEnvelope<T>(envelope: SessionInputEnvelope<T> | undefined): boolean {
  return envelope?.availability === "available" && envelope.value !== null && envelope.value !== undefined;
}

function declaredTaxBasis(input: WorkbenchInput): "before-tax" | "after-tax" | null {
  const envelope = input["income-tax-basis"];
  if (!availableEnvelope(envelope)) return null;
  return envelope.value === "before-tax" || envelope.value === "after-tax" ? envelope.value : null;
}

function notProvided(fieldId: string): InputRecord {
  return {
    field_id: fieldId,
    availability: "not-provided",
    value: null,
    source: null,
    evidence_status: null,
    unit: null,
    currency_code: null,
    currency_table_snapshot_id: null,
    period_ref: null,
    tax_basis: null,
    confirmed_at: null,
    assumptions: [],
    limitations: [],
  };
}

function parseMoneyValue(
  fieldId: string,
  envelope: SessionInputEnvelope<unknown> | undefined,
  currencyCode: string | null,
  currency: CurrencyInfo | null,
  period: CalculationPeriodRef | null,
  taxBasis: "before-tax" | "after-tax" | null,
  confirmedAt: string,
): ExportResult<InputRecord> {
  if (!availableEnvelope(envelope)) return { ok: true, value: notProvided(fieldId) };
  if (typeof envelope?.value !== "string" || !currencyCode || !currency) return fail("export-schema-mismatch");
  const parsed = parseMoney(envelope.value, currencyCode, DEFAULT_CURRENCY_TABLE);
  if (!parsed.ok) return fail("export-schema-mismatch");
  return {
    ok: true,
    value: {
      field_id: fieldId,
      availability: "available",
      value: {
        kind: "money",
        minor_units: parsed.value.minorUnits.toString(),
        minor_unit: parsed.value.minorUnit,
        currency_code: parsed.value.currencyCode,
      },
      source: "user-input",
      evidence_status: envelope.evidenceStatus,
      unit: currencyCode,
      currency_code: currencyCode,
      currency_table_snapshot_id: CURRENCY_TABLE_SNAPSHOT_ID,
      period_ref: wirePeriod(period),
      tax_basis: fieldId === "income" || fieldId === "fixed-cost-total" ? taxBasis : null,
      confirmed_at: confirmedAt,
      assumptions: [],
      limitations: [],
    },
  };
}

function parseHoursValue(
  envelope: SessionInputEnvelope<unknown> | undefined,
  period: CalculationPeriodRef | null,
  confirmedAt: string,
): ExportResult<InputRecord> {
  if (!availableEnvelope(envelope)) return { ok: true, value: notProvided("work-hours") };
  if (typeof envelope?.value !== "string") return fail("export-schema-mismatch");
  const parsed = parseWorkHours(envelope.value);
  if (!parsed.ok) return fail("export-schema-mismatch");
  return {
    ok: true,
    value: {
      field_id: "work-hours",
      availability: "available",
      value: { kind: "rational", numerator: parsed.value.numerator.toString(), denominator: parsed.value.denominator.toString(), unit: "hour" },
      source: "user-input",
      evidence_status: envelope.evidenceStatus,
      unit: "hour",
      currency_code: null,
      currency_table_snapshot_id: CURRENCY_TABLE_SNAPSHOT_ID,
      period_ref: wirePeriod(period),
      tax_basis: null,
      confirmed_at: confirmedAt,
      assumptions: [],
      limitations: [],
    },
  };
}

function parseAvailableValue(
  fieldId: string,
  envelope: SessionInputEnvelope<unknown> | undefined,
  period: CalculationPeriodRef | null,
  _currencyCode: string | null,
  confirmedAt: string,
): ExportResult<InputRecord> {
  if (!availableEnvelope(envelope)) return { ok: true, value: notProvided(fieldId) };
  const value = envelope?.value;
  const base = {
    field_id: fieldId,
    availability: "available" as const,
    source: "user-input" as const,
    evidence_status: envelope?.evidenceStatus ?? null,
    unit: null as string | null,
    currency_code: null as string | null,
    currency_table_snapshot_id: CURRENCY_TABLE_SNAPSHOT_ID,
    period_ref: null as InputRecord["period_ref"],
    tax_basis: null as InputRecord["tax_basis"],
    confirmed_at: confirmedAt,
    assumptions: [],
    limitations: [],
  };
  if (fieldId === "comparison-period" && isRecord(value) && typeof value.kind === "string" && typeof value.revision === "string") {
    const period = value as unknown as CalculationPeriodRef;
    return { ok: true, value: { ...base, value: periodValue(period), unit: "period" as const, period_ref: wirePeriod(period) } };
  }
  if (fieldId === "currency" && typeof value === "string") {
    return { ok: true, value: { ...base, value: enumValue(value), unit: "currency", currency_code: value } };
  }
  if (fieldId === "income-tax-basis" && (value === "before-tax" || value === "after-tax")) {
    return { ok: true, value: { ...base, value: enumValue(value), unit: "tax-basis", tax_basis: value } };
  }
  if (fieldId === "purchase-period-inclusion" && typeof value === "boolean") {
    return { ok: true, value: { ...base, value: booleanValue(value), unit: "period-inclusion", period_ref: wirePeriod(period) } };
  }
  if (fieldId === "fixed-cost-coverage" && typeof value === "string" && ["complete", "partial", "unknown"].includes(value)) {
    return { ok: true, value: { ...base, value: enumValue(value), unit: "coverage" } };
  }
  if ((fieldId === "fixed-cost-coverage-description" || fieldId === "value-expectation") && typeof value === "string") {
    return { ok: true, value: { ...base, value: textValue(value), unit: "text" } };
  }
  // Raw numeric parsing is deliberately delegated to the calculation domain.
  if (["income", "purchase-price", "fixed-cost-total"].includes(fieldId)) {
    return fail("export-schema-mismatch");
  }
  return fail("export-schema-mismatch");
}

function inputRecord(
  fieldId: string,
  input: WorkbenchInput,
  period: CalculationPeriodRef | null,
  currencyCode: string | null,
  currency: CurrencyInfo | null,
  taxBasis: "before-tax" | "after-tax" | null,
  confirmedAt: string,
): ExportResult<InputRecord> {
  const envelope = input[fieldId as keyof WorkbenchInput] as SessionInputEnvelope<unknown> | undefined;
  if (fieldId === "income" || fieldId === "purchase-price" || fieldId === "fixed-cost-total") {
    return parseMoneyValue(fieldId, envelope, currencyCode, currency, period, taxBasis, confirmedAt);
  }
  if (fieldId === "work-hours") return parseHoursValue(envelope, period, confirmedAt);
  return parseAvailableValue(fieldId, envelope, period, currencyCode, confirmedAt);
}

function wireExact(value: CalculationResult["exact"]): ResultRecord["exact_value"] {
  if (!value) return null;
  return {
    decimal: value.decimal,
    ...(value.rational ? { rational: { numerator: value.rational.numerator, denominator: value.rational.denominator } } : {}),
    ...(value.minorUnits !== undefined ? { minor_units: value.minorUnits } : {}),
    currency_code: value.currencyCode,
    unit: value.unit,
  };
}

function wireDisplay(value: CalculationResult["display"]): ResultRecord["display_value"] {
  if (!value) return null;
  return { text: value.text, decimal: value.decimal, display_digits: value.displayDigits, relation: value.relation };
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function resultRecord(result: CalculationResult): ExportResult<ResultRecord> {
  try {
    if (!isRecord(result)) return fail("export-schema-mismatch");
    if (result.source !== "ruleset-derived" || result.rulesetRef !== RULESET.ruleset_ref) return fail("export-schema-mismatch");
    if (result.availability !== "available" && result.availability !== "unavailable") return fail("export-schema-mismatch");
    if (typeof result.formulaId !== "string" || typeof result.unit !== "string") return fail("export-schema-mismatch");
    if (result.currencyCode !== null && typeof result.currencyCode !== "string") return fail("export-schema-mismatch");
    if (result.currencyTableSnapshotId === undefined || typeof result.currencyTableSnapshotId !== "string") return fail("export-schema-mismatch");
    if (result.taxBasis !== null && result.taxBasis !== "before-tax" && result.taxBasis !== "after-tax") return fail("export-schema-mismatch");
    if (!stringArray(result.dependencyFieldIds) || !stringArray(result.estimatedDependencyFieldIds) || !stringArray(result.reasonCodes)) return fail("export-schema-mismatch");
    if (!stringArray(result.assumptions) || !stringArray(result.limitations)) return fail("export-schema-mismatch");
    if (result.primaryReasonCode !== null && typeof result.primaryReasonCode !== "string") return fail("export-schema-mismatch");
    if (result.exact !== null && !isRecord(result.exact)) return fail("export-schema-mismatch");
    if (result.display !== null && !isRecord(result.display)) return fail("export-schema-mismatch");
    if (!isRecord(result.rounding) || result.rounding.mode !== "half-away-from-zero" || (result.rounding.displayDigits !== null && typeof result.rounding.displayDigits !== "number") || typeof result.rounding.rounded !== "boolean") return fail("export-schema-mismatch");
    const generatedAt = wireTime(result.timeContext);
    if (!generatedAt) return fail("export-required-metadata-missing");
    const available = result.availability === "available";
    if (available) {
      if (!result.exact || !result.display || result.rounding.displayDigits === null) return fail("export-schema-mismatch");
      if (result.evidenceStatus !== "user-confirmed" && result.evidenceStatus !== "estimated" && result.evidenceStatus !== "forecast") return fail("export-schema-mismatch");
    } else if (
      result.exact !== null ||
      result.display !== null ||
      result.rounding.displayDigits !== null ||
      result.evidenceStatus !== "insufficient-data" ||
      result.reasonCodes.length === 0 ||
      (result.reasonCodes.length > 0 && result.primaryReasonCode !== result.reasonCodes[0])
    ) {
      return fail("export-schema-mismatch");
    }
    const exact = wireExact(result.exact);
    const display = wireDisplay(result.display);
    if (available && (!exact || !display)) return fail("export-schema-mismatch");
    return {
      ok: true,
      value: {
        formula_id: result.formulaId,
        source: result.source,
        availability: result.availability,
        exact_value: available ? exact : null,
        display_value: available ? display : null,
        unit: result.unit,
        currency_code: result.currencyCode,
        currency_table_snapshot_id: result.currencyCode ? result.currencyTableSnapshotId : null,
        period_ref: wirePeriod(result.periodRef),
        tax_basis: result.taxBasis,
        evidence_status: result.evidenceStatus,
        dependency_field_ids: [...result.dependencyFieldIds],
        estimated_dependency_field_ids: [...result.estimatedDependencyFieldIds],
        reason_codes: [...result.reasonCodes],
        primary_reason_code: result.primaryReasonCode,
        assumptions: dictionaryTexts(result.assumptions, `${result.formulaId}.assumption`),
        limitations: dictionaryTexts(result.limitations, `${result.formulaId}.limitation`),
        ruleset_ref: result.rulesetRef,
        generated_at: generatedAt,
        rounding: available
          ? { mode: result.rounding.mode, display_digits: result.rounding.displayDigits as number, rounded: result.rounding.rounded }
          : null,
      },
    };
  } catch {
    return fail("export-schema-mismatch");
  }
}

function revisionInputValue(
  fieldId: string,
  value: ConfirmedInputRevision["before"],
  currencyCode: string | null,
): ExportResult<ExportSnapshotSource["inputs"][number]["value"]> {
  if (value.availability !== "available") return { ok: true, value: null };
  const envelope: SessionInputEnvelope<unknown> = {
    availability: "available",
    value: value.value,
    evidenceStatus: value.evidenceStatus,
  };
  const revisionCurrencyCode = value.currencyCode ?? currencyCode;
  const currencyResult = revisionCurrencyCode ? currencyInfo(revisionCurrencyCode) : null;
  const currency = currencyResult?.ok ? currencyResult.value : null;
  const result = inputRecord(fieldId, { [fieldId]: envelope } as unknown as WorkbenchInput, value.periodRef, revisionCurrencyCode, currency, null, "revision");
  if (!result.ok) return result;
  return { ok: true, value: result.value.value };
}

function oldResultRecord(result: NonNullable<WorkbenchResults>[number] | null): ExportOldResultSnapshot {
  const value = result as unknown as {
    formulaId: string;
    exactValue: CalculationResult["exact"];
    displayValue: CalculationResult["display"];
    unit: string | null;
    currencyCode: string | null;
    periodRef: CalculationPeriodRef | null;
    taxBasis: "before-tax" | "after-tax" | null;
    evidenceStatus: string;
    dependencyIds: readonly string[];
    rounding: { mode: "half-away-from-zero"; displayDigits: number | null; rounded: boolean } | null;
    rulesetRef: "purchase-decision-rules@1.0.0";
    currencyTableSnapshotId: string | null;
    generatedAt: SessionTimeContext | null;
  };
  const generatedAt = wireTime(value.generatedAt);
  return {
    formula_id: value.formulaId as ExportOldResultSnapshot["formula_id"],
    exact_value: wireExact(value.exactValue),
    display_value: wireDisplay(value.displayValue),
    unit: value.unit,
    currency_code: value.currencyCode,
    period_ref: wirePeriod(value.periodRef),
    tax_basis: value.taxBasis,
    evidence_status: value.evidenceStatus as ExportOldResultSnapshot["evidence_status"],
    dependency_ids: [...value.dependencyIds],
    rounding: value.rounding && value.rounding.displayDigits !== null
      ? { mode: "half-away-from-zero", display_digits: value.rounding.displayDigits, rounded: value.rounding.rounded }
      : null,
    ruleset_ref: value.rulesetRef,
    currency_table_snapshot_id: value.currencyCode ? value.currencyTableSnapshotId : null,
    generated_at: generatedAt as TimeContext,
  };
}

function revisionRecord(
  revision: ConfirmedInputRevision,
  currencyCode: string | null,
): ExportResult<ExportSnapshotSource["confirmed_revisions"][number]> {
  const timeContext = wireTime(revision.timeContext);
  if (!timeContext) return fail("export-required-metadata-missing");
  const before = revisionInputValue(revision.fieldId, revision.before, currencyCode);
  const after = revisionInputValue(revision.fieldId, revision.after, currencyCode);
  if (!before.ok) return before;
  if (!after.ok) return after;
  const oldResults = revision.oldResults.map((item) => oldResultRecord(item as unknown as CalculationResult));
  if (oldResults.some((item) => item.generated_at === null)) return fail("export-required-metadata-missing");
  return {
    ok: true,
    value: {
      sequence: revision.sequence,
      event_type: "confirmed-input-revision",
      event_status: "actual",
      actor: "user",
      time_context: timeContext,
      field_id: revision.fieldId,
      before: {
        availability: revision.before.availability,
        value: before.value,
        evidence_status: revision.before.evidenceStatus,
        unit: revision.before.unit,
        currency_code: revision.before.currencyCode,
        period_ref: wirePeriod(revision.before.periodRef),
      },
      after: {
        availability: revision.after.availability,
        value: after.value,
        evidence_status: revision.after.evidenceStatus,
        unit: revision.after.unit,
        currency_code: revision.after.currencyCode,
        period_ref: wirePeriod(revision.after.periodRef),
      },
      raw_decimal_before: revision.rawDecimalBefore,
      raw_decimal_after: revision.rawDecimalAfter,
      confirmed_at: revision.confirmedAt,
      invalidated_result_ids: [...revision.invalidatedResultIds],
      old_results: oldResults,
      ruleset_ref: "purchase-decision-rules@1.0.0",
    },
  };
}

function decisionRecord(session: WorkbenchSession): ExportSnapshotSource["decision"] {
  if (session.decision.availability !== "available") return { availability: "not-provided", decision_code: null, evidence_status: null, rationale: null, confirmed_at: null };
  return {
    availability: "available",
    decision_code: session.decision.code as DecisionCode,
    evidence_status: "user-confirmed",
    rationale: session.decision.rationale ? textValue(session.decision.rationale) : null,
    confirmed_at: session.decision.confirmedAt,
  };
}

function reviewRecord(session: WorkbenchSession): ExportSnapshotSource["review"] {
  if (session.review.availability !== "available") return { availability: "not-provided", kind: null, local_date: null, condition_text: null, evidence_status: null, confirmed_at: null };
  if (session.review.kind === "local-date") return {
    availability: "available",
    kind: "local-date",
    local_date: { kind: "local-date", value: session.review.value as string },
    condition_text: null,
    evidence_status: "user-confirmed",
    confirmed_at: session.review.confirmedAt,
  };
  return {
    availability: "available",
    kind: "condition",
    local_date: null,
    condition_text: session.review.value ? textValue(session.review.value) : null,
    evidence_status: "user-confirmed",
    confirmed_at: session.review.confirmedAt,
  };
}

/**
 * Build the strict export source from one stable workbench session.  This
 * function is pure and returns a stable non-sensitive error code on any
 * malformed/missing metadata rather than inventing a default value.
 */
export function buildExportSnapshotSource(
  session: WorkbenchSession,
  applicationBuild: ApplicationBuild,
): ExportResult<ExportSnapshotSource> {
  try {
    if (session.lifecycle !== "active" || !session.confirmed || session.confirmedStability !== "stable" || session.draft !== null) return fail("export-pending-edit");
    if (!session.confirmed.exportEligible) return fail("export-no-input");
    const captured = wireTime(session.timeContext);
    if (!captured) return fail("export-required-metadata-missing");
    const input = session.confirmed.value;
    const period = session.periodRef ?? null;
    const currencyEnvelope = input.currency;
    const currencyCode = availableEnvelope(currencyEnvelope) && typeof currencyEnvelope.value === "string" ? currencyEnvelope.value : null;
    const currencyResult = currencyCode ? currencyInfo(currencyCode, DEFAULT_CURRENCY_TABLE) : null;
    if (currencyCode && currencyResult && !currencyResult.ok) return fail("export-schema-mismatch");
    const currency = currencyResult?.ok ? currencyResult.value : null;
    const confirmedAt = session.confirmed.confirmedAt;
    if (!confirmedAt) return fail("export-required-metadata-missing");
    const taxBasis = declaredTaxBasis(input);
    const inputs: InputRecord[] = [];
    for (const fieldId of INPUT_FIELD_IDS) {
      const next = inputRecord(fieldId, input, period, currencyCode, currency, taxBasis, confirmedAt);
      if (!next.ok) return next;
      inputs.push(next.value);
    }
    const resultsEnvelope = session.derived.envelope;
    if (!resultsEnvelope || !Array.isArray(resultsEnvelope.value) || resultsEnvelope.value.length !== 5) return fail("export-schema-mismatch");
    const results: ResultRecord[] = [];
    for (const result of resultsEnvelope.value) {
      const next = resultRecord(result);
      if (!next.ok) return next;
      results.push(next.value);
    }
    const revisions: ExportSnapshotSource["confirmed_revisions"] = [];
    for (const revision of session.confirmedInputRevisions) {
      const next = revisionRecord(revision, currencyCode);
      if (!next.ok) return next;
      revisions.push(next.value);
    }
    return {
      ok: true,
      value: {
      session_revision: session.sessionRevision,
      session_revision_start: session.sessionRevision,
      session_revision_end: session.sessionRevision,
      snapshot_revision: session.sessionRevision,
      snapshot_captured_at: captured,
      application_build: applicationBuild,
      ruleset: RULESET,
      currency_table: {
        snapshot_id: CURRENCY_SNAPSHOT_METADATA.snapshotId,
        source: CURRENCY_SNAPSHOT_METADATA.sourceName,
        published_on: CURRENCY_SNAPSHOT_METADATA.publishedDate,
        read_on: CURRENCY_SNAPSHOT_METADATA.readDate,
        bytes: CURRENCY_SNAPSHOT_METADATA.bytes,
        sha256: CURRENCY_SNAPSHOT_METADATA.sha256,
      },
      dictionaries: DEFAULT_DICTIONARIES,
      comparison_context: {
        period_ref: wirePeriod(period),
        currency_code: currencyCode,
        currency_table_snapshot_id: currencyCode ? CURRENCY_TABLE_SNAPSHOT_ID : null,
        tax_basis: taxBasis,
        time_zone_id: captured.time_zone_id,
        utc_offset: captured.utc_offset,
        time_zone_source: captured.time_zone_source,
        time_zone_confirmation: captured.time_zone_confirmation,
        source_input_ids: inputs.filter((item) => item.availability === "available").map((item) => item.field_id),
      },
      inputs,
      results,
      decision: decisionRecord(session),
      review: reviewRecord(session),
      confirmed_revisions: revisions,
      notices: DEFAULT_NOTICES,
      },
    };
  } catch {
    return fail("export-schema-mismatch");
  }
}

function defaultFileClock(): SessionTimeContext {
  const now = new Date().toISOString();
  return {
    occurredAtUtc: now,
    recordedAtUtc: now,
    clockSource: "device-clock",
    timeZoneId: "Etc/UTC",
    utcOffset: "+00:00",
    timeZoneSource: "utc-fallback",
    timeZoneConfirmation: "unconfirmed",
  };
}

function formatStateWithPreview(
  current: ExportFormatViewState,
  event: Parameters<typeof transitionExportState>[1],
  preview: ExportPreview | null,
): ExportResult<ExportFormatViewState> {
  const next = transitionExportState(current, event);
  if (!next.ok) return next;
  return { ok: true, value: { ...next.value, preview } };
}

function stableError(error: ExportError): ExportError {
  return { code: error.code, message: error.message };
}

function sameApplicationBuild(
  left: Readonly<ApplicationBuild> | null,
  right: Readonly<ApplicationBuild> | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return left === right;
  return left.app_version === right.app_version
    && left.git_commit_sha === right.git_commit_sha
    && left.artifact_manifest_sha256 === right.artifact_manifest_sha256
    && left.config_version === right.config_version;
}

function sameBuildIdentityGate(
  left: Readonly<BuildIdentityGate>,
  right: Readonly<BuildIdentityGate>,
): boolean {
  return left.status === right.status
    && left.canStartSession === right.canStartSession
    && left.canExport === right.canExport
    && left.reason === right.reason
    && sameApplicationBuild(left.applicationBuild, right.applicationBuild);
}

function sameExportOptions(left: ExportWorkbenchOptions, right: ExportWorkbenchOptions): boolean {
  return sameBuildIdentityGate(left.buildIdentityGate, right.buildIdentityGate)
    && left.fileClock === right.fileClock
    && left.downloadEnvironment === right.downloadEnvironment
    && left.lifecycleTarget === right.lifecycleTarget;
}

function gateIsVerified(gate: Readonly<BuildIdentityGate>): boolean {
  return gate.status === "verified" && gate.canExport && gate.applicationBuild !== null;
}

function gateNotice(gate: Readonly<BuildIdentityGate>): string | null {
  return gateIsVerified(gate) ? null : "未验证实现预览，不能导出。";
}

function useExportWorkbenchController(
  session: WorkbenchSession,
  options: ExportWorkbenchOptions,
): ExportWorkbenchController {
  const optionsRef = useRef(options);
  const previousOptionsRef = useRef(options);
  // Keep event callbacks pointed at the current composition inputs. The
  // effect below separately invalidates any snapshot made under older inputs.
  optionsRef.current = options;
  const requestsRef = useRef<Set<DownloadRequest>>(new Set());
  const mountedRef = useRef(true);
  const [state, setState] = useState<ExportWorkbenchState>(() => ({
    canExport: false,
    buildVerified: gateIsVerified(options.buildIdentityGate),
    buildNotice: gateNotice(options.buildIdentityGate),
    snapshot: null,
    snapshotRevision: null,
    snapshotStale: false,
    paused: false,
    pauseError: null,
    cleanupBlocked: false,
    error: null,
    json: EMPTY_FORMAT_STATE(),
    markdown: EMPTY_FORMAT_STATE(),
  }));

  const cleanupResources = useCallback((): ExportResult<void> => {
    let failure: ExportError | null = null;
    for (const request of requestsRef.current) {
      try {
        const result = request.cleanup();
        if (!result.ok) failure = stableError(result.error);
      } catch {
        failure = exportError("export-resource-cleanup-failed");
      }
    }
    requestsRef.current.clear();
    if (failure) {
      // The adapter owns the process-wide fail-closed boundary. This call is
      // also required for unmount cleanup, where React cannot accept a state
      // update but the next controller must not issue a new request.
      markCleanupBlocked();
      return { ok: false, error: failure };
    }
    return { ok: true, value: undefined };
  }, []);

  const clearState = useCallback((cleanup = true) => {
    const result = cleanup ? cleanupResources() : { ok: true as const, value: undefined };
    if (!mountedRef.current) return result;
    if (!result.ok) {
      setState((current) => ({
        ...current,
        snapshot: null,
        snapshotRevision: null,
        snapshotStale: current.snapshot !== null || current.snapshotStale,
        paused: true,
        pauseError: result.error,
        cleanupBlocked: true,
        error: result.error,
        json: clearFormatStateAfterCleanup(current.json, result.error),
        markdown: clearFormatStateAfterCleanup(current.markdown, result.error),
      }));
      return result;
    }
    setState((current) => ({
      ...current,
      snapshot: null,
      snapshotRevision: null,
      snapshotStale: false,
      error: null,
      json: clearFormatStateAfterCleanup(current.json),
      markdown: clearFormatStateAfterCleanup(current.markdown),
    }));
    return result;
  }, [cleanupResources]);

  const pauseForContractBreach = useCallback((error: ExportError) => {
    const cleanup = cleanupResources();
    setState((current) => {
      if (current.snapshot) markSnapshotStale(current.snapshot);
      return {
        ...current,
        snapshot: null,
        snapshotRevision: null,
        snapshotStale: true,
        paused: true,
        pauseError: error,
        cleanupBlocked: current.cleanupBlocked || !cleanup.ok,
        error,
        // A contract breach is a whole-build boundary. Do not leave either
        // format's old preview or a clickable confirmation behind.
        json: EMPTY_FORMAT_STATE(),
        markdown: EMPTY_FORMAT_STATE(),
      };
    });
  }, [cleanupResources]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // No setState is safe after unmount; cleanupResources still marks the
      // adapter's global cleanup block when an object URL cannot be proven
      // released, so a later controller remains fail-closed.
      cleanupResources();
    };
  }, [cleanupResources]);

  useEffect(() => {
    const previous = previousOptionsRef.current;
    if (sameExportOptions(previous, options)) return;
    previousOptionsRef.current = options;
    const cleanup = cleanupResources();
    setState((current) => {
      const hadSnapshot = current.snapshot !== null || current.snapshotRevision !== null;
      if (current.snapshot) markSnapshotStale(current.snapshot);
      const gate = options.buildIdentityGate;
      return {
        ...current,
        canExport: false,
        buildVerified: gateIsVerified(gate),
        buildNotice: gateNotice(gate),
        snapshot: null,
        snapshotRevision: null,
        snapshotStale: hadSnapshot || current.snapshotStale,
        paused: current.paused || !cleanup.ok,
        pauseError: cleanup.ok ? current.pauseError : cleanup.error,
        cleanupBlocked: current.cleanupBlocked || !cleanup.ok,
        error: cleanup.ok
          ? hadSnapshot ? exportError("export-snapshot-stale") : null
          : cleanup.error,
        json: clearFormatStateAfterCleanup(current.json, cleanup.ok ? null : cleanup.error),
        markdown: clearFormatStateAfterCleanup(current.markdown, cleanup.ok ? null : cleanup.error),
      };
    });
  }, [cleanupResources, options]);

  useEffect(() => {
    if (session.lifecycle === "exited") {
      clearState();
      return;
    }
    setState((current) => {
      if (current.snapshotRevision === null || current.snapshotRevision === session.sessionRevision) return current;
      if (current.snapshot) markSnapshotStale(current.snapshot);
      const stale = exportError("export-snapshot-stale");
      return {
        ...current,
        snapshot: null,
        snapshotRevision: null,
        snapshotStale: true,
        error: stale,
        json: EMPTY_FORMAT_STATE(),
        markdown: EMPTY_FORMAT_STATE(),
      };
    });
  }, [clearState, session.lifecycle, session.sessionRevision]);

  const lifecycleTarget = options.lifecycleTarget ?? (typeof window === "undefined" ? null : window);
  useEffect(() => {
    const target = lifecycleTarget;
    if (!target) return undefined;
    const listener = () => { clearState(); };
    target.addEventListener("pagehide", listener);
    return () => {
      let cleanupError: ExportError | null = null;
      try {
        target.removeEventListener("pagehide", listener);
      } catch {
        cleanupError = exportError("export-resource-cleanup-failed");
        markCleanupBlocked();
      }
      const cleanup = cleanupResources();
      if (!cleanup.ok) cleanupError = cleanup.error;
      if (cleanupError && mountedRef.current) {
        setState((current) => ({
          ...current,
          paused: true,
          pauseError: cleanupError,
          cleanupBlocked: true,
          error: cleanupError,
          snapshot: null,
          snapshotRevision: null,
          snapshotStale: true,
          json: clearFormatStateAfterCleanup(current.json, cleanupError),
          markdown: clearFormatStateAfterCleanup(current.markdown, cleanupError),
        }));
      }
    };
  }, [clearState, cleanupResources, lifecycleTarget]);

  const open = useCallback(() => {
    if (!optionsRef.current.buildIdentityGate.canExport || !optionsRef.current.buildIdentityGate.applicationBuild) {
      setState((current) => ({ ...current, buildNotice: "未验证实现预览，不能导出。", error: null }));
      return;
    }
    if (state.cleanupBlocked || state.paused) return;
    const source = buildExportSnapshotSource(session, optionsRef.current.buildIdentityGate.applicationBuild);
    if (!source.ok) {
      if (source.error.code === "export-contract-breach") pauseForContractBreach(source.error);
      else setState((current) => ({ ...current, error: source.error }));
      return;
    }
    const frozen = freezeExportSnapshot(source.value);
    if (!frozen.ok) {
      if (frozen.error.code === "export-contract-breach") pauseForContractBreach(frozen.error);
      else setState((current) => ({ ...current, error: frozen.error }));
      return;
    }
    setState((current) => ({
      ...current,
      canExport: true,
      snapshot: frozen.value,
      snapshotRevision: session.sessionRevision,
      snapshotStale: false,
      error: null,
      json: EMPTY_FORMAT_STATE(),
      markdown: EMPTY_FORMAT_STATE(),
    }));
  }, [pauseForContractBreach, session, state.cleanupBlocked, state.paused]);

  const preview = useCallback((format: ExportFormat) => {
    if (state.cleanupBlocked || state.paused || !state.snapshot || state.snapshotRevision !== session.sessionRevision) {
      setState((current) => ({ ...current, error: exportError("export-snapshot-stale"), snapshotStale: true }));
      return;
    }
    const target = state[format];
    const previewed = previewExport(state.snapshot, format, session.sessionRevision);
    if (!previewed.ok) {
      if (previewed.error.code === "export-contract-breach") pauseForContractBreach(previewed.error);
      else setState((current) => ({ ...current, error: previewed.error, [format]: { ...current[format], state: "failed", error: previewed.error } }));
      return;
    }
    const previewState = formatStateWithPreview(target, { type: "preview" }, previewed.value);
    if (!previewState.ok) {
      setState((current) => ({ ...current, error: previewState.error }));
      return;
    }
    const ready = formatStateWithPreview(previewState.value, { type: "ready" }, previewed.value);
    if (!ready.ok) {
      setState((current) => ({ ...current, error: ready.error }));
      return;
    }
    setState((current) => ({ ...current, error: null, [format]: ready.value }));
  }, [pauseForContractBreach, session.sessionRevision, state]);

  const confirm = useCallback((format: ExportFormat) => {
    if (state.cleanupBlocked || state.paused || !state.snapshot || state.snapshotRevision !== session.sessionRevision) {
      setState((current) => ({ ...current, error: exportError("export-snapshot-stale"), snapshotStale: true }));
      return;
    }
    if (state[format].state !== "ready" || !state[format].preview) {
      setState((current) => ({ ...current, error: exportError("export-download-request-failed") }));
      return;
    }
    const generating = formatStateWithPreview(state[format], { type: "generate" }, state[format].preview);
    if (!generating.ok) {
      setState((current) => ({ ...current, error: generating.error }));
      return;
    }
    const generatedAt = wireTime((optionsRef.current.fileClock ?? defaultFileClock)());
    if (!generatedAt) {
      const error = exportError("export-required-metadata-missing");
      setState((current) => ({ ...current, error, [format]: { ...current[format], state: "failed", error } }));
      return;
    }
    const options = format === "json"
      ? ({ file_generated_at: generatedAt, current_session_revision: session.sessionRevision } satisfies SerializeJsonOptions)
      : ({ file_generated_at: generatedAt, current_session_revision: session.sessionRevision } satisfies SerializeMarkdownOptions);
    const serialized = format === "json"
      ? serializeJsonSnapshot(state.snapshot, options)
      : serializeMarkdownSnapshot(state.snapshot, options);
    if (!serialized.ok) {
      if (serialized.error.code === "export-contract-breach") pauseForContractBreach(serialized.error);
      else setState((current) => ({ ...current, error: serialized.error, [format]: { ...current[format], state: "failed", error: serialized.error } }));
      return;
    }
    const requested = requestBrowserDownload({
      format,
      text: serialized.value.text,
      file_name: serialized.value.file_name,
      mime: serialized.value.mime as "application/json" | "text/markdown;charset=UTF-8;variant=GFM",
      explicit_user_action: true,
      environment: optionsRef.current.downloadEnvironment,
    });
    if (!requested.ok) {
      if (requested.error.code === "export-contract-breach") pauseForContractBreach(requested.error);
      else setState((current) => ({ ...current, error: requested.error, [format]: { ...current[format], state: "failed", error: requested.error } }));
      return;
    }
    requestsRef.current.add(requested.value);
    const done = formatStateWithPreview(generating.value, { type: "download-requested" }, state[format].preview);
    if (!done.ok) {
      requested.value.cleanup();
      requestsRef.current.delete(requested.value);
      setState((current) => ({ ...current, error: done.error }));
      return;
    }
    setState((current) => ({ ...current, error: null, [format]: done.value }));
  }, [pauseForContractBreach, session.sessionRevision, state]);

  const cancel = useCallback((format: ExportFormat) => {
    const target = state[format];
    const cancelled = formatStateWithPreview(target, { type: "cancel" }, null);
    if (!cancelled.ok) {
      setState((current) => ({ ...current, error: cancelled.error }));
      return;
    }
    setState((current) => ({ ...current, error: null, [format]: cancelled.value }));
  }, [state]);

  const reset = useCallback(() => { clearState(); }, [clearState]);

  const cleanup = useCallback(() => clearState(), [clearState]);

  const eligible = session.lifecycle === "active" && session.confirmed !== null && session.confirmedStability === "stable" && session.draft === null && session.confirmed.exportEligible;
  const currentBuildVerified = gateIsVerified(options.buildIdentityGate);
  const optionsCurrent = sameExportOptions(previousOptionsRef.current, options);
  const visibleState = optionsCurrent
    ? state
    : {
        ...state,
        canExport: false,
        buildVerified: currentBuildVerified,
        buildNotice: gateNotice(options.buildIdentityGate),
        snapshot: null,
        snapshotRevision: null,
        snapshotStale: true,
        json: EMPTY_FORMAT_STATE(),
        markdown: EMPTY_FORMAT_STATE(),
      };
  return {
    ...visibleState,
    canExport: optionsCurrent && currentBuildVerified && eligible && !state.paused && !state.cleanupBlocked,
    buildVerified: currentBuildVerified,
    buildNotice: gateNotice(options.buildIdentityGate),
    open,
    preview,
    confirm,
    cancel,
    reset,
    cleanup,
  };
}

export function useExportWorkbenchControllerForSession(
  session: WorkbenchSession,
  options: ExportWorkbenchOptions,
): ExportWorkbenchController {
  return useExportWorkbenchController(session, options);
}

export { useExportWorkbenchControllerForSession as useExportWorkbenchController };
