import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUILD_MODES,
  CARRIER_META_NAMES,
  CONFIG_VERSION,
  DEFAULT_MANIFEST_PATH,
  REQUIRED_MANIFEST_PATHS,
  WORKTREE_STATES,
  ArtifactManifestError,
  buildArtifactManifest,
  checkBuildPreflight,
  decodeUtf8Exact,
  normalizeCarrierForEntry,
  readCarrier,
} from "../../scripts/build-manifest.mjs";

function createHashHex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeIndex({ lineEnding = "\n", bom = false, values = {} } = {}) {
  const meta = Object.entries(CARRIER_META_NAMES)
    .map(([key, name]) => {
      const fallback = key === "appVersion"
        ? "0.1.0"
        : key === "gitCommitSha"
          ? "0".repeat(40)
          : key === "artifactManifestSha256"
            ? "0".repeat(64)
            : CONFIG_VERSION;
      return `<meta name="${name}" content="${values[key] ?? fallback}" />`;
    })
    .join(`${lineEnding}    `);
  const html = `<!doctype html>${lineEnding}<html><head>${lineEnding}    ${meta}${lineEnding}</head><body>${lineEnding}<div id="root"></div>${lineEnding}</body></html>${lineEnding}`;
  return `${bom ? "\uFEFF" : ""}${html}`;
}

function initializeGit(root) {
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "manifest-test"]);
  execFileSync("git", ["-C", root, "add", "--all"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "fixture"]);
}

function createFixtureRoot({ lineEnding = "\n", bom = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "zhiguan-artifact-manifest-"));
  const files = new Set(REQUIRED_MANIFEST_PATHS);
  files.delete("index.html");
  files.delete("package.json");
  for (const path of files) {
    const target = join(root, path);
    const directory = target.slice(0, target.lastIndexOf("/"));
    mkdirSync(directory, { recursive: true });
    writeFileSync(target, `fixture:${path}\n`, "utf8");
  }
  mkdirSync(join(root, "dist/assets"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
  writeFileSync(join(root, "index.html"), makeIndex({ lineEnding, bom }), "utf8");
  writeFileSync(join(root, "dist/index.html"), makeIndex({ lineEnding, bom }), "utf8");
  writeFileSync(join(root, "dist/assets/z.js"), "z\n", "utf8");
  writeFileSync(join(root, "dist/assets/ä.js"), "umlaut\n", "utf8");
  writeFileSync(join(root, ".gitignore"), "dist/\nartifacts/build/\n", "utf8");
  initializeGit(root);
  return root;
}

function removeFixture(root) {
  rmSync(root, { recursive: true, force: true });
}

test("writes a deterministic non-circular manifest with the complete input set", () => {
  const root = createFixtureRoot();
  try {
    const written = buildArtifactManifest({ rootDir: root });
    const manifestPath = join(root, DEFAULT_MANIFEST_PATH);
    const manifestText = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    assert.deepEqual(Object.keys(manifest), [
      "manifest_version",
      "app_version",
      "config_version",
      "build_mode",
      "worktree_state",
      "git_commit_sha",
      "entries",
    ]);
    assert.equal(manifest.app_version, "0.1.0");
    assert.equal(manifest.config_version, CONFIG_VERSION);
    assert.equal(manifest.build_mode, BUILD_MODES.release);
    assert.equal(manifest.worktree_state, WORKTREE_STATES.clean);
    assert.match(manifest.git_commit_sha, /^[0-9a-f]{40}$/u);
    assert.equal(written.manifestSha256, createHashHex(Buffer.from(manifestText, "utf8")));
    assert.equal(readFileSync(join(root, "dist/index.html"), "utf8").includes(written.manifestSha256), true);
    assert.equal(manifest.entries.some(({ path }) => path === DEFAULT_MANIFEST_PATH), false);

    const paths = manifest.entries.map(({ path }) => path);
    assert.deepEqual(paths, [...paths].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))));
    for (const requiredPath of REQUIRED_MANIFEST_PATHS) assert.equal(paths.includes(requiredPath), true, requiredPath);
    assert.equal(paths.includes("dist/index.html"), true);
    assert.equal(paths.includes("dist/assets/ä.js"), true);

    const normalizedIndex = normalizeCarrierForEntry(readFileSync(join(root, "dist/index.html"), "utf8"));
    const indexEntry = manifest.entries.find(({ path }) => path === "dist/index.html");
    assert.equal(indexEntry.sha256, createHashHex(Buffer.from(normalizedIndex, "utf8")));
    assert.equal(buildArtifactManifest({ rootDir: root, check: true }).checked, true);
    assert.throws(
      () => buildArtifactManifest({ rootDir: root, gitCommitSha: "a".repeat(40) }),
      (error) => error?.code === "manifest-git-sha-mismatch",
    );
  } finally {
    removeFixture(root);
  }
});

