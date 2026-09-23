import {
  parseAmount,
  parseWorkHours,
  type DecisionInput,
  type NumericField,
  type WorkTimeInput,
} from "../domain/calculation";

export const ASSIST_FIELD_NAMES = [
  "income",
  "taxBasis",
  "purchaseAmount",
  "workTimeMode",
  "workDaysPerWeek",
  "workHoursPerDay",
  "workHours",
  "fixedExpenses",
  "fixedCostCoverage",
  "purchaseIncluded",
] as const;

export type AssistFieldName = (typeof ASSIST_FIELD_NAMES)[number];
export type AssistStatus = "present" | "estimated" | "missing" | "ambiguous" | "unsupported" | "unknown";

export interface AssistField {
  readonly value: string | null;
  readonly span: string | null;
  readonly status: AssistStatus;
}

export type AssistFields = Partial<Record<AssistFieldName, AssistField>>;

export interface AssistResponse {
  readonly fields: AssistFields;
}

export type AssistEstimatedValues = Readonly<Record<NumericField, string | null>>;

export const EMPTY_ASSIST_ESTIMATES: AssistEstimatedValues = {
  income: null,
  workHours: null,
  fixedExpenses: null,
  purchaseAmount: null,
};

export function areNumericValuesEquivalent(field: NumericField, left: string, right: string): boolean {
  if (left === right) return true;
  if (field === "workHours") {
    const first = parseWorkHours(left);
    const second = parseWorkHours(right);
    return first.ok && second.ok
      && first.value.numerator * second.value.denominator === second.value.numerator * first.value.denominator;
  }
  const first = parseAmount(left, true);
  const second = parseAmount(right, true);
  return first.ok && second.ok && first.value.cents === second.value.cents;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssistFieldName(value: string): value is AssistFieldName {
  return (ASSIST_FIELD_NAMES as readonly string[]).includes(value);
}

function isAssistStatus(value: unknown): value is AssistStatus {
  return value === "present" || value === "estimated" || value === "missing"
    || value === "ambiguous" || value === "unsupported" || value === "unknown";
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isDecimalWithin(raw: string, maximum: number): boolean {
  if (!parseWorkHours(raw).ok) return false;
  const value = Number(raw);
  return value > 0 && value <= maximum;
}

export function isValidAssistValue(field: AssistFieldName, value: string): boolean {
  switch (field) {
    case "income":
    case "purchaseAmount":
      return parseAmount(value, false).ok;
    case "fixedExpenses":
      return parseAmount(value, true).ok;
    case "workHours":
      return parseWorkHours(value).ok;
    case "workDaysPerWeek":
      return isDecimalWithin(value, 7);
    case "workHoursPerDay":
      return isDecimalWithin(value, 24);
    case "taxBasis":
      return value === "before-tax" || value === "after-tax";
    case "workTimeMode":
      return value === "custom" || value === "monthly";
    case "fixedCostCoverage":
      return value === "complete" || value === "partial" || value === "unknown";
    case "purchaseIncluded":
      return value === "included" || value === "excluded";
  }
}

/** Validate the local API response, including that every assigned value cites this turn's text. */
export function parseAssistResponse(value: unknown, text: string): AssistResponse | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["fields"]) || !isRecord(value.fields)) return null;
  const fields: AssistFields = {};
  for (const [key, raw] of Object.entries(value.fields)) {
    if (!isAssistFieldName(key) || !isRecord(raw) || !hasOnlyKeys(raw, ["value", "span", "status"]) || !isAssistStatus(raw.status)) return null;
    if ((typeof raw.value !== "string" && raw.value !== null)
      || (typeof raw.span !== "string" && raw.span !== null)) return null;

    const field = key;
    const candidate = raw.status === "present" || raw.status === "estimated";
    if (candidate) {
      if (typeof raw.value !== "string" || typeof raw.span !== "string" || !raw.span || !text.includes(raw.span)) return null;
      if (!isValidAssistValue(field, raw.value)) return null;
    } else if (raw.value !== null) {
      return null;
    } else if (typeof raw.span === "string" && raw.span && !text.includes(raw.span)) {
      return null;
    }
    fields[field] = { value: raw.value as string | null, span: raw.span as string | null, status: raw.status };
  }

  const mode = fields.workTimeMode;
  if (mode?.value === "monthly" && (fields.workDaysPerWeek?.value || fields.workHoursPerDay?.value)) return null;
  if (mode?.value === "custom" && fields.workHours?.value) return null;
  return { fields };
}

