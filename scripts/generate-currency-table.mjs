import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const CURRENCY_FIXTURE_RELATIVE_PATH =
  "fixtures/currency/iso4217-list-one-2026-01-01.xml";
export const GENERATED_CURRENCY_TABLE_RELATIVE_PATH =
  "src/domain/calculation/generated/currency-table.ts";

export const CURRENCY_SOURCE_URL =
  "https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml";
export const CURRENCY_SOURCE_NAME = "SIX List One XML";
export const CURRENCY_PUBLISHED_DATE = "2026-01-01";
export const CURRENCY_READ_DATE = "2026-08-21";
export const CURRENCY_FIXTURE_BYTES = 47463;
export const CURRENCY_FIXTURE_SHA256 =
  "838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9";
export const CURRENCY_TABLE_SNAPSHOT_ID =
  `iso4217-list-one@${CURRENCY_PUBLISHED_DATE}#sha256:${CURRENCY_FIXTURE_SHA256}`;

export const FIXED_CURRENCY_METADATA = Object.freeze({
  sourceName: CURRENCY_SOURCE_NAME,
  sourceUrl: CURRENCY_SOURCE_URL,
  publishedDate: CURRENCY_PUBLISHED_DATE,
  readDate: CURRENCY_READ_DATE,
  bytes: CURRENCY_FIXTURE_BYTES,
  sha256: CURRENCY_FIXTURE_SHA256,
  snapshotId: CURRENCY_TABLE_SNAPSHOT_ID,
});

const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ROOT_NAME = "ISO_4217";
const CURRENCY_TABLE_NAME = "CcyTbl";
const ENTRY_NAME = "CcyNtry";
const ENTRY_FIELD_NAMES = new Set(["CtryNm", "CcyNm", "Ccy", "CcyNbr", "CcyMnrUnts"]);
const MINOR_UNIT_VALUES = new Set([0, 2, 3, 4]);

/**
 * Every failure from this module uses a short stable code.  In particular,
 * errors never include XML text, an input token, or an offending currency
 * code, so the generator is safe to run in build logs.
 */
export class CurrencyFixtureError extends Error {
  constructor(code) {
    super(`currency-fixture-error:${code}`);
    this.name = "CurrencyFixtureError";
    this.code = code;
  }
}

function fail(code) {
  throw new CurrencyFixtureError(code);
}

function decodeUtf8(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    fail("utf8-bom");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("utf8-invalid");
  }
}

function assertCrLfWithoutTrailingNewline(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n" && text[index - 1] !== "\r") {
      fail("line-ending-not-crlf");
    }
    if (text[index] === "\r" && text[index + 1] !== "\n") {
      fail("line-ending-not-crlf");
    }
  }
  if (text.endsWith("\r\n") || text.endsWith("\n") || text.endsWith("\r")) {
    fail("trailing-newline");
  }
}

/** Validate the byte-level contract before attempting to parse XML. */
export function validateCurrencyFixtureBytes(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    fail("fixture-not-buffer");
  }
  if (buffer.byteLength !== CURRENCY_FIXTURE_BYTES) {
    fail("bytes-mismatch");
  }
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== CURRENCY_FIXTURE_SHA256) {
    fail("sha256-mismatch");
  }
  const text = decodeUtf8(buffer);
  assertCrLfWithoutTrailingNewline(text);
  return text;
}

function decodeXmlEntities(value) {
  if (!value.includes("&")) return value;
  const entityPattern = /&(?:amp|lt|gt|apos|quot|#(?:x[0-9a-f]+|[0-9]+));/giu;
  const unresolved = value.replace(entityPattern, "");
  if (unresolved.includes("&")) {
    fail("xml-entity-invalid");
  }
  const decoded = value.replace(
    entityPattern,
    (entity) => {
      if (entity === "&amp;") return "&";
      if (entity === "&lt;") return "<";
      if (entity === "&gt;") return ">";
      if (entity === "&apos;") return "'";
      if (entity === "&quot;") return '"';
      const body = entity.slice(2, -1);
      const codePoint = body[0].toLowerCase() === "x"
        ? Number.parseInt(body.slice(1), 16)
        : Number.parseInt(body, 10);
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        fail("xml-entity-invalid");
      }
      return String.fromCodePoint(codePoint);
    },
  );
  return decoded;
}

