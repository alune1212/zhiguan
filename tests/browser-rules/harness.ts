import {
  calculatePurchaseDecision,
  normalizeRational,
  rationalDisplay,
  roundHalfAwayFromZero,
  type CalculationRequest,
  type CalculationResult,
  type Rational,
} from "../../src/domain/calculation/index.js";

interface BrowserRuleHarness {
  readonly calculate: (request: CalculationRequest) => readonly CalculationResult[];
  readonly round: (
    numerator: string,
    denominator: string,
    displayDigits: number,
    unit: string,
    tinyPositiveText?: string,
  ) => {
    readonly decimal: string;
    readonly rounded: boolean;
    readonly display: ReturnType<typeof rationalDisplay>;
  };
  readonly normalize: (
    numerator: string,
    denominator: string,
  ) =>
    | { readonly ok: true; readonly numerator: string; readonly denominator: string }
    | { readonly ok: false; readonly reasonCode: string };
}

const browserHarness: BrowserRuleHarness = {
  calculate: (request) => calculatePurchaseDecision(request),
  round: (numerator, denominator, displayDigits, unit, tinyPositiveText) => {
    const value: Rational = {
      numerator: BigInt(numerator),
      denominator: BigInt(denominator),
    };
    const rounded = roundHalfAwayFromZero(value, displayDigits);
    const display = rationalDisplay(value, displayDigits, unit, {
      tinyPositiveText,
    });
    return {
      decimal: rounded.decimal,
      rounded: rounded.rounded,
      display,
    };
  },
  normalize: (numerator, denominator) => {
    const result = normalizeRational(BigInt(numerator), BigInt(denominator));
    return result.ok
      ? {
          ok: true,
          numerator: result.value.numerator.toString(),
          denominator: result.value.denominator.toString(),
        }
      : result;
  },
};

type WindowWithRuleHarness = Window & {
  __zhiguanRuleHarness?: BrowserRuleHarness;
};

(window as WindowWithRuleHarness).__zhiguanRuleHarness = browserHarness;