export function currentMode(input: DecisionInput): WorkTimeInput["mode"] {
  return input.workTime?.mode ?? "monthly";
}

export function scheduleValues(input: DecisionInput): { daysPerWeek: string; hoursPerDay: string } {
  const mode = currentMode(input);
  if (input.workTime?.mode === "custom") return { daysPerWeek: input.workTime.daysPerWeek, hoursPerDay: input.workTime.hoursPerDay };
  if (mode === "five-day") return { daysPerWeek: "5", hoursPerDay: "8" };
  if (mode === "six-day") return { daysPerWeek: "6", hoursPerDay: "8" };
  return { daysPerWeek: "", hoursPerDay: "" };
}

function clearWorkTime(input: DecisionInput): DecisionInput {
  return {
    ...input,
    workHours: "",
    workTime: { mode: "unselected" },
    evidence: { ...input.evidence, workHours: "" },
  };
}

function writeWorkTimeMode(input: DecisionInput, mode: "custom" | "monthly"): DecisionInput {
  if (currentMode(input) === mode) return input;
  return {
    ...input,
    workHours: "",
    workTime: mode === "custom" ? { mode, daysPerWeek: "", hoursPerDay: "" } : { mode },
    evidence: { ...input.evidence, workHours: "" },
  };
}

function writeSchedulePart(input: DecisionInput, field: "workDaysPerWeek" | "workHoursPerDay", value: string): DecisionInput {
  const base: DecisionInput = currentMode(input) === "custom"
    ? input
    : {
      ...input,
      workHours: "",
      workTime: { mode: "custom" as const, ...scheduleValues(input) },
      evidence: { ...input.evidence, workHours: "" },
    };
  if (base.workTime?.mode !== "custom") return base;
  return {
    ...base,
    workTime: field === "workDaysPerWeek"
      ? { ...base.workTime, daysPerWeek: value }
      : { ...base.workTime, hoursPerDay: value },
  };
}

function clearSchedulePart(input: DecisionInput, field: "workDaysPerWeek" | "workHoursPerDay"): DecisionInput {
  const values = scheduleValues(input);
  if (currentMode(input) === "monthly" || currentMode(input) === "unselected") {
    return {
      ...input,
      workHours: "",
      workTime: { mode: "custom", daysPerWeek: field === "workDaysPerWeek" ? "" : values.daysPerWeek, hoursPerDay: field === "workHoursPerDay" ? "" : values.hoursPerDay },
      evidence: { ...input.evidence, workHours: "" },
    };
  }
  return {
    ...input,
    workHours: "",
    workTime: {
      mode: "custom",
      daysPerWeek: field === "workDaysPerWeek" ? "" : values.daysPerWeek,
      hoursPerDay: field === "workHoursPerDay" ? "" : values.hoursPerDay,
    },
    evidence: { ...input.evidence, workHours: "" },
  };
}

function numericFieldForAssist(field: AssistFieldName): NumericField | null {
  return field === "income" || field === "workHours" || field === "fixedExpenses" || field === "purchaseAmount"
    ? field
    : null;
}

function clearAssistField(input: DecisionInput, field: AssistFieldName): DecisionInput {
  switch (field) {
    case "income":
      return { ...input, income: "", evidence: { ...input.evidence, income: "" } };
    case "taxBasis":
      return { ...input, taxBasis: "" };
    case "purchaseAmount":
      return { ...input, purchaseAmount: "", evidence: { ...input.evidence, purchaseAmount: "" } };
    case "workTimeMode":
      return clearWorkTime(input);
    case "workDaysPerWeek":
    case "workHoursPerDay":
      return clearSchedulePart(input, field);
    case "workHours":
      return currentMode(input) === "monthly"
        ? { ...input, workHours: "", evidence: { ...input.evidence, workHours: "" } }
        : clearWorkTime(input);
    case "fixedExpenses":
      return { ...input, fixedExpenses: "", evidence: { ...input.evidence, fixedExpenses: "" } };
    case "fixedCostCoverage":
      return { ...input, fixedCostCoverage: "" };
    case "purchaseIncluded":
      return { ...input, purchaseIncluded: "" };
  }
}

