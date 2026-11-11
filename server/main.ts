import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

import { createApp } from "./app";

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'sha256-HR6/MuuYfB8aijiNP5MPm3YOR8WqVmL7UkE3Q8OslTs='",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const FILE_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

loadEnvFile(".env");

const port = 4174;
const hostname = process.env.ZHIGUAN_BIND_HOST || "127.0.0.1";
const app = createApp({
  env: process.env,
  log: (category) => {
    console.error(category);
  },
});
const distRoot = resolve("dist");

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `${hostname}:${port}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      await serveStatic(url.pathname, res);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  }
});

server.listen(port, hostname, () => {
  console.log(`Local Zhiguan: http://127.0.0.1:${port} (Ctrl-C to stop)`);
});

async function serveStatic(pathname: string, res: import("node:http").ServerResponse): Promise<void> {
  const allowed = pathname === "/" || pathname === "/index.html" || pathname.startsWith("/assets/");
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
  const target = resolve(distRoot, relative);
  const type = FILE_TYPES[extname(target)];
  if (!allowed || !type || (!target.startsWith(`${distRoot}${sep}`) && target !== distRoot)) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not-file");
    const data = await readFile(target);
    res.statusCode = 200;
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
    res.setHeader("content-type", type);
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  }
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
