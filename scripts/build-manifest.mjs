import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_VERSION = "1.0.0";
export const CONFIG_VERSION = "research-static-config@1.0.0";
export const DEFAULT_MANIFEST_PATH = "artifacts/build/artifact-manifest.json";
export const BUILD_MODES = Object.freeze({
  release: "release",
  implementationPreview: "implementation-preview",
});
export const WORKTREE_STATES = Object.freeze({
  clean: "clean",
  dirty: "dirty",
});
export const CARRIER_META_NAMES = Object.freeze({
  appVersion: "application-build-app-version",
  gitCommitSha: "application-build-git-commit-sha",
  artifactManifestSha256: "artifact-manifest-sha256",
  configVersion: "application-build-config-version",
});

export const ZERO_SHA256 = "0".repeat(64);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const SHA1_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_MANIFEST_RELATIVE_PATH = DEFAULT_MANIFEST_PATH;
const TEMP_FILE_PREFIX = ".zhiguan-artifact-manifest-";

export const REQUIRED_MANIFEST_PATHS = Object.freeze([
  ".gitattributes",
  "package.json",
  "package-lock.json",
  "index.html",
  ".npmrc",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
  "scripts/verify-toolchain.mjs",
  "scripts/build-manifest.mjs",
  "scripts/check-dependency-policy.mjs",
  "scripts/generate-currency-table.mjs",
  "scripts/preview-lan.mjs",
  "scripts/preview-gate.mjs",
  "scripts/preview-gate.d.mts",
  "scripts/scope-guard.mjs",
  "src/main.tsx",
  "src/app/App.tsx",
  "src/application/export-workbench.ts",
  "src/application/workbench.ts",
  "src/styles/app.css",
  "src/adapters/browser/build-metadata.ts",
  "src/adapters/browser/clock.ts",
  "src/adapters/browser/download-lifecycle.ts",
  "src/adapters/browser/download.ts",
  "src/adapters/browser/lifecycle.ts",
  "src/domain/calculation/currency.ts",
  "src/domain/calculation/decimal.ts",
  "src/domain/calculation/display.ts",
  "src/domain/calculation/index.ts",
  "src/domain/calculation/rational.ts",
  "src/domain/calculation/rules.ts",
  "src/domain/calculation/types.ts",
  "src/domain/calculation/generated/currency-table.ts",
  "src/domain/export/constants.ts",
  "src/domain/export/equivalence.ts",
  "src/domain/export/errors.ts",
  "src/domain/export/index.ts",
  "src/domain/export/json.ts",
  "src/domain/export/markdown.ts",
  "src/domain/export/preview.ts",
  "src/domain/export/snapshot.ts",
  "src/domain/export/state.ts",
  "src/domain/export/types.ts",
  "src/domain/export/unicode.ts",
  "src/domain/export/validator.ts",
  "src/domain/session/index.ts",
  "src/domain/session/reducer.ts",
  "src/domain/session/selectors.ts",
  "src/domain/session/types.ts",
  "fixtures/currency/README.md",
  "fixtures/currency/iso4217-list-one-2026-01-01.xml",
  "tests/fixtures/synthetic/manifest.json",
  "tests/fixtures/synthetic/edge-currency-conflict.json",
  "tests/fixtures/synthetic/edge-currency-minor-units.json",
  "tests/fixtures/synthetic/edge-empty-input.json",
  "tests/fixtures/synthetic/edge-invalid-unicode.json",
  "tests/fixtures/synthetic/edge-markdown-unicode.json",
  "tests/fixtures/synthetic/edge-negative-input.json",
  "tests/fixtures/synthetic/edge-negative-margin.json",
  "tests/fixtures/synthetic/edge-numeric-limits.json",
  "tests/fixtures/synthetic/edge-period-conflict.json",
  "tests/fixtures/synthetic/edge-representative-failures.json",
  "tests/fixtures/synthetic/edge-revision-limit.json",
  "tests/fixtures/synthetic/edge-rounding-ties.json",
  "tests/fixtures/synthetic/edge-tax-basis-conflict.json",
  "tests/fixtures/synthetic/edge-zero-input.json",
  "tests/fixtures/synthetic/syn-01-confirmed-no-fixed-cost.json",
  "tests/fixtures/synthetic/syn-02-complete-purchase-forecast.json",
  "tests/fixtures/synthetic/syn-03-estimated-dependency-propagation.json",
  "tests/fixtures/synthetic/syn-04-missing-hours-local-insufficiency.json",
  "tests/fixtures/synthetic/syn-05-before-tax-local-results.json",
]);