function writeAssistField(input: DecisionInput, field: AssistFieldName, value: string, status: "present" | "estimated"): DecisionInput {
  const evidenceValue = status === "estimated" ? "estimated" : "";
  switch (field) {
    case "income":
      return { ...input, income: value, evidence: { ...input.evidence, income: evidenceValue } };
    case "taxBasis":
      return { ...input, taxBasis: value as "before-tax" | "after-tax" };
    case "purchaseAmount":
      return { ...input, purchaseAmount: value, evidence: { ...input.evidence, purchaseAmount: evidenceValue } };
    case "workTimeMode":
      return writeWorkTimeMode(input, value as "custom" | "monthly");
    case "workDaysPerWeek":
    case "workHoursPerDay":
      return writeSchedulePart(input, field, value);
    case "workHours": {
      const next = writeWorkTimeMode(input, "monthly");
      return { ...next, workHours: value, evidence: { ...next.evidence, workHours: evidenceValue } };
    }
    case "fixedExpenses":
      return { ...input, fixedExpenses: value, evidence: { ...input.evidence, fixedExpenses: evidenceValue } };
    case "fixedCostCoverage":
      return { ...input, fixedCostCoverage: value as DecisionInput["fixedCostCoverage"] };
    case "purchaseIncluded":
      return { ...input, purchaseIncluded: value as DecisionInput["purchaseIncluded"] };
  }
}

export function applyQuickAssistAnswer(input: DecisionInput, field: AssistFieldName, value: string): DecisionInput {
  if (!isValidAssistValue(field, value)) return input;
  switch (field) {
    case "income":
      return { ...input, income: value, evidence: { ...input.evidence, income: "" } };
    case "taxBasis":
      return { ...input, taxBasis: value as "before-tax" | "after-tax" };
    case "purchaseAmount":
      return { ...input, purchaseAmount: value, evidence: { ...input.evidence, purchaseAmount: "" } };
    case "workTimeMode":
      return writeWorkTimeMode(input, value as "custom" | "monthly");
    case "workDaysPerWeek":
    case "workHoursPerDay":
      return writeSchedulePart(input, field, value);
    case "workHours": {
      const next = writeWorkTimeMode(input, "monthly");
      return { ...next, workHours: value, evidence: { ...next.evidence, workHours: "" } };
    }
    case "fixedExpenses":
      return { ...input, fixedExpenses: value, evidence: { ...input.evidence, fixedExpenses: "" } };
    case "fixedCostCoverage":
      return { ...input, fixedCostCoverage: value as DecisionInput["fixedCostCoverage"] };
    case "purchaseIncluded":
      return { ...input, purchaseIncluded: value as DecisionInput["purchaseIncluded"] };
  }
}

export interface AppliedAssistPatch {
  readonly input: DecisionInput;
  readonly estimatedValues: AssistEstimatedValues;
  readonly changedFields: readonly AssistFieldName[];
}

export function finalizeAssistInput(
  input: DecisionInput,
  estimatedValues: AssistEstimatedValues,
  approximateInput: boolean,
): DecisionInput {
  const evidence = { ...input.evidence };
  for (const field of ["income", "workHours", "fixedExpenses", "purchaseAmount"] as const) {
    if (!input[field].trim()) continue;
    evidence[field] = approximateInput || estimatedValues[field] === input[field] ? "estimated" : "user-confirmed";
  }
  return { ...input, evidence };
}

