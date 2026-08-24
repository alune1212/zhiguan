import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_NODE_VERSION = "24.19.0";
export const REQUIRED_NPM_VERSION = "11.17.0";
export const REGISTRY_PREFIX = "https://registry.npmjs.org/";

export const DIRECT_DEPENDENCY_ALLOWLIST = Object.freeze({
  dependencies: Object.freeze({
    react: "19.2.8",
    "react-dom": "19.2.8",
  }),
  devDependencies: Object.freeze({
    "@axe-core/playwright": "4.13.0",
    "@playwright/test": "1.62.1",
    "@testing-library/dom": "10.4.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.5",
    "@types/node": "24.13.3",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.4",
    "@vitejs/plugin-react": "6.1.0",
    jsdom: "30.0.1",
    typescript: "7.0.2",
    vite: "8.2.2",
    vitest: "4.1.11",
  }),
});

export const LICENSE_POLICY = Object.freeze({
  "Apache-2.0": "approved permissive license",
  "BSD-2-Clause": "approved permissive license",
  "BSD-3-Clause": "approved permissive license",
  "BlueOak-1.0.0": "approved permissive license",
  "CC0-1.0": "approved public-domain dedication",
  ISC: "approved permissive license",
  MIT: "approved permissive license",
  "MIT-0": "approved permissive license",
  "MPL-2.0": "approved file-level copyleft license for reviewed locked packages",
});

export const MPL_PACKAGE_ALLOWLIST = Object.freeze(new Set([
  "@axe-core/playwright",
  "axe-core",
  "lightningcss",
  "lightningcss-android-arm64",
  "lightningcss-darwin-arm64",
  "lightningcss-darwin-x64",
  "lightningcss-freebsd-x64",
  "lightningcss-linux-arm-gnueabihf",
  "lightningcss-linux-arm64-gnu",
  "lightningcss-linux-arm64-musl",
  "lightningcss-linux-x64-gnu",
  "lightningcss-linux-x64-musl",
  "lightningcss-win32-arm64-msvc",
  "lightningcss-win32-x64-msvc",
]));

export const APPROVED_INSTALL_SCRIPT_DECISIONS = Object.freeze({
  fsevents: false,
});

const ROOT_INSTALL_SCRIPT_DECISIONS = Object.freeze({
  preinstall: "node scripts/verify-toolchain.mjs",
});

const LIFECYCLE_SCRIPT_NAMES = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
]);

const SOURCE_SPEC_PATTERN = /^(?:file:|link:|workspace:|git(?:\+|:)|https?:|ssh:|github:|npm:)/iu;
const REGISTRY_TARBALL_PATTERN =
  /^https:\/\/registry\.npmjs\.org\/(?:@[^/]+\/)?[^/]+\/-\/[^/]+-[^/]+\.tgz$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function addViolation(violations, code, subject) {
  violations.push({ code, subject: sanitizeSubject(subject) });
}

function sanitizeSubject(subject) {
  if (typeof subject !== "string" || subject.length === 0) return "metadata";
  const safe = subject.replace(/[^A-Za-z0-9@_./:+-]/gu, "_");
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort((left, right) => left.localeCompare(right));
}

function packageNameFromLockKey(key) {
  const marker = "node_modules/";
  const index = key.lastIndexOf(marker);
  return index >= 0 ? key.slice(index + marker.length) : key;
}

