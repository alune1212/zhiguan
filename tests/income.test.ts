import { describe, expect, it, vi } from "vitest";

import {
  calculateIncome,
  defaultProfile,
  validateProfile,
  type IncomeProfile,
} from "../src/domain/income";

function profile(overrides: Partial<IncomeProfile> = {}): IncomeProfile {
  return {
    ...defaultProfile(new Date("2026-01-01T00:00:00.000Z"), "UTC"),
    income: "8000",
    ...overrides,
  };
}

describe("income profile", () => {
  it("defaults to five weekdays and eight working hours", () => {
    const value = defaultProfile(new Date("2026-01-01T00:00:00.000Z"), "Asia/Shanghai");
    expect(value).toMatchObject({
      workDays: [1, 2, 3, 4, 5],
      periods: [
        { start: "09:00", end: "12:00", endDayOffset: 0 },
        { start: "13:00", end: "18:00", endDayOffset: 0 },
      ],
      timeZone: "Asia/Shanghai",
      scheduleSource: "default",
    });
    expect(value.periods.reduce((total, period) => {
      const [startHour, startMinute] = period.start.split(":").map(Number);
      const [endHour, endMinute] = period.end.split(":").map(Number);
      return total + (period.endDayOffset * 24 * 60 + endHour * 60 + endMinute) - (startHour * 60 + startMinute);
    }, 0)).toBe(8 * 60);
  });

  it.each([
    ["invalid income", { income: "not-money" }, "income", "invalid-input"],
    ["zero income", { income: "0" }, "income", "zero-not-allowed"],
    ["invalid time zone", { timeZone: "Not/A_Real_Zone" }, "timeZone", "invalid-time-zone"],
    ["zero-length period", { periods: [{ start: "09:00", end: "09:00", endDayOffset: 0 }] }, "periods", "zero-length-period"],
    ["backwards period without next-day marker", { periods: [{ start: "22:00", end: "02:00", endDayOffset: 0 }] }, "periods", "invalid-period"],
    ["same-day overlap", { periods: [{ start: "09:00", end: "12:00", endDayOffset: 0 }, { start: "11:00", end: "13:00", endDayOffset: 0 }] }, "periods", "overlapping-periods"],
    ["adjacent-day overlap", {
      workDays: [1, 2],
      periods: [{ start: "22:00", end: "02:00", endDayOffset: 1 }, { start: "01:00", end: "09:00", endDayOffset: 0 }],
    }, "periods", "overlapping-periods"],
    ["invalid exception date", { exceptions: { "2026-02-30": "rest" } }, "exceptions", "invalid-date"],
  ] as const)("rejects $0", (_name, changes, field, code) => {
    const result = validateProfile(profile(changes));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.field === field && issue.code === code)).toBe(true);
  });
});

