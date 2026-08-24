import { accessSync, constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildArtifactManifest } from "./build-manifest.mjs";

export const PREVIEW_PORT = 4173;
export const VITE_BIN_RELATIVE_PATH = "node_modules/.bin/vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const IPv4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

function parseIPv4(value) {
  if (typeof value !== "string" || !IPv4_PATTERN.test(value)) {
    return null;
  }

  const octets = value.split(".").map((octet) => Number(octet));
  if (
    octets.length !== 4 ||
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== value.split(".")[index],
    )
  ) {
    return null;
  }

  return octets;
}

export function isAllowedLanIPv4(value) {
  const octets = parseIPv4(value);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

export function listLocalLanIPv4(interfaces = networkInterfaces()) {
  const addresses = new Set();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (
        entry.family === "IPv4" &&
        entry.internal === false &&
        isAllowedLanIPv4(entry.address)
      ) {
        addresses.add(entry.address);
      }
    }
  }

  return [...addresses].sort();
}

export function isVerifiedLocalLanIPv4(address, interfaces = networkInterfaces()) {
  return listLocalLanIPv4(interfaces).includes(address);
}

export function parseLanArguments(argumentsList) {
  if (!Array.isArray(argumentsList) || argumentsList.length !== 1) {
    return {
      ok: false,
      error: "必须只提供一个受控 LAN IPv4 地址",
    };
  }

  const [address] = argumentsList;
  if (!isAllowedLanIPv4(address)) {
    return {
      ok: false,
      error: "地址必须是 RFC1918 或链路本地 IPv4",
    };
  }

  return { ok: true, address };
}

export function buildPreviewInvocation(address, root = projectRoot) {
  if (!isAllowedLanIPv4(address)) {
    throw new Error("地址必须是 RFC1918 或链路本地 IPv4");
  }

  return {
    command: resolve(root, VITE_BIN_RELATIVE_PATH),
    args: [
      "preview",
      "--host",
      address,
      "--port",
      String(PREVIEW_PORT),
      "--strictPort",
    ],
    cwd: root,
  };
}

function run() {
  const parsed = parseLanArguments(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  if (!isVerifiedLocalLanIPv4(parsed.address)) {
    console.error("地址不是当前设备已验证的 LAN IPv4");
    process.exitCode = 1;
    return;
  }

  try {
    buildArtifactManifest({ check: true });
  } catch {
    console.error("artifact manifest 校验失败；禁止启动 LAN 预览");
    process.exitCode = 1;
    return;
  }

  const invocation = buildPreviewInvocation(parsed.address);
  try {
    accessSync(invocation.command, fsConstants.X_OK);
  } catch {
    console.error("本地 Vite 可执行文件不可用；请先完成锁定版本的依赖安装");
    process.exitCode = 1;
    return;
  }

  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    shell: false,
    stdio: "inherit",
  });

  child.once("error", () => {
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode =
      typeof code === "number" ? code : signal === null ? 1 : 1;
  });
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  run();
}