/** Apply explicit current-turn values while preserving missing fields and clearing unresolved ones. */
export function applyAssistPatch(
  input: DecisionInput,
  previousEstimates: AssistEstimatedValues,
  fields: AssistFields,
): AppliedAssistPatch {
  let next = input;
  const estimatedValues = { ...previousEstimates };
  const changedFields: AssistFieldName[] = [];
  const customModeWithSchedulePatch = fields.workTimeMode?.value === "custom"
    && (currentMode(input) === "five-day" || currentMode(input) === "six-day")
    && ([fields.workDaysPerWeek, fields.workHoursPerDay].some((field) => field?.status === "present" || field?.status === "estimated"));
  if (customModeWithSchedulePatch) {
    next = {
      ...next,
      workHours: "",
      workTime: { mode: "custom", ...scheduleValues(next) },
      evidence: { ...next.evidence, workHours: "" },
    };
  }

  for (const field of ASSIST_FIELD_NAMES) {
    const patch = fields[field];
    if (!patch || patch.status === "missing") continue;
    const numericField = numericFieldForAssist(field);
    if (patch.status === "present" || patch.status === "estimated") {
      if (patch.value === null) continue;
      next = writeAssistField(next, field, patch.value, patch.status);
      if (numericField) estimatedValues[numericField] = patch.status === "estimated" ? patch.value : null;
    } else {
      next = clearAssistField(next, field);
      if (numericField) estimatedValues[numericField] = null;
    }
    changedFields.push(field);
  }

  return { input: next, estimatedValues, changedFields: [...new Set(changedFields)] };
}

export function assistValue(input: DecisionInput, field: AssistFieldName): string {
  switch (field) {
    case "income": return input.income;
    case "taxBasis": return input.taxBasis;
    case "purchaseAmount": return input.purchaseAmount;
    case "workTimeMode": {
      const mode = currentMode(input);
      return mode === "custom" || mode === "five-day" || mode === "six-day" ? "custom" : mode === "monthly" ? "monthly" : "";
    }
    case "workDaysPerWeek": return scheduleValues(input).daysPerWeek;
    case "workHoursPerDay": return scheduleValues(input).hoursPerDay;
    case "workHours": return currentMode(input) === "monthly" ? input.workHours : "";
    case "fixedExpenses": return input.fixedExpenses;
    case "fixedCostCoverage": return input.fixedCostCoverage;
    case "purchaseIncluded": return input.purchaseIncluded;
  }
}

const QUESTION_CONTEXT: Readonly<Record<AssistFieldName, readonly AssistFieldName[]>> = {
  income: ["income"],
  taxBasis: ["income"],
  purchaseAmount: ["purchaseAmount"],
  workTimeMode: ["workTimeMode", "workDaysPerWeek", "workHoursPerDay", "workHours"],
  workDaysPerWeek: ["workTimeMode", "workDaysPerWeek", "workHoursPerDay"],
  workHoursPerDay: ["workTimeMode", "workDaysPerWeek", "workHoursPerDay"],
  workHours: ["workTimeMode", "workHours"],
  fixedExpenses: ["fixedExpenses"],
  fixedCostCoverage: ["fixedExpenses", "fixedCostCoverage"],
  purchaseIncluded: ["purchaseAmount", "purchaseIncluded"],
};

export type AssistContext = Partial<Record<AssistFieldName, { readonly value: string; readonly span: string | null }>>;

export function assistContextFor(
  input: DecisionInput,
  questionId: AssistFieldName | null,
  hasStarted: boolean,
  notes: Partial<Record<AssistFieldName, AssistField>>,
): AssistContext {
  if (questionId === null && !hasStarted) return {};
  const fields = questionId === null
    ? ["income", "taxBasis", "purchaseAmount", "fixedExpenses", "fixedCostCoverage", "purchaseIncluded"] as const
    : QUESTION_CONTEXT[questionId];
  const context: AssistContext = {};
  for (const field of fields) {
    const value = assistValue(input, field);
    if (!value) continue;
    const note = notes[field];
    context[field] = {
      value,
      span: note?.value === value ? note.span : null,
    };
  }
  return context;
}

