import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: resolve(import.meta.dirname, "tsconfig.build.json"),
    }),
  ],
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        protocol: resolve(import.meta.dirname, "src/protocol.ts"),
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : format}`,
    },
    sourcemap: true,
  },
});
