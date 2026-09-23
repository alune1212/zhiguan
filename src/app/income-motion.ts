import type { IncomeCalculation, IncomeProfile } from "../domain/income";

const motionFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type IncomeMotionFrame = {
  cents: bigint;
  localDate: string;
  profile: IncomeProfile;
  second: number;
  generation: number;
  workState: IncomeCalculation["workState"];
};

export function parseAnimatedAmount(decimal: string | null | undefined): { value: number; cents: bigint } | null {
  const match = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(decimal ?? "");
  if (!match) return null;
  const cents = BigInt(match[1] as string) * 100n + BigInt(match[2] as string);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const value = Number(decimal);
  const exactDisplay = `${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
  return Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100))
    && BigInt(Math.round(value * 100)) === cents && motionFormatter.format(value) === exactDisplay
    ? { value, cents } : null;
}

export function shouldAnimateIncome(previous: IncomeMotionFrame | null, next: IncomeMotionFrame | null): boolean {
  return previous !== null && next !== null
    && previous.profile === next.profile
    && previous.localDate === next.localDate
    && previous.generation === next.generation
    && next.second === previous.second + 1
    && previous.workState === "working" && next.workState === "working"
    && next.cents > previous.cents;
}

export function isPausedIncomeCurrent(
  paused: { profile: IncomeProfile } | null,
  profile: IncomeProfile | null,
  status: IncomeCalculation["status"] | null,
  onDashboard: boolean,
): boolean {
  return paused !== null && onDashboard && paused.profile === profile && status === "available";
}
