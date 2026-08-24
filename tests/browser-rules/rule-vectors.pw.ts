import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import type {
  CalculationRequest,
  CalculationResult,
} from "../../src/domain/calculation/index.js";
import {
  buildRuleVectorCatalog,
  canonicalUnit,
  fixturePeriodRef,
  type CalculationVector,
  type RuleVectorCatalog,
} from "./vector-catalog.js";

type JsonRecord = Record<string, unknown>;

interface BrowserHarness {
  readonly calculate: (request: CalculationRequest) => readonly CalculationResult[];
  readonly round: (
    numerator: string,
    denominator: string,
    displayDigits: number,
    unit: string,
    tinyPositiveText?: string,
  ) => JsonRecord;
  readonly normalize: (numerator: string, denominator: string) => JsonRecord;
}

interface VectorRun {
  readonly forward: readonly VectorOutput[];
  readonly repeated: readonly VectorOutput[];
  readonly withPoisonedHistory: readonly VectorOutput[];
  readonly reverse: readonly VectorOutput[];
  readonly rounding: readonly JsonRecord[];
  readonly normalize: JsonRecord;
}

interface VectorOutput {
  readonly id: string;
  readonly results: readonly CalculationResult[];
}

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CALCULATION_ROOT = resolve(REPO_ROOT, "src/domain/calculation");
const RULESET_REF = "purchase-decision-rules@1.0.0";
const EXPECTED_VECTOR_DIGEST =
  "8328a9521d4f408ae43b682ba55a73c692524647ecbf1b374ded74cac8ae5390";

const STATIC_DENYLIST = Object.freeze([
  { label: "Number reference", pattern: /\bNumber\b/u },
  { label: "parseFloat reference", pattern: /\bparseFloat\b/u },
  { label: "implicit performance clock reference", pattern: /\bperformance\b/u },
  { label: "randomness reference", pattern: /\bMath\s*\.\s*random\b/u },
  { label: "fetch reference", pattern: /\bfetch\b/u },
  { label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/u },
  { label: "WebSocket", pattern: /\bWebSocket\b/u },
  { label: "EventSource", pattern: /\bEventSource\b/u },
  { label: "sendBeacon", pattern: /\bsendBeacon\b/u },
  { label: "localStorage", pattern: /\blocalStorage\b/u },
  { label: "sessionStorage", pattern: /\bsessionStorage\b/u },
  { label: "IndexedDB", pattern: /\bindexedDB\b/u },
  { label: "Cache Storage", pattern: /\bcaches\b/u },
  { label: "cookie storage", pattern: /\bcookie\b/u },
  { label: "clipboard", pattern: /\bclipboard\b/u },
  { label: "console output", pattern: /\bconsole\b/u },
  { label: "DOM window", pattern: /\bwindow\b/u },
  { label: "DOM document", pattern: /\bdocument\b/u },
  { label: "browser navigator", pattern: /\bnavigator\b/u },
  {
    label: "old result fallback",
    pattern: /\b(?:oldResults|old_results|previousResults|previous_results)\b/u,
  },
]);

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as JsonRecord;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestRun(run: VectorRun): string {
  return createHash("sha256")
    .update(
      stableJson({
        forward: run.forward,
        rounding: run.rounding,
        normalize: run.normalize,
      }),
      "utf8",
    )
    .digest("hex");
}

function resultByFormula(
  results: readonly CalculationResult[],
  formulaId: string,
): CalculationResult {
  const result = results.find((item) => item.formulaId === formulaId);
  if (!result) throw new Error(`missing calculation result ${formulaId}`);
  return result;
}

