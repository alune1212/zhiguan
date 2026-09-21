import { useEffect, useRef, useState } from "react";

import {
  parseAmount,
  type DecisionInput,
  type TaxBasis,
} from "../domain/calculation";

export const ASSIST_STATUSES = ["present", "estimated", "missing", "ambiguous", "unsupported"] as const;
export type AssistStatus = (typeof ASSIST_STATUSES)[number];

export interface AssistField<T extends string | null = string | null> {
  readonly value: T;
  readonly span: string | null;
  readonly status: AssistStatus;
}

export interface AssistFields {
  readonly income: AssistField;
  readonly purchaseAmount: AssistField;
  readonly taxBasis: AssistField<TaxBasis | null>;
}

export interface AssistResponse {
  readonly fields: AssistFields;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssistStatus(value: unknown): value is AssistStatus {
  return typeof value === "string" && (ASSIST_STATUSES as readonly string[]).includes(value);
}

function parseCommonField(value: unknown): { value: string | null; span: string | null; status: AssistStatus } | null {
  if (!isRecord(value) || !isAssistStatus(value.status)) return null;
  if (typeof value.span !== "string" && value.span !== null) return null;
  if (typeof value.value !== "string" && value.value !== null) return null;
  const span = typeof value.span === "string" ? value.span.trim() || null : null;
  const fieldValue = typeof value.value === "string" ? value.value.trim() || null : null;
  const requiresCandidate = value.status === "present" || value.status === "estimated";
  if (requiresCandidate && (!fieldValue || !span)) return null;
  if (!requiresCandidate && fieldValue !== null) return null;
  return {
    value: fieldValue,
    span,
    status: value.status,
  };
}

function parseAmountField(value: unknown): AssistField | null {
  const field = parseCommonField(value);
  if (!field || (field.value !== null && !parseAmount(field.value, false).ok)) return null;
  return field;
}

function parseTaxBasisField(value: unknown): AssistField<TaxBasis | null> | null {
  const field = parseCommonField(value);
  if (!field) return null;
  if (field.value !== null && field.value !== "before-tax" && field.value !== "after-tax") return null;
  return field as AssistField<TaxBasis | null>;
}

/** Return null for any response that does not match the backend contract. */
export function parseAssistResponse(value: unknown): AssistResponse | null {
  if (!isRecord(value) || !isRecord(value.fields)) return null;
  const income = parseAmountField(value.fields.income);
  const purchaseAmount = parseAmountField(value.fields.purchaseAmount);
  const taxBasis = parseTaxBasisField(value.fields.taxBasis);
  if (!income || !purchaseAmount || !taxBasis) return null;
  return { fields: { income, purchaseAmount, taxBasis } };
}

function canApply(field: AssistField): field is AssistField<string> {
  return field.value !== null && (field.status === "present" || field.status === "estimated") && parseAmount(field.value, false).ok;
}

function canApplyTaxBasis(field: AssistField<TaxBasis | null>): field is AssistField<TaxBasis> {
  return field.value !== null && (field.status === "present" || field.status === "estimated");
}

function responseSpansAppearInText(response: AssistResponse, text: string): boolean {
  return Object.values(response.fields).every((field) => (
    (field.status !== "present" && field.status !== "estimated")
      || (field.span !== null && text.includes(field.span))
  ));
}

/** Fill only blank fields; a tax basis is tied to the income filled in this action. */
export function applyAssistFields(input: DecisionInput, fields: AssistFields): DecisionInput {
  let income = input.income;
  let purchaseAmount = input.purchaseAmount;
  let taxBasis = input.taxBasis;
  let evidence = { ...input.evidence };
  let incomeFilled = false;

  if (!input.income.trim() && canApply(fields.income)) {
    income = fields.income.value;
    evidence = {
      ...evidence,
      income: fields.income.status === "estimated" || input.evidence.income === "estimated" ? "estimated" : "user-confirmed",
    };
    incomeFilled = true;
  }

  if (!input.purchaseAmount.trim() && canApply(fields.purchaseAmount)) {
    purchaseAmount = fields.purchaseAmount.value;
    evidence = {
      ...evidence,
      purchaseAmount: fields.purchaseAmount.status === "estimated" || input.evidence.purchaseAmount === "estimated" ? "estimated" : "user-confirmed",
    };
  }

  if (!input.taxBasis.trim() && incomeFilled && canApplyTaxBasis(fields.taxBasis)) {
    taxBasis = fields.taxBasis.value;
  }

  return { ...input, income, purchaseAmount, taxBasis, evidence };
}

const ASSIST_TIMEOUT_MS = 40_000;

const ASSIST_FIELD_LABELS = {
  income: "每月收入",
  purchaseAmount: "购买价格",
  taxBasis: "收入口径",
} as const;

const ASSIST_STATUS_LABELS: Record<AssistStatus, string> = {
  present: "已识别，待确认",
  estimated: "大概数",
  missing: "描述中未提到",
  ambiguous: "描述不明确",
  unsupported: "暂不支持",
};

function statusHint(status: AssistStatus): string | null {
  switch (status) {
    case "estimated":
      return "确认后仍会保留为大概数，你可以继续修改。";
    case "missing":
      return "这段描述没有提到，可以留空并手动填写。";
    case "ambiguous":
      return "有多个可能含义，请手动选择或修改后再确认。";
    case "unsupported":
      return "这类内容暂时不能安全整理，请手动填写。";
    case "present":
      return null;
  }
}

function AssistFieldEditor({
  fieldKey,
  field,
  existingIncome,
  onAmountChange,
  onTaxBasisChange,
}: {
  readonly fieldKey: "income" | "purchaseAmount" | "taxBasis";
  readonly field: AssistField | AssistField<TaxBasis | null>;
  readonly existingIncome: boolean;
  readonly onAmountChange: (fieldKey: "income" | "purchaseAmount", value: string) => void;
  readonly onTaxBasisChange: (value: string) => void;
}) {
  const inputId = `assist-${fieldKey}`;
  const amountInvalid = fieldKey !== "taxBasis" && field.value !== null && !parseAmount(field.value, false).ok;
  return (
    <div className="assist-field-row">
      <div className="assist-field-heading">
        <label htmlFor={inputId}>{ASSIST_FIELD_LABELS[fieldKey]}</label>
        <span className={`assist-status assist-status-${field.status}`}>{ASSIST_STATUS_LABELS[field.status]}</span>
      </div>
      {fieldKey === "taxBasis" ? (
        <select id={inputId} value={field.value ?? ""} onChange={(event) => onTaxBasisChange(event.currentTarget.value)}>
          <option value="">请选择</option>
          <option value="after-tax">税后（到手）</option>
          <option value="before-tax">税前（还没扣税）</option>
        </select>
      ) : (
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={field.value ?? ""}
          onChange={(event) => onAmountChange(fieldKey, event.currentTarget.value)}
        />
      )}
      {field.span ? <p className="assist-source">原文候选：“{field.span}”</p> : field.value ? <p className="assist-source">你补充或修改的内容。</p> : null}
      {amountInvalid ? <p className="error" role="alert">金额需为大于 0、最多两位小数的数字。</p> : null}
      {statusHint(field.status) ? <p className="assist-hint">{statusHint(field.status)}</p> : null}
      {fieldKey === "taxBasis" && existingIncome ? <p className="assist-hint">当前已有收入，这个口径需要你手动选择，避免和另一笔收入混淆。</p> : null}
    </div>
  );
}

export function AssistInput({
  currentInput,
  onApply,
}: {
  readonly currentInput: DecisionInput;
  readonly onApply: (fields: AssistFields) => void;
}) {
  const [text, setText] = useState("");
  const [response, setResponse] = useState<AssistResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPendingRequest = () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  useEffect(() => () => {
    stopPendingRequest();
  }, []);

  const updateText = (value: string) => {
    stopPendingRequest();
    setText(value);
    setResponse(null);
    setStatus("idle");
    setError(null);
    setNotice(null);
  };

  const updateAmountField = (fieldKey: "income" | "purchaseAmount", value: string) => {
    setResponse((current) => {
      if (!current) return current;
      const field = current.fields[fieldKey];
      const nextValue = value.trim() || null;
      const nextStatus: AssistStatus = field.status === "estimated" ? "estimated" : nextValue ? "present" : "missing";
      return {
        ...current,
        fields: { ...current.fields, [fieldKey]: { ...field, value: nextValue, span: null, status: nextStatus } },
      };
    });
    setNotice(null);
  };

  const updateTaxBasis = (value: string) => {
    setResponse((current) => {
      if (!current) return current;
      const field = current.fields.taxBasis;
      const nextValue = value === "before-tax" || value === "after-tax" ? value : null;
      const nextStatus: AssistStatus = field.status === "estimated" ? "estimated" : nextValue ? "present" : "missing";
      return {
        ...current,
        fields: { ...current.fields, taxBasis: { ...field, value: nextValue, span: null, status: nextStatus } },
      };
    });
    setNotice(null);
  };

  const request = async () => {
    const trimmedText = text.trim();
    if (!trimmedText || status === "loading") return;

    stopPendingRequest();
    const controller = new AbortController();
    const generation = generationRef.current;
    let timedOut = false;
    controllerRef.current = controller;
    setStatus("loading");
    setResponse(null);
    setError(null);
    setNotice(null);
    timeoutRef.current = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ASSIST_TIMEOUT_MS);

    try {
      const result = await fetch("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmedText }),
        signal: controller.signal,
      });
      if (!result.ok) throw new Error("request-failed");
      const payload: unknown = await result.json();
      const parsed = parseAssistResponse(payload);
      if (!parsed || !responseSpansAppearInText(parsed, trimmedText)) throw new Error("invalid-response");
      if (generationRef.current !== generation || controller.signal.aborted) return;
      setResponse(parsed);
      setStatus("ready");
    } catch (reason) {
      if (generationRef.current !== generation) return;
      if (reason instanceof Error && reason.name === "AbortError") {
        setError(timedOut ? "整理超时，请手动填写或稍后重试。" : "整理已取消，你可以继续手动填写。");
      } else if (reason instanceof Error && reason.message === "invalid-response") {
        setError("服务返回的内容无法识别，你可以继续手动填写。");
      } else {
        setError("暂时无法完成整理，你可以继续手动填写或稍后重试。");
      }
      setStatus("error");
    } finally {
      if (generationRef.current === generation) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        controllerRef.current = null;
      }
    }
  };

  const cancel = () => {
    if (status !== "loading") return;
    stopPendingRequest();
    setStatus("idle");
    setError(null);
  };

  const incomeCandidate = Boolean(response && !currentInput.income.trim() && canApply(response.fields.income));
  const purchaseCandidate = Boolean(response && !currentInput.purchaseAmount.trim() && canApply(response.fields.purchaseAmount));
  const taxBasisCandidate = Boolean(response && !currentInput.taxBasis.trim() && !currentInput.income.trim() && incomeCandidate && canApplyTaxBasis(response.fields.taxBasis));
  const hasCandidate = incomeCandidate || purchaseCandidate || taxBasisCandidate;
  const hasInvalidCandidate = Boolean(response && [response.fields.income, response.fields.purchaseAmount].some((field) => field.value !== null && !parseAmount(field.value, false).ok));

  return (
    <details className="assist-input">
      <summary>不想逐项填写？让 Jev 帮你整理（可选）</summary>
      <div className="assist-content">
        <p className="assist-disclosure">
          只有你在这里输入的这段描述会在点击后发送给 TypeSafe/Jev；不会发送表单里的其他内容。第三方服务是否留存这段描述，以其服务说明为准。
        </p>
        <label className="field" htmlFor="assist-text">
          <span>用一句话描述收入和想买的东西</span>
          <textarea
            id="assist-text"
            rows={3}
            maxLength={2000}
            value={text}
            aria-describedby="assist-text-hint"
            onChange={(event) => updateText(event.currentTarget.value)}
          />
        </label>
        <p className="field-hint" id="assist-text-hint">例如：“税后每月八千，想买三千元的相机。”最多 2000 字。</p>
        <div className="assist-actions">
          <button className="secondary-button" type="button" disabled={!text.trim() || status === "loading"} onClick={() => void request()}>
            {status === "loading" ? "整理中…" : "帮我整理"}
          </button>
          {status === "loading" ? <button className="quiet-button" type="button" onClick={cancel}>取消</button> : null}
          <span className="assist-count" aria-live="polite">{text.length}/2000</span>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {response ? (
          <div className="assist-review" aria-live="polite">
            <div className="assist-review-heading">
              <h3>请核对这些候选内容</h3>
              <p>确认后只会填入当前表单的空白项，已有内容不会被覆盖。</p>
            </div>
            <AssistFieldEditor fieldKey="income" field={response.fields.income} existingIncome={Boolean(currentInput.income.trim() && !currentInput.taxBasis)} onAmountChange={updateAmountField} onTaxBasisChange={updateTaxBasis} />
            <AssistFieldEditor fieldKey="taxBasis" field={response.fields.taxBasis} existingIncome={Boolean(currentInput.income.trim() && !currentInput.taxBasis)} onAmountChange={updateAmountField} onTaxBasisChange={updateTaxBasis} />
            <AssistFieldEditor fieldKey="purchaseAmount" field={response.fields.purchaseAmount} existingIncome={Boolean(currentInput.income.trim() && !currentInput.taxBasis)} onAmountChange={updateAmountField} onTaxBasisChange={updateTaxBasis} />
            {hasInvalidCandidate ? <p className="error" role="alert">请先改正候选金额，再确认填入。</p> : null}
            <button className="primary-button" type="button" disabled={!hasCandidate || hasInvalidCandidate} onClick={() => { onApply(response.fields); setNotice("已填入可用的空白项，其余请手动核对。"); }}>
              确认填入空白字段
            </button>
          </div>
        ) : null}
        {notice ? <p className="assist-notice" role="status">{notice}</p> : null}
      </div>
    </details>
  );
}
