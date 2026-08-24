import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The guard deliberately has a small, explicit input surface.  A caller may
 * scan only these roots; governance documents, OpenSpec artifacts, the guard
 * itself and tests are never implicit scan inputs.
 */
export const APPROVED_SCOPE_PATHS = Object.freeze([
  Object.freeze({ kind: "runtime-entry", path: "index.html" }),
  Object.freeze({ kind: "runtime-source", path: "src" }),
  Object.freeze({ kind: "runtime-assets", path: "public" }),
  Object.freeze({ kind: "fixtures", path: "fixtures" }),
  Object.freeze({ kind: "fixtures", path: "tests/fixtures" }),
  Object.freeze({ kind: "exports", path: "exports" }),
  Object.freeze({ kind: "build", path: "dist" }),
  Object.freeze({ kind: "build", path: "build" }),
  Object.freeze({ kind: "build", path: "artifacts" }),
  Object.freeze({ kind: "evidence", path: "evidence" }),
  Object.freeze({ kind: "logs", path: "logs" }),
]);

export const DEFAULT_SCAN_PATHS = Object.freeze(
  APPROVED_SCOPE_PATHS.map(({ path }) => path),
);

export const DENIED_SCOPE_PATHS = Object.freeze([
  ".git",
  "node_modules",
  "docs",
  "openspec",
  "scripts/scope-guard.mjs",
  "tests/delivery",
  "package.json",
  "package-lock.json",
]);

export const ALLOWED_EVIDENCE_GOVERNANCE_IDS = Object.freeze(["RESEARCH-0001"]);
export const ALLOWED_CURRENCY_SOURCE_URL =
  "https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml";
const CURRENCY_METADATA_PATH = "fixtures/currency/README.md";
const CURRENCY_METADATA_PATHS = new Set([
  CURRENCY_METADATA_PATH,
  "src/domain/calculation/generated/currency-table.ts",
]);
const INERT_MARKDOWN_FIXTURE_PATH = "tests/fixtures/synthetic/edge-markdown-unicode.json";
const SUPPLY_CHAIN_EVIDENCE_PATH = "evidence/supply-chain/dependency-readback.md";
const ALLOWED_SUPPLY_CHAIN_REGISTRY_URL = "https://registry.npmjs.org/";
const BUILD_CONFIG_CARRIER_LITERAL = "research-static-config@1.0.0";
const EXPORT_CONFIG_CARRIER_PATH = "src/domain/export/constants.ts";
const W3C_LIBRARY_NAMESPACE_URLS = Object.freeze([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
]);
const REACT_LIBRARY_ERROR_URL_PREFIX = "https://react.dev/errors/";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".cjs",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".mjs",
  ".md",
  ".ndjson",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".otf",
  ".pdf",
  ".png",
  ".svgz",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);

const DENIED_PATH_SEGMENTS = new Set([
  "account",
  "accounts",
  "analytics",
  "auth",
  "backend",
  "cloud",
  "consent",
  "database",
  "db",
  "goal",
  "goals",
  "identity",
  "import",
  "imports",
  "notification",
  "notifications",
  "observation",
  "observations",
  "participant",
  "participants",
  "profile",
  "recruit",
  "recruitment",
  "research",
  "server",
  "share",
  "sharing",
  "storage",
  "subscription",
  "subscriptions",
  "sync",
  "telemetry",
  "transaction",
  "transactions",
  "user",
  "users",
  "withdrawal",
]);