function assertFixtureResult(
  actual: CalculationResult,
  expected: JsonRecord,
  request: CalculationRequest,
): void {
  expect(actual.source).toBe("ruleset-derived");
  expect(actual.formulaExpression.length).toBeGreaterThan(0);
  expect(actual.timeContext).toEqual(request.context.timeContext ?? null);
  expect(actual.rulesetId).toBe(request.context.rulesetId);
  expect(actual.rulesetVersion).toBe(request.context.rulesetVersion);
  expect(actual.rulesetRef).toBe(RULESET_REF);
  expect(actual.currencyTableSnapshotId).toBe(
    request.context.currencyTableSnapshotId,
  );
  expect(actual.availability).toBe(expected.availability);
  expect(actual.evidenceStatus).toBe(expected.evidence_status);
  expect(actual.primaryReasonCode).toBe(expected.primary_reason_code ?? null);

  if (Array.isArray(expected.reason_codes)) {
    expect(actual.reasonCodes).toEqual(expected.reason_codes);
  }
  if (Array.isArray(expected.dependency_field_ids)) {
    expect(actual.dependencyFieldIds).toEqual(expected.dependency_field_ids);
  }
  if (Array.isArray(expected.estimated_dependency_field_ids)) {
    expect(actual.estimatedDependencyFieldIds).toEqual(
      expected.estimated_dependency_field_ids,
    );
  }
  if (expected.unit !== undefined && expected.unit !== null) {
    expect(actual.unit).toBe(canonicalUnit(expected.unit));
  }
  if (expected.currency_code !== undefined) {
    expect(actual.currencyCode).toBe(expected.currency_code);
  }
  if (expected.period_ref !== undefined) {
    expect(actual.periodRef).toEqual(fixturePeriodRef(expected.period_ref));
  }
  if (expected.tax_basis !== undefined) {
    expect(actual.taxBasis).toBe(expected.tax_basis);
  }

  const exact = expected.exact as JsonRecord | null;
  if (exact === null) {
    expect(actual.exact).toBeNull();
    expect(actual.display).toBeNull();
    return;
  }
  expect(actual.exact).not.toBeNull();
  expect(actual.display).not.toBeNull();
  if (actual.exact) {
    if (exact.rational !== undefined) {
      expect(actual.exact.rational).toEqual(exact.rational);
    }
    if (exact.minor_units !== undefined) {
      expect(actual.exact.minorUnits).toBe(exact.minor_units);
    }
    if (exact.currency_code !== undefined) {
      expect(actual.exact.currencyCode).toBe(exact.currency_code);
    }
    if (exact.unit !== undefined) {
      expect(actual.exact.unit).toBe(canonicalUnit(exact.unit));
    }
    if (typeof exact.decimal === "string") {
      expect(actual.exact.decimal).toBe(exact.decimal);
    }
  }

  const display = expected.display as JsonRecord;
  if (actual.display) {
    expect(actual.display.text).toBe(canonicalUnit(display.text));
    expect(actual.display.decimal).toBe(display.decimal);
    expect(actual.display.displayDigits).toBe(display.display_digits);
    expect(actual.display.relation).toBe(display.relation);
    expect(actual.display.roundingMode).toBe(display.rounding_mode);
    expect(actual.display.rounded).toBe(display.rounded);
    expect(actual.rounding).toEqual({
      mode: display.rounding_mode,
      displayDigits: display.display_digits,
      rounded: display.rounded,
    });
  }
}

function assertOracle(
  output: VectorOutput,
  vector: CalculationVector,
): void {
  expect(output.id).toBe(vector.id);
  expect(output.results).toHaveLength(5);
  if (vector.expected.kind === "canonical") {
    expect(output.results).toEqual(vector.expected.results);
    return;
  }
  for (const expected of vector.expected.results) {
    const formulaId = String(expected.formula_id);
    assertFixtureResult(
      resultByFormula(output.results, formulaId),
      expected,
      vector.request,
    );
  }
}

async function waitForHarness(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as Window & { __zhiguanRuleHarness?: BrowserHarness })
            .__zhiguanRuleHarness,
        ),
      ),
    )
    .toBe(true);
}