function isExactVersion(value) {
  return typeof value === "string" && EXACT_VERSION_PATTERN.test(value);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function parseVersion(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
    String(value).trim().replace(/^v/u, ""),
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function parsePartialVersion(value) {
  const match = /^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/u.exec(
    value.trim().replace(/^v/u, ""),
  );
  if (!match) return null;
  return {
    values: [
      Number(match[1]),
      match[2] === undefined || /^[xX*]$/u.test(match[2]) ? null : Number(match[2]),
      match[3] === undefined || /^[xX*]$/u.test(match[3]) ? null : Number(match[3]),
    ],
  };
}

function upperBoundForCaret(values) {
  const [major, minor, patch] = values;
  if (minor === null) return [major + 1, 0, 0];
  if (patch === null) return [major, minor + 1, 0];
  if (major > 0) return [major + 1, 0, 0];
  if (minor > 0) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

function upperBoundForTilde(values) {
  const [major, minor] = values;
  if (minor === null) return [major + 1, 0, 0];
  return [major, minor + 1, 0];
}

function comparePartialVersion(version, partial) {
  const [major, minor, patch] = partial.values;
  if (version[0] !== major) return version[0] - major;
  if (minor !== null && version[1] !== minor) return version[1] - minor;
  if (patch !== null && version[2] !== patch) return version[2] - patch;
  return 0;
}

function satisfiesComparator(version, comparator) {
  const normalized = comparator.trim().replace(/^(<=|>=|<|>|=|~|\^)\s+/u, "$1");
  if (normalized === "" || normalized === "*" || normalized === "x" || normalized === "X") {
    return { parsed: true, satisfied: true };
  }

  const operator = /^(<=|>=|<|>|=|~|\^)/u.exec(normalized)?.[1] ?? "";
  const versionText = operator ? normalized.slice(operator.length) : normalized;
  const partial = parsePartialVersion(versionText);
  if (!partial) return { parsed: false, satisfied: false };

  const comparison = comparePartialVersion(version, partial);
  if (operator === ">") return { parsed: true, satisfied: comparison > 0 };
  if (operator === ">=") return { parsed: true, satisfied: comparison >= 0 };
  if (operator === "<") return { parsed: true, satisfied: comparison < 0 };
  if (operator === "<=") return { parsed: true, satisfied: comparison <= 0 };
  if (operator === "^") {
    const lower = comparison >= 0;
    const upper = compareVersions(version, upperBoundForCaret(partial.values)) < 0;
    return { parsed: true, satisfied: lower && upper };
  }
  if (operator === "~") {
    const lower = comparison >= 0;
    const upper = compareVersions(version, upperBoundForTilde(partial.values)) < 0;
    return { parsed: true, satisfied: lower && upper };
  }

  if (partial.values[1] === null) {
    return { parsed: true, satisfied: version[0] === partial.values[0] };
  }
  if (partial.values[2] === null) {
    return {
      parsed: true,
      satisfied: version[0] === partial.values[0] && version[1] === partial.values[1],
    };
  }
  return { parsed: true, satisfied: comparison === 0 };
}

function satisfiesRange(versionText, rangeText) {
  const version = parseVersion(versionText);
  if (!version || typeof rangeText !== "string" || rangeText.trim() === "") {
    return { parsed: false, satisfied: false };
  }

  const normalized = rangeText
    .replace(/(<=|>=|<|>|=|~|\^)\s+/gu, "$1")
    .trim();
  const alternatives = normalized.split(/\s*\|\|\s*/u);
  let sawParsedAlternative = false;
  for (const alternative of alternatives) {
    const tokens = alternative.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) continue;
    const results = tokens.map((token) => satisfiesComparator(version, token));
    if (results.every(({ parsed }) => parsed)) {
      sawParsedAlternative = true;
      if (results.every(({ satisfied }) => satisfied)) {
        return { parsed: true, satisfied: true };
      }
    }
  }
  return { parsed: sawParsedAlternative, satisfied: false };
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function resolvePeerPackageKey(packageKey, peerName, packages) {
  let directory = packageKey;
  while (true) {
    const candidate = directory
      ? `${directory}/node_modules/${peerName}`
      : `node_modules/${peerName}`;
    if (packages[candidate]) return candidate;
    if (directory === "") return null;
    directory = parentPath(directory);
  }
}

function checkDirectDependencies(manifest, lock, violations) {
  const actualSections = new Set(["dependencies", "devDependencies"]);
  for (const section of ["optionalDependencies", "peerDependencies", "bundledDependencies"]) {
    if (manifest[section] && Object.keys(manifest[section]).length > 0) {
      addViolation(violations, "DIRECT_DEPENDENCY_SECTION_FORBIDDEN", section);
    }
  }

  for (const section of actualSections) {
    const expected = DIRECT_DEPENDENCY_ALLOWLIST[section];
    const actual = manifest[section] ?? {};
    for (const name of sortedKeys(expected)) {
      if (actual[name] !== expected[name]) {
        addViolation(violations, "DIRECT_DEPENDENCY_VERSION_MISMATCH", name);
      }
      if (!isExactVersion(actual[name])) {
        addViolation(violations, "DIRECT_DEPENDENCY_NOT_EXACT", name);
      }
    }
    for (const name of sortedKeys(actual)) {
      if (!(name in expected)) addViolation(violations, "DIRECT_DEPENDENCY_NOT_ALLOWLISTED", name);
      if (SOURCE_SPEC_PATTERN.test(String(actual[name]))) {
        addViolation(violations, "DEPENDENCY_SOURCE_SPEC_FORBIDDEN", name);
      }
    }

    const lockRoot = lock.packages?.[""]?.[section] ?? {};
    if (JSON.stringify(lockRoot) !== JSON.stringify(actual)) {
      addViolation(violations, "LOCK_ROOT_DIRECT_DEPENDENCY_DRIFT", section);
    }
  }

  const lockRoot = lock.packages?.[""];
  if (!lockRoot || lockRoot.name !== manifest.name || lockRoot.version !== manifest.version) {
    addViolation(violations, "LOCK_ROOT_IDENTITY_MISMATCH", "packages[empty]");
  }
  if (lockRoot?.engines?.node !== manifest.engines?.node || lockRoot?.engines?.npm !== manifest.engines?.npm) {
    addViolation(violations, "LOCK_ROOT_ENGINE_DRIFT", "packages[empty]");
  }

  for (const [section, expected] of Object.entries(DIRECT_DEPENDENCY_ALLOWLIST)) {
    for (const [name, version] of Object.entries(expected)) {
      const lockEntry = lock.packages?.[`node_modules/${name}`];
      if (!lockEntry || lockEntry.version !== version) {
        addViolation(violations, "LOCK_DIRECT_DEPENDENCY_MISMATCH", name);
      }
    }
    if (section === "dependencies") {
      if (manifest.dependencies?.react !== manifest.dependencies?.["react-dom"]) {
        addViolation(violations, "REACT_VERSION_PAIR_MISMATCH", "react/react-dom");
      }
    }
  }
}

function checkRootInstallScripts(manifest, violations) {
  const scripts = manifest.scripts ?? {};
  for (const name of LIFECYCLE_SCRIPT_NAMES) {
    if (!(name in scripts)) continue;
    if (ROOT_INSTALL_SCRIPT_DECISIONS[name] !== scripts[name]) {
      addViolation(violations, "ROOT_INSTALL_SCRIPT_NOT_APPROVED", name);
    }
  }
}

function checkNpmrc(npmrcText, violations) {
  const settings = new Map();
  for (const line of String(npmrcText ?? "").split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/u.exec(line);
    if (match) settings.set(match[1], match[2]);
  }
  if (settings.get("strict-allow-scripts") !== "true") {
    addViolation(violations, "NPMRC_STRICT_ALLOW_SCRIPTS_REQUIRED", "strict-allow-scripts");
  }
  if (settings.get("registry") !== REGISTRY_PREFIX) {
    addViolation(violations, "NPMRC_REGISTRY_NOT_APPROVED", "registry");
  }
  if (settings.get("ignore-scripts") === "true") {
    addViolation(violations, "NPMRC_IGNORE_SCRIPTS_FORBIDDEN", "ignore-scripts");
  }
}

function checkLockMetadata(lock, violations, summary) {
  if (lock.lockfileVersion !== 3) addViolation(violations, "LOCKFILE_VERSION_NOT_V3", "package-lock.json");
  const packages = lock.packages;
  if (!packages || typeof packages !== "object") {
    addViolation(violations, "LOCK_PACKAGES_MISSING", "package-lock.json");
    return;
  }

  const entries = Object.entries(packages).filter(([key]) => key !== "");
  summary.packageCount = entries.length;
  const licenseCounts = new Map();
  for (const [key, entry] of entries) {
    const subject = packageNameFromLockKey(key);
    if (!entry || typeof entry !== "object" || !isExactVersion(entry.version)) {
      addViolation(violations, "LOCK_PACKAGE_VERSION_INVALID", subject);
    }
    if (typeof entry.resolved !== "string" || !REGISTRY_TARBALL_PATTERN.test(entry.resolved)) {
      addViolation(violations, "LOCK_PACKAGE_SOURCE_NOT_REGISTRY", subject);
    }
    if (typeof entry.integrity !== "string" || !INTEGRITY_PATTERN.test(entry.integrity)) {
      addViolation(violations, "LOCK_PACKAGE_INTEGRITY_INVALID", subject);
    }
    if (typeof entry.license !== "string" || !(entry.license in LICENSE_POLICY)) {
      addViolation(violations, "LOCK_PACKAGE_LICENSE_NOT_APPROVED", subject);
    } else if (entry.license === "MPL-2.0" && !MPL_PACKAGE_ALLOWLIST.has(subject)) {
      addViolation(violations, "LOCK_PACKAGE_MPL_NOT_REVIEWED", subject);
    } else {
      licenseCounts.set(entry.license, (licenseCounts.get(entry.license) ?? 0) + 1);
    }
    for (const mapName of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependencyName, specification] of Object.entries(entry[mapName] ?? {})) {
        if (SOURCE_SPEC_PATTERN.test(String(specification))) {
          addViolation(violations, "LOCK_DEPENDENCY_SOURCE_SPEC_FORBIDDEN", `${subject}/${dependencyName}`);
        }
      }
    }
  }
  summary.licenseCounts = Object.fromEntries([...licenseCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function checkInstallScripts(manifest, lock, violations, summary) {
  const allowScripts = manifest.allowScripts;
  if (!allowScripts || typeof allowScripts !== "object" || Array.isArray(allowScripts)) {
    addViolation(violations, "INSTALL_SCRIPT_POLICY_MISSING", "allowScripts");
    return;
  }
  const lockScriptNames = new Set();
  let scriptEntryCount = 0;
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key !== "" && entry?.hasInstallScript === true) {
      scriptEntryCount += 1;
      const name = packageNameFromLockKey(key);
      lockScriptNames.add(name);
      const decision = allowScripts[name];
      if (typeof decision !== "boolean") {
        addViolation(violations, "INSTALL_SCRIPT_NOT_EXPLICITLY_DECIDED", name);
      } else if (!(name in APPROVED_INSTALL_SCRIPT_DECISIONS) || APPROVED_INSTALL_SCRIPT_DECISIONS[name] !== decision) {
        addViolation(violations, "INSTALL_SCRIPT_NOT_APPROVED", name);
      }
    }
  }
  for (const name of sortedKeys(allowScripts)) {
    if (!lockScriptNames.has(name)) addViolation(violations, "INSTALL_SCRIPT_POLICY_STALE", name);
    if (typeof allowScripts[name] !== "boolean") addViolation(violations, "INSTALL_SCRIPT_DECISION_NOT_BOOLEAN", name);
  }
  summary.installScriptCount = scriptEntryCount;
  summary.installScriptPackageCount = lockScriptNames.size;
}

function checkEngines(lock, violations, summary) {
  let checked = 0;
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "" || !entry?.engines) continue;
    const subject = packageNameFromLockKey(key);
    for (const [engine, range] of Object.entries(entry.engines)) {
      const current = engine === "node" ? REQUIRED_NODE_VERSION : engine === "npm" ? REQUIRED_NPM_VERSION : null;
      if (current === null) {
        addViolation(violations, "ENGINE_TARGET_UNSUPPORTED", `${subject}/${engine}`);
        continue;
      }
      checked += 1;
      const result = satisfiesRange(current, range);
      if (!result.parsed) addViolation(violations, "ENGINE_RANGE_UNPARSEABLE", subject);
      else if (!result.satisfied) addViolation(violations, "ENGINE_RANGE_MISMATCH", subject);
    }
  }
  summary.engineCount = checked;
}

