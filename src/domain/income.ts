import {
  exactValueFromRatio,
  parseAmount,
  type CalendarWorkTimeInput,
  type ExactValue,
  type InputErrorCode,
} from "./calculation";

export type IncomeProfileScheduleSource = "default" | "user-confirmed";
export type IncomeException = "work" | "rest";

export interface IncomePeriod {
  readonly start: string;
  readonly end: string;
  readonly endDayOffset: 0 | 1;
}

export interface IncomeProfile {
  readonly income: string;
  readonly timeZone: string;
  readonly workDays: readonly number[];
  readonly periods: readonly IncomePeriod[];
  readonly exceptions: Readonly<Record<string, IncomeException>>;
  readonly updatedAt: string;
  readonly scheduleSource: IncomeProfileScheduleSource;
}

export type IncomeProfileField = "profile" | "income" | "timeZone" | "workDays" | "periods" | "exceptions" | "updatedAt" | "scheduleSource";

export interface IncomeProfileIssue {
  readonly field: IncomeProfileField;
  readonly code: InputErrorCode | "invalid-profile" | "invalid-time-zone" | "invalid-work-day" | "duplicate-work-day" | "invalid-period" | "zero-length-period" | "overlapping-periods" | "invalid-date" | "invalid-exception" | "invalid-updated-at" | "invalid-schedule-source";
  readonly date?: string;
}

export type IncomeProfileValidation =
  | { readonly ok: true; readonly value: IncomeProfile }
  | { readonly ok: false; readonly issues: readonly IncomeProfileIssue[] };

export type IncomeCalculationReason =
  | { readonly code: "invalid-profile"; readonly issues: readonly IncomeProfileIssue[] }
  | { readonly code: "invalid-now" }
  | { readonly code: "invalid-calendar-boundary"; readonly date: string }
  | { readonly code: "nonexistent-local-time" | "ambiguous-local-time" | "invalid-period"; readonly date: string; readonly time: string }
  | { readonly code: "overlapping-periods"; readonly date: string }
  | { readonly code: "no-working-time" };

export interface IncomeCalculation {
  readonly status: "available" | "insufficient-data";
  readonly evidenceStatus: "estimated" | "insufficient-data";
  readonly comparisonMonth: string | null;
  readonly localDate: string | null;
  readonly totalWorkSeconds: string | null;
  readonly monthElapsedWorkSeconds: string | null;
  readonly todayTotalWorkSeconds: string | null;
  readonly todayElapsedWorkSeconds: string | null;
  readonly perSecondIncome: ExactValue | null;
  readonly todayIncome: ExactValue | null;
  readonly monthIncome: ExactValue | null;
  readonly workState: "working" | "resting" | "insufficient-data";
  readonly workTimeInput: CalendarWorkTimeInput | null;
  readonly reason: IncomeCalculationReason | null;
}

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5] as const;
const DEFAULT_PERIODS: readonly IncomePeriod[] = [
  { start: "09:00", end: "12:00", endDayOffset: 0 },
  { start: "13:00", end: "18:00", endDayOffset: 0 },
];
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const SECOND_MS = 1000;

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface LocalDateTime extends CalendarDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

interface WorkInterval {
  readonly start: number;
  readonly end: number;
}

interface PreparedDay {
  readonly start: number;
  readonly end: number;
  readonly intervals: readonly WorkInterval[];
  readonly totalSeconds: bigint;
}

interface PreparedMonth {
  readonly start: number;
  readonly end: number;
  readonly intervals: readonly WorkInterval[];
  readonly days: ReadonlyMap<string, PreparedDay>;
  readonly totalSeconds: bigint;
}

type PreparedMonthResult =
  | { readonly ok: true; readonly value: PreparedMonth }
  | { readonly ok: false; readonly reason: IncomeCalculationReason };

type LocalResolution =
  | { readonly ok: true; readonly epoch: number }
  | { readonly ok: false; readonly code: "nonexistent-local-time" | "ambiguous-local-time" };