async function executeCatalog(
  page: Page,
  catalog: RuleVectorCatalog,
): Promise<VectorRun> {
  return page.evaluate(
    ({ vectors, roundingVectors, normalizeVector }) => {
      const harness = (
        window as Window & { __zhiguanRuleHarness?: BrowserHarness }
      ).__zhiguanRuleHarness;
      if (!harness) throw new Error("rule harness unavailable");

      const restorers: Array<() => void> = [];
      const replace = (target: object, key: PropertyKey, value: unknown): void => {
        const own = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: own?.enumerable ?? false,
          writable: true,
          value,
        });
        restorers.push(() => {
          if (own) Object.defineProperty(target, key, own);
          else Reflect.deleteProperty(target, key);
        });
      };
      const blocked = (boundary: string) => (): never => {
        throw new Error(`forbidden rule-kernel boundary: ${boundary}`);
      };

      const realDate = Date;
      const guardedDate = new Proxy(realDate, {
        apply(target, thisArgument, argumentsList) {
          if (argumentsList.length === 0) blocked("implicit Date")();
          return Reflect.apply(target, thisArgument, argumentsList);
        },
        construct(target, argumentsList, newTarget) {
          if (argumentsList.length === 0) blocked("implicit Date")();
          return Reflect.construct(target, argumentsList, newTarget);
        },
      });

      replace(realDate, "now", blocked("Date.now"));
      replace(performance, "now", blocked("performance.now"));
      replace(globalThis, "Number", blocked("Number"));
      replace(globalThis, "Date", guardedDate);
      replace(Math, "random", blocked("Math.random"));
      replace(globalThis, "fetch", blocked("fetch"));
      replace(globalThis, "XMLHttpRequest", blocked("XMLHttpRequest"));
      replace(globalThis, "WebSocket", blocked("WebSocket"));
      replace(globalThis, "EventSource", blocked("EventSource"));
      replace(navigator, "sendBeacon", blocked("sendBeacon"));
      replace(globalThis, "localStorage", new Proxy({}, { get: blocked("localStorage") }));
      replace(globalThis, "sessionStorage", new Proxy({}, { get: blocked("sessionStorage") }));
      replace(globalThis, "indexedDB", new Proxy({}, { get: blocked("indexedDB") }));
      replace(globalThis, "caches", new Proxy({}, { get: blocked("Cache Storage") }));
      replace(navigator, "clipboard", new Proxy({}, { get: blocked("clipboard") }));
      replace(globalThis, "console", new Proxy({}, { get: blocked("console") }));

      const run = (items: readonly CalculationVector[]): readonly VectorOutput[] =>
        items.map((item) => ({
          id: item.id,
          results: harness.calculate(item.request),
        }));

      try {
        const forward = run(vectors);
        const repeated = run(vectors);
        const withPoisonedHistory = run(
          vectors.map((item) => ({
            ...item,
            request: {
              ...item.request,
              oldResults: [{ formulaId: "purchase-impact", exact: "poison" }],
              previousResults: [{ formulaId: "income-rate", exact: "poison" }],
              inputs: {
                ...item.request.inputs,
                oldResults: [{ formulaId: "purchase-impact", exact: "poison" }],
                previousResults: [{ formulaId: "income-rate", exact: "poison" }],
              },
            },
          })),
        );
        const reverse = run([...vectors].reverse());
        const rounding = roundingVectors.map((item) =>
          harness.round(
            item.numerator,
            item.denominator,
            item.displayDigits,
            item.unit,
            item.tinyPositiveText,
          ),
        );
        const normalize = harness.normalize(
          normalizeVector.numerator,
          normalizeVector.denominator,
        );
        return {
          forward,
          repeated,
          withPoisonedHistory,
          reverse,
          rounding,
          normalize,
        };
      } finally {
        for (const restore of restorers.reverse()) restore();
      }
    },
    catalog,
  );
}

