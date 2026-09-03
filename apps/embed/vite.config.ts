import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // The hosted shell lives below an immutable version path such as
  // /embed/v1.2.3/. Relative URLs keep every emitted Worker, PDF worker and
  // stylesheet inside that release instead of resolving at the CDN origin.
  base: "./",
  build: {
    emptyOutDir: true,
    // Development-only benchmark pages must never be emitted by the hosted
    // embed build. The QR benchmark starts its own ephemeral Vite server.
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
      output: {
        // The release shell references these two entry assets directly. Their
        // enclosing version directory is immutable, so stable names do not
        // weaken cache safety and avoid a second runtime manifest lookup.
        entryFileNames: "assets/consulta-embed.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) => asset.name?.endsWith(".css")
          ? "assets/consulta-embed.css"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
});
