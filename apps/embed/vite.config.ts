import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    // Development-only benchmark pages must never be emitted by the hosted
    // embed build. The QR benchmark starts its own ephemeral Vite server.
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
});