export class ArtifactManifestError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ArtifactManifestError";
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new ArtifactManifestError(code, message);
}

function assert(condition, code, message = code) {
  if (!condition) fail(code, message);
}

function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}

export function normalizeManifestPath(value) {
  const path = toPosixPath(String(value));
  assert(path.length > 0, "manifest-path-empty");
  assert(!path.startsWith("/"), "manifest-path-absolute");
  assert(!path.split("/").includes(".."), "manifest-path-parent");
  assert(!path.split("/").includes(""), "manifest-path-empty-segment");
  return path;
}

function compareUtf8Bytes(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sortUtf8BytePaths(paths) {
  return [...paths].sort(compareUtf8Bytes);
}

function rootRelativePath(rootDir, filePath) {
  const root = resolve(rootDir);
  const absolute = resolve(filePath);
  const candidate = toPosixPath(relative(root, absolute));
  assert(candidate && candidate !== ".", "manifest-path-empty");
  return normalizeManifestPath(candidate);
}

function lstatOrNull(filePath) {
  return lstatSync(filePath, { throwIfNoEntry: false });
}

/**
 * lstat every existing component instead of relying on realpath.  This keeps
 * a manifest build from following a symlink in an output parent, required
 * source path, or dist subtree.  Missing leaf components are allowed only
 * when the caller is about to create a known output file.
 */
function assertNoSymlinkBoundary(
  rootDir,
  relativePath,
  { allowMissingLeaf = false, allowMissingComponents = false } = {},
) {
  const root = resolve(rootDir);
  const rootStat = lstatOrNull(root);
  assert(rootStat && rootStat.isDirectory() && !rootStat.isSymbolicLink(), "manifest-root-invalid");
  const normalized = normalizeManifestPath(relativePath);
  const parts = normalized.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    const stat = lstatOrNull(current);
    if (!stat) {
      assert(
        (allowMissingComponents || (allowMissingLeaf && index === parts.length - 1)),
        "manifest-path-missing",
        normalized,
      );
      return current;
    }
    assert(!stat.isSymbolicLink(), "manifest-path-symlink", normalized);
    if (index < parts.length - 1) {
      assert(stat.isDirectory(), "manifest-path-parent-invalid", normalized);
    }
  }
  return current;
}

function requireRegularFile(rootDir, relativePath) {
  const normalized = normalizeManifestPath(relativePath);
  const absolute = assertNoSymlinkBoundary(rootDir, normalized);
  const stat = lstatOrNull(absolute);
  assert(stat, "manifest-required-file-missing", normalized);
  assert(!stat.isSymbolicLink() && stat.isFile(), "manifest-required-file-invalid", normalized);
  return { absolute, path: normalized };
}

function collectDistFiles(rootDir, distDir) {
  const distRoot = resolve(distDir);
  const distRelative = rootRelativePath(rootDir, distRoot);
  assertNoSymlinkBoundary(rootDir, distRelative);
  const stat = lstatOrNull(distRoot);
  assert(stat && !stat.isSymbolicLink() && stat.isDirectory(), "manifest-dist-missing");

  const paths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("manifest-dist-symlink");
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      assert(entry.isFile(), "manifest-dist-special-file");
      paths.push(rootRelativePath(rootDir, absolute));
    }
  };
  visit(distRoot);
  assert(paths.length > 0, "manifest-dist-empty");
  return sortUtf8BytePaths(paths);
}

function readJsonObject(filePath, code) {
  const text = readFileSync(filePath, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(code);
  }
  assert(value && typeof value === "object" && !Array.isArray(value), code);
  return value;
}

function exactSemver(value) {
  assert(typeof value === "string" && SEMVER_PATTERN.test(value), "manifest-invalid-app-version");
  return value;
}

function exactGitSha(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  assert(SHA1_PATTERN.test(normalized), "manifest-invalid-git-sha");
  return normalized;
}

