import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { App as PurchaseWorkbench, monthInTimeZone } from "./App";
import { downloadJson } from "./download";
import {
  calculateIncome,
  defaultProfile,
  validateProfile,
  type IncomeCalculation,
  type IncomeException,
  type IncomePeriod,
  type IncomeProfile,
  type IncomeProfileIssue,
} from "../domain/income";
import {
  addFavorite,
  clearInvalidLocalData,
  clearLocalData,
  commitLocalData,
  createLocalBackup,
  deleteFavorite,
  LOCAL_DATA_STORAGE_KEY,
  parseLocalBackup,
  readLocalData,
  restoreInvalidLocalData,
  restoreLocalData,
  type FavoriteSnapshot,
  type LocalDataContent,
  type LocalDataDocument,
  type LocalDataReadResult,
} from "../domain/local-data";
import type { DecisionInput, WorkTimeInput } from "../domain/calculation";
import type { PurchaseSnapshotV2 } from "../domain/purchase-snapshot";

type Screen = "setup" | "dashboard" | "purchase" | "favorites";

const EMPTY_STORAGE: LocalDataReadResult = { status: "empty", document: null, raw: null };
const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
] as const;

function validationMessage(issue: IncomeProfileIssue): string {
  if (issue.field === "income") return "请填写大于 0 的到手月收入，最多保留两位小数。";
  if (issue.field === "timeZone") return "时区无效，请填写有效的 IANA 时区，例如 Asia/Shanghai。";
  if (issue.field === "workDays") return "请检查每周工作日设置。";
  if (issue.field === "periods") {
    if (issue.code === "overlapping-periods") return "工作时段不能重叠，请调整开始或结束时间。";
    if (issue.code === "zero-length-period") return "每个工作时段都需要有实际时长。";
    return "请检查工作时段；跨日时需明确选择“次日”。";
  }
  if (issue.field === "exceptions") return issue.date ? `${issue.date} 的特殊日期设置无效。` : "请检查特殊日期设置。";
  return "资料格式有误，请检查后再保存。";
}

function minuteOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function plannedHours(periods: readonly IncomePeriod[]): string {
  let minutes = 0;
  for (const period of periods) {
    const start = minuteOfDay(period.start);
    const end = minuteOfDay(period.end);
    if (start === null || end === null) return "待完善";
    minutes += end + period.endDayOffset * 1440 - start;
  }
  return minutes > 0 ? `${Number((minutes / 60).toFixed(2))} 小时` : "待完善";
}

function weekdaySummary(workDays: readonly number[]): string {
  const labels = WEEKDAYS.filter((day) => workDays.includes(day.value)).map((day) => day.label);
  if (workDays.length === 5 && [1, 2, 3, 4, 5].every((day) => workDays.includes(day))) return "周一至周五（双休）";
  return labels.length > 0 ? labels.join("、") : "尚未选择工作日";
}

function profileScheduleChanged(profile: IncomeProfile, patch: Partial<IncomeProfile>): IncomeProfile {
  return { ...profile, ...patch, scheduleSource: "user-confirmed" };
}

