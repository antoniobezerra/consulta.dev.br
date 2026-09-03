import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const recipeDirectory = resolve(import.meta.dirname, "..", "qr-only");
const manifest = JSON.parse(readFileSync(resolve(recipeDirectory, "manifest.json"), "utf8")) as {
  zxing_cpp: { commit: string; tag: string };
  emscripten: { image: string; platform: string };
  build: { formats: string[]; writers: boolean; maximum_wasm_bytes: number; minimum_size_reduction: number };
};
const cmake = readFileSync(resolve(recipeDirectory, "CMakeLists.txt"), "utf8");
const wrapper = readFileSync(resolve(recipeDirectory, "qr_reader.cpp"), "utf8");
const dockerfile = readFileSync(resolve(recipeDirectory, "Dockerfile"), "utf8");

describe("QR-only build recipe", () => {
  it("pins the compiler and source commit instead of depending on moving tags", () => {
    expect(manifest.zxing_cpp.tag).toBe("v3.1.1");
    expect(manifest.zxing_cpp.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.emscripten.image).toMatch(/^emscripten\/emsdk@sha256:[0-9a-f]{64}$/);
    expect(manifest.emscripten.platform).toBe("linux/amd64");
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
});