function checkPeers(lock, violations, summary) {
  const packages = lock.packages ?? {};
  let required = 0;
  let optionalMissing = 0;
  for (const [key, entry] of Object.entries(packages)) {
    if (key === "" || !entry?.peerDependencies) continue;
    const subject = packageNameFromLockKey(key);
    for (const [peerName, range] of Object.entries(entry.peerDependencies)) {
      const optional = entry.peerDependenciesMeta?.[peerName]?.optional === true;
      const peerKey = resolvePeerPackageKey(key, peerName, packages);
      if (!peerKey) {
        if (optional) {
          optionalMissing += 1;
          continue;
        }
        required += 1;
        addViolation(violations, "PEER_REQUIRED_MISSING", `${subject}/${peerName}`);
        continue;
      }
      const resolved = packages[peerKey];
      const result = satisfiesRange(resolved.version, range);
      if (!result.parsed) {
        addViolation(violations, "PEER_RANGE_UNPARSEABLE", `${subject}/${peerName}`);
      } else if (!result.satisfied) {
        addViolation(violations, "PEER_RANGE_MISMATCH", `${subject}/${peerName}`);
      } else if (!optional) {
        required += 1;
      }
    }
  }
  summary.requiredPeerCount = required;
  summary.optionalPeerMissingCount = optionalMissing;
}

