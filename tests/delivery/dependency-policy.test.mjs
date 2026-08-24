import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  auditDependencyPolicy,
  formatDependencyPolicyReport,
  readProjectDependencyPolicy,
} from "../../scripts/check-dependency-policy.mjs";

async function readInputs() {
  const [manifestText, lockText, npmrcText] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("package-lock.json", "utf8"),
    readFile(".npmrc", "utf8"),
  ]);
  return {
    manifest: JSON.parse(manifestText),
    lock: JSON.parse(lockText),
    npmrcText,
  };
}

function clone(value) {
  return structuredClone(value);
}

test("current manifest and lockfile pass the dependency policy readback", async () => {
  const result = await readProjectDependencyPolicy();

  assert.equal(result.passed, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.summary.packageCount > 0, true);
  assert.equal(result.summary.installScriptCount, 2);
  assert.equal(result.summary.engineCount > 0, true);
  assert.equal(result.summary.requiredPeerCount > 0, true);
  assert.equal(formatDependencyPolicyReport(result).startsWith("DEPENDENCY_POLICY_PASS "), true);
});

test("rejects direct dependency drift and remote source specifications", async () => {
  const inputs = await readInputs();
  inputs.manifest.dependencies.react = "https://registry.example.invalid/react.tgz";

  const result = auditDependencyPolicy(inputs);
  const codes = new Set(result.violations.map(({ code }) => code));

  assert.equal(result.passed, false);
  assert.equal(codes.has("DIRECT_DEPENDENCY_VERSION_MISMATCH"), true);
  assert.equal(codes.has("DIRECT_DEPENDENCY_NOT_EXACT"), true);
  assert.equal(codes.has("DEPENDENCY_SOURCE_SPEC_FORBIDDEN"), true);
  assert.equal(formatDependencyPolicyReport(result).includes("registry.example.invalid"), false);
});

test("rejects non-registry lock entries, missing integrity and unapproved licenses", async () => {
  const inputs = await readInputs();
  const entry = inputs.lock.packages["node_modules/react"];
  entry.resolved = "https://evil.example.invalid/react.tgz";
  delete entry.integrity;
  entry.license = "GPL-3.0-only";

  const result = auditDependencyPolicy(inputs);
  const codes = new Set(result.violations.map(({ code }) => code));

  assert.equal(result.passed, false);
  assert.equal(codes.has("LOCK_PACKAGE_SOURCE_NOT_REGISTRY"), true);
  assert.equal(codes.has("LOCK_PACKAGE_INTEGRITY_INVALID"), true);
  assert.equal(codes.has("LOCK_PACKAGE_LICENSE_NOT_APPROVED"), true);
  assert.equal(formatDependencyPolicyReport(result).includes("evil.example.invalid"), false);
});

test("requires strict script policy and explicit approved decisions", async () => {
  const inputs = await readInputs();
  inputs.npmrcText = "fund=false\n";
  inputs.manifest.allowScripts = { fsevents: true };

  const result = auditDependencyPolicy(inputs);
  const codes = new Set(result.violations.map(({ code }) => code));

  assert.equal(result.passed, false);
  assert.equal(codes.has("NPMRC_STRICT_ALLOW_SCRIPTS_REQUIRED"), true);
  assert.equal(codes.has("NPMRC_REGISTRY_NOT_APPROVED"), true);
  assert.equal(codes.has("INSTALL_SCRIPT_NOT_APPROVED"), true);
});

test("allows MPL-2.0 only for the explicitly reviewed locked packages", async () => {
  const inputs = await readInputs();
  inputs.lock.packages["node_modules/react"].license = "MPL-2.0";

  const result = auditDependencyPolicy(inputs);
  const codes = new Set(result.violations.map(({ code }) => code));

  assert.equal(result.passed, false);
  assert.equal(codes.has("LOCK_PACKAGE_MPL_NOT_REVIEWED"), true);
});

test("rejects an environment registry override even when the project npmrc is pinned", async () => {
  const inputs = await readInputs();
  inputs.registryOverride = "https://registry.example.invalid/";

  const result = auditDependencyPolicy(inputs);

  assert.equal(result.passed, false);
  assert.equal(
    result.violations.some(({ code }) => code === "NPM_REGISTRY_OVERRIDE_NOT_APPROVED"),
    true,
  );
});

test("fails closed for required peer and engine incompatibility", async () => {
  const inputs = await readInputs();
  const reactDom = inputs.lock.packages["node_modules/react-dom"];
  reactDom.peerDependencies.react = ">=99.0.0";
  const saxes = inputs.lock.packages["node_modules/saxes"];
  saxes.engines.node = ">=99.0.0";

  const result = auditDependencyPolicy(inputs);
  const codes = new Set(result.violations.map(({ code }) => code));

  assert.equal(result.passed, false);
  assert.equal(codes.has("PEER_RANGE_MISMATCH"), true);
  assert.equal(codes.has("ENGINE_RANGE_MISMATCH"), true);
});

test("keeps source, integrity and license summary deterministic", async () => {
  const first = await readProjectDependencyPolicy();
  const second = await readProjectDependencyPolicy();

  assert.deepEqual(first.summary, second.summary);
  assert.equal(formatDependencyPolicyReport(first), formatDependencyPolicyReport(second));
  assert.equal(formatDependencyPolicyReport(first).includes("sha512-"), false);
  assert.equal(formatDependencyPolicyReport(first).includes("https://"), false);
});
