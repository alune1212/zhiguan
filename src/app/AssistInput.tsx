import { useEffect, useRef, useState } from "react";

import type { DecisionInput, NumericField } from "../domain/calculation";
import {
  ASSIST_FIELD_NAMES,
  areNumericValuesEquivalent,
  advanceAssistQuestion,
  applyAssistPatch,
  applyQuickAssistAnswer,
  assistContextFor,
  assistValue,
  currentMode,
  finalizeAssistInput,
  isValidAssistValue,
  noteForDraftField,
  parseAssistResponse,
  scheduleValues,
  type AssistContext,
  type AssistEstimatedValues,
  type AssistField,
  type AssistFieldName,
  type AssistFields,
  type AssistStatus,
} from "./assist-flow";

export { parseAssistResponse } from "./assist-flow";
export type { AssistFields } from "./assist-flow";

const ASSIST_TIMEOUT_MS = 40_000;

const QUESTION_LABELS: Readonly<Record<AssistFieldName, string>> = {
  income: "你每月大约有多少收入？",
  taxBasis: "你说的收入是税前，还是扣税后实际到手？",
  purchaseAmount: "这次准备花多少钱？",
  workTimeMode: "你更方便按平时每周作息，还是直接说每月工作小时数？",
  workDaysPerWeek: "平均每周上班几天？",
  workHoursPerDay: "每个上班日大约工作几小时？",
  workHours: "你每月大约工作多少小时？",
  fixedExpenses: "每月固定支出大约多少？没有可以选“没有”。",
  fixedCostCoverage: "这个数包含了本月全部固定支出吗？",
  purchaseIncluded: "这笔购买会在本月付款吗？",
};

const QUESTION_HINTS: Partial<Record<AssistFieldName, string>> = {
  workHoursPerDay: "包含经常性加班，不含通勤和休息时间。",
};

const QUESTION_OPTIONS: Partial<Record<AssistFieldName, readonly { label: string; value: string }[]>> = {
  taxBasis: [
    { label: "税后到手", value: "after-tax" },
    { label: "税前", value: "before-tax" },
  ],
  workTimeMode: [
    { label: "按每周作息估算", value: "custom" },
    { label: "直接填每月工时", value: "monthly" },
  ],
  workDaysPerWeek: [
    { label: "每周 5 天", value: "5" },
    { label: "每周 6 天", value: "6" },
  ],
  workHoursPerDay: [{ label: "每天约 8 小时", value: "8" }],
  fixedExpenses: [{ label: "没有固定支出", value: "0" }],
  fixedCostCoverage: [
    { label: "包含全部", value: "complete" },
    { label: "只包含一部分", value: "partial" },
    { label: "不确定", value: "unknown" },
  ],
  purchaseIncluded: [
    { label: "本月付款", value: "included" },
    { label: "不在本月付款", value: "excluded" },
  ],
};

const FIELD_LABELS: Readonly<Record<AssistFieldName, string>> = {
  income: "每月收入",
  taxBasis: "收入口径",
  purchaseAmount: "购买价格",
  workTimeMode: "工作时间口径",
  workDaysPerWeek: "每周上班天数",
  workHoursPerDay: "每天工作小时数",
  workHours: "每月工作小时数",
  fixedExpenses: "每月固定支出",
  fixedCostCoverage: "固定支出范围",
  purchaseIncluded: "本月是否付款",
};

const STATUS_LABELS: Readonly<Record<AssistStatus, string>> = {
  present: "已识别，待确认",
  estimated: "大概数，待确认",
  missing: "还没有提供",
  ambiguous: "需要你再说明",
  unsupported: "暂不支持整理",
  unknown: "你选择暂不确定",
};

const NUMERIC_ASSIST_FIELDS: readonly NumericField[] = ["income", "workHours", "fixedExpenses", "purchaseAmount"];

function inputHasAssistData(input: DecisionInput): boolean {
  return ASSIST_FIELD_NAMES.some((field) => Boolean(assistValue(input, field).trim()));
}

function valueOf(input: DecisionInput, field: AssistFieldName): string {
  const schedule = scheduleValues(input);
  if (field === "workDaysPerWeek") return schedule.daysPerWeek;
  if (field === "workHoursPerDay") return schedule.hoursPerDay;
  return assistValue(input, field);
}

