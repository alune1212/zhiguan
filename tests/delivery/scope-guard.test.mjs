import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  ALLOWED_CURRENCY_SOURCE_URL,
  checkScopePath,
  formatScopeGuardReport,
  scanScope,
} from "../../scripts/scope-guard.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiguan-scope-guard-"));
  temporaryRoots.push(root);
  return root;
}

async function writeRelative(root, relativePath, content) {
  const parent = relativePath.slice(0, relativePath.lastIndexOf("/"));
  if (parent) await mkdir(join(root, parent), { recursive: true });
  await writeFile(join(root, relativePath), content, "utf8");
}

describe("scope guard", () => {
  it("allows boundary copy while scanning only approved paths", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "src/boundary.ts",
      [
        "export const NOTICE =",
        '  "本原型不实现正式研究知情同意、研究观察存储、招募、研究联系或撤回管理。";',
        "export const EXIT = \"刷新或关闭会清除当前会话内存。\";",
        "export function PrivacyNotice() { return <p>不会写入 localStorage、Cookie 或 IndexedDB。</p>; }",
      ].join("\n"),
    );

    const result = await scanScope({ root, paths: ["src", "dist", "evidence"] });

    assert.equal(result.passed, true);
    assert.deepEqual(result.scannedFiles, ["src/boundary.ts"]);
    assert.deepEqual(result.skippedMissingPaths, ["dist", "evidence"]);
    assert.equal(formatScopeGuardReport(result), "SCOPE_GUARD_PASS files=1 skipped=2");
  });

  it("rejects product-external fields, identifiers, contact values and network code", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "src/invalid.ts",
      [
        "export const payload = {",
        '  research_id: "RESEARCH-9999",',
        '  contact_email: "person@example.invalid",',
        "  consent_record: true,",
        "};",
        "const researchId = \"RESEARCH-9999\";",
        "const studyCode = \"RESEARCH-ABC\";",
        'export function upload(value) { return fetch("https://example.invalid", { body: JSON.stringify(value) }); }',
      ].join("\n"),
    );

    const result = await scanScope({ root, paths: ["src"] });
    const codes = new Set(result.violations.map(({ code }) => code));
    const report = formatScopeGuardReport(result);

    assert.equal(result.passed, false);
    assert.equal(codes.has("SCOPE_GUARD_FORBIDDEN_FIELD"), true);
    assert.equal(codes.has("SCOPE_GUARD_RESEARCH_IDENTIFIER"), true);
    assert.equal(codes.has("SCOPE_GUARD_CONTACT_VALUE"), true);
    assert.equal(codes.has("SCOPE_GUARD_NETWORK_API"), true);
    assert.equal(codes.has("SCOPE_GUARD_REMOTE_URL"), true);
    assert.equal(report.includes("RESEARCH-9999"), false);
    assert.equal(report.includes("person@example.invalid"), false);
    assert.equal(report.includes("https://example.invalid"), false);
  });

  it("checks key-value logs while leaving ordinary boundary prose readable", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "logs/runtime.log",
      [
        "启动说明：不收集研究编号、联系人或正式同意。",
        "research_id=RESEARCH-9999",
      ].join("\n"),
    );

    const result = await scanScope({ root, paths: ["logs"] });

    assert.equal(result.passed, false);
    assert.equal(
      result.violations.some(({ code, line }) => code === "SCOPE_GUARD_FORBIDDEN_FIELD" && line === 2),
      true,
    );
    assert.equal(formatScopeGuardReport(result).includes("RESEARCH-9999"), false);
  });

  it("allows only the exact governance document ID in evidence", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "evidence/implementation/baseline.md",
      "研究协议 `RESEARCH-0001` 仍为 Draft。\n",
    );
    const allowed = await scanScope({ root, paths: ["evidence"] });
    assert.equal(allowed.passed, true);

    await writeRelative(root, "evidence/implementation/other.md", "`RESEARCH-0002`\n");
    const rejected = await scanScope({ root, paths: ["evidence"] });
    assert.equal(rejected.passed, false);
    assert.equal(
      rejected.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );

    const nonEvidencePaths = [
      "src/notes.ts",
      "fixtures/notes.txt",
      "exports/notes.md",
      "build/notes.js",
      "logs/notes.log",
    ];
    await Promise.all(
      nonEvidencePaths.map((path) => writeRelative(root, path, "`RESEARCH-0001`\n")),
    );
    const nonEvidence = await scanScope({ root, paths: nonEvidencePaths });
    assert.equal(nonEvidence.passed, false);
    assert.equal(
      nonEvidence.violations.filter(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER").length,
      nonEvidencePaths.length,
    );
  });

  it("allows the exact npm registry URL only in supply-chain evidence metadata", async () => {
    const root = await makeRoot();
    const evidencePath = "evidence/supply-chain/dependency-readback.md";
    await writeRelative(
      root,
      evidencePath,
      [
        "| npm registry | `https://registry.npmjs.org/` |",
        "npm config get registry                https://registry.npmjs.org/",
      ].join("\n"),
    );
    const allowed = await scanScope({ root, paths: [evidencePath] });
    assert.equal(allowed.passed, true);

    await writeRelative(root, evidencePath, "source: https://other.invalid/\n");
    const rejected = await scanScope({ root, paths: [evidencePath] });
    assert.equal(rejected.passed, false);
    assert.equal(
      rejected.violations.some(({ code }) => code === "SCOPE_GUARD_REMOTE_URL"),
      true,
    );
  });

  it("allows the exact SIX source URL only as currency metadata text", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "fixtures/currency/README.md",
      `来源 URL：${ALLOWED_CURRENCY_SOURCE_URL}\n`,
    );
    const allowed = await scanScope({ root, paths: ["fixtures/currency/README.md"] });
    assert.equal(allowed.passed, true);

    await writeRelative(
      root,
      "src/domain/calculation/generated/currency-table.ts",
      `export const CURRENCY_TABLE_SOURCE_URL = "${ALLOWED_CURRENCY_SOURCE_URL}" as const;\n`,
    );
    const generatedMetadata = await scanScope({
      root,
      paths: ["src/domain/calculation/generated/currency-table.ts"],
    });
    assert.equal(generatedMetadata.passed, true);

    await writeRelative(
      root,
      "fixtures/currency/README.md",
      [
        `来源 URL：${ALLOWED_CURRENCY_SOURCE_URL}`,
        `[SIX](${ALLOWED_CURRENCY_SOURCE_URL})`,
      ].join("\n"),
    );
    const linked = await scanScope({ root, paths: ["fixtures/currency/README.md"] });
    assert.equal(linked.passed, false);
    assert.equal(
      linked.violations.some(({ code }) => code === "SCOPE_GUARD_REMOTE_URL"),
      true,
    );

    await writeRelative(
      root,
      "src/currency-loader.ts",
      `export const source = fetch("${ALLOWED_CURRENCY_SOURCE_URL}");\n`,
    );
    const runtime = await scanScope({ root, paths: ["src"] });
    assert.equal(runtime.passed, false);
    assert.equal(
      runtime.violations.some(({ code }) => code === "SCOPE_GUARD_REMOTE_URL"),
      true,
    );
    assert.equal(
      runtime.violations.some(({ code }) => code === "SCOPE_GUARD_NETWORK_API"),
      true,
    );
  });

  it("allows fixed build config carriers only at their exact paths and value", async () => {
    const root = await makeRoot();
    const exact = "research-static-config@1.0.0";
    await writeRelative(
      root,
      "index.html",
      `<meta name="application-build-config-version" content="${exact}">\n`,
    );
    await writeRelative(root, "src/adapters/browser/build-metadata.ts", `const CONFIG_VERSION = "${exact}";\n`);
    await writeRelative(root, "artifacts/build/artifact-manifest.json", `{"config_version":"${exact}"}\n`);
    const allowed = await scanScope({
      root,
      paths: [
        "index.html",
        "src/adapters/browser/build-metadata.ts",
        "artifacts/build/artifact-manifest.json",
      ],
    });
    assert.equal(allowed.passed, true);

    await writeRelative(root, "src/other.ts", `const config = "${exact}";\n`);
    const wrongPath = await scanScope({ root, paths: ["src/other.ts"] });
    assert.equal(wrongPath.passed, false);
    assert.equal(
      wrongPath.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );

    await writeRelative(
      root,
      "src/adapters/browser/build-metadata.ts",
      'const CONFIG = "research-static-config@1.0.1";\n',
    );
    const wrongValue = await scanScope({ root, paths: ["src/adapters/browser/build-metadata.ts"] });
    assert.equal(wrongValue.passed, false);
    assert.equal(
      wrongValue.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );

    await writeRelative(
      root,
      "src/adapters/browser/build-metadata.ts",
      `const CONFIG_VERSION = "${exact}";\nconst unrelated = "${exact}";\n`,
    );
    const extraOccurrence = await scanScope({ root, paths: ["src/adapters/browser/build-metadata.ts"] });
    assert.equal(extraOccurrence.passed, false);
    assert.equal(
      extraOccurrence.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );

    await writeRelative(
      root,
      "src/domain/export/constants.ts",
      `export const CONFIG_VERSION = '${exact}' as const;\n`,
    );
    const exportConstants = await scanScope({ root, paths: ["src/domain/export/constants.ts"] });
    assert.equal(exportConstants.passed, true);

    await writeRelative(
      root,
      "src/domain/export/constants.ts",
      `export const CONFIG_VERSION = '${exact}';\nconst unrelated = '${exact}';\n`,
    );
    const exportExtraOccurrence = await scanScope({ root, paths: ["src/domain/export/constants.ts"] });
    assert.equal(exportExtraOccurrence.passed, false);
    assert.equal(
      exportExtraOccurrence.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );

    await writeRelative(
      root,
      "src/domain/export/constants.ts",
      `const CONFIG_VERSION = '${exact}';\n`,
    );
    const exportWrongDeclaration = await scanScope({ root, paths: ["src/domain/export/constants.ts"] });
    assert.equal(exportWrongDeclaration.passed, false);
    assert.equal(
      exportWrongDeclaration.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );
  });

  it("allows exact export denylist literals only inside its fixed declaration", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "src/domain/export/snapshot.ts",
      [
        "const EXTERNAL_FIELD_KEYS = new Set([",
        "  'research_code',",
        "  'study_code',",
        "]);",
      ].join("\n"),
    );
    const allowed = await scanScope({ root, paths: ["src/domain/export/snapshot.ts"] });
    assert.equal(allowed.passed, true);

    await writeRelative(root, "src/domain/export/other.ts", "const key = 'research_code';\n");
    const wrongPath = await scanScope({ root, paths: ["src/domain/export/other.ts"] });
    assert.equal(wrongPath.passed, false);
    assert.equal(
      wrongPath.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );

    await writeRelative(
      root,
      "src/domain/export/snapshot.ts",
      [
        "const EXTERNAL_FIELD_KEYS = new Set([",
        '  "research_code",',
        "  'study_code_extra',",
        "]);",
      ].join("\n"),
    );
    const variants = await scanScope({ root, paths: ["src/domain/export/snapshot.ts"] });
    assert.equal(variants.passed, false);
    assert.equal(
      variants.violations.some(({ code }) => code === "SCOPE_GUARD_RESEARCH_IDENTIFIER"),
      true,
    );
  });

  it("uses build-output rules for approved React internals and rejects real build violations", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "dist/assets/react-runtime.js",
      [
        "function preload(e,n){fetch(e.href,n)}",
        "console.error(error);",
        "const svgNamespace = `http://www.w3.org/2000/svg`;",
        "const mathNamespace = `http://www.w3.org/1998/Math/MathML`;",
        "const xlinkNamespace = `http://www.w3.org/1999/xlink`;",
        "const xmlNamespace = `http://www.w3.org/XML/1998/namespace`;",
        "const reactError = `https://react.dev/errors/` + code;",
      ].join("\n"),
    );
    const approved = await scanScope({ root, paths: ["dist"] });
    assert.equal(approved.passed, true);

    await writeRelative(
      root,
      "dist/assets/external.js",
      [
        'const chunk = import("https://evil.invalid/chunk.js");',
        'const request = fetch("https://evil.invalid/api");',
        'const script = document.createElement("script"); script.src = "https://evil.invalid/script.js";',
        "navigator.serviceWorker.register('/sw.js');",
        "window.analytics.track('event');",
        "//# sourceMappingURL=external.js.map",
      ].join("\n"),
    );
    await writeRelative(root, "dist/assets/external.js.map", "{}\n");
    await writeRelative(
      root,
      "dist/index.html",
      '<script src="https://evil.invalid/script.js"></script>\n<link rel="manifest" href="/manifest.webmanifest">\n',
    );
    await writeRelative(root, "dist/manifest.json", "{}\n");
    await writeRelative(root, "dist/sw.js", "self.addEventListener('fetch', () => {});\n");
    const rejected = await scanScope({ root, paths: ["dist"] });
    const codes = new Set(rejected.violations.map(({ code }) => code));
    assert.equal(rejected.passed, false);
    assert.equal(codes.has("SCOPE_GUARD_EXTERNAL_DYNAMIC_IMPORT"), true);
    assert.equal(codes.has("SCOPE_GUARD_EXTERNAL_RESOURCE_ENDPOINT"), true);
    assert.equal(codes.has("SCOPE_GUARD_EXTERNAL_STATIC_RESOURCE"), true);
    assert.equal(codes.has("SCOPE_GUARD_PWA_ARTIFACT"), true);
    assert.equal(codes.has("SCOPE_GUARD_ANALYTICS_IDENTIFIER"), true);
    assert.equal(codes.has("SCOPE_GUARD_SOURCE_MAP"), true);
  });

  it("scans the root HTML entry and rejects external resources or PWA metadata", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "index.html",
      '<script type="module" src="/src/main.tsx"></script>\n',
    );
    const allowed = await scanScope({ root, paths: ["index.html"] });
    assert.equal(allowed.passed, true);
    assert.deepEqual(allowed.scannedFiles, ["index.html"]);

    await writeRelative(
      root,
      "index.html",
      [
        '<script src="https://external.invalid/runtime.js"></script>',
        '<link rel="manifest" href="/manifest.webmanifest">',
      ].join("\n"),
    );
    const rejected = await scanScope({ root, paths: ["index.html"] });
    const codes = new Set(rejected.violations.map(({ code }) => code));
    assert.equal(codes.has("SCOPE_GUARD_EXTERNAL_STATIC_RESOURCE"), true);
    assert.equal(codes.has("SCOPE_GUARD_PWA_ARTIFACT"), true);
  });

  it("allows remote-looking URLs only in the declared inert Markdown fixture text", async () => {
    const root = await makeRoot();
    const fixturePath = "tests/fixtures/synthetic/edge-markdown-unicode.json";
    const fixture = {
      fixture_schema: "zhiguan.synthetic-fixture.v1",
      synthetic_only: true,
      text_case: {
        contains_network_intent: false,
        text: "link [literal](https://example.invalid/x)",
      },
    };
    await writeRelative(root, fixturePath, `${JSON.stringify(fixture)}\n`);
    const inert = await scanScope({ root, paths: [fixturePath] });
    assert.equal(inert.passed, true);

    fixture.text_case.contains_network_intent = true;
    await writeRelative(root, fixturePath, `${JSON.stringify(fixture)}\n`);
    const active = await scanScope({ root, paths: [fixturePath] });
    assert.equal(active.passed, false);
    assert.equal(
      active.violations.some(({ code }) => code === "SCOPE_GUARD_REMOTE_URL"),
      true,
    );

    fixture.text_case.contains_network_intent = false;
    const otherFixturePath = "tests/fixtures/synthetic/other.json";
    await writeRelative(root, otherFixturePath, `${JSON.stringify(fixture)}\n`);
    const otherFixture = await scanScope({ root, paths: [otherFixturePath] });
    assert.equal(otherFixture.passed, false);
    assert.equal(
      otherFixture.violations.some(({ code }) => code === "SCOPE_GUARD_REMOTE_URL"),
      true,
    );
  });

  it("rejects structured fields in JSON fixtures without exposing values", async () => {
    const root = await makeRoot();
    await writeRelative(
      root,
      "tests/fixtures/invalid.json",
      `${JSON.stringify({ participant_id: "P-0001", observation_notes: "private" }, null, 2)}\n`,
    );

    const result = await scanScope({ root, paths: ["tests/fixtures"] });
    const forbidden = result.violations.filter(
      ({ code }) => code === "SCOPE_GUARD_FORBIDDEN_FIELD",
    );

    assert.equal(result.passed, false);
    assert.equal(forbidden.length, 2);
    assert.equal(formatScopeGuardReport(result).includes("private"), false);
  });

  it("fails closed for paths outside the allowlist and keeps the decision auditable", async () => {
    const root = await makeRoot();
    await writeRelative(root, "docs/should-not-scan.md", "contact_email: hidden@example.invalid\n");

    const denied = checkScopePath("docs/should-not-scan.md");
    assert.deepEqual(denied, {
      code: "SCOPE_GUARD_PATH_DENIED",
      path: "docs/should-not-scan.md",
      line: 0,
      column: 0,
    });

    const result = await scanScope({ root, paths: ["docs"] });
    assert.equal(result.passed, false);
    assert.deepEqual(result.violations, [
      {
        code: "SCOPE_GUARD_PATH_DENIED",
        path: "docs",
        line: 0,
        column: 0,
      },
    ]);
    assert.equal(formatScopeGuardReport(result).includes("hidden@example.invalid"), false);
  });

  it("skips missing optional roots and rejects traversal paths without reading them", async () => {
    const root = await makeRoot();
    const result = await scanScope({ root, paths: ["src", "public", "../outside"] });

    assert.equal(result.passed, false);
    assert.deepEqual(result.skippedMissingPaths, ["public", "src"]);
    assert.deepEqual(result.violations, [
      {
        code: "SCOPE_GUARD_PATH_INVALID",
        path: "<path>",
        line: 0,
        column: 0,
      },
    ]);
  });
});