function parseAttributes(source) {
  const attributes = {};
  let index = 0;
  while (index < source.length) {
    const whitespace = /^\s+/u.exec(source.slice(index));
    if (whitespace) index += whitespace[0].length;
    if (index >= source.length) break;
    const nameMatch = /^[A-Za-z_:][A-Za-z0-9_.:-]*/u.exec(source.slice(index));
    if (!nameMatch) fail("xml-attribute-invalid");
    const name = nameMatch[0];
    index += name.length;
    const equals = /^\s*=\s*/u.exec(source.slice(index));
    if (!equals) fail("xml-attribute-invalid");
    index += equals[0].length;
    if (source[index] !== '"') fail("xml-attribute-invalid");
    const closeQuote = source.indexOf('"', index + 1);
    if (closeQuote < 0) fail("xml-attribute-invalid");
    if (Object.hasOwn(attributes, name)) fail("xml-attribute-duplicate");
    attributes[name] = decodeXmlEntities(source.slice(index + 1, closeQuote));
    index = closeQuote + 1;
  }
  return attributes;
}

function parseOpeningTag(rawTag) {
  if (rawTag.endsWith("/>") || rawTag.startsWith("</")) {
    fail("xml-tag-invalid");
  }
  const body = rawTag.slice(1, -1);
  const nameMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*)$/u.exec(body);
  if (!nameMatch) fail("xml-tag-invalid");
  return Object.freeze({
    name: nameMatch[1],
    attributes: Object.freeze(parseAttributes(nameMatch[2])),
  });
}

function parseXmlTree(xml) {
  if (typeof xml !== "string") fail("xml-not-text");
  if (!xml.startsWith(XML_DECLARATION)) fail("xml-declaration-invalid");
  let cursor = XML_DECLARATION.length;
  const stack = [];
  let root = null;

  const appendText = (rawText) => {
    if (stack.length === 0) {
      if (/\S/u.test(rawText)) fail("xml-text-outside-root");
      return;
    }
    stack.at(-1).text += decodeXmlEntities(rawText);
  };

  const closeNode = (name) => {
    const node = stack.pop();
    if (!node || node.name !== name) fail("xml-tag-unbalanced");
    const frozenNode = Object.freeze({
      name: node.name,
      attributes: Object.freeze(node.attributes),
      text: node.text,
      children: Object.freeze(node.children),
    });
    if (stack.length > 0) {
      stack.at(-1).children.push(frozenNode);
    } else if (root !== null) {
      fail("xml-multiple-roots");
    } else {
      root = frozenNode;
    }
  };

  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) {
      appendText(xml.slice(cursor));
      cursor = xml.length;
      break;
    }
    appendText(xml.slice(cursor, open));
    const close = xml.indexOf(">", open + 1);
    if (close < 0) fail("xml-tag-unclosed");
    const rawTag = xml.slice(open, close + 1);
    if (rawTag.startsWith("<!") || rawTag.startsWith("<?")) {
      fail("xml-declaration-or-doctype-unexpected");
    }
    if (rawTag.startsWith("</")) {
      const closeBody = rawTag.slice(2, -1);
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(closeBody)) {
        fail("xml-tag-invalid");
      }
      closeNode(closeBody);
    } else {
      const tag = parseOpeningTag(rawTag);
      stack.push({ name: tag.name, attributes: tag.attributes, text: "", children: [] });
    }
    cursor = close + 1;
  }
  if (stack.length !== 0) fail("xml-tag-unbalanced");
  if (root === null) fail("xml-root-missing");
  return root;
}

function childrenByName(node, allowedNames, requiredNames, { requireLeaf = true } = {}) {
  const result = new Map();
  for (const child of node.children) {
    if (!allowedNames.has(child.name)) fail("xml-unknown-element");
    if (result.has(child.name)) fail("xml-element-duplicate");
    const attributeNames = Object.keys(child.attributes);
    const allowedFundMarker =
      child.name === "CcyNm" &&
      attributeNames.length === 1 &&
      attributeNames[0] === "IsFund" &&
      child.attributes.IsFund === "true";
    if (attributeNames.length !== 0 && !allowedFundMarker) {
      fail("xml-leaf-attributes-invalid");
    }
    if (requireLeaf && child.children.length > 0) fail("xml-leaf-has-children");
    result.set(child.name, child);
  }
  for (const requiredName of requiredNames) {
    if (!result.has(requiredName)) fail("xml-element-missing");
  }
  return result;
}