export type AssistQuestionState = {
  readonly skipped: ReadonlySet<AssistFieldName>;
  readonly clarifications: Readonly<Partial<Record<AssistFieldName, number>>>;
};

function mayAsk(field: AssistFieldName, state: AssistQuestionState): boolean {
  return !state.skipped.has(field) && (state.clarifications[field] ?? 0) < 2;
}

function hasWorkTime(input: DecisionInput): boolean {
  const mode = currentMode(input);
  if (mode === "calendar") return true;
  if (mode === "five-day" || mode === "six-day") return true;
  if (mode === "custom") {
    const workTime = input.workTime;
    return Boolean(workTime?.mode === "custom"
      && isValidAssistValue("workDaysPerWeek", workTime.daysPerWeek)
      && isValidAssistValue("workHoursPerDay", workTime.hoursPerDay));
  }
  return mode === "monthly" && isValidAssistValue("workHours", input.workHours);
}

export function nextAssistQuestion(
  input: DecisionInput,
  state: AssistQuestionState,
  marginRequested: boolean,
): AssistFieldName | null {
  if (!isValidAssistValue("income", input.income) && mayAsk("income", state)) return "income";
  if (!isValidAssistValue("taxBasis", input.taxBasis) && mayAsk("taxBasis", state)) return "taxBasis";
  if (!isValidAssistValue("purchaseAmount", input.purchaseAmount) && mayAsk("purchaseAmount", state)) return "purchaseAmount";

  const mode = currentMode(input);
  if (mode === "unselected") {
    if (mayAsk("workTimeMode", state)) return "workTimeMode";
  } else if (!hasWorkTime(input)) {
    if (mode === "custom") {
      const schedule = input.workTime;
      if (schedule?.mode === "custom" && !isValidAssistValue("workDaysPerWeek", schedule.daysPerWeek) && mayAsk("workDaysPerWeek", state)) return "workDaysPerWeek";
      if (schedule?.mode === "custom" && !isValidAssistValue("workHoursPerDay", schedule.hoursPerDay) && mayAsk("workHoursPerDay", state)) return "workHoursPerDay";
    } else if (mode === "monthly" && !isValidAssistValue("workHours", input.workHours) && mayAsk("workHours", state)) {
      return "workHours";
    }
  }

  if (!marginRequested) return null;
  if (input.fixedCostCoverage === "partial" || input.fixedCostCoverage === "unknown") return null;
  if (!isValidAssistValue("fixedExpenses", input.fixedExpenses) && mayAsk("fixedExpenses", state)) return "fixedExpenses";
  if (!isValidAssistValue("fixedCostCoverage", input.fixedCostCoverage) && mayAsk("fixedCostCoverage", state)) return "fixedCostCoverage";
  if (input.fixedCostCoverage !== "complete") return null;
  if (!isValidAssistValue("purchaseIncluded", input.purchaseIncluded) && mayAsk("purchaseIncluded", state)) return "purchaseIncluded";
  return null;
}

export interface AssistQuestionTransition {
  readonly questionId: AssistFieldName | null;
  readonly state: AssistQuestionState;
  readonly firstClarifications: ReadonlySet<AssistFieldName>;
}

export function advanceAssistQuestion(
  input: DecisionInput,
  state: AssistQuestionState,
  marginRequested: boolean,
  firstClarifications: ReadonlySet<AssistFieldName> = new Set(),
): AssistQuestionTransition {
  const questionId = nextAssistQuestion(input, state, marginRequested);
  if (!questionId) return { questionId: null, state, firstClarifications };
  const nextClarifications = {
    ...state.clarifications,
    [questionId]: firstClarifications.has(questionId) ? 2 : (state.clarifications[questionId] ?? 0) + 1,
  };
  const nextFirstClarifications = new Set(firstClarifications);
  nextFirstClarifications.delete(questionId);
  return {
    questionId,
    state: { skipped: state.skipped, clarifications: nextClarifications },
    firstClarifications: nextFirstClarifications,
  };
}

export function noteForDraftField(
  value: string,
  status: AssistStatus = "present",
): AssistField {
  return { value: value || null, span: null, status };
}