test("implementation-preview mode is explicit and labels dirty worktrees", () => {
  const root = createFixtureRoot();
  try {
    writeFileSync(join(root, "src/dirty-preview.ts"), "export const dirtyPreview = true;\n", "utf8");
    assert.throws(
      () => buildArtifactManifest({ rootDir: root }),
      (error) => error?.code === "manifest-git-dirty",
    );
    const preview = buildArtifactManifest({ rootDir: root, implementationPreview: true });
    assert.equal(preview.buildMode, BUILD_MODES.implementationPreview);
    assert.equal(preview.worktreeState, WORKTREE_STATES.dirty);
    const manifest = JSON.parse(readFileSync(join(root, DEFAULT_MANIFEST_PATH), "utf8"));
    assert.equal(manifest.build_mode, BUILD_MODES.implementationPreview);
    assert.equal(manifest.worktree_state, WORKTREE_STATES.dirty);
    assert.equal(buildArtifactManifest({ rootDir: root, check: true, implementationPreview: true }).checked, true);
    execFileSync("git", ["-C", root, "add", "src/dirty-preview.ts"]);
    execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "clean-preview-source"]);
    assert.throws(
      () => buildArtifactManifest({ rootDir: root, check: true }),
      (error) => error?.code === "manifest-mismatch" || error?.code === "manifest-carrier-mismatch",
    );
  } finally {
    removeFixture(root);
  }
});

test("carrier normalization changes only the 64 ASCII zero digest and preserves BOM/CRLF", () => {
  const source = makeIndex({ lineEnding: "\r\n", bom: true });
  const carrier = readCarrier(source);
  assert.equal(carrier.artifactManifestSha256, "0".repeat(64));
  const normalized = normalizeCarrierForEntry(source);
  assert.equal(normalized, source);
  assert.equal(normalized.startsWith("\uFEFF"), true);
  assert.equal(normalized.includes("\r\n"), true);

  const withDigest = source.replace(
    `content="${"0".repeat(64)}"`,
    `content="${"a".repeat(64)}"`,
  );
  const expected = withDigest.replace(
    `content="${"a".repeat(64)}"`,
    `content="${"0".repeat(64)}"`,
  );
  assert.equal(normalizeCarrierForEntry(withDigest), expected);
});

test("CRLF/BOM index survives a complete build and check", () => {
  const root = createFixtureRoot({ lineEnding: "\r\n", bom: true });
  try {
    buildArtifactManifest({ rootDir: root });
    const index = readFileSync(join(root, "dist/index.html"), "utf8");
    assert.equal(index.startsWith("\uFEFF"), true);
    assert.equal(index.includes("\r\n"), true);
    assert.equal(buildArtifactManifest({ rootDir: root, check: true }).checked, true);
  } finally {
    removeFixture(root);
  }
});

test("check mode fails closed when the manifest or carrier changes", () => {
  const root = createFixtureRoot();
  try {
    buildArtifactManifest({ rootDir: root });
    const indexPath = join(root, "dist/index.html");
    const changedIndex = readFileSync(indexPath, "utf8").replace("<div id=\"root\"></div>", "<div id=\"changed\"></div>");
    writeFileSync(indexPath, changedIndex);
    assert.throws(
      () => buildArtifactManifest({ rootDir: root, check: true }),
      (error) => error?.code === "manifest-mismatch" || error?.code === "manifest-carrier-mismatch",
    );
  } finally {
    removeFixture(root);
  }
});

