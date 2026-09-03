import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("rejects missing or incompatible peers while resolving scoped, nested and optional peers", () => {
  const root = mkdtempSync(join(tmpdir(), "zhiguan-peers-"));
  const script = fileURLToPath(new URL("../scripts/check-dependencies.mjs", import.meta.url));
  const writePackage = (path: string, pkg: object) => {
    const manifest = join(root, "node_modules", path, "package.json");
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, JSON.stringify(pkg));
  };
  const check = () => spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", timeout: 5000 });

  try {
    expect(check().status).not.toBe(0);
    writePackage("@fixture/consumer", {
      name: "@fixture/consumer", version: "1.0.0",
      peerDependencies: { "peer-target": "^2.0.0", "optional-target": "^1.0.0" },
      peerDependenciesMeta: { "optional-target": { optional: true } },
    });
    writePackage("peer-target", { name: "peer-target", version: "1.0.0" });
    expect(check().stderr).toContain("requires peer peer-target@^2.0.0; found 1.0.0");
    expect(check().status).not.toBe(0);

    writePackage("@fixture/consumer/node_modules/peer-target", { name: "peer-target", version: "2.1.0" });
    expect(check().status).toBe(0);
    writePackage("optional-target", { name: "optional-target", version: "2.0.0" });
    expect(check().stderr).toContain("requires peer optional-target@^1.0.0; found 2.0.0");
    expect(check().status).not.toBe(0);
    rmSync(join(root, "node_modules/optional-target"), { recursive: true });

    rmSync(join(root, "node_modules/@fixture/consumer/node_modules"), { recursive: true });
    rmSync(join(root, "node_modules/peer-target"), { recursive: true });
    expect(check().stderr).toContain("requires peer peer-target@^2.0.0; found missing");
    expect(check().status).not.toBe(0);
    writePackage("peer-target", { name: "peer-target", version: "2.0.0" });
    expect(check().status).toBe(0);
    writeFileSync(join(root, "node_modules/peer-target/package.json"), "{");
    expect(check().status).not.toBe(0);
    for (const malformed of [{}, [], { name: "peer-target", version: "2.0.0", peerDependencies: [] }]) {
      writePackage("peer-target", malformed);
      expect(check().status).not.toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
