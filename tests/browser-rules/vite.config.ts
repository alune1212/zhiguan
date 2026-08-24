import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Test-only loopback server. HMR is disabled so the offline rule run has no background socket. */
export default defineConfig({
  root: REPO_ROOT,
  appType: "mpa",
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    hmr: false,
  },
});