// These are field names, not ordinary words.  Boundary copy may discuss why
// these objects are excluded; only structured keys/attributes are rejected.
const FORBIDDEN_FIELD_NAMES = Object.freeze([
  "account",
  "account_id",
  "accountId",
  "analytics",
  "auth",
  "authentication",
  "backend",
  "cloud",
  "cloud_service",
  "cloudService",
  "consent",
  "consent_at",
  "consentAt",
  "consent_record",
  "consentRecord",
  "database",
  "database_url",
  "databaseUrl",
  "db",
  "goal",
  "goal_id",
  "goalId",
  "identity",
  "identity_id",
  "identityId",
  "participant",
  "participant_contact",
  "participantContact",
  "participant_email",
  "participantEmail",
  "participant_id",
  "participantId",
  "participant_name",
  "participantName",
  "participant_phone",
  "participantPhone",
  "profile",
  "recruitment",
  "recruitment_status",
  "recruitmentStatus",
  "research_data",
  "research_id",
  "research_record",
  "research_storage",
  "researchData",
  "researchId",
  "researchRecord",
  "researchStorage",
  "server",
  "server_url",
  "serverUrl",
  "storage",
  "study_code",
  "study_id",
  "studyCode",
  "studyId",
  "subscription",
  "telemetry",
  "transaction",
  "user",
  "user_id",
  "userId",
  "withdrawal",
  "withdrawal_at",
  "withdrawalAt",
  "withdrawn",
  "withdrawn_at",
  "withdrawnAt",
  "observation",
  "observation_data",
  "observation_notes",
  "observation_record",
  "observationData",
  "observationNotes",
  "observationRecord",
  "observations",
  "contact",
  "contact_email",
  "contact_name",
  "contact_phone",
  "contactEmail",
  "contactName",
  "contactPhone",
  "研究编号",
  "研究记录",
  "研究数据",
  "研究存储",
  "联系人",
  "联系方式",
  "参与者",
  "参与者编号",
  "正式同意",
  "同意记录",
  "撤回记录",
  "观察记录",
  "招募记录",
  "招募状态",
  "云服务",
  "数据库",
  "账户",
  "身份",
  "订阅",
  "交易",
  "用户资料",
]);

const ASCII_FIELD_NAMES = FORBIDDEN_FIELD_NAMES.filter((name) => /^[\x00-\x7F]+$/u.test(name));
const CHINESE_FIELD_NAMES = FORBIDDEN_FIELD_NAMES.filter((name) => /[^\x00-\x7F]/u.test(name));
const FORBIDDEN_FIELD_PATTERN = new RegExp(
  `(?:["'](?:${FORBIDDEN_FIELD_NAMES.map(escapeRegExp).join("|")})["']|\\b(?:${ASCII_FIELD_NAMES.map(escapeRegExp).join("|")})\\b|(?:${CHINESE_FIELD_NAMES.map(escapeRegExp).join("|")}))\\s*[:：]`,
  "giu",
);

