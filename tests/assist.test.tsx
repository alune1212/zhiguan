import { describe, expect, it } from "vitest";

import {
  EMPTY_ASSIST_ESTIMATES,
  advanceAssistQuestion,
  areNumericValuesEquivalent,
  applyAssistPatch,
  applyQuickAssistAnswer,
  assistContextFor,
  finalizeAssistInput,
  nextAssistQuestion,
  parseAssistResponse,
  type AssistField,
  type AssistFields,
  type AssistQuestionState,
} from "../src/app/assist-flow";
import type { DecisionInput } from "../src/domain/calculation";

const blankInput: DecisionInput = {
  income: "",
  workHours: "",
  workTime: { mode: "unselected" },
  fixedExpenses: "",
  purchaseAmount: "",
  taxBasis: "",
  fixedCostCoverage: "",
  purchaseIncluded: "",
  valueExpectation: "",
  evidence: { income: "", workHours: "", fixedExpenses: "", purchaseAmount: "" },
};

function answer(value: string | null, span: string | null, status: AssistField["status"]): AssistField {
  return { value, span, status };
}

describe("conversation assist flow", () => {
  it("validates the closed response shape and requires current-turn source spans", () => {
    const body = {
      fields: {
        income: answer("8000", "到手八千", "present"),
        taxBasis: answer("after-tax", "到手", "present"),
        purchaseAmount: answer("3000", "三千元", "present"),
      },
    };
    expect(parseAssistResponse(body, "税后到手八千，想买三千元的相机。" )).toEqual(body);
    expect(parseAssistResponse({ ...body, extra: true }, "税后到手八千，想买三千元的相机。" )).toBeNull();
    expect(parseAssistResponse({ fields: { ...body.fields, invented: answer("1", "到手", "present") } }, "到手" )).toBeNull();
    expect(parseAssistResponse({ fields: { income: { ...body.fields.income, privateReason: "x" } } }, "到手八千" )).toBeNull();
    expect(parseAssistResponse({ fields: { income: answer("8000", "原话里没有", "present") } }, "八千" )).toBeNull();
    expect(parseAssistResponse({ fields: { income: answer("8000", "八千", "ambiguous") } }, "八千" )).toBeNull();
  });

  it("applies a mixed response as one shared draft and keeps each estimate attached to its value", () => {
    const text = "大概到手八千，想买三千元相机，每周五天、每天九小时";
    const fields: AssistFields = {
      income: answer("8000", "大概到手八千", "estimated"),
      taxBasis: answer("after-tax", "到手", "present"),
      purchaseAmount: answer("3000", "三千元相机", "present"),
      workTimeMode: answer("custom", "每周五天、每天九小时", "present"),
      workDaysPerWeek: answer("5", "每周五天", "present"),
      workHoursPerDay: answer("9", "每天九小时", "estimated"),
    };
    expect(parseAssistResponse({ fields }, text)?.fields).toEqual(fields);
    const applied = applyAssistPatch(blankInput, EMPTY_ASSIST_ESTIMATES, fields);
    expect(applied.input).toMatchObject({
      income: "8000",
      taxBasis: "after-tax",
      purchaseAmount: "3000",
      workTime: { mode: "custom", daysPerWeek: "5", hoursPerDay: "9" },
      evidence: { income: "estimated", purchaseAmount: "" },
    });
    expect(applied.estimatedValues).toMatchObject({ income: "8000", purchaseAmount: null });
  });

  it("preserves missing fields but clears prior values that are ambiguous, unsupported, or unknown", () => {
    const existing: DecisionInput = {
      ...blankInput,
      income: "9000",
      workHours: "160",
      taxBasis: "after-tax",
      evidence: { ...blankInput.evidence, income: "user-confirmed", workHours: "estimated" },
    };
    const estimates = { ...EMPTY_ASSIST_ESTIMATES, workHours: "160" };
    const missing = applyAssistPatch(existing, estimates, { income: answer(null, null, "missing") });
    expect(missing.input).toBe(existing);
    expect(missing.estimatedValues.workHours).toBe("160");

    const unresolved = applyAssistPatch(existing, estimates, {
      income: answer(null, "那个数", "ambiguous"),
      workHours: answer(null, null, "unsupported"),
    });
    expect(unresolved.input.income).toBe("");
    expect(unresolved.input.workHours).toBe("");
    expect(unresolved.estimatedValues).toMatchObject({ income: null, workHours: null });
  });

  it("does not infer a changed income's tax basis, but applies an explicit or unresolved basis response", () => {
    const existing: DecisionInput = { ...blankInput, income: "8000", taxBasis: "after-tax" };
    const correction = applyAssistPatch(existing, EMPTY_ASSIST_ESTIMATES, {
      income: answer("8500", "八千五", "present"),
      taxBasis: answer(null, null, "missing"),
    });
    expect(correction.input).toMatchObject({ income: "8500", taxBasis: "after-tax" });

    const changedBasis = applyAssistPatch(existing, EMPTY_ASSIST_ESTIMATES, {
      income: answer("8500", "税前八千五", "present"),
      taxBasis: answer("before-tax", "税前", "present"),
    });
    expect(changedBasis.input).toMatchObject({ income: "8500", taxBasis: "before-tax" });

    const unclearBasis = applyAssistPatch(existing, EMPTY_ASSIST_ESTIMATES, {
      income: answer("8500", "八千五", "present"),
      taxBasis: answer(null, "那个口径", "ambiguous"),
    });
    expect(unclearBasis.input.taxBasis).toBe("");
  });

  it("preserves a preset day count when editing daily hours switches to custom schedule", () => {
    const fiveDayInput: DecisionInput = { ...blankInput, workTime: { mode: "five-day" }, workHours: "173.333" };
    const changedToCustom = applyAssistPatch(fiveDayInput, EMPTY_ASSIST_ESTIMATES, {
      workTimeMode: answer("custom", "每天改九小时", "present"),
      workHoursPerDay: answer("9", "九小时", "present"),
    });
    expect(changedToCustom.input.workTime).toEqual({ mode: "custom", daysPerWeek: "5", hoursPerDay: "9" });

    const sameCustom = applyAssistPatch(changedToCustom.input, EMPTY_ASSIST_ESTIMATES, {
      workTimeMode: answer("custom", "继续按每周作息", "present"),
      workHoursPerDay: answer("10", "每天十小时", "present"),
    });
    expect(sameCustom.input.workTime).toEqual({ mode: "custom", daysPerWeek: "5", hoursPerDay: "10" });
  });

  it("keeps partial, unknown, and excluded answers as valid stopping points for optional questions", () => {
    const coreComplete: DecisionInput = {
      ...blankInput,
      income: "8000",
      purchaseAmount: "3000",
      taxBasis: "after-tax",
      workTime: { mode: "five-day" },
    };
    const state: AssistQuestionState = { skipped: new Set(), clarifications: {} };
    const partialCoverage = { ...coreComplete, fixedExpenses: "3000", fixedCostCoverage: "partial" as const };
    expect(nextAssistQuestion(partialCoverage, state, true)).toBeNull();
    expect(nextAssistQuestion({ ...coreComplete, fixedCostCoverage: "partial" }, state, true)).toBeNull();
    const unknownCoverage = { ...coreComplete, fixedExpenses: "3000", fixedCostCoverage: "unknown" as const };
    expect(nextAssistQuestion(unknownCoverage, state, true)).toBeNull();
    const excluded = { ...coreComplete, fixedExpenses: "3000", fixedCostCoverage: "complete" as const, purchaseIncluded: "excluded" as const };
    expect(nextAssistQuestion(excluded, state, true)).toBeNull();
  });

  it("asks one necessary question and permits at most one repeat for clarification", () => {
    const state: AssistQuestionState = { skipped: new Set(), clarifications: {} };
    const first = advanceAssistQuestion(blankInput, state, false);
    expect(first.questionId).toBe("income");
    expect(first.state.clarifications.income).toBe(1);
    const clarification = advanceAssistQuestion(blankInput, first.state, false);
    expect(clarification.questionId).toBe("income");
    expect(clarification.state.clarifications.income).toBe(2);
    const afterLimit = advanceAssistQuestion(blankInput, clarification.state, false);
    expect(afterLimit.questionId).toBe("taxBasis");

    const ambiguousFreeText = advanceAssistQuestion(blankInput, state, false, new Set(["income"]));
    expect(ambiguousFreeText.questionId).toBe("income");
    expect(ambiguousFreeText.state.clarifications.income).toBe(2);
    expect(advanceAssistQuestion(blankInput, ambiguousFreeText.state, false).questionId).toBe("taxBasis");
  });

  it("sends only the context relevant to a targeted question and uses manual draft context when resumed", () => {
    expect(assistContextFor(blankInput, null, false, {})).toEqual({});
    const input = {
      ...blankInput,
      income: "8000",
      taxBasis: "after-tax" as const,
      purchaseAmount: "3000",
      fixedExpenses: "2000",
      fixedCostCoverage: "complete" as const,
      valueExpectation: "不发送的期待",
    };
    expect(assistContextFor(input, "taxBasis", true, {})).toEqual({ income: { value: "8000", span: null } });
    expect(assistContextFor(input, "purchaseIncluded", true, {})).toEqual({ purchaseAmount: { value: "3000", span: null } });
    expect(assistContextFor(input, null, true, {})).not.toHaveProperty("valueExpectation");
    expect(assistContextFor(input, null, true, {})).toHaveProperty("fixedExpenses", { value: "2000", span: null });
  });

  it("uses local quick answers without promoting estimates and keeps per-field estimates after confirmation", () => {
    const current: DecisionInput = { ...blankInput, income: "8000", taxBasis: "after-tax", evidence: { ...blankInput.evidence, income: "estimated" } };
    const quick = applyQuickAssistAnswer(current, "fixedCostCoverage", "partial");
    expect(quick.fixedCostCoverage).toBe("partial");
    const values = { ...EMPTY_ASSIST_ESTIMATES, income: "8000", workHours: "160", fixedExpenses: "0" };
    const final = finalizeAssistInput({ ...current, workHours: "160", fixedExpenses: "0", purchaseAmount: "1000" }, values, false);
    expect(final.evidence).toMatchObject({ income: "estimated", workHours: "estimated", fixedExpenses: "estimated", purchaseAmount: "user-confirmed" });
    expect(finalizeAssistInput(final, values, true).evidence.purchaseAmount).toBe("estimated");
  });

  it("keeps an estimate when a user only changes numeric formatting", () => {
    expect(areNumericValuesEquivalent("income", "8000", "8000.00")).toBe(true);
    expect(areNumericValuesEquivalent("workHours", "8", "8.000")).toBe(true);
    expect(areNumericValuesEquivalent("fixedExpenses", "3000", "3000.01")).toBe(false);
    const formatted = finalizeAssistInput(
      { ...blankInput, income: "8000.00" },
      { ...EMPTY_ASSIST_ESTIMATES, income: "8000.00" },
      false,
    );
    expect(formatted.evidence.income).toBe("estimated");
  });
});
