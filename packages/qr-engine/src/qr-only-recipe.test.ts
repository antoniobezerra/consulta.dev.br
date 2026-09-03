import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const recipeDirectory = resolve(import.meta.dirname, "..", "qr-only");
const manifest = JSON.parse(readFileSync(resolve(recipeDirectory, "manifest.json"), "utf8")) as {
  zxing_cpp: { commit: string };
  baseline: { package: string; version: string; zxing_cpp_commit: string };
  emscripten: { image: string; tag: string; platform: string };
  build: { formats: string[]; writers: boolean; maximum_wasm_bytes: number; minimum_size_reduction: number };
};
const cmake = readFileSync(resolve(recipeDirectory, "CMakeLists.txt"), "utf8");
const wrapper = readFileSync(resolve(recipeDirectory, "qr_reader.cpp"), "utf8");
const dockerfile = readFileSync(resolve(recipeDirectory, "Dockerfile"), "utf8");
const buildScript = readFileSync(resolve(recipeDirectory, "..", "scripts", "build-qr-only.mjs"), "utf8");

describe("QR-only build recipe", () => {
  it("pins the compiler and source commit instead of depending on moving tags", () => {
    expect(manifest.zxing_cpp).not.toHaveProperty("tag");
    expect(manifest.zxing_cpp.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.baseline).toEqual({
      package: "zxing-wasm",
      version: "3.1.3",
      zxing_cpp_commit: "a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f",
    });
    expect(manifest.zxing_cpp.commit).toBe(manifest.baseline.zxing_cpp_commit);
    expect(manifest.emscripten).toEqual({
      image: "emscripten/emsdk@sha256:ef91f658e0104636cf40a702c99169273969cf04d939f4f08e5d0223965d5788",
      tag: "5.0.4",
      platform: "linux/amd64",
    });
    expect(dockerfile).toContain(manifest.zxing_cpp.commit);
    expect(dockerfile).toContain(manifest.emscripten.image);
  });

  it("has no generic barcode readers, writer or file decoder in its selected source", () => {
    expect(manifest.build.formats).toEqual(["QRCode"]);
    expect(manifest.build.writers).toBe(false);
    expect(cmake).toContain("set(ZXING_WRITERS OFF");
    expect(cmake).toContain("set(ZXING_ENABLE_QRCODE ON");
    for (const disabledFormat of ["1D", "AZTEC", "DATAMATRIX", "MAXICODE", "PDF417"]) {
      expect(cmake).toContain(`set(ZXING_ENABLE_${disabledFormat} OFF`);
    }
    expect(wrapper).toContain("BarcodeFormat::QRCode");
    expect(wrapper).toContain('"QRCode"');
    expect(wrapper).not.toContain("stb_image");
    expect(wrapper).not.toContain("readBarcodesFromImage");
  });

  it("keeps the promotion budget explicit", () => {
    expect(manifest.build.maximum_wasm_bytes).toBe(716800);
    expect(manifest.build.minimum_size_reduction).toBe(0.3);
  });

  it("exports only the reader artifacts instead of the Emscripten toolchain", () => {
    expect(dockerfile).toContain("FROM scratch");
    expect(dockerfile).toContain("COPY --from=build /out/ /");
  });

  it("supports a cacheless second build for the CI reproducibility gate", () => {
    expect(buildScript).toContain("QR_ONLY_BUILD_NO_CACHE");
    expect(buildScript).toContain('"--no-cache"');
  });
});
