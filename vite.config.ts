import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { createArtifactPreviewPlugin } from "./scripts/preview-gate.mjs";

/**
 * These headers are part of the research prototype's delivery boundary.  The
 * preview server must not cache a session page or permit browser-side
 * external connections, form posts, object loads, or embedding.
 */
export const PREVIEW_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "font-src 'self'",
    "img-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
  ].join("; "),
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export default defineConfig({
  base: "./",
  plugins: [react(), createArtifactPreviewPlugin()],
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: PREVIEW_HEADERS,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    emptyOutDir: true,
    cssCodeSplit: true,
    reportCompressedSize: false,
  },
  test: {
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
  },
});