test.describe("cross-engine calculation rule vectors", () => {
  test("keeps the pure calculation source free of forbidden boundaries", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(CALCULATION_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const item of STATIC_DENYLIST) {
        if (item.pattern.test(source)) {
          violations.push(`${relative(REPO_ROOT, file)}: ${item.label}`);
        }
      }
      const withoutExplicitDateValidation = source.replace(
        /new\s+Date\s*\(\s*[^()\n]+\s*\)/gu,
        "",
      );
      if (/\bDate\b/u.test(withoutExplicitDateValidation)) {
        violations.push(
          `${relative(REPO_ROOT, file)}: Date reference outside explicit-argument validation`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("replays all synthetic calculation oracles deterministically and offline", async ({
    browserName,
    context,
    page,
  }, testInfo) => {
    const catalog = buildRuleVectorCatalog();
    expect(catalog.fixtureCount).toBe(19);
    expect(catalog.caseOracleCount).toBe(76);
    expect(catalog.resultOracleCount).toBe(655);
    expect(catalog.calculationResultOracleCount).toBe(652);
    expect(catalog.fixtureCalculationResultOracleCount).toBe(152);
    expect(catalog.engineParityResultCount).toBe(500);
    expect(catalog.roundingOracleCount).toBe(3);
    expect(catalog.utilityOracleCount).toBe(1);
    expect(catalog.excludedNonCalculationFailureCount).toBe(5);
    expect(catalog.vectors).toHaveLength(132);

    const executionRequests: string[] = [];
    const executionWebSockets: string[] = [];
    const executionConsole: string[] = [];
    const executionErrors: string[] = [];
    let executing = false;
    page.on("request", (request) => {
      if (executing) executionRequests.push(request.url());
    });
    page.on("websocket", (socket) => {
      if (executing) executionWebSockets.push(socket.url());
    });
    page.on("console", (message) => {
      if (executing) executionConsole.push(`${message.type()}:${message.text()}`);
    });
    page.on("pageerror", (error) => {
      if (executing) executionErrors.push(error.message);
    });

    await page.goto("/tests/browser-rules/index.html");
    await waitForHarness(page);
    await context.setOffline(true);
    executing = true;
    let run: VectorRun;
    try {
      run = await executeCatalog(page, catalog);
    } finally {
      executing = false;
      await context.setOffline(false);
    }

    expect(executionRequests).toEqual([]);
    expect(executionWebSockets).toEqual([]);
    expect(executionConsole).toEqual([]);
    expect(executionErrors).toEqual([]);
    expect(run.forward).toEqual(run.repeated);
    expect(run.forward).toEqual(run.withPoisonedHistory);
    expect([...run.reverse].reverse()).toEqual(run.forward);

    for (const [index, vector] of catalog.vectors.entries()) {
      assertOracle(run.forward[index] as VectorOutput, vector);
    }
    for (const [index, vector] of catalog.roundingVectors.entries()) {
      const actual = run.rounding[index] as JsonRecord;
      expect(actual.decimal).toBe(vector.expectedDecimal);
      if (vector.expectedText !== undefined) {
        expect((actual.display as JsonRecord).text).toBe(vector.expectedText);
      }
    }
    expect(run.normalize).toEqual({
      ok: false,
      reasonCode: catalog.normalizeVector.expectedReasonCode,
    });

    const storage = await page.evaluate(async () => ({
      localStorageLength: localStorage.length,
      sessionStorageLength: sessionStorage.length,
      indexedDbNames:
        typeof indexedDB.databases === "function"
          ? (await indexedDB.databases()).map((item) => item.name ?? "")
          : [],
      cacheNames: await caches.keys(),
      serviceWorkerCount:
        "serviceWorker" in navigator
          ? (await navigator.serviceWorker.getRegistrations()).length
          : 0,
      search: location.search,
      hash: location.hash,
    }));
    expect(storage).toEqual({
      localStorageLength: 0,
      sessionStorageLength: 0,
      indexedDbNames: [],
      cacheNames: [],
      serviceWorkerCount: 0,
      search: "",
      hash: "",
    });
    expect(await context.cookies()).toEqual([]);

    const digest = digestRun(run);
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(digest).toBe(EXPECTED_VECTOR_DIGEST);
    testInfo.annotations.push(
      {
        type: "rule-vector-digest",
        description: digest,
      },
      {
        type: "browser-engine",
        description: `${browserName} ${await page.evaluate(() => navigator.userAgent)}`,
      },
    );
    process.stdout.write(
      `RULE_VECTOR_SUMMARY engine=${browserName} version=${context.browser()?.version() ?? "unknown"} fixtures=19 cases=76 calculation_cases=71 excluded_non_calculation_cases=5 fixture_results=152 revision_parity_results=500 rounding_results=3 total_result_oracles=655 utility=1 digest=${digest}\n`,
    );
  });
});
