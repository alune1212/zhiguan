import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** Local preview permits only the same-origin, explicitly invoked assistance API. */
export const PREVIEW_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:4174", changeOrigin: false } },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    headers: PREVIEW_HEADERS,
    proxy: { "/api": { target: "http://127.0.0.1:4174", changeOrigin: false } },
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