test("missing and duplicate carriers fail closed", () => {
  const root = createFixtureRoot();
  try {
    const indexPath = join(root, "dist/index.html");
    const source = readFileSync(indexPath, "utf8");
    writeFileSync(indexPath, source.replace(/<meta name="artifact-manifest-sha256"[^>]+>\r?\n?/u, ""));
    assert.throws(() => buildArtifactManifest({ rootDir: root }), (error) => error?.code === "manifest-carrier-meta-missing");
    writeFileSync(indexPath, `${source}\n<meta name="artifact-manifest-sha256" content="${"0".repeat(64)}" />\n`);
    assert.throws(() => buildArtifactManifest({ rootDir: root }), (error) => error?.code === "manifest-carrier-meta-duplicate");
  } finally {
    removeFixture(root);
  }
});

test("parent and output symlinks are rejected before publication", () => {
  const root = createFixtureRoot();
  try {
    mkdirSync(join(root, "outside"));
    symlinkSync(join(root, "outside"), join(root, "artifacts"));
    assert.throws(() => buildArtifactManifest({ rootDir: root }), (error) => error?.code === "manifest-path-symlink");
  } finally {
    removeFixture(root);
  }

  const rootWithOutputSymlink = createFixtureRoot();
  try {
    mkdirSync(join(rootWithOutputSymlink, "outside"));
    mkdirSync(join(rootWithOutputSymlink, "artifacts"));
    symlinkSync(join(rootWithOutputSymlink, "outside"), join(rootWithOutputSymlink, "artifacts/build"));
    assert.throws(
      () => buildArtifactManifest({ rootDir: rootWithOutputSymlink }),
      (error) => error?.code === "manifest-path-symlink",
    );
  } finally {
    removeFixture(rootWithOutputSymlink);
  }

  const rootWithManifestSymlink = createFixtureRoot();
  try {
    mkdirSync(join(rootWithManifestSymlink, "outside"));
    mkdirSync(join(rootWithManifestSymlink, "artifacts/build"), { recursive: true });
    writeFileSync(join(rootWithManifestSymlink, "outside/manifest.json"), "outside\n", "utf8");
    symlinkSync(
      join(rootWithManifestSymlink, "outside/manifest.json"),
      join(rootWithManifestSymlink, DEFAULT_MANIFEST_PATH),
    );
    assert.throws(
      () => buildArtifactManifest({ rootDir: rootWithManifestSymlink }),
      (error) => error?.code === "manifest-path-symlink",
    );
  } finally {
    removeFixture(rootWithManifestSymlink);
  }
});

test("failed second publish restores the previous index and manifest pair", () => {
  const root = createFixtureRoot();
  try {
    buildArtifactManifest({ rootDir: root });
    const indexPath = join(root, "dist/index.html");
    const manifestPath = join(root, DEFAULT_MANIFEST_PATH);
    const oldIndex = readFileSync(indexPath);
    const oldManifest = readFileSync(manifestPath);
    writeFileSync(join(root, "dist/assets/new.js"), "new\n", "utf8");
    let failedOnce = false;
    assert.throws(
      () => buildArtifactManifest({
        rootDir: root,
        filesystem: {
          rename(source, target) {
            if (!failedOnce && target === manifestPath) {
              failedOnce = true;
              const error = new Error("synthetic rename failure");
              error.code = "EIO";
              throw error;
            }
            return renameSync(source, target);
          },
        },
      }),
      (error) => error instanceof ArtifactManifestError && error.code === "manifest-atomic-publish-failed",
    );
    assert.deepEqual(readFileSync(indexPath), oldIndex);
    assert.deepEqual(readFileSync(manifestPath), oldManifest);
  } finally {
    removeFixture(root);
  }
});

test("backup rename failure preserves the existing pair", () => {
  const root = createFixtureRoot();
  try {
    buildArtifactManifest({ rootDir: root });
    const indexPath = join(root, "dist/index.html");
    const manifestPath = join(root, DEFAULT_MANIFEST_PATH);
    const oldIndex = readFileSync(indexPath);
    const oldManifest = readFileSync(manifestPath);
    let failedOnce = false;
    assert.throws(
      () => buildArtifactManifest({
        rootDir: root,
        filesystem: {
          rename(source, target) {
            if (!failedOnce && source === indexPath && target.includes("index-backup-")) {
              failedOnce = true;
              const error = new Error("synthetic backup rename failure");
              error.code = "EIO";
              throw error;
            }
            return renameSync(source, target);
          },
        },
      }),
      (error) => error instanceof ArtifactManifestError && error.code === "manifest-atomic-publish-failed",
    );
    assert.deepEqual(readFileSync(indexPath), oldIndex);
    assert.deepEqual(readFileSync(manifestPath), oldManifest);
  } finally {
    removeFixture(root);
  }
});