function leafValue(node) {
  if (!node) return null;
  const value = node.text.trim();
  if (value.length === 0) fail("xml-value-empty");
  return value;
}

function parseCurrencyEntries(root) {
  if (root.name !== ROOT_NAME) fail("xml-root-unknown");
  if (!Object.hasOwn(root.attributes, "Pblshd") || Object.keys(root.attributes).length !== 1) {
    fail("xml-root-attributes-invalid");
  }
  const publishedDate = root.attributes.Pblshd;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(publishedDate)) {
    fail("publication-date-invalid");
  }
  const rootChildren = childrenByName(
    root,
    new Set([CURRENCY_TABLE_NAME]),
    [CURRENCY_TABLE_NAME],
    { requireLeaf: false },
  );
  if (root.children.length !== 1) fail("xml-root-structure-invalid");
  const table = rootChildren.get(CURRENCY_TABLE_NAME);
  if (Object.keys(table.attributes).length !== 0) fail("xml-table-attributes-invalid");
  if (table.children.length === 0) fail("currency-entries-missing");

  const entriesByCode = new Map();
  for (const entryNode of table.children) {
    if (entryNode.name !== ENTRY_NAME) fail("xml-unknown-element");
    if (Object.keys(entryNode.attributes).length !== 0) fail("xml-entry-attributes-invalid");
    const fields = childrenByName(entryNode, ENTRY_FIELD_NAMES, ["CtryNm", "CcyNm"]);
    const countryName = leafValue(fields.get("CtryNm"));
    const currencyName = leafValue(fields.get("CcyNm"));
    const code = fields.has("Ccy") ? leafValue(fields.get("Ccy")) : null;
    const numericCode = fields.has("CcyNbr") ? leafValue(fields.get("CcyNbr")) : null;
    const minorUnitText = fields.has("CcyMnrUnts")
      ? leafValue(fields.get("CcyMnrUnts"))
      : null;

    // Antarctica's “No universal currency” row is the only valid entry in
    // the fixed list without a currency code or minor-unit field.
    if (minorUnitText === null) {
      if (
        code !== null ||
        numericCode !== null ||
        currencyName !== "No universal currency"
      ) {
        fail("currency-entry-structure-missing");
      }
      continue;
    }
    if (code === null || numericCode === null) fail("currency-entry-structure-missing");
    if (!/^[A-Z]{3}$/u.test(code)) fail("currency-code-invalid");
    if (!/^\d{3}$/u.test(numericCode)) fail("currency-numeric-code-invalid");
    if (minorUnitText === "N.A.") continue;
    if (!/^(?:0|2|3|4)$/u.test(minorUnitText)) fail("minor-unit-invalid");
    const minorUnit = Number(minorUnitText);
    if (!MINOR_UNIT_VALUES.has(minorUnit)) fail("minor-unit-invalid");
    const existing = entriesByCode.get(code);
    if (existing !== undefined && existing !== minorUnit) {
      fail("duplicate-code-minor-unit-conflict");
    }
    entriesByCode.set(code, minorUnit);
  }
  if (entriesByCode.size === 0) fail("currency-entries-empty-after-filter");
  const entries = [...entriesByCode.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([code, minorUnit]) => Object.freeze({ code, minorUnit }));
  return Object.freeze({ publishedDate, entries: Object.freeze(entries) });
}

/** Parse a structurally validated SIX XML string without exposing its content in errors. */
export function parseCurrencyXml(xml) {
  return parseCurrencyEntries(parseXmlTree(xml));
}

/** Read and validate only the approved immutable fixture. */
export async function readCurrencyFixture({
  fixturePath = resolve(REPOSITORY_ROOT, CURRENCY_FIXTURE_RELATIVE_PATH),
} = {}) {
  let buffer;
  try {
    buffer = await readFile(fixturePath);
  } catch {
    fail("fixture-unreadable");
  }
  const xml = validateCurrencyFixtureBytes(buffer);
  const parsed = parseCurrencyXml(xml);
  if (parsed.publishedDate !== CURRENCY_PUBLISHED_DATE) {
    fail("publication-date-mismatch");
  }
  return Object.freeze({
    ...parsed,
    metadata: FIXED_CURRENCY_METADATA,
  });
}

function quote(value) {
  return JSON.stringify(value);
}

