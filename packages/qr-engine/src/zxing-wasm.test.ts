import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  prepareZXingModule as prepareWriter,
  purgeZXingModule as purgeWriter,
  writeBarcode,
} from "zxing-wasm/writer";
import { ZXingWasmQrEngine } from "./index.js";

const require = createRequire(import.meta.url);

function wasmBinary(subpath: string): ArrayBuffer {
  const source = readFileSync(require.resolve(subpath));
  return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
}

describe("ZXing WASM QR baseline", () => {
  it("round-trips raw QR bytes with the reader constrained to QRCode", async () => {
    const expected = new TextEncoder().encode("consulta-autofill-synthetic-qr-v1");
    await prepareWriter({
      overrides: { wasmBinary: wasmBinary("zxing-wasm/writer/zxing_writer.wasm") },
      fireImmediately: true,
    });
    const written = await writeBarcode(expected, { format: "QRCode", scale: 4 });
    expect(written.image).not.toBeNull();

    const engine = new ZXingWasmQrEngine({
      wasmBinary: wasmBinary("zxing-wasm/reader/zxing_reader.wasm"),
    });
    try {
      const result = await engine.scan(written.image as Blob);
      expect(result).not.toBeNull();
      expect(Array.from(result || [])).toEqual(Array.from(expected));
    } finally {
      engine.dispose();
      purgeWriter();
      expected.fill(0);
    }
  });
});
