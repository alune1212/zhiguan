import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

function readPackage(path) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(pkg) || typeof pkg.name !== "string" || !pkg.name || typeof pkg.version !== "string" || !pkg.version) {
    throw new Error(`Invalid package manifest: ${path}`);
  }
  for (const field of ["peerDependencies", "peerDependenciesMeta"]) {
    if (field in pkg && !isObject(pkg[field])) throw new Error(`Invalid ${field}: ${path}`);
  }
  if (Object.values(pkg.peerDependencies ?? {}).some((range) => typeof range !== "string")) {
    throw new Error(`Invalid peer dependency range: ${path}`);
  }
  for (const meta of Object.values(pkg.peerDependenciesMeta ?? {})) {
    if (!isObject(meta) || ("optional" in meta && typeof meta.optional !== "boolean")) {
      throw new Error(`Invalid peer dependency metadata: ${path}`);
    }
  }
  return pkg;
}

function peerPackage(manifest, name) {
  for (const directory of createRequire(manifest).resolve.paths(name) ?? []) {
    try {
      return readPackage(join(directory, name, "package.json"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

// Preserve strict peer validation when installing with Bun.
// The project uses Bun's hoisted linker, including scoped and nested packages.
const directories = [resolve("node_modules")];
const seen = new Set();
let packages = 0;

while (directories.length) {
  const directory = directories.pop();
  const realDirectory = realpathSync(directory);
  if (seen.has(realDirectory)) continue;
  seen.add(realDirectory);

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith("@")) {
      directories.push(path);
      continue;
    }

    const manifest = join(path, "package.json");
    const pkg = readPackage(manifest);
    packages++;
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      const peer = peerPackage(manifest, name);
      if (!peer && pkg.peerDependenciesMeta?.[name]?.optional) continue;
      if (!peer || !Bun.semver.satisfies(peer.version, range)) {
        throw new Error(`${pkg.name}@${pkg.version} requires peer ${name}@${range}; found ${peer?.version ?? "missing"}`);
      }
    }

    try {
      const nested = join(path, "node_modules");
      realpathSync(nested);
      directories.push(nested);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

console.log(`Checked peer dependencies for ${packages} installed packages.`);
