import type { SessionTimeContext } from "../../domain/session/types";

export type TimeZoneSource = SessionTimeContext["timeZoneSource"];
export type TimeZoneConfirmation = SessionTimeContext["timeZoneConfirmation"];

export interface DeviceClockOptions {
  /** Explicit dates keep the adapter deterministic in tests and callers. */
  readonly occurredAt?: Date;
  readonly recordedAt?: Date;
  /** An explicit value is treated as a user-selected IANA identifier. */
  readonly timeZoneId?: string | null;
  readonly timeZoneSource?: TimeZoneSource;
  readonly timeZoneConfirmation?: TimeZoneConfirmation;
  /** Optional explicit offset for an already observed/confirmed context. */
  readonly utcOffset?: string | null;
  /** Injectable observation for browser tests; no network or persistence is used. */
  readonly observeTimeZone?: () => string | null | undefined;
  /** Injectable clock for browser observation; defaults to the device clock. */
  readonly now?: () => Date;
}

const STRICT_UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UTC_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/**
 * Convert an explicit Date to the only instant representation accepted by the
 * domain. Extended-year Date strings are rejected so the result is strictly
 * round-trippable as YYYY-MM-DDTHH:mm:ss.sssZ.
 */
export function toStrictUtcIso(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError("invalid-device-date");
  }
  const value = date.toISOString();
  if (!STRICT_UTC_ISO.test(value)) {
    throw new RangeError("unsupported-utc-instant");
  }
  const roundTrip = new Date(value).toISOString();
  if (roundTrip !== value) {
    throw new RangeError("utc-round-trip-failed");
  }
  return value;
}

/** Validate and return a strict UTC instant without normalizing user text. */
export function assertStrictUtcIso(value: string): string {
  if (!STRICT_UTC_ISO.test(value)) {
    throw new RangeError("invalid-utc-instant");
  }
  const roundTrip = new Date(value).toISOString();
  if (roundTrip !== value) {
    throw new RangeError("utc-round-trip-failed");
  }
  return value;
}

function isValidOffset(value: string): boolean {
  const match = UTC_OFFSET.exec(value);
  if (!match) {
    return false;
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return hours <= 23 && minutes <= 59;
}

function normalizeOffset(value: string | null | undefined): string | null {
  if (!value || !isValidOffset(value)) {
    return null;
  }
  return value;
}

/** IANA validation is performed by the platform's timezone database. */
export function isValidIanaTimeZone(value: string | null | undefined): value is string {
  if (!value || value.trim() !== value || value.length === 0 || /[\u0000-\u0020]/.test(value)) {
    return false;
  }
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
    return typeof resolved === "string" && resolved.length > 0;
  } catch {
    return false;
  }
}

/** Observe the browser suggestion; callers can still replace it explicitly. */
export function observeBrowserTimeZone(): string | null {
  try {
    const candidate = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidIanaTimeZone(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function offsetForTimeZone(date: Date, timeZoneId: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      timeZone: timeZoneId,
      timeZoneName: "longOffset",
    }).formatToParts(date);
    const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    if (zone === "GMT" || zone === "UTC") {
      return "+00:00";
    }
    const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(zone);
    if (!match) {
      return null;
    }
    const hours = match[2].padStart(2, "0");
    const minutes = (match[3] ?? "00").padStart(2, "0");
    const result = `${match[1]}${hours}:${minutes}`;
    return isValidOffset(result) ? result : null;
  } catch {
    return null;
  }
}

interface ResolvedTimeZone {
  readonly timeZoneId: string;
  readonly timeZoneSource: TimeZoneSource;
  readonly timeZoneConfirmation: TimeZoneConfirmation;
}

function resolveTimeZone(options: DeviceClockOptions): ResolvedTimeZone {
  if (options.timeZoneSource === "utc-fallback") {
    return {
      timeZoneId: "Etc/UTC",
      timeZoneSource: "utc-fallback",
      timeZoneConfirmation: "unconfirmed",
    };
  }
  const explicit = options.timeZoneId;
  if (explicit && isValidIanaTimeZone(explicit)) {
    const source = options.timeZoneSource ?? "user-selected";
    const requestedConfirmation = options.timeZoneConfirmation;
    const confirmation = source === "browser-observed"
      ? (requestedConfirmation === "unconfirmed" ? "unconfirmed" : "observed")
      : (requestedConfirmation === "unconfirmed" ? "unconfirmed" : "user-confirmed");
    return {
      timeZoneId: explicit,
      timeZoneSource: source,
      timeZoneConfirmation: confirmation,
    };
  }

  let observed: string | null | undefined;
  try {
    observed = options.observeTimeZone?.() ?? observeBrowserTimeZone();
  } catch {
    observed = null;
  }
  if (observed && isValidIanaTimeZone(observed)) {
    return {
      timeZoneId: observed,
      timeZoneSource: "browser-observed",
      timeZoneConfirmation: "observed",
    };
  }

  return {
    timeZoneId: "Etc/UTC",
    timeZoneSource: "utc-fallback",
    timeZoneConfirmation: "unconfirmed",
  };
}

/**
 * Build a device-clock context from explicit dates and timezone metadata. The
 * timezone never enters a formula; it is only retained for explanation and
 * historical interpretation.
 */
export function createDeviceTimeContext(options: DeviceClockOptions = {}): SessionTimeContext {
  const now = options.now ?? (() => new Date());
  const occurredAt = options.occurredAt ?? now();
  const recordedAt = options.recordedAt ?? now();
  const occurredAtUtc = toStrictUtcIso(occurredAt);
  const recordedAtUtc = toStrictUtcIso(recordedAt);
  const resolved = resolveTimeZone(options);

  if (resolved.timeZoneSource === "utc-fallback") {
    return Object.freeze({
      occurredAtUtc,
      recordedAtUtc,
      clockSource: "device-clock" as const,
      timeZoneId: "Etc/UTC",
      utcOffset: "+00:00",
      timeZoneSource: "utc-fallback" as const,
      timeZoneConfirmation: "unconfirmed" as const,
    });
  }

  const utcOffset = normalizeOffset(options.utcOffset) ?? offsetForTimeZone(occurredAt, resolved.timeZoneId);
  if (!utcOffset) {
    return Object.freeze({
      occurredAtUtc,
      recordedAtUtc,
      clockSource: "device-clock" as const,
      timeZoneId: "Etc/UTC",
      utcOffset: "+00:00",
      timeZoneSource: "utc-fallback" as const,
      timeZoneConfirmation: "unconfirmed" as const,
    });
  }

  return Object.freeze({
    occurredAtUtc,
    recordedAtUtc,
    clockSource: "device-clock" as const,
    timeZoneId: resolved.timeZoneId,
    utcOffset,
    timeZoneSource: resolved.timeZoneSource,
    timeZoneConfirmation: resolved.timeZoneConfirmation,
  });
}

/** Explicitly name browser observation for callers and tests. */
export function observeDeviceTimeContext(options: DeviceClockOptions = {}): SessionTimeContext {
  return createDeviceTimeContext({
    ...options,
    timeZoneId: options.timeZoneId ?? null,
    timeZoneSource: options.timeZoneId ? options.timeZoneSource : "browser-observed",
    timeZoneConfirmation: options.timeZoneId ? options.timeZoneConfirmation : "observed",
  });
}
