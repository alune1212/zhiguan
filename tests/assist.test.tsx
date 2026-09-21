import { describe, expect, it } from "vitest";

import {
  applyAssistFields,
  parseAssistResponse,
  type AssistFields,
} from "../src/app/AssistInput";
import { updateEvidencePreservingAssistEstimates } from "../src/app/App";
import type { DecisionInput } from "../src/domain/calculation";

const baseInput: DecisionInput = {
  income: "",
  workHours: "160",
  fixedExpenses: "",
  purchaseAmount: "",
  taxBasis: "",
  fixedCostCoverage: "",
  purchaseIncluded: "",
  valueExpectation: "",
  evidence: {
    income: "",
    workHours: "user-confirmed",
    fixedExpenses: "",
    purchaseAmount: "",
  },
};

const fields: AssistFields = {
  income: { value: "8000", span: "税后每月八千", status: "present" },
  purchaseAmount: { value: "3000", span: "三千元的相机", status: "present" },
  taxBasis: { value: "after-tax", span: "税后", status: "present" },
};

describe("Jev assist response", () => {
  it("accepts the typed contract and rejects malformed or unsafe candidates", () => {
    expect(parseAssistResponse({ fields })).toEqual({ fields });
    expect(parseAssistResponse({ fields: { ...fields, income: { ...fields.income, span: null } } })).toBeNull();
    expect(parseAssistResponse({ fields: { ...fields, income: { ...fields.income, value: "0" } } })).toBeNull();
    expect(parseAssistResponse({ fields: { ...fields, purchaseAmount: { ...fields.purchaseAmount, value: "1.234" } } })).toBeNull();
    expect(parseAssistResponse({ fields: { ...fields, purchaseAmount: { ...fields.purchaseAmount, value: "1000000000000000" } } })).toBeNull();
    expect(parseAssistResponse({ fields: { ...fields, taxBasis: { ...fields.taxBasis, value: "unknown" } } })).toBeNull();
    expect(parseAssistResponse({ fields: { ...fields, income: { ...fields.income, status: "ambiguous", value: "8000" } } })).toBeNull();
  });

  it("fills blank fields without overwriting existing values or unrelated tax basis", () => {
    const filled = applyAssistFields({ ...baseInput, purchaseAmount: "2500", taxBasis: "before-tax" }, fields);
    expect(filled.income).toBe("8000");
    expect(filled.purchaseAmount).toBe("2500");
    expect(filled.taxBasis).toBe("before-tax");

    const existingIncome = applyAssistFields({ ...baseInput, income: "9000" }, fields);
    expect(existingIncome.income).toBe("9000");
    expect(existingIncome.purchaseAmount).toBe("3000");
    expect(existingIncome.taxBasis).toBe("");
  });

  it("keeps an estimated candidate and existing estimated evidence marked estimated", () => {
    const estimated: AssistFields = {
      income: { value: "8000", span: "大概八千", status: "estimated" },
      purchaseAmount: { value: "3000", span: "约三千", status: "present" },
      taxBasis: { value: "after-tax", span: "到手", status: "present" },
    };
    const filled = applyAssistFields({ ...baseInput, evidence: { ...baseInput.evidence, purchaseAmount: "estimated" } }, estimated);
    expect(filled.evidence.income).toBe("estimated");
    expect(filled.evidence.purchaseAmount).toBe("estimated");
    expect(filled.taxBasis).toBe("after-tax");
  });

  it("does not upgrade an unchanged assistant estimate when the shared checkbox is cleared", () => {
    const estimatedInput = applyAssistFields(baseInput, {
      ...fields,
      income: { ...fields.income, status: "estimated" },
    });
    const preserved = updateEvidencePreservingAssistEstimates(estimatedInput, "user-confirmed", {
      income: estimatedInput.income,
      purchaseAmount: null,
    });
    expect(preserved.evidence.income).toBe("estimated");

    const edited = updateEvidencePreservingAssistEstimates({ ...estimatedInput, income: "8500" }, "user-confirmed", {
      income: estimatedInput.income,
      purchaseAmount: null,
    });
    expect(edited.evidence.income).toBe("user-confirmed");
  });
});
