import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** Keep the static preview local, uncached, and unable to send session data. */
export const PREVIEW_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export default defineConfig({
  base: "./",
  plugins: [react()],
  preview: {
    host: "127.0.0.1",
    port: 4173,
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
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
  },
});