test("manifest backup rename failure restores the pair after index backup", () => {
  const root = createFixtureRoot();
  try {
    buildArtifactManifest({ rootDir: root });
    const indexPath = join(root, "dist/index.html");
    const manifestPath = join(root, DEFAULT_MANIFEST_PATH);
    const oldIndex = readFileSync(indexPath);
    const oldManifest = readFileSync(manifestPath);
    let indexBackupSucceeded = false;
    let manifestBackupFailed = false;
    assert.throws(
      () => buildArtifactManifest({
        rootDir: root,
        filesystem: {
          rename(source, target) {
            if (source === indexPath && target.includes("index-backup-")) {
              indexBackupSucceeded = true;
              return renameSync(source, target);
            }
            if (source === manifestPath && target.includes("manifest-backup-")) {
              manifestBackupFailed = true;
              const error = new Error("synthetic manifest backup rename failure");
              error.code = "EIO";
              throw error;
            }
            return renameSync(source, target);
          },
        },
      }),
      (error) => error instanceof ArtifactManifestError && error.code === "manifest-atomic-publish-failed",
    );
    assert.equal(indexBackupSucceeded, true);
    assert.equal(manifestBackupFailed, true);
    assert.deepEqual(readFileSync(indexPath), oldIndex);
    assert.deepEqual(readFileSync(manifestPath), oldManifest);
  } finally {
    removeFixture(root);
  }
});

test("preflight rejects dirty builds before dist can be changed", () => {
  const root = createFixtureRoot();
  try {
    const distIndexPath = join(root, "dist/index.html");
    const before = readFileSync(distIndexPath);
    writeFileSync(join(root, "src/dirty-before-vite.ts"), "export const dirty = true;\n", "utf8");
    assert.throws(
      () => checkBuildPreflight({ rootDir: root }),
      (error) => error?.code === "manifest-git-dirty",
    );
    assert.deepEqual(readFileSync(distIndexPath), before);
  } finally {
    removeFixture(root);
  }
});

test("preflight rejects an existing symlink in the output parent", () => {
  const root = createFixtureRoot();
  try {
    const outside = join(root, "outside");
    rmSync(join(root, "dist"), { recursive: true, force: true });
    mkdirSync(outside);
    symlinkSync(outside, join(root, "dist"));
    assert.throws(
      () => checkBuildPreflight({ rootDir: root }),
      (error) => error?.code === "manifest-path-symlink",
    );
  } finally {
    removeFixture(root);
  }
});

test("carrier input must be valid UTF-8 and byte round-trippable", () => {
  assert.equal(decodeUtf8Exact(Buffer.from([0xef, 0xbb, 0xbf, 0x41])), "\uFEFFA");
  assert.throws(
    () => decodeUtf8Exact(Buffer.from([0xc3, 0x28])),
    (error) => error?.code === "manifest-index-invalid-utf8",
  );
  assert.throws(
    () => readCarrier("\uD800<meta name=\"application-build-app-version\">") ,
    (error) => error?.code === "manifest-index-invalid-utf8",
  );
});

test("invalid dist index bytes fail before carrier publication", () => {
  const root = createFixtureRoot();
  try {
    const indexPath = join(root, "dist/index.html");
    const before = readFileSync(indexPath);
    writeFileSync(indexPath, Buffer.from([0xc3, 0x28]));
    assert.throws(
      () => buildArtifactManifest({ rootDir: root }),
      (error) => error?.code === "manifest-index-invalid-utf8",
    );
    assert.deepEqual(readFileSync(indexPath), Buffer.from([0xc3, 0x28]));
    assert.notDeepEqual(readFileSync(indexPath), before);
  } finally {
    removeFixture(root);
  }
});