export function auditDependencyPolicy({ manifest, lock, npmrcText = "", registryOverride = null }) {
  const violations = [];
  const summary = {
    packageCount: 0,
    licenseCounts: {},
    installScriptCount: 0,
    installScriptPackageCount: 0,
    engineCount: 0,
    requiredPeerCount: 0,
    optionalPeerMissingCount: 0,
  };

  if (!manifest || typeof manifest !== "object") {
    addViolation(violations, "MANIFEST_MISSING", "package.json");
    return { passed: false, violations, summary };
  }
  if (!lock || typeof lock !== "object") {
    addViolation(violations, "LOCKFILE_MISSING", "package-lock.json");
    return { passed: false, violations, summary };
  }

  checkDirectDependencies(manifest, lock, violations);
  checkRootInstallScripts(manifest, violations);
  checkNpmrc(npmrcText, violations);
  if (registryOverride !== null && registryOverride !== REGISTRY_PREFIX) {
    addViolation(violations, "NPM_REGISTRY_OVERRIDE_NOT_APPROVED", "registry");
  }
  checkLockMetadata(lock, violations, summary);
  checkInstallScripts(manifest, lock, violations, summary);
  checkEngines(lock, violations, summary);
  checkPeers(lock, violations, summary);

  violations.sort((left, right) => `${left.code}\u0000${left.subject}`.localeCompare(`${right.code}\u0000${right.subject}`));
  return { passed: violations.length === 0, violations, summary };
}