/** Render a deterministic, ASCII-sorted, immutable TypeScript carrier. */
export function renderCurrencyTableSource({ entries, metadata = FIXED_CURRENCY_METADATA }) {
  if (!Array.isArray(entries) || entries.length === 0) fail("generated-entries-missing");
  const sortedEntries = [...entries].sort((left, right) =>
    left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
  );
  for (const entry of sortedEntries) {
    if (
      !entry ||
      !/^[A-Z]{3}$/u.test(entry.code) ||
      !MINOR_UNIT_VALUES.has(entry.minorUnit)
    ) {
      fail("generated-entry-invalid");
    }
  }
  const minorUnitsByCode = new Map();
  for (const entry of sortedEntries) {
    const existing = minorUnitsByCode.get(entry.code);
    if (existing !== undefined && existing !== entry.minorUnit) {
      fail("duplicate-code-minor-unit-conflict");
    }
    minorUnitsByCode.set(entry.code, entry.minorUnit);
  }
  const uniqueEntries = [...minorUnitsByCode.entries()].map(([code, minorUnit]) => ({
    code,
    minorUnit,
  }));
  const lines = [
    "/* Generated by scripts/generate-currency-table.mjs. Do not edit. */",
    "",
    "export type CurrencyMinorUnit = 0 | 2 | 3 | 4;",
    "",
    `export const CURRENCY_TABLE_SNAPSHOT_ID = ${quote(metadata.snapshotId)} as const;`,
    `export const CURRENCY_TABLE_SOURCE_NAME = ${quote(metadata.sourceName)} as const;`,
    `export const CURRENCY_TABLE_SOURCE_URL = ${quote(metadata.sourceUrl)} as const;`,
    `export const CURRENCY_TABLE_PUBLISHED_DATE = ${quote(metadata.publishedDate)} as const;`,
    `export const CURRENCY_TABLE_READ_DATE = ${quote(metadata.readDate)} as const;`,
    `export const CURRENCY_TABLE_BYTES = ${metadata.bytes} as const;`,
    `export const CURRENCY_TABLE_SHA256 = ${quote(metadata.sha256)} as const;`,
    "",
    "export const CURRENCY_MINOR_UNITS = Object.freeze({",
    ...uniqueEntries.map(({ code, minorUnit }) => `  ${code}: ${minorUnit},`),
    "} as const satisfies Readonly<Record<string, CurrencyMinorUnit>>);",
    "",
    "export const CURRENCY_TABLE = Object.freeze({",
    "  sourceName: CURRENCY_TABLE_SOURCE_NAME,",
    "  sourceUrl: CURRENCY_TABLE_SOURCE_URL,",
    "  publishedDate: CURRENCY_TABLE_PUBLISHED_DATE,",
    "  readDate: CURRENCY_TABLE_READ_DATE,",
    "  bytes: CURRENCY_TABLE_BYTES,",
    "  sha256: CURRENCY_TABLE_SHA256,",
    "  snapshotId: CURRENCY_TABLE_SNAPSHOT_ID,",
    "  minorUnits: CURRENCY_MINOR_UNITS,",
    "} as const);",
    "",
  ];
  return lines.join("\n");
}

export async function generateCurrencyTable({
  fixturePath = resolve(REPOSITORY_ROOT, CURRENCY_FIXTURE_RELATIVE_PATH),
  outputPath = resolve(REPOSITORY_ROOT, GENERATED_CURRENCY_TABLE_RELATIVE_PATH),
  check = false,
} = {}) {
  const fixture = await readCurrencyFixture({ fixturePath });
  const source = renderCurrencyTableSource(fixture);
  if (check) {
    let current;
    try {
      current = await readFile(outputPath, "utf8");
    } catch {
      fail("generated-file-missing");
    }
    if (current !== source) fail("generated-file-out-of-date");
    return Object.freeze({ checked: true, entries: fixture.entries.length });
  }
  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, source, "utf8");
  } catch {
    fail("generated-file-write-failed");
  }
  return Object.freeze({ checked: false, entries: fixture.entries.length });
}

function usageError() {
  fail("usage");
}

async function main(argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) usageError();
  const result = await generateCurrencyTable({ check: argv[0] === "--check" });
  process.stdout.write(result.checked ? "currency-table-check-pass\n" : "currency-table-generated\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof CurrencyFixtureError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write("currency-fixture-error:internal\n");
    }
    process.exitCode = 1;
  });
}