function statusForField(field: AssistField | undefined, value: string): AssistStatus {
  if (field && field.value === (value || null)) return field.status;
  return value ? "present" : "missing";
}

function questionContext(input: DecisionInput, questionId: AssistFieldName | null, notes: Partial<Record<AssistFieldName, AssistField>>): AssistContext {
  return assistContextFor(input, questionId, inputHasAssistData(input), notes);
}

function useStopPendingRequest() {
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
  return { generationRef, controllerRef, timeoutRef, stopPendingRequest };
}

export interface AssistInputProps {
  readonly currentInput: DecisionInput;
  readonly estimatedValues: AssistEstimatedValues;
  readonly draftRevision: number;
  readonly manualMode: boolean;
  readonly marginRequested: boolean;
  readonly approximateInput: boolean;
  readonly onDraftChange: (input: DecisionInput, estimates: AssistEstimatedValues) => void;
  readonly onApproximateInputChange: (value: boolean) => void;
  readonly onMarginRequest: () => void;
  readonly onConfirm: (input: DecisionInput, estimates: AssistEstimatedValues) => void;
  readonly onSwitchManual: () => void;
  readonly onSwitchChat: () => void;
}

export function AssistInput({
  currentInput,
  estimatedValues,
  draftRevision,
  manualMode,
  marginRequested,
  approximateInput,
  onDraftChange,
  onApproximateInputChange,
  onMarginRequest,
  onConfirm,
  onSwitchManual,
  onSwitchChat,
}: AssistInputProps) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<AssistFieldName | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<AssistFieldName>>(() => new Set());
  const [asked, setAsked] = useState<Readonly<Partial<Record<AssistFieldName, number>>>>({});
  const [freeTextAmbiguities, setFreeTextAmbiguities] = useState<ReadonlySet<AssistFieldName>>(() => new Set());
  const [notes, setNotes] = useState<Partial<Record<AssistFieldName, AssistField>>>({});
  const [lastTurn, setLastTurn] = useState<string | null>(null);
  const [lastChangedFields, setLastChangedFields] = useState<readonly AssistFieldName[]>([]);
  const [started, setStarted] = useState(false);
  const revisionRef = useRef(draftRevision);
  const previousRevisionRef = useRef(draftRevision);
  const manualModeRef = useRef(manualMode);
  revisionRef.current = draftRevision;
  manualModeRef.current = manualMode;
  const { generationRef, controllerRef, timeoutRef, stopPendingRequest } = useStopPendingRequest();

  useEffect(() => {
    const changedDraft = draftRevision !== previousRevisionRef.current;
    if (changedDraft || manualMode) {
      stopPendingRequest();
      setStatus((current) => current === "loading" ? "idle" : current);
      setError(null);
    }
    previousRevisionRef.current = draftRevision;
  }, [draftRevision, manualMode]);

  useEffect(() => () => stopPendingRequest(), []);

  const setNextQuestion = (
    input: DecisionInput,
    nextSkipped: ReadonlySet<AssistFieldName> = skipped,
    nextAsked: Readonly<Partial<Record<AssistFieldName, number>>> = asked,
    includeMargin = marginRequested,
    firstClarifications: ReadonlySet<AssistFieldName> = freeTextAmbiguities,
  ) => {
    const transition = advanceAssistQuestion(
      input,
      { skipped: nextSkipped, clarifications: nextAsked },
      includeMargin,
      firstClarifications,
    );
    setAsked(transition.state.clarifications);
    setFreeTextAmbiguities(transition.firstClarifications);
    setCurrentQuestion(transition.questionId);
    return transition.questionId;
  };

  const updateDraftField = (field: AssistFieldName, value: string) => {
    setLastChangedFields([]);
    let next = currentInput;
    let nextEstimates = { ...estimatedValues };
    if (NUMERIC_ASSIST_FIELDS.includes(field as NumericField)) {
      const numericField = field as NumericField;
      const estimate = nextEstimates[numericField];
      next = {
        ...next,
        [numericField]: value,
        evidence: { ...next.evidence, [numericField]: "" },
      };
      nextEstimates[numericField] = estimate === currentInput[numericField]
        && areNumericValuesEquivalent(numericField, currentInput[numericField], value)
        ? value
        : null;
    } else if (field === "workDaysPerWeek" || field === "workHoursPerDay") {
      next = applyQuickAssistAnswer(next, field, value);
    } else if (value && isValidAssistValue(field, value)) {
      next = applyQuickAssistAnswer(next, field, value);
    } else if (field === "taxBasis") {
      next = { ...next, taxBasis: "" };
    } else if (field === "workTimeMode") {
      next = { ...next, workHours: "", workTime: { mode: "unselected" }, evidence: { ...next.evidence, workHours: "" } };
    } else if (field === "fixedCostCoverage") {
      next = { ...next, fixedCostCoverage: "" };
    } else if (field === "purchaseIncluded") {
      next = { ...next, purchaseIncluded: "" };
    }
    onDraftChange(next, nextEstimates);
    setNotes((current) => ({ ...current, [field]: noteForDraftField(value, value ? "present" : "missing") }));
  };

  const updateTurnText = (value: string) => {
    stopPendingRequest();
    setText(value);
    setStatus("idle");
    setError(null);
    setNotice(null);
  };

  const request = async () => {
    const trimmedText = text.trim();
    if (!trimmedText || status === "loading" || manualMode) return;
    stopPendingRequest();
    const controller = new AbortController();
    const generation = generationRef.current;
    const requestRevision = draftRevision;
    const questionId = currentQuestion;
    const context = questionContext(currentInput, questionId, notes);
    let timedOut = false;
    controllerRef.current = controller;
    setStarted(true);
    setStatus("loading");
    setError(null);
    setNotice(null);
    setLastChangedFields([]);
    timeoutRef.current = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ASSIST_TIMEOUT_MS);

    try {
      const result = await fetch("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmedText, questionId, context }),
        signal: controller.signal,
      });
      if (!result.ok) throw new Error("request-failed");
      const payload: unknown = await result.json();
      const parsed = parseAssistResponse(payload, trimmedText);
      if (!parsed) throw new Error("invalid-response");
      if (generationRef.current !== generation || controller.signal.aborted
        || revisionRef.current !== requestRevision || manualModeRef.current) return;

      const applied = applyAssistPatch(currentInput, estimatedValues, parsed.fields);
      const nextNotes: Partial<Record<AssistFieldName, AssistField>> = { ...notes };
      const nextSkipped = new Set(skipped);
      const nextFreeTextAmbiguities = new Set(freeTextAmbiguities);
      for (const [field, answer] of Object.entries(parsed.fields) as [AssistFieldName, AssistField][]) {
        nextNotes[field] = answer;
        if (answer.status === "unknown" || answer.status === "unsupported") nextSkipped.add(field);
        if (answer.status === "ambiguous" && (asked[field] ?? 0) >= 2) nextSkipped.add(field);
        if (questionId === null && answer.status === "ambiguous") nextFreeTextAmbiguities.add(field);
      }
      if (questionId && !parsed.fields[questionId]) {
        nextNotes[questionId] = { value: null, span: null, status: "missing" };
      }
      setNotes(nextNotes);
      setSkipped(nextSkipped);
      setFreeTextAmbiguities(nextFreeTextAmbiguities);
      onDraftChange(applied.input, applied.estimatedValues);
      setLastChangedFields(applied.changedFields);
      setLastTurn(trimmedText);
      setText("");
      setStatus("idle");
      const nextQuestion = setNextQuestion(applied.input, nextSkipped, asked, marginRequested, nextFreeTextAmbiguities);
      setNotice(nextQuestion
        ? "已整理这段补充，下面只继续问一个必要问题；确认前都可以修改。"
        : "已整理这段补充，请核对摘要；确认前都可以修改。" );
    } catch (reason) {
      if (generationRef.current !== generation || revisionRef.current !== requestRevision || manualModeRef.current) return;
      if (reason instanceof Error && reason.name === "AbortError") {
        setError(timedOut ? "整理超时了。回答和已有内容仍保留，你可以重试或手动填写。" : "整理已取消。回答和已有内容仍保留。 ");
      } else if (reason instanceof Error && reason.message === "invalid-response") {
        setError("服务返回的内容无法安全识别。你的回答和已有内容仍保留，可以重试或手动填写。");
      } else {
        setError("暂时无法连接本机整理服务。你的回答和已有内容仍保留，可以重试或手动填写。");
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

  const answerQuickly = (field: AssistFieldName, value: string) => {
    stopPendingRequest();
    const next = applyQuickAssistAnswer(currentInput, field, value);
    const nextEstimates = { ...estimatedValues };
    if (NUMERIC_ASSIST_FIELDS.includes(field as NumericField)) {
      const numericField = field as NumericField;
      if (!areNumericValuesEquivalent(numericField, currentInput[numericField], next[numericField])) nextEstimates[numericField] = null;
      else if (nextEstimates[numericField] === currentInput[numericField]) nextEstimates[numericField] = next[numericField];
    }
    onDraftChange(next, nextEstimates);
    setNotes((current) => ({ ...current, [field]: noteForDraftField(value) }));
    setLastTurn(null);
    setLastChangedFields([field]);
    setNotice("已按你的选择更新草稿，没有发送 Jev 请求。");
    setText("");
    setStatus("idle");
    setError(null);
    setNextQuestion(next);
  };

  const skipQuestion = (markUnknown: boolean) => {
    if (!currentQuestion) return;
    stopPendingRequest();
    let nextInput = currentInput;
    let nextEstimates = estimatedValues;
    const field = currentQuestion;
    if (markUnknown) {
      const unresolved: AssistFields = { [field]: { value: null, span: null, status: "unknown" } };
      const applied = applyAssistPatch(currentInput, estimatedValues, unresolved);
      nextInput = applied.input;
      nextEstimates = applied.estimatedValues;
      onDraftChange(nextInput, nextEstimates);
      setNotes((current) => ({ ...current, [field]: unresolved[field] }));
    }
    const nextSkipped = new Set(skipped).add(field);
    setSkipped(nextSkipped);
    setText("");
    setStatus("idle");
    setError(null);
    setNotice(markUnknown ? "已保留为暂不确定，不再追问这一项。" : "已跳过这一项，可以在摘要或手动填写中补充。");
    setNextQuestion(nextInput, nextSkipped);
  };

  const requestMargin = () => {
    if (!marginRequested) onMarginRequest();
    const next = setNextQuestion(currentInput, skipped, asked, true);
    if (!next) setNotice("现有信息已足够或该项已跳过，可以直接确认摘要。");
  };

  const changeModeAndResume = () => {
    stopPendingRequest();
    setStatus("idle");
    setError(null);
    setCurrentQuestion(null);
    onSwitchChat();
    setNextQuestion(currentInput);
  };

  const toggleApproximate = (checked: boolean) => onApproximateInputChange(checked);

  if (manualMode) {
    return (
      <section className="assist-return" aria-label="对话输入">
        <p>价格可以直接填写；想用一句话补充时再打开对话。不会自动发送内容。</p>
        <button className="secondary-button" type="button" onClick={changeModeAndResume}>用一句话补充</button>
      </section>
    );
  }

  const currentOptions = currentQuestion ? QUESTION_OPTIONS[currentQuestion] ?? [] : [];
  const showSummary = status !== "loading" && (started || inputHasAssistData(currentInput) || Boolean(lastTurn));
  const optionalValuesExist = Boolean(currentInput.fixedExpenses || currentInput.fixedCostCoverage || currentInput.purchaseIncluded);
  const summaryFields = ASSIST_FIELD_NAMES.filter((field) => {
    const optional = field === "fixedExpenses" || field === "fixedCostCoverage" || field === "purchaseIncluded";
    return !optional || marginRequested || optionalValuesExist;
  });

  return (
    <section className="assist-input card" aria-labelledby="assist-title">
      <div className="assist-header">
        <div>
          <p className="eyebrow">少填一点</p>
          <h2 id="assist-title">先用一句话说说这次购买</h2>
          <p className="assist-lead">Jev 会帮你整理收入、价格和工作时间；你可以继续补充，也可以直接改摘要。</p>
        </div>
        <button className="quiet-button" type="button" onClick={onSwitchManual}>手动填写</button>
      </div>

      <p className="assist-disclosure">点击发送后，当前回答、问题，以及理解回答所需的少量相关字段会发送给 TypeSafe/Jev。不会自动发送整份草稿或决定理由。</p>
      {currentQuestion ? (
        <div className="assist-question" aria-live="polite">
          <span>接下来只确认一项</span>
          <h3>{QUESTION_LABELS[currentQuestion]}</h3>
          {QUESTION_HINTS[currentQuestion] ? <p>{QUESTION_HINTS[currentQuestion]}</p> : null}
        </div>
      ) : null}
      {lastTurn ? <p className="assist-last-turn">刚刚补充：{lastTurn}</p> : null}

      <label className="field field-wide" htmlFor="assist-text">
        <span>{currentQuestion ? "补充这一项，也可以顺便改口其他内容" : "用一句话描述你的收入和想买的东西"}</span>
        <textarea
          id="assist-text"
          rows={3}
          maxLength={2000}
          value={text}
          aria-describedby="assist-text-hint"
          onChange={(event) => updateTurnText(event.currentTarget.value)}
          placeholder={currentQuestion ? "写下你的回答，例如：税后到手，或每周上五天、每天九小时。" : "例如：税后每月到手八千，想买三千元的相机，平时每周上五天、每天八小时。"}
        />
      </label>
      <p className="field-hint" id="assist-text-hint">只会在点击发送后整理这段内容。最多 2000 字。</p>
      <div className="assist-actions">
        <button className="primary-button" type="button" disabled={!text.trim() || status === "loading"} onClick={() => void request()}>
          {status === "loading" ? "整理中…" : currentQuestion ? "发送回答" : "整理这句话"}
        </button>
        {status === "loading" ? <button className="quiet-button" type="button" onClick={() => { stopPendingRequest(); setStatus("idle"); setError(null); }}>取消</button> : null}
        <span className="assist-count" aria-live="polite">{text.length}/2000</span>
      </div>
      {status === "error" ? (
        <div className="assist-error" role="alert">
          <p>{error}</p>
          <div className="assist-actions">
            <button className="secondary-button" type="button" disabled={!text.trim()} onClick={() => void request()}>重试这一句</button>
            <button className="quiet-button" type="button" onClick={onSwitchManual}>改用手动填写</button>
          </div>
        </div>
      ) : null}
      {status !== "loading" && currentQuestion ? (
        <div className="assist-answer-options" aria-label="快捷回答">
          {currentOptions.map((option) => (
            <button key={option.value} className="quick-answer" type="button" onClick={() => answerQuickly(currentQuestion, option.value)}>{option.label}</button>
          ))}
          <button className="quick-answer quick-answer-quiet" type="button" onClick={() => skipQuestion(false)}>先跳过</button>
          <button className="quick-answer quick-answer-quiet" type="button" onClick={() => skipQuestion(true)}>我不确定</button>
        </div>
      ) : null}
      {lastChangedFields.length > 0 && status !== "loading" ? (
        <p className="assist-changed-fields" role="status">本轮更新：{lastChangedFields.map((field) => FIELD_LABELS[field]).join("、")}</p>
      ) : null}
      {notice ? <p className="assist-notice" role="status">{notice}</p> : null}

      {!marginRequested && showSummary ? (
        <div className="assist-margin-invite">
          <div>
            <h3>还想看买完后本月剩多少吗？</h3>
            <p>这部分是可选的。只有你主动开启后，才会追问固定支出和付款月份。</p>
          </div>
          <button className="secondary-button" type="button" onClick={requestMargin}>开启余量计算</button>
        </div>
      ) : null}

      {showSummary && currentQuestion === null ? (
        <section className="assist-review" aria-labelledby="assist-review-title">
          <div className="assist-review-heading">
            <div>
              <p className="eyebrow">一份草稿，一次确认</p>
              <h3 id="assist-review-title">核对并修改摘要</h3>
            </div>
            <button className="quiet-button" type="button" onClick={onSwitchManual}>更多手动选项</button>
          </div>
          <p className="assist-review-copy">识别结果还不是已确认事实。缺少的信息可以留空，之后仍能看已有结果。</p>
          <div className="assist-summary-grid">
            {summaryFields.map((field) => {
              const currentValue = valueOf(currentInput, field);
              const note = notes[field];
              const fieldStatus = statusForField(note, currentValue);
              const id = `assist-summary-${field}`;
              const scheduleMode = assistValue(currentInput, "workTimeMode");
              const isCalendarWorkTime = currentMode(currentInput) === "calendar";
              const calendarDetail = field === "workTimeMode" || field === "workDaysPerWeek" || field === "workHoursPerDay" || field === "workHours";
              const showField = !(isCalendarWorkTime && calendarDetail)
                && (field !== "workDaysPerWeek" && field !== "workHoursPerDay" || scheduleMode === "custom")
                && (field !== "workHours" || scheduleMode === "monthly");
              if (!showField) return null;
              return (
                <div className="assist-field-row" key={field}>
                  <div className="assist-field-heading">
                    <label htmlFor={id}>{FIELD_LABELS[field]}</label>
                    <span className={`assist-status assist-status-${fieldStatus}`}>{STATUS_LABELS[fieldStatus]}</span>
                  </div>
                  {field === "taxBasis" ? (
                    <select id={id} value={currentValue} onChange={(event) => updateDraftField(field, event.currentTarget.value)}>
                      <option value="">尚未提供</option><option value="after-tax">税后（到手）</option><option value="before-tax">税前</option>
                    </select>
                  ) : field === "workTimeMode" ? (
                    <select id={id} value={currentValue} onChange={(event) => updateDraftField(field, event.currentTarget.value)}>
                      <option value="">尚未提供</option><option value="custom">按每周作息估算</option><option value="monthly">直接填每月工时</option>
                    </select>
                  ) : field === "fixedCostCoverage" ? (
                    <select id={id} value={currentValue} onChange={(event) => updateDraftField(field, event.currentTarget.value)}>
                      <option value="">尚未提供</option><option value="complete">包含全部</option><option value="partial">只包含一部分</option><option value="unknown">不确定</option>
                    </select>
                  ) : field === "purchaseIncluded" ? (
                    <select id={id} value={currentValue} onChange={(event) => updateDraftField(field, event.currentTarget.value)}>
                      <option value="">尚未提供</option><option value="included">本月付款</option><option value="excluded">不在本月付款</option>
                    </select>
                  ) : (
                    <input
                      id={id}
                      type="text"
                      inputMode="decimal"
                      value={currentValue}
                      onChange={(event) => updateDraftField(field, event.currentTarget.value)}
                    />
                  )}
                  {note?.span && currentValue === note.value ? <p className="assist-source">对应原话：“{note.span}”</p> : null}
                </div>
              );
            })}
          </div>
          {assistValue(currentInput, "workTimeMode") === "custom" ? (
            <p className="assist-hint">每周 {scheduleValues(currentInput).daysPerWeek || "—"} 天 × 每天 {scheduleValues(currentInput).hoursPerDay || "—"} 小时；完整后按平时作息估算月工时。</p>
          ) : null}
          <label className="check-row assist-estimate-toggle">
            <input type="checkbox" checked={approximateInput} onChange={(event) => toggleApproximate(event.currentTarget.checked)} />
            我填的数字里有大概数
          </label>
          <p className="field-hint">逐项识别为大概数的字段会一直保留估算标记，不会因取消这个统一选项变成精确数字。</p>
          {marginRequested ? <p className="assist-hint">余量计算已开启；固定支出不完整、未知或本月不付款时，会显示对应的不足说明。</p> : null}
          <button className="primary-button" type="button" disabled={status !== "idle"} onClick={() => onConfirm(finalizeAssistInput(currentInput, estimatedValues, approximateInput), estimatedValues)}>
            确认摘要并查看结果
          </button>
        </section>
      ) : null}

      {showSummary && currentQuestion !== null ? (
        <section className="assist-progress" aria-label="当前草稿进度">
          <p>已整理的内容会保留在草稿里；每次只追问一个必要信息。你也可以跳过、手动补充或随时核对摘要。</p>
          <button className="quiet-button" type="button" onClick={onSwitchManual}>现在手动填写</button>
        </section>
      ) : null}
    </section>
  );
}
