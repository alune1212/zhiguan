import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURRENCY_FIXTURE_BYTES,
  CURRENCY_FIXTURE_SHA256,
  CURRENCY_PUBLISHED_DATE,
  CURRENCY_TABLE_SNAPSHOT_ID,
  CurrencyFixtureError,
  generateCurrencyTable,
  parseCurrencyXml,
  readCurrencyFixture,
  renderCurrencyTableSource,
  validateCurrencyFixtureBytes,
} from "../../../scripts/generate-currency-table.mjs";
import {
  CURRENCY_MINOR_UNITS,
  CURRENCY_TABLE,
  CURRENCY_TABLE_BYTES,
  CURRENCY_TABLE_PUBLISHED_DATE,
  CURRENCY_TABLE_READ_DATE,
  CURRENCY_TABLE_SHA256,
  CURRENCY_TABLE_SNAPSHOT_ID as GENERATED_SNAPSHOT_ID,
} from "../../../src/domain/calculation/generated/currency-table";
import { currencyInfo } from "../../../src/domain/calculation/currency";

const FIXTURE_PATH = resolve(
  process.cwd(),
  "fixtures/currency/iso4217-list-one-2026-01-01.xml",
);

function minimalXml(entries: string, publishedDate = "2026-01-01"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<ISO_4217 Pblshd="${publishedDate}">`,
    "<CcyTbl>",
    entries,
    "</CcyTbl>",
    "</ISO_4217>",
  ].join("\n");
}

function currencyEntry({ code = "AAA", minorUnit = "2", numericCode = "001" } = {}) {
  return [
    "<CcyNtry>",
    "<CtryNm>TEST</CtryNm>",
    "<CcyNm>Test currency</CcyNm>",
    `<Ccy>${code}</Ccy>`,
    `<CcyNbr>${numericCode}</CcyNbr>`,
    `<CcyMnrUnts>${minorUnit}</CcyMnrUnts>`,
    "</CcyNtry>",
  ].join("");
}

function expectFixtureError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error("expected fixture parser to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CurrencyFixtureError);
    expect((error as CurrencyFixtureError).code).toBe(code);
    expect((error as Error).message).not.toContain("SECRET");
    expect((error as Error).message).not.toContain("AAA");
  }
}

describe("fixed ISO 4217 currency snapshot", () => {
  it("validates the immutable fixture bytes and publication metadata", async () => {
    const buffer = await readFile(FIXTURE_PATH);
    const xml = validateCurrencyFixtureBytes(buffer);
    const fixture = await readCurrencyFixture({ fixturePath: FIXTURE_PATH });

    expect(buffer.byteLength).toBe(CURRENCY_FIXTURE_BYTES);
    expect(CURRENCY_FIXTURE_SHA256).toBe(
      "838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9",
    );
    expect(xml.endsWith("\n")).toBe(false);
    expect(xml.match(/\r\n/gu)).toHaveLength(1955);
    expect(fixture.publishedDate).toBe(CURRENCY_PUBLISHED_DATE);
    expect(fixture.metadata.snapshotId).toBe(CURRENCY_TABLE_SNAPSHOT_ID);
    expect(fixture.entries.length).toBe(165);
  });

  it("deduplicates repeated country rows and skips N.A. minor units", async () => {
    const fixture = await readCurrencyFixture({ fixturePath: FIXTURE_PATH });
    const codes = fixture.entries.map(({ code }) => code);

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([...codes].sort());
    expect(codes).not.toContain("XAU");
    expect(codes).not.toContain("XTS");
    expect(codes).not.toContain("XXX");
    expect(fixture.entries.find(({ code }) => code === "CNY")?.minorUnit).toBe(2);
    expect(fixture.entries.find(({ code }) => code === "JPY")?.minorUnit).toBe(0);
    expect(fixture.entries.find(({ code }) => code === "KWD")?.minorUnit).toBe(3);
    expect(fixture.entries.find(({ code }) => code === "CLF")?.minorUnit).toBe(4);
  });

  it("renders only an immutable code-to-minor-unit map and fixed metadata", async () => {
    const fixture = await readCurrencyFixture({ fixturePath: FIXTURE_PATH });
    const source = renderCurrencyTableSource(fixture);
    const generated = await readFile(
      resolve(process.cwd(), "src/domain/calculation/generated/currency-table.ts"),
      "utf8",
    );

    expect(source).toBe(generated);
    expect(source).toContain("Object.freeze({");
    expect(source).toContain("CURRENCY_TABLE_SNAPSHOT_ID");
    expect(source).toContain(CURRENCY_FIXTURE_SHA256);
    expect(source).not.toContain("CtryNm");
    expect(source).not.toContain("CcyNbr");
    expect(source).not.toContain("XAU:");
    expect(source).not.toContain("N.A.");
  });

  it("exposes the generated table with frozen metadata and expected minor units", () => {
    expect(Object.isFrozen(CURRENCY_MINOR_UNITS)).toBe(true);
    expect(Object.isFrozen(CURRENCY_TABLE)).toBe(true);
    expect(GENERATED_SNAPSHOT_ID).toBe(CURRENCY_TABLE_SNAPSHOT_ID);
    expect(CURRENCY_TABLE_BYTES).toBe(CURRENCY_FIXTURE_BYTES);
    expect(CURRENCY_TABLE_SHA256).toBe(CURRENCY_FIXTURE_SHA256);
    expect(CURRENCY_TABLE_PUBLISHED_DATE).toBe(CURRENCY_PUBLISHED_DATE);
    expect(CURRENCY_TABLE_READ_DATE).toBe("2026-08-21");
    expect(CURRENCY_MINOR_UNITS.CNY).toBe(2);
    expect(CURRENCY_MINOR_UNITS.JPY).toBe(0);
    expect(CURRENCY_MINOR_UNITS.KWD).toBe(3);
    expect(CURRENCY_MINOR_UNITS.CLF).toBe(4);
    expect(CURRENCY_MINOR_UNITS.XAU).toBeUndefined();
    expect(currencyInfo("XAU")).toEqual({
      ok: false,
      reasonCode: "unsupported-currency",
    });
    expect(currencyInfo("ZZZ")).toEqual({
      ok: false,
      reasonCode: "unsupported-currency",
    });
  });

  it("fails closed for malformed, unknown, missing, invalid, and conflicting structure", () => {
    expectFixtureError(
      () => parseCurrencyXml(minimalXml(currencyEntry({ code: "AAA", minorUnit: "2" }) + "<Unknown/>")),
      "xml-tag-invalid",
    );
    expectFixtureError(
      () => parseCurrencyXml(minimalXml(currencyEntry({ code: "AAA", minorUnit: "2" }).replace("<CcyNbr>001</CcyNbr>", ""))),
      "currency-entry-structure-missing",
    );
    expectFixtureError(
      () => parseCurrencyXml(minimalXml(currencyEntry({ code: "aaA", minorUnit: "2" }))),
      "currency-code-invalid",
    );
    expectFixtureError(
      () => parseCurrencyXml(minimalXml(currencyEntry({ code: "AAA", minorUnit: "1" }))),
      "minor-unit-invalid",
    );
    expectFixtureError(
      () => parseCurrencyXml(minimalXml(
        currencyEntry({ code: "AAA", minorUnit: "2" }) +
          currencyEntry({ code: "AAA", minorUnit: "3", numericCode: "002" }),
      )),
      "duplicate-code-minor-unit-conflict",
    );
  });

  it("does not leak XML content in byte or parser failures", () => {
    const invalidBuffer = Buffer.from("SECRET", "utf8");
    expectFixtureError(() => validateCurrencyFixtureBytes(invalidBuffer), "bytes-mismatch");
    expectFixtureError(
      () => parseCurrencyXml(minimalXml(currencyEntry({ code: "AAA", minorUnit: "2" }).replace("Test currency", "SECRET" )).replace("</CcyNtry>", "<SECRET></CcyNtry>")),
      "xml-tag-unbalanced",
    );
  });

  it("supports deterministic --check semantics without changing the generated file", async () => {
    const before = await readFile(
      resolve(process.cwd(), "src/domain/calculation/generated/currency-table.ts"),
    );
    const result = await generateCurrencyTable({ check: true });
    const after = await readFile(
      resolve(process.cwd(), "src/domain/calculation/generated/currency-table.ts"),
    );

    expect(result.checked).toBe(true);
    expect(result.entries).toBe(165);
    expect(after.equals(before)).toBe(true);
  });
});
