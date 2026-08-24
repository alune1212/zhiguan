import { describe, expect, it } from "vitest";

import {
  assertStrictUtcIso,
  createDeviceTimeContext,
  isValidIanaTimeZone,
  observeDeviceTimeContext,
  toStrictUtcIso,
} from "../../../src/adapters/browser/clock";

describe("browser clock adapter", () => {
  it("keeps explicit occurred and recorded instants as strict ISO round-trips", () => {
    const occurredAt = new Date("2026-08-24T00:00:00.000Z");
    const recordedAt = new Date("2026-08-24T00:00:01.234Z");
    const context = createDeviceTimeContext({
      occurredAt,
      recordedAt,
      timeZoneId: "Asia/Shanghai",
    });

    expect(context.occurredAtUtc).toBe("2026-08-24T00:00:00.000Z");
    expect(context.recordedAtUtc).toBe("2026-08-24T00:00:01.234Z");
    expect(context.clockSource).toBe("device-clock");
    expect(context.timeZoneId).toBe("Asia/Shanghai");
    expect(context.timeZoneSource).toBe("user-selected");
    expect(context.timeZoneConfirmation).toBe("user-confirmed");
    expect(context.utcOffset).toBe("+08:00");
    expect(assertStrictUtcIso(context.occurredAtUtc)).toBe(context.occurredAtUtc);
    expect(toStrictUtcIso(occurredAt)).toBe(context.occurredAtUtc);
  });

  it("records browser-observed timezone and DST-aware offset without entering formulas", () => {
    const context = observeDeviceTimeContext({
      occurredAt: new Date("2026-07-01T12:00:00.000Z"),
      recordedAt: new Date("2026-07-01T12:00:00.100Z"),
      observeTimeZone: () => "America/New_York",
    });

    expect(context.timeZoneId).toBe("America/New_York");
    expect(context.timeZoneSource).toBe("browser-observed");
    expect(context.timeZoneConfirmation).toBe("observed");
    expect(context.utcOffset).toBe("-04:00");
  });

  it("uses explicit UTC fallback when timezone observation is unavailable", () => {
    const context = observeDeviceTimeContext({
      occurredAt: new Date("2026-08-24T00:00:00.000Z"),
      recordedAt: new Date("2026-08-24T00:00:00.000Z"),
      observeTimeZone: () => "not-a-time-zone",
    });

    expect(context.timeZoneId).toBe("Etc/UTC");
    expect(context.utcOffset).toBe("+00:00");
    expect(context.timeZoneSource).toBe("utc-fallback");
    expect(context.timeZoneConfirmation).toBe("unconfirmed");
  });

  it("fails closed to UTC when custom timezone observation throws", () => {
    const context = observeDeviceTimeContext({
      occurredAt: new Date("2026-08-24T00:00:00.000Z"),
      recordedAt: new Date("2026-08-24T00:00:00.000Z"),
      observeTimeZone: () => {
        throw new Error("observation unavailable");
      },
    });

    expect(context.timeZoneId).toBe("Etc/UTC");
    expect(context.utcOffset).toBe("+00:00");
    expect(context.timeZoneSource).toBe("utc-fallback");
    expect(context.timeZoneConfirmation).toBe("unconfirmed");
  });

  it("rejects invalid dates and non-round-trippable instant strings", () => {
    expect(() => toStrictUtcIso(new Date(Number.NaN))).toThrow("invalid-device-date");
    expect(() => assertStrictUtcIso("2026-08-24T00:00:00Z")).toThrow("invalid-utc-instant");
    expect(() => assertStrictUtcIso("2026-02-30T00:00:00.000Z")).toThrow("utc-round-trip-failed");
    expect(isValidIanaTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidIanaTimeZone("not-a-time-zone")).toBe(false);
  });
});