describe("calendar-based income calculation", () => {
  it("reuses prepared intervals for live ticks while applying a changed salary", () => {
    const formatSpy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      const first = calculateIncome(profile(), new Date("2026-02-02T10:00:00.000Z"));
      const beforeSecondTick = formatSpy.mock.calls.length;
      const next = calculateIncome(profile({ income: "9000" }), new Date("2026-02-02T10:00:01.000Z"));

      expect(first.status).toBe("available");
      expect(next.monthIncome?.decimal).toBe("56.27");
      expect(formatSpy.mock.calls.length - beforeSecondTick).toBe(1);
    } finally {
      formatSpy.mockRestore();
    }
  });

  it("uses exact work seconds for today's and month's income", () => {
    const value = profile();
    const atTen = calculateIncome(value, new Date("2026-02-02T10:00:00.000Z"));
    expect(atTen).toMatchObject({
      status: "available",
      evidenceStatus: "estimated",
      comparisonMonth: "2026-02",
      totalWorkSeconds: "576000",
      todayTotalWorkSeconds: "28800",
      todayElapsedWorkSeconds: "3600",
      monthElapsedWorkSeconds: "3600",
      todayIncome: { decimal: "50.00" },
      monthIncome: { decimal: "50.00" },
      perSecondIncome: { decimal: "0.01388889" },
      workState: "working",
    });

    expect(calculateIncome(value, new Date("2026-02-02T12:30:00.000Z")).todayIncome?.decimal).toBe("150.00");
    expect(calculateIncome(value, new Date("2026-02-02T13:30:00.000Z")).todayIncome?.decimal).toBe("175.00");
    expect(calculateIncome(value, new Date("2026-02-02T18:00:00.000Z"))).toMatchObject({
      todayIncome: { decimal: "400.00" },
      monthIncome: { decimal: "400.00" },
      workState: "resting",
    });
  });

  it("recalculates the complete monthly salary from the current calendar position", () => {
    const value = profile();
    const atMonthEnd = calculateIncome(value, new Date("2026-02-28T23:59:59.000Z"));
    expect(atMonthEnd).toMatchObject({
      totalWorkSeconds: "576000",
      monthElapsedWorkSeconds: "576000",
      monthIncome: { decimal: "8000.00" },
    });
    const reopened = calculateIncome(value, new Date("2026-02-02T10:00:00.000Z"));
    expect(reopened.todayIncome?.decimal).toBe("50.00");
  });

  it("applies work and rest exceptions to the scheduled day", () => {
    const restDay = calculateIncome(profile({ exceptions: { "2026-02-02": "rest" } }), new Date("2026-02-02T10:00:00.000Z"));
    expect(restDay.totalWorkSeconds).toBe(String(19 * 8 * 3600));
    expect(restDay.todayElapsedWorkSeconds).toBe("0");
    expect(restDay.workState).toBe("resting");

    const extraWorkDay = calculateIncome(profile({ exceptions: { "2026-02-07": "work" } }), new Date("2026-02-07T10:00:00.000Z"));
    expect(extraWorkDay.totalWorkSeconds).toBe(String(21 * 8 * 3600));
    expect(extraWorkDay.todayElapsedWorkSeconds).toBe("3600");
  });

  it("clips cross-midnight work at month boundaries and includes the prior day's spill", () => {
    const value = profile({
      workDays: [7],
      periods: [{ start: "23:00", end: "02:00", endDayOffset: 1 }],
      exceptions: { "2026-02-28": "work" },
    });
    const atHalfPastMidnight = calculateIncome(value, new Date("2026-03-01T00:30:00.000Z"));
    expect(atHalfPastMidnight).toMatchObject({
      comparisonMonth: "2026-03",
      totalWorkSeconds: "61200",
      monthElapsedWorkSeconds: "1800",
      todayTotalWorkSeconds: "10800",
      todayElapsedWorkSeconds: "1800",
    });
  });

  it("keeps the saved time zone when the device's current zone differs", () => {
    const value = profile({ timeZone: "America/Los_Angeles", workDays: [6] });
    const calculation = calculateIncome(value, new Date("2026-03-01T00:30:00.000Z"));
    expect(calculation).toMatchObject({ comparisonMonth: "2026-02", localDate: "2026-02-28" });
    expect(value.timeZone).toBe("America/Los_Angeles");
  });

  it.each([
    ["nonexistent spring-forward time", "America/New_York", "2026-03-01T12:00:00.000Z", "02:30", "04:00", "nonexistent-local-time"],
    ["ambiguous fall-back time", "America/New_York", "2026-11-02T12:00:00.000Z", "01:30", "04:00", "ambiguous-local-time"],
  ] as const)("reports %s without guessing a DST offset", (_name, timeZone, now, start, end, code) => {
    const value = profile({ timeZone, workDays: [7], periods: [{ start, end, endDayOffset: 0 }] });
    const result = calculateIncome(value, new Date(now));
    expect(result.status).toBe("insufficient-data");
    expect(result.reason?.code).toBe(code);
    expect(result.monthIncome).toBeNull();
  });

  it("reports a missing denominator and never reuses an earlier amount", () => {
    const value = profile({ workDays: [], exceptions: {} });
    const result = calculateIncome(value, new Date("2026-02-02T10:00:00.000Z"));
    expect(result).toMatchObject({ status: "insufficient-data", reason: { code: "no-working-time" } });
    expect(result.totalWorkSeconds).toBeNull();
    expect(result.todayIncome).toBeNull();
  });
});