function readGitSha(rootDir) {
  let value;
  try {
    value = execFileSync("git", ["-C", resolve(rootDir), "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    fail("manifest-git-sha-unavailable");
  }
  return exactGitSha(value);
}

function readGitWorktreeState(rootDir) {
  let output;
  try {
    output = execFileSync(
      "git",
      ["-C", resolve(rootDir), "status", "--porcelain=v1", "--untracked-files=all", "-z"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    fail("manifest-git-state-unavailable");
  }

  const changedPaths = output
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .map((entry) => entry.replace(/^"(.*)"$/u, "$1"))
    .filter((entry) => entry !== GENERATED_MANIFEST_RELATIVE_PATH);
  return {
    state: changedPaths.length === 0 ? WORKTREE_STATES.clean : WORKTREE_STATES.dirty,
    changedPaths,
  };
}

export function decodeUtf8Exact(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    fail("manifest-index-invalid-utf8");
  }
  assert(Buffer.compare(Buffer.from(text, "utf8"), input) === 0, "manifest-index-invalid-utf8");
  return text;
}

function readUtf8ExactText(value) {
  const text = String(value);
  return decodeUtf8Exact(Buffer.from(text, "utf8")) === text
    ? text
    : fail("manifest-index-invalid-utf8");
}

export function checkBuildPreflight({
  rootDir = REPO_ROOT,
  distDir = join(rootDir, "dist"),
  manifestPath = DEFAULT_MANIFEST_PATH,
  implementationPreview = false,
} = {}) {
  const root = resolve(rootDir);
  const dist = resolve(distDir);
  const manifestAbsolute = resolve(root, manifestPath);
  const manifestRelative = manifestRelativePath(root, manifestAbsolute);
  assertNoSymlinkBoundary(root, manifestRelative, {
    allowMissingLeaf: true,
    allowMissingComponents: true,
  });
  assert(manifestRelative !== "dist" && !manifestRelative.startsWith("dist/"), "manifest-output-inside-dist");
  const distRelative = rootRelativePath(root, dist);
  assertNoSymlinkBoundary(root, distRelative, {
    allowMissingLeaf: true,
    allowMissingComponents: true,
  });
  const distStat = lstatOrNull(dist);
  if (distStat) {
    assert(!distStat.isSymbolicLink() && distStat.isDirectory(), "manifest-dist-preflight-invalid");
    assertNoSymlinkBoundary(root, distRelative);
  }
  const gitCommitSha = readGitSha(root);
  const worktree = readGitWorktreeState(root);
  if (!implementationPreview) {
    assert(worktree.state === WORKTREE_STATES.clean, "manifest-git-dirty", worktree.changedPaths.join(","));
  }
  return Object.freeze({
    buildMode: implementationPreview ? BUILD_MODES.implementationPreview : BUILD_MODES.release,
    gitCommitSha,
    worktreeState: worktree.state,
    changedPaths: [...worktree.changedPaths],
  });
}

function getAttribute(tag, attributeName) {
  const pattern = new RegExp(`(?:^|\\s)${attributeName}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, "iu");
  const match = pattern.exec(tag);
  return match ? match[2] ?? match[3] ?? "" : null;
}

function updateMetaContent(html, metaName, content) {
  const tagPattern = /<meta\b[^>]*>/giu;
  let count = 0;
  const updated = html.replace(tagPattern, (tag) => {
    if (getAttribute(tag, "name") !== metaName) return tag;
    count += 1;
    const contentPattern = /(?:^|\s)(content\s*=\s*)(["'])(.*?)\2/giu;
    const contentMatches = [...tag.matchAll(contentPattern)];
    assert(contentMatches.length === 1, "manifest-carrier-content-invalid", metaName);
    const contentMatch = contentMatches[0];
    assert(contentMatch, "manifest-carrier-content-missing", metaName);
    const prefixLength = contentMatch[0].length - contentMatch[0].trimStart().length;
    const start = (contentMatch.index ?? 0) + prefixLength + contentMatch[1].length + 1;
    const end = start + contentMatch[3].length;
    return `${tag.slice(0, start)}${content}${tag.slice(end)}`;
  });
  assert(count === 1, count === 0 ? "manifest-carrier-meta-missing" : "manifest-carrier-meta-duplicate", metaName);
  return updated;
}

export function readCarrier(indexHtml) {
  const html = readUtf8ExactText(indexHtml);
  const values = {};
  for (const [key, name] of Object.entries(CARRIER_META_NAMES)) {
    const tagPattern = /<meta\b[^>]*>/giu;
    let count = 0;
    let value = null;
    for (const match of html.matchAll(tagPattern)) {
      if (getAttribute(match[0], "name") !== name) continue;
      count += 1;
      value = getAttribute(match[0], "content");
    }
    assert(count === 1, count === 0 ? "manifest-carrier-meta-missing" : "manifest-carrier-meta-duplicate", name);
    assert(value !== null, "manifest-carrier-content-missing", name);
    values[key] = value;
  }
  return values;
}

function writeCarrier(indexHtml, values) {
  let html = String(indexHtml);
  html = updateMetaContent(html, CARRIER_META_NAMES.appVersion, values.appVersion);
  html = updateMetaContent(html, CARRIER_META_NAMES.gitCommitSha, values.gitCommitSha);
  html = updateMetaContent(html, CARRIER_META_NAMES.configVersion, values.configVersion);
  html = updateMetaContent(html, CARRIER_META_NAMES.artifactManifestSha256, values.artifactManifestSha256);
  return html;
}

export function normalizeCarrierForEntry(indexHtml) {
  const carrier = readCarrier(indexHtml);
  // The self-reference break is deliberately byte-preserving: only the 64
  // ASCII zero carrier is replaced.  In particular, BOM and CRLF bytes must
  // remain part of the index entry hash.
  return writeCarrier(indexHtml, { ...carrier, artifactManifestSha256: ZERO_SHA256 });
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function entryForPath(rootDir, path, normalizedBytes = null) {
  const file = requireRegularFile(rootDir, path);
  const bytes = normalizedBytes ?? readFileSync(file.absolute);
  return { path: file.path, bytes: bytes.byteLength, sha256: hashBytes(bytes) };
}

function uniqueSortedPaths(paths) {
  const unique = new Set(paths.map(normalizeManifestPath));
  assert(unique.size === paths.length, "manifest-entry-duplicate");
  return sortUtf8BytePaths(unique);
}

function expectedEntries(rootDir, distDir, indexRelativePath, normalizedIndexBytes) {
  const distPaths = collectDistFiles(rootDir, distDir);
  const required = [...REQUIRED_MANIFEST_PATHS];
  const paths = uniqueSortedPaths([...distPaths, ...required]);
  const entries = paths.map((path) => {
    if (path === indexRelativePath) return entryForPath(rootDir, path, normalizedIndexBytes);
    return entryForPath(rootDir, path);
  });
  return entries;
}

function serializeManifest(manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const bytes = Buffer.from(text, "utf8");
  assert(bytes.byteLength > 0, "manifest-empty");
  assert(!text.includes("\r"), "manifest-crlf");
  return bytes;
}

function buildManifestObject({
  appVersion,
  configVersion,
  gitCommitSha,
  buildMode,
  worktreeState,
  entries,
}) {
  // Keep this object literal order stable: it is part of the manifest contract.
  return {
    manifest_version: MANIFEST_VERSION,
    app_version: appVersion,
    config_version: configVersion,
    build_mode: buildMode,
    worktree_state: worktreeState,
    git_commit_sha: gitCommitSha,
    entries,
  };
}

function manifestRelativePath(rootDir, manifestPath) {
  const absolute = resolve(rootDir, manifestPath);
  return rootRelativePath(rootDir, absolute);
}

function pathExistsAsRegularFile(filePath) {
  const stat = lstatOrNull(filePath);
  return Boolean(stat && stat.isFile() && !stat.isSymbolicLink());
}

function createStagedFile(directory, bytes, label) {
  const stagePath = join(
    directory,
    `${TEMP_FILE_PREFIX}${label}-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(stagePath, "wx", 0o600);
    let offset = 0;
    while (offset < bytes.byteLength) {
      offset += writeFileChunk(descriptor, bytes, offset);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return stagePath;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original failure.
      }
    }
    try {
      unlinkSync(stagePath);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function writeFileChunk(descriptor, bytes, offset) {
  // fs.writeSync is allowed to make a short write; loop in the caller rather
  // than assuming a single write publishes the complete UTF-8 byte sequence.
  return writeSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
}

function safeUnlink(filePath) {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is not available on every supported filesystem.  The
    // file staging and same-filesystem renames remain the hard requirement.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Publish two related files with same-filesystem staging and a rollback path.
 * Separate rename syscalls cannot be a single POSIX transaction, so a failed
 * second rename restores the first file before the error escapes.  Callers
 * therefore observe either the old pair or the new pair, never a knowingly
 * published half-pair.
 */
function publishArtifactPair({ indexPath, indexBytes, manifestPath, manifestBytes, rename = renameSync }) {
  const indexDirectory = dirname(indexPath);
  const manifestDirectory = dirname(manifestPath);
  const indexStage = createStagedFile(indexDirectory, indexBytes, "index");
  let manifestStage;
  try {
    manifestStage = createStagedFile(manifestDirectory, manifestBytes, "manifest");
  } catch (error) {
    safeUnlink(indexStage);
    throw new ArtifactManifestError("manifest-staging-failed", String(error?.message ?? error));
  }

  const indexBackup = join(indexDirectory, `${TEMP_FILE_PREFIX}index-backup-${process.pid}-${randomUUID()}`);
  const manifestBackup = join(manifestDirectory, `${TEMP_FILE_PREFIX}manifest-backup-${process.pid}-${randomUUID()}`);
  const state = {
    indexBackedUp: false,
    manifestBackedUp: false,
    indexPublished: false,
    manifestPublished: false,
  };
  try {
    if (pathExistsAsRegularFile(indexPath)) {
      rename(indexPath, indexBackup);
      state.indexBackedUp = true;
    } else {
      const stat = lstatOrNull(indexPath);
      assert(!stat, "manifest-index-output-invalid");
    }
    if (pathExistsAsRegularFile(manifestPath)) {
      rename(manifestPath, manifestBackup);
      state.manifestBackedUp = true;
    } else {
      const stat = lstatOrNull(manifestPath);
      assert(!stat, "manifest-output-invalid");
    }

    rename(indexStage, indexPath);
    state.indexPublished = true;
    rename(manifestStage, manifestPath);
    state.manifestPublished = true;
    fsyncDirectory(indexDirectory);
    if (manifestDirectory !== indexDirectory) fsyncDirectory(manifestDirectory);
  } catch (error) {
    // Remove newly published files before restoring backups.  If a stage was
    // never renamed, safeUnlink is a no-op.
    // Only remove paths that were actually published by this transaction.
    // If a backup rename itself failed, the original file is still the live
    // file and must never be mistaken for a newly published output.
    if (state.manifestPublished) safeUnlink(manifestPath);
    if (state.indexPublished) safeUnlink(indexPath);
    if (state.manifestBackedUp && !lstatOrNull(manifestPath)) rename(manifestBackup, manifestPath);
    if (state.indexBackedUp && !lstatOrNull(indexPath)) rename(indexBackup, indexPath);
    safeUnlink(indexStage);
    safeUnlink(manifestStage);
    safeUnlink(indexBackup);
    safeUnlink(manifestBackup);
    throw new ArtifactManifestError("manifest-atomic-publish-failed", String(error?.message ?? error));
  }

  safeUnlink(indexStage);
  safeUnlink(manifestStage);
  safeUnlink(indexBackup);
  safeUnlink(manifestBackup);
  return { changed: true };
}

export function buildArtifactManifest({
  rootDir = REPO_ROOT,
  distDir = join(rootDir, "dist"),
  manifestPath = DEFAULT_MANIFEST_PATH,
  gitCommitSha,
  check = false,
  implementationPreview = false,
  filesystem = undefined,
} = {}) {
  const root = resolve(rootDir);
  const dist = resolve(distDir);
  const manifestAbsolute = resolve(root, manifestPath);
  const manifestRelative = manifestRelativePath(root, manifestAbsolute);
  assertNoSymlinkBoundary(root, manifestRelative, {
    allowMissingLeaf: true,
    allowMissingComponents: true,
  });
  assert(!REQUIRED_MANIFEST_PATHS.includes(manifestRelative), "manifest-output-conflict");
  assert(manifestRelative !== "dist" && !manifestRelative.startsWith("dist/"), "manifest-output-inside-dist");
  const packageJson = readJsonObject(join(root, "package.json"), "manifest-package-invalid");
  const appVersion = exactSemver(packageJson.version);
  const configVersion = CONFIG_VERSION;
  const repositoryCommitSha = readGitSha(root);
  if (gitCommitSha !== undefined) {
    assert(exactGitSha(gitCommitSha) === repositoryCommitSha, "manifest-git-sha-mismatch");
  }
  const commitSha = repositoryCommitSha;
  const worktree = readGitWorktreeState(root);
  const buildMode = implementationPreview
    ? BUILD_MODES.implementationPreview
    : BUILD_MODES.release;
  if (!implementationPreview) {
    assert(worktree.state === WORKTREE_STATES.clean, "manifest-git-dirty", worktree.changedPaths.join(","));
  }
  const indexRelativePath = rootRelativePath(root, join(dist, "index.html"));
  const indexFile = requireRegularFile(root, indexRelativePath);
  const indexBytes = readFileSync(indexFile.absolute);
  const indexHtml = decodeUtf8Exact(indexBytes);
  const preparedIndexHtml = writeCarrier(indexHtml, {
    appVersion,
    gitCommitSha: commitSha,
    configVersion,
    artifactManifestSha256: ZERO_SHA256,
  });
  const normalizedIndexHtml = normalizeCarrierForEntry(preparedIndexHtml);
  const normalizedIndexBytes = Buffer.from(normalizedIndexHtml, "utf8");
  const entries = expectedEntries(root, dist, indexRelativePath, normalizedIndexBytes);
  assert(!entries.some((entry) => entry.path === manifestRelative), "manifest-output-conflict");
  const manifest = buildManifestObject({
    appVersion,
    configVersion,
    gitCommitSha: commitSha,
    buildMode,
    worktreeState: worktree.state,
    entries,
  });
  const manifestBytes = serializeManifest(manifest);
  const manifestSha256 = hashBytes(manifestBytes);
  assert(SHA256_PATTERN.test(manifestSha256), "manifest-digest-invalid");
  const finalIndexHtml = writeCarrier(indexHtml, {
    appVersion,
    gitCommitSha: commitSha,
    configVersion,
    artifactManifestSha256: manifestSha256,
  });
  const finalIndexBytes = Buffer.from(finalIndexHtml, "utf8");
  const expected = {
    manifest,
    manifestBytes,
    manifestSha256,
    finalIndexBytes,
    normalizedIndexBytes,
    manifestPath: manifestRelative,
    buildMode,
    worktreeState: worktree.state,
    changedPaths: [...worktree.changedPaths],
  };

  if (check) {
    assertNoSymlinkBoundary(root, manifestRelative);
    let currentManifestBytes;
    try {
      currentManifestBytes = readFileSync(manifestAbsolute);
    } catch {
      fail("manifest-output-missing");
    }
    const currentIndexBytes = readFileSync(indexFile.absolute);
    assert(Buffer.compare(currentManifestBytes, manifestBytes) === 0, "manifest-mismatch");
    assert(Buffer.compare(currentIndexBytes, finalIndexBytes) === 0, "manifest-carrier-mismatch");
    assert(!entries.some((entry) => entry.path === manifestRelative), "manifest-self-entry");
    assert(manifest.build_mode === buildMode, "manifest-build-mode-mismatch");
    assert(manifest.worktree_state === worktree.state, "manifest-worktree-state-mismatch");
    return { ...expected, checked: true, changed: false };
  }

  const manifestParentRelative = rootRelativePath(root, dirname(manifestAbsolute));
  assertNoSymlinkBoundary(root, manifestParentRelative, {
    allowMissingLeaf: true,
    allowMissingComponents: true,
  });
  mkdirSync(dirname(manifestAbsolute), { recursive: true });
  assertNoSymlinkBoundary(root, manifestParentRelative);
  return {
    ...expected,
    ...publishArtifactPair({
      indexPath: indexFile.absolute,
      indexBytes: finalIndexBytes,
      manifestPath: manifestAbsolute,
      manifestBytes,
      rename: filesystem?.rename ?? renameSync,
    }),
    checked: false,
  };
}

function parseArgs(argv) {
  const options = {
    check: false,
    preflight: false,
    rootDir: REPO_ROOT,
    manifestPath: DEFAULT_MANIFEST_PATH,
    implementationPreview: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--preflight") {
      options.preflight = true;
      continue;
    }
    if (argument === "--root") {
      options.rootDir = resolve(argv[++index] ?? "");
      continue;
    }
    if (argument === "--manifest") {
      options.manifestPath = argv[++index] ?? "";
      continue;
    }
    if (argument === "--implementation-preview") {
      options.implementationPreview = true;
      continue;
    }
    fail("manifest-unknown-argument");
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.preflight) {
      const result = checkBuildPreflight(options);
      process.stdout.write(`ARTIFACT_PREFLIGHT_PASS mode=${result.buildMode} worktree=${result.worktreeState}\n`);
    } else {
      const result = buildArtifactManifest(options);
      process.stdout.write(`ARTIFACT_MANIFEST_${result.checked ? "CHECK_PASS" : "WRITE_PASS"} sha256=${result.manifestSha256}\n`);
    }
  } catch (error) {
    const code = error instanceof ArtifactManifestError ? error.code : "manifest-unexpected-failure";
    process.stderr.write(`ARTIFACT_MANIFEST_FAIL ${code}\n`);
    process.exitCode = 1;
  }
}