export function formatDependencyPolicyReport(result) {
  const { summary } = result;
  const licenses = Object.entries(summary.licenseCounts)
    .map(([name, count]) => `${name}:${count}`)
    .join(",");
  const head = result.passed ? "DEPENDENCY_POLICY_PASS" : "DEPENDENCY_POLICY_FAIL";
  const lines = [
    `${head} lockfile=v3 packages=${summary.packageCount} scripts=${summary.installScriptCount} script-packages=${summary.installScriptPackageCount} engines=${summary.engineCount} peers=${summary.requiredPeerCount} optional-peer-missing=${summary.optionalPeerMissingCount} licenses=${licenses || "none"}`,
  ];
  for (const { code, subject } of result.violations) {
    lines.push(`VIOLATION code=${code} subject=${subject}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function readProjectDependencyPolicy(rootDirectory = process.cwd(), environment = process.env) {
  const [manifestText, lockText, npmrcText] = await Promise.all([
    readFile(`${rootDirectory}/package.json`, "utf8"),
    readFile(`${rootDirectory}/package-lock.json`, "utf8"),
    readFile(`${rootDirectory}/.npmrc`, "utf8").catch(() => ""),
  ]);
  return auditDependencyPolicy({
    manifest: JSON.parse(manifestText),
    lock: JSON.parse(lockText),
    npmrcText,
    registryOverride: Object.entries(environment).find(
      ([key]) => key.toLowerCase() === "npm_config_registry",
    )?.[1] ?? null,
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = await readProjectDependencyPolicy(dirname(fileURLToPath(import.meta.url)) + "/..");
  process.stdout.write(formatDependencyPolicyReport(result));
  if (!result.passed) process.exitCode = 1;
}
