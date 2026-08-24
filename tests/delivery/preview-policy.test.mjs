import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  PREVIEW_PORT,
  buildPreviewInvocation,
  isAllowedLanIPv4,
  isVerifiedLocalLanIPv4,
  listLocalLanIPv4,
  parseLanArguments,
} from "../../scripts/preview-lan.mjs";
import {
  PreviewArtifactGateError,
  createArtifactPreviewPlugin,
} from "../../scripts/preview-gate.mjs";

const projectRoot = new URL("../../", import.meta.url);

test("default Vite preview is loopback-only, strict-port, and non-cacheable", async () => {
  const config = await readFile(new URL("../../vite.config.ts", import.meta.url), "utf8");

  assert.match(config, /host:\s*["']127\.0\.0\.1["']/u);
  assert.match(config, /port:\s*4173/u);
  assert.match(config, /strictPort:\s*true/u);
  assert.match(config, /sourcemap:\s*false/u);
  assert.match(config, /outDir:\s*["']dist["']/u);
  assert.match(config, /["']Cache-Control["']:\s*["']no-store["']/u);
  assert.match(config, /["']X-Content-Type-Options["']:\s*["']nosniff["']/u);
  assert.match(config, /["']Referrer-Policy["']:\s*["']no-referrer["']/u);

  for (const directive of [
    "default-src 'self'",
    "connect-src 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.match(config, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("LAN adapter accepts only a single RFC1918 or link-local IPv4", () => {
  for (const address of ["10.24.0.8", "172.20.1.3", "192.168.2.16", "169.254.10.4"]) {
    assert.equal(isAllowedLanIPv4(address), true, address);
    assert.deepEqual(parseLanArguments([address]), { ok: true, address });
  }

  for (const argumentsList of [
    [],
    ["192.168.1.10", "--strictPort"],
    ["127.0.0.1"],
    ["0.0.0.0"],
    ["8.8.8.8"],
    ["localhost"],
    ["192.168.1.999"],
    ["192.168.001.10"],
  ]) {
    assert.equal(parseLanArguments(argumentsList).ok, false, String(argumentsList));
  }
});

test("LAN adapter invokes only the local locked Vite binary", () => {
  const invocation = buildPreviewInvocation("192.168.2.16", new URL(projectRoot).pathname);

  assert.match(invocation.command, /node_modules[\\/]\.bin[\\/]vite$/u);
  assert.deepEqual(invocation.args, [
    "preview",
    "--host",
    "192.168.2.16",
    "--port",
    String(PREVIEW_PORT),
    "--strictPort",
  ]);
  assert.equal(invocation.cwd, new URL(projectRoot).pathname);
});

test("LAN adapter verifies that the address belongs to a current local interface", () => {
  const interfaces = {
    en0: [
      { address: "192.168.2.16", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    utun0: [{ address: "100.64.0.1", family: "IPv4", internal: false }],
    empty: undefined,
  };

  assert.deepEqual(listLocalLanIPv4(interfaces), ["192.168.2.16"]);
  assert.equal(isVerifiedLocalLanIPv4("192.168.2.16", interfaces), true);
  assert.equal(isVerifiedLocalLanIPv4("192.168.2.17", interfaces), false);
  assert.equal(isVerifiedLocalLanIPv4("127.0.0.1", interfaces), false);
});

test("runtime sources do not declare external requests or browser persistence", async () => {
  const paths = [
    "../../index.html",
    "../../src/main.tsx",
    "../../src/app/App.tsx",
    "../../src/styles/app.css",
  ];
  const source = (await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join(
    "\n",
  );

  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "serviceWorker",
    "http://",
    "https://",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("production startup reads fixed build metadata while dev preview stays explicitly unverified", async () => {
  const main = await readFile(new URL("../../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /import\.meta\.env\.PROD/u);
  assert.match(main, /getBuildIdentityGate\(\)/u);
  assert.match(main, /Development-server preview/u);
});

test("direct Vite preview is guarded at configurePreviewServer startup", async () => {
  const config = await readFile(new URL("../../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /createArtifactPreviewPlugin\(\)/u);
  const plugin = createArtifactPreviewPlugin();
  assert.equal(plugin.name, "zhiguan-artifact-preview-gate");
  assert.throws(
    () => plugin.configurePreviewServer({ config: { root: "/private/tmp/zhiguan-no-artifact-root" } }),
    (error) => error instanceof PreviewArtifactGateError && error.code === "artifact-preview-gate-failed",
  );
});

test("build lifecycle runs clean-worktree preflight before Vite", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.match(packageJson.scripts.prebuild, /node scripts\/build-manifest\.mjs --preflight/u);
  assert.match(
    packageJson.scripts.build,
    /^node scripts\/build-manifest\.mjs --preflight && vite build/u,
  );
});