function ProfileSettings({
  profile,
  onChange,
}: {
  readonly profile: IncomeProfile;
  readonly onChange: (profile: IncomeProfile) => void;
}) {
  const [exceptionDate, setExceptionDate] = useState("");
  const [exceptionKind, setExceptionKind] = useState<IncomeException>("rest");

  const updatePeriod = (index: number, patch: Partial<IncomePeriod>) => {
    const periods = profile.periods.map((period, current) => current === index ? { ...period, ...patch } : period);
    onChange(profileScheduleChanged(profile, { periods }));
  };

  return (
    <div className="income-profile-settings">
      <fieldset className="income-weekdays">
        <legend>每周工作日</legend>
        <div className="income-weekday-options">
          {WEEKDAYS.map((day) => (
            <label key={day.value}>
              <input
                type="checkbox"
                checked={profile.workDays.includes(day.value)}
                onChange={(event) => {
                  const workDays = event.target.checked
                    ? [...profile.workDays, day.value].sort((left, right) => left - right)
                    : profile.workDays.filter((current) => current !== day.value);
                  onChange(profileScheduleChanged(profile, { workDays }));
                }}
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="income-periods">
        <legend>每天工作时段 · 合计 {plannedHours(profile.periods)}</legend>
        <p className="field-hint">按时段自动计算工作时长。若在午夜后结束，请明确选“次日”；不会自动猜测跨日安排。</p>
        {profile.periods.map((period, index) => (
          <div className="income-period-row" key={index}>
            <label>
              <span>开始</span>
              <input
                aria-label={`第 ${index + 1} 个时段开始时间`}
                type="time"
                value={period.start}
                onChange={(event) => updatePeriod(index, { start: event.target.value })}
              />
            </label>
            <label>
              <span>结束</span>
              <input
                aria-label={`第 ${index + 1} 个时段结束时间`}
                type="time"
                value={period.end}
                onChange={(event) => updatePeriod(index, { end: event.target.value })}
              />
            </label>
            <label>
              <span>结束日期</span>
              <select
                aria-label={`第 ${index + 1} 个时段结束日期`}
                value={period.endDayOffset}
                onChange={(event) => updatePeriod(index, { endDayOffset: Number(event.target.value) as 0 | 1 })}
              >
                <option value={0}>当天</option>
                <option value={1}>次日</option>
              </select>
            </label>
            <button
              className="quiet-button income-remove-period"
              type="button"
              disabled={profile.periods.length <= 1}
              onClick={() => onChange(profileScheduleChanged(profile, {
                periods: profile.periods.filter((_, current) => current !== index),
              }))}
            >
              删除时段
            </button>
          </div>
        ))}
        <button
          className="secondary-button income-add-period"
          type="button"
          onClick={() => onChange(profileScheduleChanged(profile, {
            periods: [...profile.periods, { start: "", end: "", endDayOffset: 0 }],
          }))}
        >
          添加工作时段
        </button>
      </fieldset>

      <fieldset className="income-exceptions">
        <legend>特殊日期</legend>
        <p className="field-hint">只调整某一天是否按平时时段工作；不自动匹配节假日，也不计算加班或扣薪。</p>
        <div className="income-exception-form">
          <label>
            <span>日期</span>
            <input aria-label="特殊日期" type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)} />
          </label>
          <label>
            <span>安排</span>
            <select aria-label="特殊日期安排" value={exceptionKind} onChange={(event) => setExceptionKind(event.target.value as IncomeException)}>
              <option value="rest">休息</option>
              <option value="work">按平时时段工作</option>
            </select>
          </label>
          <button className="secondary-button" type="button" disabled={!exceptionDate} onClick={() => {
            if (!exceptionDate) return;
            onChange(profileScheduleChanged(profile, {
              exceptions: { ...profile.exceptions, [exceptionDate]: exceptionKind },
            }));
            setExceptionDate("");
          }}>添加日期</button>
        </div>
        {Object.entries(profile.exceptions).length > 0 ? (
          <ul className="income-exception-list">
            {Object.entries(profile.exceptions).sort(([left], [right]) => left.localeCompare(right)).map(([date, kind]) => (
              <li key={date}>
                <time dateTime={date}>{date}</time>
                <select
                  aria-label={`${date} 的安排`}
                  value={kind}
                  onChange={(event) => onChange(profileScheduleChanged(profile, {
                    exceptions: { ...profile.exceptions, [date]: event.target.value as IncomeException },
                  }))}
                >
                  <option value="rest">休息</option>
                  <option value="work">按平时时段工作</option>
                </select>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => {
                    const exceptions = { ...profile.exceptions };
                    delete exceptions[date];
                    onChange(profileScheduleChanged(profile, { exceptions }));
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="field-hint">暂未设置特殊日期。</p>}
      </fieldset>

      <label className="field income-time-zone">
        <span>时区</span>
        <input
          type="text"
          autoComplete="off"
          value={profile.timeZone}
          onChange={(event) => onChange(profileScheduleChanged(profile, { timeZone: event.target.value }))}
        />
        <span className="field-hint">首次采用设备时区并保存；之后不会随设备时区变化自动修改。</span>
      </label>
    </div>
  );
}

function IncomeProfileForm({
  profile,
  onChange,
  onSubmit,
  submitLabel,
  disabled = false,
  advancedDisclosure = true,
  issues = [],
  onCancel,
}: {
  readonly profile: IncomeProfile;
  readonly onChange: (profile: IncomeProfile) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly submitLabel: string;
  readonly disabled?: boolean;
  readonly advancedDisclosure?: boolean;
  readonly issues?: readonly IncomeProfileIssue[];
  readonly onCancel?: () => void;
}) {
  const settings = <ProfileSettings profile={profile} onChange={onChange} />;
  return (
    <form className="card income-form" onSubmit={onSubmit} noValidate>
      <div className="section-heading">
        <div>
          <p className="eyebrow">基础信息</p>
          <h2>{advancedDisclosure ? "先从每月到手收入开始" : "调整收入与作息"}</h2>
        </div>
        <p>只填这一项也能开始</p>
      </div>

      <label className="field income-salary-field" htmlFor="income-monthly">
        <span>每月到手收入</span>
        <span className="income-money-input">
          <span aria-hidden="true">¥</span>
          <input
            id="income-monthly"
            name="income"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={profile.income}
            onChange={(event) => onChange({ ...profile, income: event.target.value })}
            aria-describedby="income-monthly-help"
          />
        </span>
        <span id="income-monthly-help" className="field-hint">填写税后实际到手金额，最多保留两位小数。</span>
      </label>

      <p className="income-default-summary">
        {profile.scheduleSource === "default" ? "默认按" : "当前按"}{weekdaySummary(profile.workDays)}，每天 {profile.periods.map((period) => `${period.start}–${period.end}${period.endDayOffset ? "（次日）" : ""}`).join("、") || "未设置时段"}（合计 {plannedHours(profile.periods)}），时区 {profile.timeZone} 估算。
      </p>
      <p className="income-local-notice">资料仅保存在此浏览器中；清除浏览器数据可能会丢失。保存失败时仍可临时使用。</p>

      {advancedDisclosure ? (
        <details className="income-advanced">
          <summary>想按自己的情况调整？展开详细设置</summary>
          <p className="field-hint">不修改也可以直接开始；工作小时数会由所选时段自动计算。</p>
          {settings}
        </details>
      ) : settings}

      {issues.length > 0 ? (
        <ul className="income-validation" role="alert">
          {issues.map((issue, index) => <li key={`${issue.field}-${issue.code}-${index}`}>{validationMessage(issue)}</li>)}
        </ul>
      ) : null}

      <div className="income-form-actions">
        <button className="primary-button" type="submit" disabled={disabled}>{submitLabel}</button>
        {onCancel ? <button className="quiet-button" type="button" onClick={onCancel} disabled={disabled}>取消修改</button> : null}
      </div>
    </form>
  );
}

function currencyDisplay(decimal: string | null | undefined): string {
  if (decimal === undefined || decimal === null) return "暂无可用结果";
  const [integer = "0", fraction = "00"] = decimal.split(".");
  const negative = integer.startsWith("-");
  const digits = negative ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${negative ? "-" : ""}¥${grouped}.${fraction}`;
}

function rateDisplay(calculation: IncomeCalculation): string {
  const value = calculation.perSecondIncome;
  if (!value) return "暂无可用结果";
  return value.decimal === "0.00000000" ? "小于 0.00000001 元/秒" : `${value.decimal} 元/秒`;
}

function dateTimeDisplay(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function calendarHours(value: string | null): string {
  if (!value) return "暂无有效工作时间";
  const hours = Number(value) / 3600;
  return Number.isFinite(hours) ? `${hours.toFixed(2)} 小时` : "暂无有效工作时间";
}

function calculationReasonText(calculation: IncomeCalculation): string | null {
  const reason = calculation.reason;
  if (!reason) return null;
  switch (reason.code) {
    case "invalid-profile": return "请检查收入和作息设置。";
    case "invalid-now": return "无法读取当前时间，请重新打开页面。";
    case "invalid-calendar-boundary": return `${reason.date} 的日历边界无法可靠计算，请检查时区。`;
    case "nonexistent-local-time": return `${reason.date} 的 ${reason.time} 在此时区不存在，请调整时段。`;
    case "ambiguous-local-time": return `${reason.date} 的 ${reason.time} 在此时区出现两次，暂无法可靠估算。`;
    case "invalid-period": return `${reason.date} 的工作时段无效，请检查设置。`;
    case "overlapping-periods": return `${reason.date} 的工作时段发生重叠，请检查设置。`;
    case "no-working-time": return "本月没有可用的计划工作时间，请检查工作日和时段。";
  }
}

function localMonthAnchor(month: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12);
  let epoch = target;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map((part) => [part.type, part.value]));
      const localAsUtc = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour), Number(parts.minute), Number(parts.second),
      );
      const difference = target - localAsUtc;
      if (difference === 0) break;
      epoch += difference;
    }
    const result = new Date(epoch);
    return Number.isFinite(result.getTime()) ? result : null;
  } catch {
    return null;
  }
}

function decisionLabel(snapshot: PurchaseSnapshotV2): string {
  switch (snapshot.decision.code) {
    case "buy": return "现在买";
    case "wait": return "再等等";
    case "adjust-conditions": return "换个条件再看";
    case "do-not-buy": return "这次不买";
    case "undecided": return "还没想好";
    default: return "尚未决定";
  }
}

function workTimeFromSnapshot(snapshot: PurchaseSnapshotV2): WorkTimeInput {
  const basis = snapshot.inputs.work_time_basis;
  if (basis.mode === "calendar") {
    return {
      mode: "calendar",
      comparisonMonth: snapshot.comparison_month,
      timeZone: snapshot.time_zone,
      totalWorkSeconds: basis.total_work_seconds ?? "0",
      workDays: basis.work_days ?? [],
      periods: basis.periods ?? [],
      exceptions: basis.exceptions ?? {},
      scheduleSource: basis.schedule_source ?? "default",
    };
  }
  if (basis.mode === "custom" && basis.days_per_week && basis.hours_per_day) {
    return { mode: "custom", daysPerWeek: basis.days_per_week, hoursPerDay: basis.hours_per_day };
  }
  if (basis.mode === "five-day" || basis.mode === "six-day" || basis.mode === "monthly") return { mode: basis.mode };
  return { mode: "unselected" };
}

function inputFromSnapshot(snapshot: PurchaseSnapshotV2): DecisionInput {
  const input = snapshot.inputs;
  return {
    income: input.income,
    workHours: input.work_hours,
    workTime: workTimeFromSnapshot(snapshot),
    fixedExpenses: input.fixed_expenses,
    purchaseAmount: input.purchase_amount,
    taxBasis: input.tax_basis ?? "after-tax",
    fixedCostCoverage: input.fixed_cost_coverage ?? "",
    purchaseIncluded: input.purchase_included ?? "",
    valueExpectation: input.value_expectation,
    evidence: input.evidence,
  };
}

function newPurchaseInput(profile: IncomeProfile, calculation: IncomeCalculation | null): DecisionInput {
  return {
    income: profile.income,
    workHours: "",
    workTime: calculation?.workTimeInput ?? { mode: "unselected" },
    fixedExpenses: "",
    purchaseAmount: "",
    taxBasis: "after-tax",
    fixedCostCoverage: "",
    purchaseIncluded: "",
    valueExpectation: "",
    evidence: {
      income: profile.income ? "user-confirmed" : "",
      workHours: "estimated",
      fixedExpenses: "user-confirmed",
      purchaseAmount: "user-confirmed",
    },
  };
}

function FavoriteCard({
  favorite,
  onRecalculate,
  onDelete,
  disabled,
}: {
  readonly favorite: FavoriteSnapshot;
  readonly onRecalculate: (snapshot: PurchaseSnapshotV2) => void;
  readonly onDelete: (favorite: FavoriteSnapshot) => void;
  readonly disabled: boolean;
}) {
  const { snapshot } = favorite;
  return (
    <article className="card income-favorite-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">收藏于 {dateTimeDisplay(favorite.savedAt, snapshot.time_zone)}</p>
          <h2>{snapshot.comparison_month} · {currencyDisplay(snapshot.inputs.purchase_amount)}</h2>
        </div>
        <span className="income-decision-label">{decisionLabel(snapshot)}</span>
      </div>
      {snapshot.inputs.value_expectation ? <p>当时在意：{snapshot.inputs.value_expectation}</p> : null}
      <details className="income-snapshot-details">
        <summary>查看当时的结果与依据</summary>
        <dl className="income-snapshot-results">
          {snapshot.results.map((result) => (
            <div key={result.id}>
              <dt>{result.label}</dt>
              <dd>{result.display ?? `资料不足${result.reasons.length > 0 ? `：${result.reasons.join("、")}` : ""}`}</dd>
            </div>
          ))}
        </dl>
        <p>当时收入 {currencyDisplay(snapshot.inputs.income)}；比较月份 {snapshot.comparison_month}；时区 {snapshot.time_zone}。</p>
        <p>{snapshot.inputs.work_time_basis.mode === "calendar" ? "按当月日历作息估算" : "使用当时选择的工作时间口径"}；规则版本 {snapshot.ruleset_version}。</p>
        <p>当时的决定依据：{snapshot.decision.rationale || "未填写"}</p>
      </details>
      <div className="income-form-actions">
        <button className="secondary-button" type="button" disabled={disabled} onClick={() => onRecalculate(snapshot)}>重新试算</button>
        <button className="quiet-button" type="button" disabled={disabled} onClick={() => onDelete(favorite)}>删除收藏</button>
      </div>
    </article>
  );
}

export function IncomeApp() {
  const [stored, setStored] = useState<LocalDataReadResult>(EMPTY_STORAGE);
  const [profile, setProfile] = useState<IncomeProfile | null>(null);
  const [draft, setDraft] = useState<IncomeProfile>(() => defaultProfile());
  const [profileSaved, setProfileSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<Screen>("setup");
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<string | null>(null);
  const [formIssues, setFormIssues] = useState<readonly IncomeProfileIssue[]>([]);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsDrafting, setSettingsDrafting] = useState(false);
  const [purchaseInput, setPurchaseInput] = useState<DecisionInput | undefined>();
  const [purchaseContext, setPurchaseContext] = useState<{ comparisonMonth: string; timeZone: string } | null>(null);
  const [purchaseKey, setPurchaseKey] = useState(0);
  const lastRawRef = useRef<string | null>(null);
  const operationGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const settingsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    const initial = readLocalData();
    lastRawRef.current = initial.raw;
    setStored(initial);
    if (initial.status === "ready" && initial.document.profile) {
      setProfile(initial.document.profile);
      setDraft(initial.document.profile);
      setProfileSaved(true);
      setView("dashboard");
    } else {
      setProfile(null);
      setDraft(defaultProfile());
      setProfileSaved(false);
      setView("setup");
    }
    setLoaded(true);

    const updateNow = () => setNow(new Date());
    let interval: number | null = null;
    const startInterval = () => {
      if (interval !== null) return;
      interval = window.setInterval(updateNow, 1000);
    };
    const stopInterval = () => {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        updateNow();
        startInterval();
      } else {
        stopInterval();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCAL_DATA_STORAGE_KEY || event.newValue === lastRawRef.current) return;
      setConflict(true);
      setNotice("另一个页面保存了更新。当前内容仍保留；请重新载入后再保存，避免覆盖新资料。");
    };
    window.addEventListener("focus", updateNow);
    window.addEventListener("pageshow", updateNow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    if (document.visibilityState === "visible") startInterval();
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      stopInterval();
      window.removeEventListener("focus", updateNow);
      window.removeEventListener("pageshow", updateNow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const calculation = useMemo(() => profile ? calculateIncome(profile, now) : null, [profile, now]);
  const favorites = stored.status === "ready" ? stored.document.favorites : [];
  const sortedFavorites = useMemo(
    () => favorites.slice().sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
    [favorites],
  );
  const expectedRevision = stored.status === "ready" ? stored.document.revision : null;

  const rememberWrite = (document: LocalDataDocument, raw: string) => {
    lastRawRef.current = raw;
    setStored({ status: "ready", document, raw });
    setConflict(false);
  };

  const applyReadResult = (next: LocalDataReadResult) => {
    lastRawRef.current = next.raw;
    setStored(next);
    if (next.status === "ready" && next.document.profile) {
      setProfile(next.document.profile);
      setDraft(next.document.profile);
      setProfileSaved(true);
      setView("dashboard");
    } else {
      setProfile(null);
      setDraft(defaultProfile());
      setProfileSaved(false);
      setView("setup");
    }
    setFormIssues([]);
    setConflict(false);
    setSettingsDrafting(false);
  };

  const updateDraft = (next: IncomeProfile) => {
    setDraft(next);
    setFormIssues([]);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateProfile({ ...draft, updatedAt: new Date().toISOString() });
    if (!validation.ok) {
      setFormIssues(validation.issues);
      return;
    }
    if (conflict) {
      setNotice("资料已在另一个页面更新。先重新载入，再保存修改。");
      return;
    }
    if (stored.status === "invalid") {
      setNotice("浏览器中的资料损坏或版本不支持；原内容仍保留。请导入有效备份后再保存。");
      return;
    }
    const hasExistingData = profile !== null || stored.status === "ready";
    if (hasExistingData && !window.confirm("保存后，今日和本月的估算会按新资料重新计算；已收藏的结果不会变化。继续保存吗？")) return;

    setBusy(true);
    const operation = ++operationGenerationRef.current;
    const content: LocalDataContent = {
      profile: validation.value,
      favorites: stored.status === "ready" ? stored.document.favorites : [],
    };
    try {
      const result = await commitLocalData(content, expectedRevision);
      if (!mountedRef.current || operation !== operationGenerationRef.current) return;
      if (result.status === "saved") {
        rememberWrite(result.document, result.raw);
        setProfile(result.document.profile);
        setDraft(result.document.profile ?? defaultProfile());
        setProfileSaved(true);
        setView("dashboard");
        setSettingsDrafting(false);
        setFormIssues([]);
        setNotice("资料已保存在此浏览器。今日和本月估算已按新资料重算。");
      } else if (result.status === "unavailable") {
        if (profile === null) {
          setProfile(validation.value);
          setDraft(validation.value);
          setProfileSaved(false);
          setView("dashboard");
          setSettingsDrafting(false);
          setNotice("未保存，本次可以临时使用。浏览器里原有的资料没有被替换。");
        } else {
          setNotice("修改没有保存；看板仍使用原来已保存的资料。当前编辑仍保留，可检查存储后重试。");
        }
      } else if (result.status === "conflict") {
        setConflict(true);
        setNotice("另一个页面已经保存了更新。当前编辑仍保留，请重新载入后再保存。");
      } else {
        setNotice("资料未保存，原有内容保持不变。请导入备份或修正资料后重试。");
      }
    } catch {
      if (mountedRef.current && operation === operationGenerationRef.current) {
        if (profile === null) {
          setProfile(validation.value);
          setDraft(validation.value);
          setProfileSaved(false);
          setView("dashboard");
          setSettingsDrafting(false);
          setNotice("未保存，本次可以临时使用。浏览器里原有的资料没有被替换。");
        } else {
          setNotice("修改没有保存；看板仍使用原来已保存的资料。当前编辑仍保留，可检查存储后重试。");
        }
      }
    } finally {
      if (mountedRef.current && operation === operationGenerationRef.current) setBusy(false);
    }
  };

  const startPurchase = (initialInput?: DecisionInput, context?: { comparisonMonth: string; timeZone: string }) => {
    if (!profile && !context) {
      setNotice("当前还没有可用的基础资料，请先回到设置页填写收入与作息。");
      return;
    }
    setPurchaseInput(initialInput ?? (profile ? newPurchaseInput(profile, calculation) : undefined));
    setPurchaseContext(context ?? null);
    setPurchaseKey((current) => current + 1);
    setView("purchase");
  };

  const saveFavorite = async (snapshot: PurchaseSnapshotV2) => {
    if (conflict) throw new Error("local-data-conflict");
    const operation = ++operationGenerationRef.current;
    setBusy(true);
    try {
    const result = await addFavorite(snapshot, expectedRevision);
    if (!mountedRef.current || operation !== operationGenerationRef.current) throw new Error("stale-favorite-save");
    if (result.status !== "saved") {
      if (result.status === "conflict") {
        setConflict(true);
        setNotice("另一个页面保存了更新，收藏尚未保存；请重新载入后再试。当前内容仍保留。");
      } else {
        setNotice("收藏未保存，原有资料保持不变。请检查浏览器存储后重试。");
      }
      throw new Error("favorite-save-failed");
    }
    rememberWrite(result.document, result.raw);
    setNotice(profileSaved ? "购买结果已收藏。" : "购买结果已收藏；基础资料仍未保存。当前资料只在本页面临时使用。");
    } finally {
      if (mountedRef.current && operation === operationGenerationRef.current) setBusy(false);
    }
  };

  const removeFavorite = async (favorite: FavoriteSnapshot) => {
    if (conflict || !window.confirm("删除这条收藏？基础资料和其他收藏不会受影响。")) return;
    setBusy(true);
    const operation = ++operationGenerationRef.current;
    try {
      const result = await deleteFavorite(favorite.id, expectedRevision);
      if (!mountedRef.current || operation !== operationGenerationRef.current) return;
      if (result.status === "saved") {
        rememberWrite(result.document, result.raw);
        setNotice("收藏已删除。");
      } else if (result.status === "conflict") {
        setConflict(true);
        setNotice("另一个页面保存了更新，未删除收藏。请重新载入后再试。");
      } else {
        setNotice("未能删除收藏，原有资料保持不变。");
      }
    } catch {
      if (mountedRef.current && operation === operationGenerationRef.current) setNotice("未能删除收藏，原有资料保持不变。");
    } finally {
      if (mountedRef.current && operation === operationGenerationRef.current) setBusy(false);
    }
  };

  const clearAll = async () => {
    if (conflict) {
      setNotice("另一个页面保存了更新。先重新载入，再清空资料。");
      return;
    }
    if ((stored.status === "ready" || stored.status === "invalid")
      && !window.confirm("将清空此浏览器中保存的基础资料和全部收藏。已下载的备份文件不会删除。确定清空吗？")) return;
    setBusy(true);
    const operation = ++operationGenerationRef.current;
    try {
      const result = stored.status === "invalid"
        ? await clearInvalidLocalData(stored.raw)
        : await clearLocalData(expectedRevision);
      if (!mountedRef.current || operation !== operationGenerationRef.current) return;
      if (result.status === "cleared") {
        const fresh = readLocalData();
        applyReadResult(fresh);
        setDraft(defaultProfile());
        setProfile(null);
        setProfileSaved(false);
        setPurchaseInput(undefined);
        setPurchaseKey((current) => current + 1);
        setNotice("本地资料和收藏已清空。已下载的文件仍由你自行管理。");
      } else if (result.status === "conflict") {
        setConflict(true);
        setNotice("另一个页面保存了更新，资料没有清空。请重新载入后再试。");
      } else {
        setNotice("资料没有清空；原有内容仍保留。请先导出备份或检查浏览器存储。");
      }
    } catch {
      if (mountedRef.current && operation === operationGenerationRef.current) setNotice("资料没有清空；原有内容仍保留。请检查浏览器存储后重试。");
    } finally {
      if (mountedRef.current && operation === operationGenerationRef.current) setBusy(false);
    }
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    const operation = ++operationGenerationRef.current;
    try {
      const parsed = parseLocalBackup(await file.text());
      if (!mountedRef.current || operation !== operationGenerationRef.current) return;
      if (parsed.status === "invalid") {
        setNotice(parsed.reason === "unsupported-version"
          ? "这个备份版本暂不支持，原有资料没有变化。"
          : "文件不是有效的值观本地备份，原有资料没有变化。");
        return;
      }
      if (conflict) {
        setNotice("另一个页面保存了更新。先重新载入，再导入备份。");
        return;
      }
      if (!window.confirm("导入会整体替换此浏览器中保存的基础资料和收藏。文件内容只作为数据读取，不会执行。继续导入吗？")) return;
      const content: LocalDataContent = {
        profile: parsed.document.profile,
        favorites: parsed.document.favorites,
      };
      const result = stored.status === "invalid"
        ? await restoreInvalidLocalData(content, stored.raw)
        : await restoreLocalData(content, expectedRevision);
      if (!mountedRef.current || operation !== operationGenerationRef.current) return;
      if (result.status === "saved") {
        rememberWrite(result.document, result.raw);
        setProfile(result.document.profile);
        setDraft(result.document.profile ?? defaultProfile());
        setProfileSaved(Boolean(result.document.profile));
        setView(result.document.profile ? "dashboard" : "setup");
        setPurchaseInput(undefined);
        setPurchaseKey((current) => current + 1);
        setNotice("备份已恢复；看板会按恢复的资料和当前时刻重新估算。");
      } else if (result.status === "conflict") {
        setConflict(true);
        setNotice("另一个页面保存了更新，备份没有导入。请重新载入后再试。");
      } else {
        setNotice("备份没有导入；原有资料保持不变。");
      }
    } catch {
      if (mountedRef.current && operation === operationGenerationRef.current) setNotice("无法读取或恢复这个文件；原有资料保持不变。");
    } finally {
      input.value = "";
      if (mountedRef.current && operation === operationGenerationRef.current) setBusy(false);
    }
  };

  const reloadChangedData = () => {
    if (!window.confirm("重新载入会放弃当前尚未保存的编辑。继续吗？")) return;
    applyReadResult(readLocalData());
    setNotice("已重新载入浏览器中的最新资料。");
  };

  const exportBackup = () => {
    if (stored.status !== "ready") {
      setNotice("当前没有可导出的已保存资料。临时使用内容尚未写入浏览器。");
      return;
    }
    try {
      downloadJson(createLocalBackup(stored.document), "zhiguan-local-backup-v1.json");
      setNotice("已生成备份下载；是否保存到磁盘由浏览器决定。");
    } catch {
      setNotice("无法生成备份文件；浏览器中的资料没有变化。");
    }
  };

  const openFavorite = (snapshot: PurchaseSnapshotV2) => {
    const savedInput = inputFromSnapshot(snapshot);
    const savedWorkTime = workTimeFromSnapshot(snapshot);
    const workTime = savedWorkTime.mode === "calendar"
      ? calculation?.workTimeInput ?? savedWorkTime
      : savedWorkTime;
    const nextIncome = profile?.income ?? savedInput.income;
    const noProfile = profile === null;
    startPurchase({
      ...savedInput,
      income: nextIncome,
      workHours: workTime.mode === "monthly" ? savedInput.workHours : "",
      workTime: noProfile && workTime.mode === "calendar" ? { mode: "unselected" } : workTime,
      evidence: {
        ...savedInput.evidence,
        income: nextIncome ? "user-confirmed" : "",
        workHours: noProfile && workTime.mode === "calendar" ? "" : workTime.mode === "monthly" ? savedInput.evidence.workHours : "estimated",
      },
    }, noProfile ? { comparisonMonth: monthInTimeZone(new Date(), snapshot.time_zone), timeZone: snapshot.time_zone } : undefined);
  };

  const adoptMonth = (month: string, input: DecisionInput) => {
    if (!profile) {
      if (purchaseContext) setPurchaseContext({ ...purchaseContext, comparisonMonth: month });
      setPurchaseInput(input);
      setPurchaseKey((current) => current + 1);
      return;
    }
    const inputWorkTime = input.workTime ?? { mode: "unselected" as const };
    if (inputWorkTime.mode !== "calendar") {
      setPurchaseInput(input);
    } else {
      const anchor = localMonthAnchor(month, profile.timeZone);
      const next = anchor ? calculateIncome(profile, anchor) : null;
      setPurchaseInput(next?.workTimeInput ? {
        ...input,
        workHours: "",
        workTime: next.workTimeInput,
        evidence: { ...input.evidence, workHours: "estimated" },
      } : input);
      if (!next?.workTimeInput) setNotice("这个月份的作息暂时无法可靠计算，已保留当前试算内容。");
    }
    setPurchaseKey((current) => current + 1);
  };

  return (
    <>
      {view !== "purchase" ? <header className="app-shell topbar income-topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); setView(profile ? "dashboard" : "setup"); }}>值观</a>
        <nav aria-label="主导航" className="income-navigation">
          {profile && view !== "dashboard" ? <button className="quiet-button" type="button" onClick={() => setView("dashboard")}>返回收入看板</button> : null}
          {favorites.length > 0 && view !== "favorites" ? <button className="quiet-button" type="button" onClick={() => setView("favorites")}>查看收藏（{favorites.length}）</button> : null}
        </nav>
      </header> : null}

      {view === "purchase" && (profile || purchaseContext) ? (
        <PurchaseWorkbench
          key={purchaseKey}
          initialInput={purchaseInput}
          comparisonMonth={purchaseContext?.comparisonMonth ?? calculation?.comparisonMonth ?? undefined}
          timeZone={purchaseContext?.timeZone ?? profile?.timeZone}
          onBack={() => setView(profile ? "dashboard" : "favorites")}
          onFavorite={saveFavorite}
          onAdoptMonth={adoptMonth}
          fromSavedProfile={Boolean(profile)}
        />
      ) : (
        <main className="app-shell income-main">
          {view === "setup" ? (
            <>
              <section className="intro income-intro">
                <p className="eyebrow">个人价值流</p>
                <h1>先看见时间与收入</h1>
                <p>填一次到手月收入，就能看到按平时作息估算的今日收入变化。没有购买计划也可以直接使用。</p>
              </section>
              {stored.status === "invalid" ? (
                <section className="income-storage-warning" role="alert">
                  <h2>{stored.reason === "unsupported-version" ? "这份本地资料版本暂不支持" : "浏览器中的本地资料无法读取"}</h2>
                  <p>原内容仍保留，没有用默认值覆盖。可尝试导入之前下载的有效备份。</p>
                </section>
              ) : null}
              {stored.status === "unavailable" ? (
                <p className="income-storage-warning" role="status">当前浏览器存储不可用。可以临时使用，保存状态会明确显示。</p>
              ) : null}
              <IncomeProfileForm
                profile={draft}
                onChange={updateDraft}
                onSubmit={saveProfile}
                submitLabel={busy ? "正在保存…" : "保存并开始"}
                disabled={!loaded || busy}
                issues={formIssues}
              />
              <section className="card income-data-actions">
                <h2>本地资料管理</h2>
                <p>可导出备份，或导入之前保存的值观备份。导入会替换当前基础资料和收藏。</p>
                <div className="income-form-actions">
                  <button className="secondary-button" type="button" onClick={exportBackup} disabled={busy || stored.status !== "ready"}>导出备份</button>
                  <label className="secondary-button income-file-button">
                    导入备份
                    <input type="file" accept="application/json,.json" onChange={importBackup} disabled={busy} />
                  </label>
                  {stored.status === "ready" || stored.status === "invalid" ? <button className="quiet-button" type="button" onClick={clearAll} disabled={busy}>清空资料</button> : null}
                </div>
              </section>
              {favorites.length > 0 ? (
                <button className="secondary-button income-open-favorites" type="button" onClick={() => setView("favorites")}>查看已收藏的购买结果（{favorites.length}）</button>
              ) : null}
            </>
          ) : view === "favorites" ? (
            <section className="income-favorites-view">
              <div className="intro income-intro">
                <p className="eyebrow">仅保存你主动收藏的结果</p>
                <h1>购买收藏</h1>
                <p>这里展示当时保存的金额、依据和决定，不会随当前资料变化而重算。</p>
              </div>
              {favorites.length > 0 ? sortedFavorites.map((favorite) => (
                <FavoriteCard
                  key={favorite.id}
                  favorite={favorite}
                  onRecalculate={openFavorite}
                  onDelete={(value) => { void removeFavorite(value); }}
                  disabled={busy || conflict}
                />
              )) : <section className="card"><p>还没有收藏。完成一笔购买计算后，可以主动保存结果供以后查看。</p></section>}
            </section>
          ) : view === "dashboard" && profile ? (
            <>
              <section className="intro income-intro">
                <p className="eyebrow">按设定作息估算 · 非实际到账</p>
                <h1>今日收入估算</h1>
                <p>按本月计划工作时间分摊到手月收入。关闭页面后再次打开，会按当前时刻重新计算。</p>
              </section>

              {!profileSaved ? <p className="income-unsaved-warning" role="status">未保存，本次仅在当前页面临时使用；重新载入后可能无法恢复。</p> : null}
              {conflict ? <section className="income-storage-warning" role="alert">
                <p>{notice ?? "另一个页面已经保存了更新；当前编辑仍保留。"}</p>
                <button className="secondary-button" type="button" onClick={reloadChangedData} disabled={busy}>重新载入最新资料</button>
              </section> : null}

              <section className="card income-dashboard-card" aria-labelledby="income-today-heading">
                <div className="income-dashboard-heading">
                  <div>
                    <p className="eyebrow">{calculation?.localDate ?? "当前日期"}</p>
                    <h2 id="income-today-heading">今天按作息累计</h2>
                  </div>
                  <span className={`income-work-state income-work-state-${calculation?.workState ?? "insufficient-data"}`}>
                    {calculation?.workState === "working" ? "当前工作时段" : calculation?.workState === "resting" ? "休息时间 · 暂停增长" : "依据不足"}
                  </span>
                </div>
                {calculation?.status === "available" ? (
                  <>
                    <p className="income-today-value" aria-live="off">{currencyDisplay(calculation.todayIncome?.decimal)}</p>
                    <div className="income-supporting-metrics">
                      <div><span>本月累计</span><strong aria-live="off">{currencyDisplay(calculation.monthIncome?.decimal)}</strong></div>
                      <div><span>每秒估算</span><strong>{rateDisplay(calculation)}</strong></div>
                    </div>
                    <p className="income-progress-note">{calculation.workState === "working" ? "当前处于设定工作时段，金额按时间推算。" : "当前不在设定工作时段，估算暂时停止增长。"}</p>
                  </>
                ) : (
                  <div className="income-insufficient" role="status">
                    <p>当前资料无法可靠计算收入估算，请检查收入、时区、工作日或时段设置。</p>
                  </div>
                )}
                <details className="income-calculation-details">
                  <summary>计算依据</summary>
                  <p>{calculation?.comparisonMonth ?? "当前月份"}：月收入按当月计划工作时间分摊，工作时段以 {profile.timeZone} 为准。</p>
                  <p>每周安排：{weekdaySummary(profile.workDays)}；每天时段：{profile.periods.map((period) => `${period.start}–${period.end}${period.endDayOffset ? "（次日）" : ""}`).join("、") || "未设置"}。</p>
                  <p>本月计划工作时间：{calendarHours(calculation?.totalWorkSeconds ?? null)}。每秒估算 = 到手月收入 ÷ 本月计划工作总秒数；今日与本月累计按已过去的计划工作秒数计算。</p>
                  {calculation ? <p>当前提示：{calculationReasonText(calculation) ?? "计算正常。"}</p> : null}
                </details>
                <p className="income-updated-at">资料更新时间：<time dateTime={profile.updatedAt}>{dateTimeDisplay(profile.updatedAt, profile.timeZone)}</time></p>
              </section>

              {notice ? <p className="income-notice" role="status">{notice}</p> : null}

              <div className="income-primary-actions">
                <button className="primary-button" type="button" onClick={() => startPurchase()}>算一笔购买</button>
                {favorites.length > 0 ? <button className="secondary-button" type="button" onClick={() => setView("favorites")}>查看收藏（{favorites.length}）</button> : null}
              </div>

              {view === "dashboard" && profile ? <details className="card income-settings" ref={settingsRef}>
                <summary>调整收入与作息</summary>
                <p className="field-hint">保存修改前会说明重算范围；已收藏的结果保持原样。</p>
                <IncomeProfileForm
                  profile={settingsDrafting ? draft : profile}
                  onChange={(next) => { setSettingsDrafting(true); updateDraft(next); }}
                  onSubmit={saveProfile}
                  submitLabel={busy ? "正在保存…" : "保存修改并重算"}
                  disabled={busy || conflict}
                  advancedDisclosure={false}
                  issues={formIssues}
                  onCancel={() => {
                    setDraft(profile);
                    setSettingsDrafting(false);
                    setFormIssues([]);
                    if (settingsRef.current) settingsRef.current.open = false;
                  }}
                />
                <section className="income-data-actions income-data-actions-compact">
                  <h3>备份与删除</h3>
                  <p>备份仅包含当前已保存资料和收藏；临时内容不会写入备份。</p>
                  <div className="income-form-actions">
                    <button className="secondary-button" type="button" onClick={exportBackup} disabled={busy || stored.status !== "ready"}>导出备份</button>
                    <label className="secondary-button income-file-button">
                      导入备份
                      <input type="file" accept="application/json,.json" onChange={importBackup} disabled={busy} />
                    </label>
                    <button className="quiet-button" type="button" onClick={() => { void clearAll(); }} disabled={busy}>清空本地资料</button>
                  </div>
                </section>
              </details> : <section className="card income-settings-unavailable"><p>收入资料当前不可用。</p><button className="secondary-button" type="button" onClick={() => { setView("setup"); setProfile(null); }}>返回基础设置</button></section>}
            </>
          ) : null}

          {notice && view !== "dashboard" ? <p className="income-notice" role="status">{notice}</p> : null}
          {conflict && view !== "dashboard" ? <section className="income-storage-warning" role="alert">
            <p>另一个页面保存了更新；当前输入仍保留。重新载入会放弃未保存编辑。</p>
            <button className="secondary-button" type="button" onClick={reloadChangedData} disabled={busy}>重新载入最新资料</button>
          </section> : null}

          {view === "favorites" ? <div className="income-backup-footer">
            <button className="secondary-button" type="button" onClick={exportBackup} disabled={busy || stored.status !== "ready"}>导出备份</button>
            <label className="secondary-button income-file-button">导入备份<input type="file" accept="application/json,.json" onChange={importBackup} disabled={busy} /></label>
          </div> : null}
          <footer className="footer">
            <p>按当前设置估算，不代表工资单、实际到账或收入记录。</p>
            <p>主动保存的收入资料与收藏只保存在此浏览器；清除浏览器数据可能丢失。导出、恢复或删除资料，请在看板展开“调整收入与作息”中的“备份与删除”；首次设置页也提供资料管理。未收藏的购买草稿与对话在离开或刷新后不保留；只有主动发送对话时，TypeSafe/Jev 才处理理解回答所需的内容。</p>
          </footer>
        </main>
      )}
    </>
  );
}