const FORBIDDEN_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(?:${ASCII_FIELD_NAMES.map(escapeRegExp).join("|")})\\b\\s*=`,
  "giu",
);

const LOG_FIELD_PATTERN = new RegExp(
  `(?:["'](?:${FORBIDDEN_FIELD_NAMES.map(escapeRegExp).join("|")})["']|\\b(?:${ASCII_FIELD_NAMES.map(escapeRegExp).join("|")})\\b|(?:${CHINESE_FIELD_NAMES.map(escapeRegExp).join("|")}))\\s*(?:[:：=]|=>)`,
  "giu",
);

const HTML_FIELD_ATTRIBUTE_PATTERN = new RegExp(
  `\\b(?:name|id|data-field|data-key)\\s*=\\s*["'](?:${FORBIDDEN_FIELD_NAMES.map(escapeRegExp).join("|")})["']`,
  "giu",
);

const HARD_CONTENT_RULES = Object.freeze([
  Object.freeze({
    code: "SCOPE_GUARD_RESEARCH_IDENTIFIER",
    pattern: /\b(?:RESEARCH|STUDY|PARTICIPANT|SUBJECT)[-_](?!(?:ID|DATA|RECORD|STORAGE|OBSERVATION|NOTES?|STATUS)\b)(?=[A-Z0-9]{3,}(?:[-_][A-Z0-9]+)*\b)[A-Z0-9]+(?:[-_][A-Z0-9]+)*\b/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_CONTACT_VALUE",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_REMOTE_URL",
    pattern: /\bhttps?:\/\/[^\s"'<>]+/giu,
  }),
]);

const CODE_RULES = Object.freeze([
  Object.freeze({
    code: "SCOPE_GUARD_NETWORK_API",
    pattern: /\bfetch\s*\(|\bnew\s+(?:WebSocket|EventSource)\b|\b(?:XMLHttpRequest|sendBeacon)\s*(?:[.(=]|$)|\bnavigator\s*\.\s*sendBeacon\b/gu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_BROWSER_PERSISTENCE",
    pattern: /\b(?:window|globalThis|document|navigator)\s*\.\s*(?:localStorage|sessionStorage|indexedDB|caches|serviceWorker|cookie|clipboard)\b|\b(?:localStorage|sessionStorage|indexedDB|CacheStorage|caches|serviceWorker)\s*(?:[.(=]|\[)/gu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_RUNTIME_LOGGING",
    pattern: /\bconsole\.(?:debug|error|info|log|trace|warn)\b/gu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_TELEMETRY",
    pattern: /\b(?:analytics|sentry|segment|telemetry|track|trackEvent)\s*(?:[.(=]|$)/gu,
  }),
]);

const BUILD_IDENTIFIER_RULES = Object.freeze([
  Object.freeze({
    code: "SCOPE_GUARD_SOURCE_MAP",
    pattern: /sourceMappingURL\b/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_PWA_ARTIFACT",
    pattern: /\b(?:navigator\s*\.\s*serviceWorker|serviceWorker\s*\.\s*register|registerSW|registerServiceWorker|workbox|beforeinstallprompt)\b|\.(?:webmanifest|service-worker|serviceworker)\b/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_ANALYTICS_IDENTIFIER",
    pattern: /\b(?:analytics|sentry|segment|telemetry|gtag|dataLayer|posthog|mixpanel)\b/giu,
  }),
]);

const BUILD_EXTERNAL_RESOURCE_RULES = Object.freeze([
  Object.freeze({
    code: "SCOPE_GUARD_EXTERNAL_DYNAMIC_IMPORT",
    pattern: /\bimport\s*\(\s*[`"']\s*(?:https?:|\/\/)/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_EXTERNAL_RESOURCE_ENDPOINT",
    pattern: /\b(?:fetch|importScripts|sendBeacon)\s*\(\s*[`"']\s*(?:https?:|\/\/)/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_EXTERNAL_RESOURCE_ENDPOINT",
    pattern: /\b(?:src|href)\s*[:=]\s*[`"']\s*(?:https?:|\/\/)/giu,
  }),
]);

const STATIC_RESOURCE_RULES = Object.freeze([
  Object.freeze({
    code: "SCOPE_GUARD_SOURCE_MAP",
    pattern: /sourceMappingURL\b/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_EXTERNAL_STATIC_RESOURCE",
    pattern: /\b(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/)/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_EXTERNAL_STATIC_RESOURCE",
    pattern: /(?:@import|url)\s*\(?\s*["']?\s*(?:https?:|\/\/)/giu,
  }),
  Object.freeze({
    code: "SCOPE_GUARD_PWA_ARTIFACT",
    pattern: /\brel\s*=\s*["'][^"']*\bmanifest\b/giu,
  }),
]);

const BINARY_SAFE_EXTENSIONS = BINARY_EXTENSIONS;
const SOURCE_CODE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return null;
  }
  const candidate = value.replaceAll("\\", "/");
  if (candidate.startsWith("/") || /^[A-Za-z]:\//u.test(candidate)) {
    return null;
  }
  const parts = [];
  for (const part of candidate.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

function isWithin(relativePath, rootPath) {
  return relativePath === rootPath || relativePath.startsWith(`${rootPath}/`);
}

function pathHasDeniedSegment(relativePath) {
  return relativePath
    .split("/")
    .map((part) => part.toLowerCase().replace(/[._-]+$/u, ""))
    .some((part) => {
      const stem = part.split(/[._-]/u, 1)[0];
      return DENIED_PATH_SEGMENTS.has(part) || DENIED_PATH_SEGMENTS.has(stem);
    });
}

function pathViolation(code, relativePath) {
  return Object.freeze({
    code,
    path: relativePath ?? "<path>",
    line: 0,
    column: 0,
  });
}

/**
 * Return a stable violation when a path is outside the documented allowlist
 * or inside the documented denylist.  No filesystem lookup occurs here.
 */
export function checkScopePath(
  value,
  { allowPaths = DEFAULT_SCAN_PATHS, denyPaths = DENIED_SCOPE_PATHS } = {},
) {
  const relativePath = normalizeRelativePath(value);
  if (relativePath === null) {
    return pathViolation("SCOPE_GUARD_PATH_INVALID", "<path>");
  }

  const normalizedDenyPaths = denyPaths
    .map(normalizeRelativePath)
    .filter((path) => path !== null);
  if (
    normalizedDenyPaths.some((denyPath) => isWithin(relativePath, denyPath)) ||
    pathHasDeniedSegment(relativePath)
  ) {
    return pathViolation("SCOPE_GUARD_PATH_DENIED", relativePath);
  }

  const normalizedAllowPaths = allowPaths
    .map(normalizeRelativePath)
    .filter((path) => path !== null);
  if (!normalizedAllowPaths.some((allowPath) => isWithin(relativePath, allowPath))) {
    return pathViolation("SCOPE_GUARD_PATH_NOT_ALLOWLISTED", relativePath);
  }
  return null;
}

function lineColumn(text, index) {
  const before = text.slice(0, index);
  const lastLineBreak = before.lastIndexOf("\n");
  return Object.freeze({
    line: 1 + (before.match(/\n/gu)?.length ?? 0),
    column: index - lastLineBreak,
  });
}

function contentViolation(code, relativePath, text, index) {
  const { line, column } = lineColumn(text, index);
  return Object.freeze({ code, path: relativePath, line, column });
}

function isEvidencePath(relativePath) {
  return relativePath === "evidence" || relativePath.startsWith("evidence/");
}

function isCurrencyMetadataPath(relativePath) {
  return CURRENCY_METADATA_PATHS.has(relativePath);
}

function isBuildJavaScriptPath(relativePath) {
  return /^dist\/assets\/[^/]+\.js$/iu.test(relativePath);
}

function isBuildStaticMarkupPath(relativePath) {
  return relativePath === "index.html" || /^dist\/.+\.(?:html|css)$/iu.test(relativePath);
}

function isBuildPath(relativePath) {
  return relativePath === "dist" || relativePath.startsWith("dist/");
}

function isSourceCodePath(relativePath) {
  return SOURCE_CODE_EXTENSIONS.has(extname(relativePath).toLowerCase());
}

function buildResourceContext(text, offset) {
  const before = text.slice(Math.max(0, offset - 120), offset);
  return /(?:\b(?:fetch|import|importScripts|sendBeacon)\s*\(\s*|\b(?:src|href)\s*[:=]\s*["'`]?\s*|\burl\s*\(\s*|\.setAttribute\s*\(\s*["'](?:src|href)["']\s*,\s*)$/iu.test(
    before,
  );
}

function maskAllowedBuildLibraryUrls(relativePath, text) {
  if (!isBuildJavaScriptPath(relativePath)) return text;
  let masked = text;
  const libraryUrls = [...W3C_LIBRARY_NAMESPACE_URLS, REACT_LIBRARY_ERROR_URL_PREFIX];
  for (const libraryUrl of libraryUrls) {
    masked = masked.replaceAll(libraryUrl, (match, offset) => {
      if (buildResourceContext(text, offset)) return match;
      return " ".repeat(match.length);
    });
  }
  return masked;
}

function scanBuildJavaScript(relativePath, text) {
  const violations = [];
  const maskedCode = maskCodeForKeyScan(text);
  for (const { code, pattern } of BUILD_IDENTIFIER_RULES) {
    const subject = code === "SCOPE_GUARD_SOURCE_MAP" ? text : maskedCode;
    violations.push(...scanMatches(pattern, subject, relativePath, code));
  }
  for (const { code, pattern } of BUILD_EXTERNAL_RESOURCE_RULES) {
    violations.push(...scanMatches(pattern, text, relativePath, code));
  }
  return violations;
}

function scanBuildStaticMarkup(relativePath, text) {
  const violations = [];
  for (const { code, pattern } of STATIC_RESOURCE_RULES) {
    violations.push(...scanMatches(pattern, text, relativePath, code));
  }
  return violations;
}

function maskAllowedGovernanceIds(relativePath, text) {
  if (!isEvidencePath(relativePath)) return text;
  let masked = text;
  for (const id of ALLOWED_EVIDENCE_GOVERNANCE_IDS) {
    // Governance IDs are allowed only when explicitly rendered as a code
    // token in evidence.  A participant/research value without this exact
    // marker remains visible to the deny rule.
    masked = masked.replaceAll(`\`${id}\``, (match) => " ".repeat(match.length));
  }
  return masked;
}

function maskAllowedBuildConfigCarrier(relativePath, text) {
  if (isBuildJavaScriptPath(relativePath)) {
    // Vite's minifier intentionally shortens the adapter constant, so the
    // compiled asset has no stable declaration shape.  The exception remains
    // exact path + exact literal and does not apply to source or evidence.
    return text.replaceAll(BUILD_CONFIG_CARRIER_LITERAL, (match) => " ".repeat(match.length));
  }
  if (relativePath === "index.html" || relativePath === "dist/index.html") {
    const metaPattern = /(<meta\b[^>]*\bname\s*=\s*["']application-build-config-version["'][^>]*\bcontent\s*=\s*["'])research-static-config@1\.0\.0(["'])/giu;
    return text.replace(metaPattern, (match, prefix, suffix) => `${prefix}${" ".repeat(BUILD_CONFIG_CARRIER_LITERAL.length)}${suffix}`);
  }
  if (relativePath === "src/adapters/browser/build-metadata.ts") {
    const adapterPattern = /(const\s+CONFIG_VERSION\s*=\s*["'])research-static-config@1\.0\.0(["'])/gu;
    return text.replace(adapterPattern, (match, prefix, suffix) => `${prefix}${" ".repeat(BUILD_CONFIG_CARRIER_LITERAL.length)}${suffix}`);
  }
  if (relativePath === EXPORT_CONFIG_CARRIER_PATH) {
    const exportConstantsPattern = /(export\s+const\s+CONFIG_VERSION\s*=\s*["'])research-static-config@1\.0\.0(["'])/gu;
    return text.replace(exportConstantsPattern, (match, prefix, suffix) => `${prefix}${" ".repeat(BUILD_CONFIG_CARRIER_LITERAL.length)}${suffix}`);
  }
  if (relativePath === "artifacts/build/artifact-manifest.json") {
    const manifestPattern = /("config_version"\s*:\s*")research-static-config@1\.0\.0(")/gu;
    return text.replace(manifestPattern, (match, prefix, suffix) => `${prefix}${" ".repeat(BUILD_CONFIG_CARRIER_LITERAL.length)}${suffix}`);
  }
  return text;
}

function maskAllowedSupplyChainEvidenceUrl(relativePath, text) {
  if (relativePath !== SUPPLY_CHAIN_EVIDENCE_PATH) return text;
  return text.replaceAll(ALLOWED_SUPPLY_CHAIN_REGISTRY_URL, (match, offset) => {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const lineEndCandidate = text.indexOf("\n", offset + match.length);
    const lineEnd = lineEndCandidate < 0 ? text.length : lineEndCandidate;
    const lineBefore = text.slice(lineStart, offset);
    const isRegistryMetadata = /\b(?:npm\s+registry|config\s+get\s+registry|registry)\b[^\n`]*`?\s*$/iu.test(
      lineBefore,
    );
    const isResourceContext = /(?:fetch\s*\(\s*|import\s*\(\s*|(?:href|src)\s*=\s*["']?\s*|\]\(\s*|url\s*\(\s*)$/iu.test(
      lineBefore,
    );
    const line = text.slice(lineStart, lineEnd);
    const hasResourceMarkup = /(?:\]\(\s*$|(?:href|src)\s*=|\b(?:fetch|import|url)\s*\()/iu.test(
      line,
    );
    if (!isRegistryMetadata || isResourceContext || hasResourceMarkup) return match;
    return " ".repeat(match.length);
  });
}

function maskAllowedCurrencySourceUrl(relativePath, text) {
  if (!isCurrencyMetadataPath(relativePath) && !isBuildJavaScriptPath(relativePath)) return text;
  return text.replaceAll(ALLOWED_CURRENCY_SOURCE_URL, (match, offset) => {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const lineEndCandidate = text.indexOf("\n", offset + match.length);
    const lineEnd = lineEndCandidate < 0 ? text.length : lineEndCandidate;
    const lineBefore = text.slice(lineStart, offset);
    const line = text.slice(lineStart, lineEnd);
    const isSourceMetadata = isBuildJavaScriptPath(relativePath)
      || /(?:来源\s*URL|source\s+URL)\s*[:：]\s*`?\s*$|CURRENCY_TABLE_SOURCE_URL\s*=\s*["']?\s*$/iu.test(lineBefore);
    const isResourceContext = /(?:fetch\s*\(\s*|import\s*\(\s*|(?:href|src)\s*=\s*["']?\s*|\]\(\s*|url\s*\(\s*)$/iu.test(
      lineBefore,
    );
    const hasResourceMarkup = isBuildJavaScriptPath(relativePath)
      ? false
      : /(?:\]\(\s*$|(?:href|src)\s*=|\b(?:fetch|import|url)\s*\()/iu.test(line);
    if (!isSourceMetadata || isResourceContext || hasResourceMarkup) return match;
    return " ".repeat(match.length);
  });
}

function maskAllowedInertFixtureUrls(relativePath, text) {
  if (relativePath !== INERT_MARKDOWN_FIXTURE_PATH) return text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (
    parsed?.fixture_schema !== "zhiguan.synthetic-fixture.v1" ||
    parsed?.synthetic_only !== true ||
    parsed?.text_case?.contains_network_intent !== false ||
    typeof parsed?.text_case?.text !== "string"
  ) {
    return text;
  }

  const keyMatch = /"text"\s*:\s*"/u.exec(text);
  if (!keyMatch || keyMatch.index === undefined) return text;
  const valueStart = keyMatch.index + keyMatch[0].length - 1;
  let valueEnd = valueStart + 1;
  let escaped = false;
  while (valueEnd < text.length) {
    const character = text[valueEnd];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      break;
    }
    valueEnd += 1;
  }
  if (valueEnd >= text.length) return text;
  const serializedValue = text.slice(valueStart, valueEnd + 1);
  const maskedValue = serializedValue.replace(
    /\bhttps?:\/\/[^\s"'<>]+/giu,
    (match) => " ".repeat(match.length),
  );
  return `${text.slice(0, valueStart)}${maskedValue}${text.slice(valueEnd + 1)}`;
}

function replaceNonNewlineCharacters(value) {
  return value.replace(/[^\n\r]/gu, " ");
}

/**
 * Mask comments and string literals while preserving quoted object keys.  It
 * lets the guard inspect executable syntax without treating required boundary
 * prose such as “不实现正式同意或研究观察” as a data field.
 */
function maskCodeForKeyScan(text) {
  const output = Array.from(text);
  let index = 0;
  let mode = "code";

  const maskRange = (start, end) => {
    const masked = replaceNonNewlineCharacters(text.slice(start, end));
    for (let offset = start; offset < end; offset += 1) {
      output[offset] = masked[offset - start];
    }
  };

  while (index < text.length) {
    const current = text[index];
    const next = text[index + 1];
    if (mode === "code") {
      if (current === "/" && next === "/") {
        const start = index;
        index += 2;
        while (index < text.length && text[index] !== "\n") index += 1;
        maskRange(start, index);
        continue;
      }
      if (current === "/" && next === "*") {
        const start = index;
        index += 2;
        while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
        index = Math.min(text.length, index + 2);
        maskRange(start, index);
        continue;
      }
      if (current === "'" || current === '"' || current === "`") {
        const quote = current;
        const start = index;
        index += 1;
        let escaped = false;
        while (index < text.length) {
          const character = text[index];
          if (escaped) {
            escaped = false;
            index += 1;
            continue;
          }
          if (character === "\\") {
            escaped = true;
            index += 1;
            continue;
          }
          if (character === quote) {
            index += 1;
            break;
          }
          index += 1;
        }
        let lookahead = index;
        while (/\s/u.test(text[lookahead] ?? "")) lookahead += 1;
        if (text[lookahead] !== ":") maskRange(start, index);
        continue;
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function normalizedFieldName(value) {
  return value.replace(/[\s-]+/gu, "_").toLowerCase();
}

const FORBIDDEN_FIELD_SET = new Set(FORBIDDEN_FIELD_NAMES.map(normalizedFieldName));

function isForbiddenFieldName(value) {
  return FORBIDDEN_FIELD_SET.has(normalizedFieldName(value));
}

function scanMatches(pattern, text, relativePath, code) {
  const violations = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    violations.push(contentViolation(code, relativePath, text, match.index ?? 0));
  }
  pattern.lastIndex = 0;
  return violations;
}

function scanStructuredKeys(text, relativePath) {
  const violations = [];
  const maskedCode = maskCodeForKeyScan(text);
  violations.push(...scanMatches(FORBIDDEN_FIELD_PATTERN, maskedCode, relativePath, "SCOPE_GUARD_FORBIDDEN_FIELD"));
  violations.push(...scanMatches(FORBIDDEN_ASSIGNMENT_PATTERN, maskedCode, relativePath, "SCOPE_GUARD_FORBIDDEN_FIELD"));
  violations.push(
    ...scanMatches(HTML_FIELD_ATTRIBUTE_PATTERN, text, relativePath, "SCOPE_GUARD_FORBIDDEN_FIELD"),
  );
  if ([".csv", ".log", ".ndjson", ".txt", ".yaml", ".yml"].includes(extname(relativePath).toLowerCase())) {
    violations.push(...scanMatches(LOG_FIELD_PATTERN, text, relativePath, "SCOPE_GUARD_FORBIDDEN_FIELD"));
  }
  return violations;
}

function scanJsonKeys(value, relativePath, sourceText, violations) {
  if (Array.isArray(value)) {
    for (const item of value) scanJsonKeys(item, relativePath, sourceText, violations);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenFieldName(key)) {
      const keyIndex = sourceText.indexOf(`"${key}"`);
      violations.push(
        contentViolation(
          "SCOPE_GUARD_FORBIDDEN_FIELD",
          relativePath,
          sourceText,
          keyIndex >= 0 ? keyIndex : 0,
        ),
      );
    }
    scanJsonKeys(child, relativePath, sourceText, violations);
  }
}

function scanTextFile(relativePath, text) {
  const violations = [];
  violations.push(...scanStructuredKeys(text, relativePath));
  const researchScanText = maskAllowedBuildConfigCarrier(
    relativePath,
    maskAllowedGovernanceIds(relativePath, text),
  );
  const remoteScanText = maskAllowedCurrencySourceUrl(
    relativePath,
    isBuildJavaScriptPath(relativePath)
      ? maskAllowedBuildLibraryUrls(relativePath, text)
      : maskAllowedInertFixtureUrls(
          relativePath,
          maskAllowedSupplyChainEvidenceUrl(relativePath, text),
        ),
  );
  for (const { code, pattern } of HARD_CONTENT_RULES) {
    const subject = code === "SCOPE_GUARD_RESEARCH_IDENTIFIER" ? researchScanText : remoteScanText;
    violations.push(...scanMatches(pattern, subject, relativePath, code));
  }

  if (isBuildJavaScriptPath(relativePath)) {
    violations.push(...scanBuildJavaScript(relativePath, text));
  } else if (isBuildStaticMarkupPath(relativePath)) {
    violations.push(...scanBuildStaticMarkup(relativePath, text));
  } else if (isSourceCodePath(relativePath)) {
    const maskedCode = maskCodeForKeyScan(text);
    for (const { code, pattern } of CODE_RULES) {
      violations.push(...scanMatches(pattern, maskedCode, relativePath, code));
    }
  }

  if (extname(relativePath).toLowerCase() === ".json") {
    try {
      const parsed = JSON.parse(text);
      scanJsonKeys(parsed, relativePath, text, violations);
    } catch {
      // JSON syntax is validated by the build/export checks.  This guard only
      // needs to remain fail-closed for content it can confidently classify.
    }
  }
  return violations;
}

async function scanFile(root, relativePath, result) {
  const extension = extname(relativePath).toLowerCase();
  if (isBuildPath(relativePath) && extension === ".map") {
    result.violations.push(pathViolation("SCOPE_GUARD_SOURCE_MAP", relativePath));
    return;
  }
  if (
    isBuildPath(relativePath) &&
    (extension === ".webmanifest" || /(?:^|\/)(?:manifest|site\.webmanifest)\.(?:json|webmanifest)$/iu.test(relativePath))
  ) {
    result.violations.push(pathViolation("SCOPE_GUARD_PWA_ARTIFACT", relativePath));
    return;
  }
  if (isBuildPath(relativePath) && /(?:^|\/)(?:sw|service-worker|serviceworker)\.js$/iu.test(relativePath)) {
    result.violations.push(pathViolation("SCOPE_GUARD_PWA_ARTIFACT", relativePath));
    return;
  }

  let file;
  try {
    file = await readFile(resolve(root, relativePath));
  } catch {
    result.violations.push(pathViolation("SCOPE_GUARD_READ_FAILED", relativePath));
    return;
  }

  if (BINARY_SAFE_EXTENSIONS.has(extension)) return;
  if (!TEXT_EXTENSIONS.has(extension)) {
    if (file.includes(0)) {
      result.violations.push(pathViolation("SCOPE_GUARD_BINARY_UNSUPPORTED", relativePath));
      return;
    }
  }

  const text = file.toString("utf8");
  result.violations.push(...scanTextFile(relativePath, text));
  result.scannedFiles.push(relativePath);
}

async function collectPath(root, relativePath, result) {
  let info;
  try {
    info = await lstat(resolve(root, relativePath));
  } catch (error) {
    if (error?.code === "ENOENT") {
      result.skippedMissingPaths.push(relativePath);
    } else {
      result.violations.push(pathViolation("SCOPE_GUARD_READ_FAILED", relativePath));
    }
    return;
  }

  if (info.isSymbolicLink()) {
    result.violations.push(pathViolation("SCOPE_GUARD_SYMLINK_UNSUPPORTED", relativePath));
    return;
  }
  if (info.isDirectory()) {
    let entries;
    try {
      entries = await readdir(resolve(root, relativePath), { withFileTypes: true });
    } catch {
      result.violations.push(pathViolation("SCOPE_GUARD_READ_FAILED", relativePath));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const childPath = `${relativePath}/${entry.name}`;
      const policyViolation = checkScopePath(childPath, {
        allowPaths: result.allowPaths,
        denyPaths: result.denyPaths,
      });
      if (policyViolation !== null) {
        result.violations.push(policyViolation);
        continue;
      }
      await collectPath(root, childPath, result);
    }
    return;
  }
  if (info.isFile()) {
    await scanFile(root, relativePath, result);
  }
}

/**
 * Scan approved runtime/source/fixture/export/build/evidence paths.
 * Missing default roots are optional and safely skipped; a present path that
 * violates the policy fails closed with a stable code.
 */
export async function scanScope({
  root = fileURLToPath(new URL("..", import.meta.url)),
  paths = DEFAULT_SCAN_PATHS,
  allowPaths = DEFAULT_SCAN_PATHS,
  denyPaths = DENIED_SCOPE_PATHS,
} = {}) {
  const result = {
    passed: false,
    allowPaths: [...allowPaths].map(normalizeRelativePath).filter((path) => path !== null).sort(),
    denyPaths: [...denyPaths].map(normalizeRelativePath).filter((path) => path !== null).sort(),
    scannedFiles: [],
    skippedMissingPaths: [],
    violations: [],
  };

  const uniquePaths = [
    ...new Map(
      paths.map((path) => [
        typeof path === "string" ? path : `\u0000${String(path)}`,
        normalizeRelativePath(path),
      ]),
    ).values(),
  ].sort((left, right) => (left ?? "").localeCompare(right ?? "", "en"));
  for (const relativePath of uniquePaths) {
    if (relativePath === null) {
      result.violations.push(pathViolation("SCOPE_GUARD_PATH_INVALID", "<path>"));
      continue;
    }
    const policyViolation = checkScopePath(relativePath, { allowPaths, denyPaths });
    if (policyViolation !== null) {
      result.violations.push(policyViolation);
      continue;
    }
    await collectPath(root, relativePath, result);
  }

  result.scannedFiles.sort();
  result.skippedMissingPaths.sort();
  const uniqueViolations = new Map(
    result.violations.map((violation) => [
      `${violation.code}\u0000${violation.path}\u0000${violation.line}\u0000${violation.column}`,
      violation,
    ]),
  );
  result.violations = [...uniqueViolations.values()];
  result.violations.sort((left, right) =>
    `${left.path}\u0000${left.line}\u0000${left.column}\u0000${left.code}`.localeCompare(
      `${right.path}\u0000${right.line}\u0000${right.column}\u0000${right.code}`,
      "en",
    ),
  );
  result.passed = result.violations.length === 0;
  return Object.freeze(result);
}

export function formatScopeGuardReport(result) {
  if (result.passed) {
    return `SCOPE_GUARD_PASS files=${result.scannedFiles.length} skipped=${result.skippedMissingPaths.length}`;
  }
  const lines = [`SCOPE_GUARD_FAIL violations=${result.violations.length}`];
  for (const violation of result.violations) {
    lines.push(
      `${violation.code} path=${violation.path} line=${violation.line} column=${violation.column}`,
    );
  }
  return lines.join("\n");
}

function parseCliArguments(argumentsList) {
  const paths = [];
  let root = fileURLToPath(new URL("..", import.meta.url));
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true, root, paths };
    }
    if (argument === "--root" || argument === "--path") {
      const value = argumentsList[index + 1];
      if (typeof value !== "string" || value.startsWith("-")) {
        return { error: "SCOPE_GUARD_USAGE_ERROR", root, paths };
      }
      if (argument === "--root") root = resolve(value);
      else paths.push(value);
      index += 1;
      continue;
    }
    return { error: "SCOPE_GUARD_USAGE_ERROR", root, paths };
  }
  return { help: false, root, paths: paths.length > 0 ? paths : DEFAULT_SCAN_PATHS };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseCliArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write("Usage: node scripts/scope-guard.mjs [--root PATH] [--path APPROVED_PATH]\n");
  } else if (parsed.error) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = 2;
  } else {
    const result = await scanScope({ root: parsed.root, paths: parsed.paths });
    const output = formatScopeGuardReport(result);
    (result.passed ? process.stdout : process.stderr).write(`${output}\n`);
    process.exitCode = result.passed ? 0 : 1;
  }
}
