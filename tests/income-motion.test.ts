import { describe, expect, it } from "vitest";

import { defaultProfile } from "../src/domain/income";
import {
  parseAnimatedAmount,
  shouldAnimateIncome,
  isPausedIncomeCurrent,
  type IncomeMotionFrame,
} from "../src/app/income-motion";

const savedProfile = defaultProfile(new Date("2026-01-01T00:00:00.000Z"), "UTC");

function frame(overrides: Partial<IncomeMotionFrame> = {}): IncomeMotionFrame {
  return {
    cents: 999n,
    localDate: "2026-09-23",
    profile: savedProfile,
    second: 100,
    generation: 1,
    workState: "working",
    ...overrides,
  };
}

describe("parseAnimatedAmount", () => {
  it.each([
    ["0.00", 0, 0n],
    ["9.99", 9.99, 999n],
    ["10.00", 10, 1000n],
    ["999.99", 999.99, 99999n],
    ["1000.00", 1000, 100000n],
    ["90071992547409.89", 90071992547409.89, 9007199254740989n],
  ] as const)("parses %s into a value and exact cents", (decimal, value, cents) => {
    expect(parseAnimatedAmount(decimal)).toEqual({ value, cents });
  });

  const invalidDecimals: readonly (string | null | undefined)[] = [
    null,
    undefined,
    "",
    "-0.00",
    "-1.00",
    "+1.00",
    "1",
    "1.0",
    "1.000",
    "1,000.00",
    " 1.00",
    "1.00 ",
    ".01",
    "1e2",
    "NaN",
    "Infinity",
    // Its exact cents fit in a safe integer, but Number(value) * 100 does not round-trip.
    "90071992547409.90",
    "90071992547409.91",
    "90071992547409.92",
    // The cent check passes, but Intl would render .90 instead of the exact .91.
    "90071988759695.91",
  ];

  it.each(invalidDecimals)("rejects malformed or unsafe amount %s", (decimal) => {
    expect(parseAnimatedAmount(decimal)).toBeNull();
  });
});

describe("income amount animation eligibility", () => {
  it.each([
    ["9.99", "10.00", "10.00", 999n, 1000n],
    ["999.99", "1000.00", "1,000.00", 99999n, 100000n],
  ] as const)("animates the cent carry from %s to %s", (from, to, formatted, fromCents, toCents) => {
    const previous = parseAnimatedAmount(from);
    const next = parseAnimatedAmount(to);
    if (!previous || !next) throw new Error("test amount did not parse");

    expect(previous.cents).toBe(fromCents);
    expect(next.cents).toBe(toCents);
    expect(new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(next.value)).toBe(formatted);
    expect(shouldAnimateIncome(frame({ cents: previous.cents }), frame({ cents: next.cents, second: 101 }))).toBe(true);
  });

  it("does not animate when a low rate leaves the displayed cent unchanged", () => {
    expect(shouldAnimateIncome(frame({ cents: 1234n }), frame({ cents: 1234n, second: 101 }))).toBe(false);
  });

  const rejectedPairs: Array<[string, Partial<IncomeMotionFrame>, Partial<IncomeMotionFrame>]> = [
    ["a non-adjacent tick", {}, { second: 102 }],
    ["a same-second tick", {}, { second: 100 }],
    ["a fractional second", {}, { second: 101.5 }],
    ["a clock rollback", { second: 101 }, { second: 100 }],
    ["a local date change", {}, { localDate: "2026-09-24" }],
    ["a different profile object", {}, { profile: { ...savedProfile } }],
    ["a new generation after recovery", {}, { generation: 2 }],
    ["a tick that leaves the working state", {}, { workState: "resting" }],
    ["a previous tick outside work", { workState: "resting" }, {}],
    ["a tick that becomes insufficient", {}, { workState: "insufficient-data" }],
    ["a previous insufficient tick", { workState: "insufficient-data" }, {}],
    ["a decrease in cents", { cents: 1000n }, { cents: 999n }],
  ];

  it.each(rejectedPairs)("does not animate across %s", (_reason, previous, next) => {
    expect(shouldAnimateIncome(frame(previous), frame({ cents: 1000n, second: 101, ...next }))).toBe(false);
  });

  it("does not animate before the first frame or after the last frame", () => {
    expect(shouldAnimateIncome(null, frame())).toBe(false);
    expect(shouldAnimateIncome(frame(), null)).toBe(false);
  });
});

describe("paused income validity", () => {
  const paused = { profile: savedProfile };

  it("keeps the pause only while its basis stays available on the dashboard", () => {
    expect(isPausedIncomeCurrent(paused, savedProfile, "available", true)).toBe(true);
    expect(isPausedIncomeCurrent(paused, { ...savedProfile }, "available", true)).toBe(false);
    expect(isPausedIncomeCurrent(paused, savedProfile, "insufficient-data", true)).toBe(false);
    expect(isPausedIncomeCurrent(paused, savedProfile, "available", false)).toBe(false);
    expect(isPausedIncomeCurrent(null, savedProfile, "available", true)).toBe(false);
  });
});