export function defaultProfile(
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): IncomeProfile {
  return {
    income: "",
    timeZone,
    workDays: DEFAULT_WORK_DAYS,
    periods: DEFAULT_PERIODS,
    exceptions: {},
    updatedAt: now.toISOString(),
    scheduleSource: "default",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function dateParts(value: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function calendarDate(value: CalendarDate): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function utcMillis(value: LocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(value.hour, value.minute, value.second, 0);
  return date.getTime();
}

function addDays(value: string, amount: number): string {
  const parsed = dateParts(value);
  if (!parsed) throw new Error("invalid-calendar-date");
  const date = new Date(utcMillis({ ...parsed, hour: 0, minute: 0, second: 0 }));
  date.setUTCDate(date.getUTCDate() + amount);
  return calendarDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function addSupportedDays(value: string, amount: number): string | null {
  const result = addDays(value, amount);
  return dateParts(result) ? result : null;
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function periodMinutes(period: IncomePeriod): { start: number; end: number } | null {
  const start = parseTime(period.start);
  const end = parseTime(period.end);
  if (!start || !end) return null;
  return {
    start: start.hour * 60 + start.minute,
    end: period.endDayOffset * 24 * 60 + end.hour * 60 + end.minute,
  };
}

let cachedFormatter: { readonly timeZone: string; readonly formatter: Intl.DateTimeFormat } | null = null;
const monthCacheSlots: Array<{ readonly key: string; readonly result: PreparedMonthResult }> = [];
const MONTH_CACHE_MAX_SLOTS = 4;
function readMonthCache(key: string): PreparedMonthResult | null {
  for (let i = 0; i < monthCacheSlots.length; i += 1) {
    if (monthCacheSlots[i]?.key === key) {
      const entry = monthCacheSlots[i];
      if (entry) {
        monthCacheSlots.splice(i, 1);
        monthCacheSlots.unshift(entry);
        return entry.result;
      }
    }
  }
  return null;
}
function writeMonthCache(key: string, result: PreparedMonthResult): void {
  monthCacheSlots.unshift({ key, result });
  if (monthCacheSlots.length > MONTH_CACHE_MAX_SLOTS) monthCacheSlots.length = MONTH_CACHE_MAX_SLOTS;
}

function isoWeekday(date: string): number {
  const parsed = dateParts(date);
  if (!parsed) throw new Error("invalid-calendar-date");
  const day = new Date(utcMillis({ ...parsed, hour: 0, minute: 0, second: 0 })).getUTCDay();
  return day === 0 ? 7 : day;
}

function periodsOverlapSameDay(periods: readonly IncomePeriod[]): boolean {
  for (let leftIndex = 0; leftIndex < periods.length; leftIndex += 1) {
    const left = periodMinutes(periods[leftIndex] as IncomePeriod);
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < periods.length; rightIndex += 1) {
      const right = periodMinutes(periods[rightIndex] as IncomePeriod);
      if (right && left.start < right.end && right.start < left.end) return true;
    }
  }
  return false;
}

function adjacentPeriodsOverlap(periods: readonly IncomePeriod[]): boolean {
  for (const leftPeriod of periods) {
    const left = periodMinutes(leftPeriod);
    if (!left) continue;
    for (const rightPeriod of periods) {
      const right = periodMinutes(rightPeriod);
      if (!right) continue;
      const rightStart = 24 * 60 + right.start;
      const rightEnd = 24 * 60 + right.end;
      if (left.start < rightEnd && rightStart < left.end) return true;
    }
  }
  return false;
}

function worksOn(
  date: string,
  workDays: readonly number[],
  exceptions: Readonly<Record<string, IncomeException>>,
): boolean {
  const exception = exceptions[date];
  return exception ? exception === "work" : workDays.includes(isoWeekday(date));
}

function profileHasOverlap(
  workDays: readonly number[],
  periods: readonly IncomePeriod[],
  exceptions: Readonly<Record<string, IncomeException>>,
): boolean {
  if (periodsOverlapSameDay(periods)) return true;
  for (let day = 1; day <= 7; day += 1) {
    const nextDay = day === 7 ? 1 : day + 1;
    if (workDays.includes(day) && workDays.includes(nextDay) && adjacentPeriodsOverlap(periods)) return true;
  }
  for (const date of Object.keys(exceptions)) {
    for (const previous of [addSupportedDays(date, -1), date]) {
      if (!previous) continue;
      const next = addSupportedDays(previous, 1);
      if (!next) continue;
      if (worksOn(previous, workDays, exceptions) && worksOn(next, workDays, exceptions) && adjacentPeriodsOverlap(periods)) return true;
    }
  }
  return false;
}

export function validateWorkTimeBasis(input: unknown): boolean {
  const profile = asRecord(input);
  if (!profile) return false;
  if (!isValidTimeZone(profile.timeZone)) return false;

  if (!Array.isArray(profile.workDays)) return false;
  if (!profile.workDays.every((day) => Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 7)) return false;
  if (new Set(profile.workDays).size !== profile.workDays.length) return false;

  if (!Array.isArray(profile.periods)) return false;
  const parsedPeriods: IncomePeriod[] = [];
  for (const value of profile.periods) {
    const period = asRecord(value);
    if (!period || typeof period.start !== "string" || typeof period.end !== "string"
      || (period.endDayOffset !== 0 && period.endDayOffset !== 1)) return false;
    const parsed = periodMinutes(period as unknown as IncomePeriod);
    if (!parsed || parsed.end > parsed.start + 24 * 60
      || (period.endDayOffset === 0 && parsed.end < parsed.start)) return false;
    if (parsed.end === parsed.start) return false;
    parsedPeriods.push({ start: period.start, end: period.end, endDayOffset: period.endDayOffset });
  }

  const exceptionsRecord = asRecord(profile.exceptions);
  if (!exceptionsRecord) return false;
  for (const [date, value] of Object.entries(exceptionsRecord)) {
    if (!dateParts(date)) return false;
    if (value !== "work" && value !== "rest") return false;
  }

  if (profile.scheduleSource !== "default" && profile.scheduleSource !== "user-confirmed") return false;
  const typedExceptions: Record<string, IncomeException> = {};
  for (const [date, value] of Object.entries(exceptionsRecord)) typedExceptions[date] = value as IncomeException;
  return !profileHasOverlap(profile.workDays as number[], parsedPeriods, typedExceptions);
}

export function validateProfile(input: unknown): IncomeProfileValidation {
  const profile = asRecord(input);
  if (!profile) return { ok: false, issues: [{ field: "profile", code: "invalid-profile" }] };
  const issues: IncomeProfileIssue[] = [];
  const amount = typeof profile.income === "string" ? parseAmount(profile.income, false) : null;
  if (!amount || !amount.ok) issues.push({ field: "income", code: amount?.reasonCode ?? "invalid-input" });
  if (!isValidTimeZone(profile.timeZone)) issues.push({ field: "timeZone", code: "invalid-time-zone" });

  const workDays = Array.isArray(profile.workDays) ? profile.workDays : null;
  if (!workDays || workDays.some((day) => !Number.isInteger(day) || (day as number) < 1 || (day as number) > 7)) {
    issues.push({ field: "workDays", code: "invalid-work-day" });
  } else if (new Set(workDays).size !== workDays.length) {
    issues.push({ field: "workDays", code: "duplicate-work-day" });
  }

  const rawPeriods = Array.isArray(profile.periods) ? profile.periods : null;
  const periods: IncomePeriod[] = [];
  if (!rawPeriods) {
    issues.push({ field: "periods", code: "invalid-period" });
  } else {
    for (const value of rawPeriods) {
      const period = asRecord(value);
      if (!period || typeof period.start !== "string" || typeof period.end !== "string"
        || (period.endDayOffset !== 0 && period.endDayOffset !== 1)) {
        issues.push({ field: "periods", code: "invalid-period" });
        continue;
      }
      const parsed = periodMinutes(period as unknown as IncomePeriod);
      if (!parsed || parsed.end > parsed.start + 24 * 60
        || (period.endDayOffset === 0 && parsed.end < parsed.start)) {
        issues.push({ field: "periods", code: "invalid-period" });
      } else if (parsed.end === parsed.start) {
        issues.push({ field: "periods", code: "zero-length-period" });
      } else {
        periods.push({ start: period.start, end: period.end, endDayOffset: period.endDayOffset });
      }
    }
  }

  const exceptionsRecord = asRecord(profile.exceptions);
  const exceptions: Record<string, IncomeException> = {};
  if (!exceptionsRecord) {
    issues.push({ field: "exceptions", code: "invalid-exception" });
  } else {
    for (const [date, value] of Object.entries(exceptionsRecord)) {
      if (!dateParts(date)) issues.push({ field: "exceptions", code: "invalid-date", date });
      else if (value !== "work" && value !== "rest") issues.push({ field: "exceptions", code: "invalid-exception", date });
      else exceptions[date] = value;
    }
  }

  if (typeof profile.updatedAt !== "string" || !Number.isFinite(Date.parse(profile.updatedAt))
    || new Date(profile.updatedAt).toISOString() !== profile.updatedAt) {
    issues.push({ field: "updatedAt", code: "invalid-updated-at" });
  }
  if (profile.scheduleSource !== "default" && profile.scheduleSource !== "user-confirmed") {
    issues.push({ field: "scheduleSource", code: "invalid-schedule-source" });
  }

  if (workDays && workDays.every((day) => Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 7)
    && rawPeriods && rawPeriods.length === periods.length && exceptionsRecord
    && !issues.some((issue) => issue.field === "workDays" || issue.field === "periods" || issue.field === "exceptions")) {
    if (profileHasOverlap(workDays as number[], periods, exceptions)) {
      issues.push({ field: "periods", code: "overlapping-periods" });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      income: profile.income as string,
      timeZone: profile.timeZone as string,
      workDays: [...workDays as number[]],
      periods,
      exceptions,
      updatedAt: profile.updatedAt as string,
      scheduleSource: profile.scheduleSource as IncomeProfileScheduleSource,
    },
  };
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  if (cachedFormatter?.timeZone === timeZone) return cachedFormatter.formatter;
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  cachedFormatter = { timeZone, formatter };
  return formatter;
}

function localPartsAt(epoch: number, formatter: Intl.DateTimeFormat): LocalDateTime {
  const values = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function sameLocalTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function localToEpoch(date: string, time: string, formatter: Intl.DateTimeFormat): LocalResolution {
  const dateValue = dateParts(date);
  const timeValue = parseTime(time);
  if (!dateValue || !timeValue) return { ok: false, code: "nonexistent-local-time" };
  const target = { ...dateValue, ...timeValue, second: 0 };
  const naive = utcMillis(target);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 3) {
    const sample = naive + hours * 60 * 60 * 1000;
    const sampleLocal = localPartsAt(sample, formatter);
    offsets.add(utcMillis(sampleLocal) - sample);
  }
  const candidates = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive - offset;
    if (sameLocalTime(localPartsAt(candidate, formatter), target)) candidates.add(candidate);
  }
  if (candidates.size === 0) return { ok: false, code: "nonexistent-local-time" };
  if (candidates.size > 1) return { ok: false, code: "ambiguous-local-time" };
  return { ok: true, epoch: [...candidates][0] as number };
}

function monthOf(epoch: number, formatter: Intl.DateTimeFormat): { month: string; date: string } {
  const parts = localPartsAt(epoch, formatter);
  const date = calendarDate(parts);
  return { month: `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`, date };
}

function nextMonthDate(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

function insufficient(
  reason: IncomeCalculationReason,
  comparisonMonth: string | null = null,
  localDate: string | null = null,
): IncomeCalculation {
  return {
    status: "insufficient-data",
    evidenceStatus: "insufficient-data",
    comparisonMonth,
    localDate,
    totalWorkSeconds: null,
    monthElapsedWorkSeconds: null,
    todayTotalWorkSeconds: null,
    todayElapsedWorkSeconds: null,
    perSecondIncome: null,
    todayIncome: null,
    monthIncome: null,
    workState: "insufficient-data",
    workTimeInput: null,
    reason,
  };
}

function secondsBefore(intervals: readonly WorkInterval[], end: number): bigint {
  let total = 0n;
  for (const interval of intervals) {
    if (interval.start >= end) break;
    total += BigInt(Math.floor((Math.min(interval.end, end) - interval.start) / SECOND_MS));
  }
  return total;
}

function secondsBetween(intervals: readonly WorkInterval[], start: number, end: number): bigint {
  return secondsBefore(intervals, end) - secondsBefore(intervals, start);
}

function monthCacheKey(profile: IncomeProfile, month: string): string {
  const exceptions = Object.entries(profile.exceptions).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([month, profile.timeZone, profile.workDays, profile.periods, exceptions, profile.updatedAt]);
}

function prepareMonth(
  profile: IncomeProfile,
  month: string,
  formatter: Intl.DateTimeFormat,
): PreparedMonthResult {
  const key = monthCacheKey(profile, month);
  const cached = readMonthCache(key);
  if (cached) return cached;

  const firstDate = `${month}-01`;
  const afterMonthDate = nextMonthDate(month);
  const monthStart = localToEpoch(firstDate, "00:00", formatter);
  const monthEnd = localToEpoch(afterMonthDate, "00:00", formatter);
  if (!monthStart.ok) {
    const result: PreparedMonthResult = { ok: false, reason: { code: "invalid-calendar-boundary", date: firstDate } };
    writeMonthCache(key, result);
    return result;
  }
  if (!monthEnd.ok) {
    const result: PreparedMonthResult = { ok: false, reason: { code: "invalid-calendar-boundary", date: afterMonthDate } };
    writeMonthCache(key, result);
    return result;
  }

  const intervals: WorkInterval[] = [];
  const previousDate = firstDate > "0001-01-01" ? addDays(firstDate, -1) : null;
  for (let anchorDate = previousDate ?? firstDate; anchorDate < afterMonthDate; anchorDate = addDays(anchorDate, 1)) {
    if (!worksOn(anchorDate, profile.workDays, profile.exceptions)) continue;
    for (const period of profile.periods) {
      const endDate = addDays(anchorDate, period.endDayOffset);
      const start = localToEpoch(anchorDate, period.start, formatter);
      if (!start.ok) {
        const result: PreparedMonthResult = { ok: false, reason: { code: start.code, date: anchorDate, time: period.start } };
        writeMonthCache(key, result);
        return result;
      }
      const end = localToEpoch(endDate, period.end, formatter);
      if (!end.ok) {
        const result: PreparedMonthResult = { ok: false, reason: { code: end.code, date: endDate, time: period.end } };
        writeMonthCache(key, result);
        return result;
      }
      if (end.epoch <= start.epoch) {
        const result: PreparedMonthResult = { ok: false, reason: { code: "invalid-period", date: anchorDate, time: period.start } };
        writeMonthCache(key, result);
        return result;
      }
      const clippedStart = Math.max(start.epoch, monthStart.epoch);
      const clippedEnd = Math.min(end.epoch, monthEnd.epoch);
      if (clippedEnd > clippedStart) intervals.push({ start: clippedStart, end: clippedEnd });
    }
  }

  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1] as WorkInterval;
    const current = intervals[index] as WorkInterval;
    if (current.start < previous.end) {
      const result: PreparedMonthResult = { ok: false, reason: { code: "overlapping-periods", date: firstDate } };
      writeMonthCache(key, result);
      return result;
    }
  }

  const totalSeconds = intervals.reduce(
    (total, interval) => total + BigInt(Math.floor((interval.end - interval.start) / SECOND_MS)),
    0n,
  );
  if (totalSeconds === 0n) {
    const result: PreparedMonthResult = { ok: false, reason: { code: "no-working-time" } };
    writeMonthCache(key, result);
    return result;
  }

  const days = new Map<string, PreparedDay>();
  for (let date = firstDate; date < afterMonthDate; date = addDays(date, 1)) {
    const dayStart = localToEpoch(date, "00:00", formatter);
    const afterDate = addDays(date, 1);
    const dayEnd = localToEpoch(afterDate, "00:00", formatter);
    if (!dayStart.ok || !dayEnd.ok) {
      const failedDate = !dayStart.ok ? date : afterDate;
      const result: PreparedMonthResult = {
        ok: false,
        reason: { code: "invalid-calendar-boundary", date: failedDate },
      };
      writeMonthCache(key, result);
      return result;
    }
    const dayIntervals = intervals.flatMap((interval) => {
      const start = Math.max(interval.start, dayStart.epoch);
      const end = Math.min(interval.end, dayEnd.epoch);
      return end > start ? [{ start, end }] : [];
    });
    days.set(date, {
      start: dayStart.epoch,
      end: dayEnd.epoch,
      intervals: dayIntervals,
      totalSeconds: dayIntervals.reduce((total, interval) => total + BigInt(Math.floor((interval.end - interval.start) / SECOND_MS)), 0n),
    });
  }

  const result: PreparedMonthResult = {
    ok: true,
    value: { start: monthStart.epoch, end: monthEnd.epoch, intervals, days, totalSeconds },
  };
  writeMonthCache(key, result);
  return result;
}

export function calculateIncome(profileInput: unknown, now: Date): IncomeCalculation {
  const validation = validateProfile(profileInput);
  if (!validation.ok) return insufficient({ code: "invalid-profile", issues: validation.issues });
  const profile = validation.value;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return insufficient({ code: "invalid-now" });

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = formatterFor(profile.timeZone);
  } catch {
    return insufficient({ code: "invalid-profile", issues: [{ field: "timeZone", code: "invalid-time-zone" }] });
  }

  const { month, date: localDate } = monthOf(now.getTime(), formatter);
  const prepared = prepareMonth(profile, month, formatter);
  if (!prepared.ok) return insufficient(prepared.reason, month, localDate);
  const calendar = prepared.value;
  const today = calendar.days.get(localDate);
  if (!today) return insufficient({ code: "invalid-calendar-boundary", date: localDate }, month, localDate);
  const totalSeconds = calendar.totalSeconds;
  const nowMs = Math.floor(now.getTime() / SECOND_MS) * SECOND_MS;
  const elapsedSeconds = secondsBetween(calendar.intervals, calendar.start, nowMs);
  const todayTotalSeconds = today.totalSeconds;
  const todayElapsedSeconds = secondsBetween(today.intervals, today.start, nowMs);
  const parsedIncome = parseAmount(profile.income, false);
  if (!parsedIncome.ok) return insufficient({ code: "invalid-profile", issues: [{ field: "income", code: parsedIncome.reasonCode }] }, month, localDate);

  const incomeCents = parsedIncome.value.cents;
  const perSecond = exactValueFromRatio(incomeCents, 100n * totalSeconds, 8);
  const todayIncome = exactValueFromRatio(incomeCents * todayElapsedSeconds, 100n * totalSeconds);
  const monthIncome = exactValueFromRatio(incomeCents * elapsedSeconds, 100n * totalSeconds);
  const workTimeInput: CalendarWorkTimeInput = {
    mode: "calendar",
    comparisonMonth: month,
    timeZone: profile.timeZone,
    totalWorkSeconds: totalSeconds.toString(),
    workDays: [...profile.workDays],
    periods: profile.periods.map((period) => ({ ...period })),
    exceptions: { ...profile.exceptions },
    scheduleSource: profile.scheduleSource,
  };

  return {
    status: "available",
    evidenceStatus: "estimated",
    comparisonMonth: month,
    localDate,
    totalWorkSeconds: totalSeconds.toString(),
    monthElapsedWorkSeconds: elapsedSeconds.toString(),
    todayTotalWorkSeconds: todayTotalSeconds.toString(),
    todayElapsedWorkSeconds: todayElapsedSeconds.toString(),
    perSecondIncome: perSecond,
    todayIncome,
    monthIncome,
    workState: today.intervals.some((interval) => now.getTime() >= interval.start && now.getTime() < interval.end) ? "working" : "resting",
    workTimeInput,
    reason: null,
  };
}
