import { describe, expect, it } from "vitest";
import { ConsultaQrOnlyEngine, FallbackQrEngine, type QrEngine } from "./index.js";

function rgba(): ImageData {
  return { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) } as ImageData;
}

describe("experimental QR-only engine", () => {
  it("copies QR bytes and wipes the temporary WASM input allocation", async () => {
    const memory = new Uint8Array(64);
    let freed = 0;
    const engine = new ConsultaQrOnlyEngine({
      wasmUrl: "https://embed.example/consulta_qr_reader.wasm",
      moduleFactory: async () => ({
        HEAPU8: memory,
        _malloc: () => 8,
        _free: (pointer) => { freed = pointer; },
        readQrCodeFromPixmap: (pointer, width, height) => {
          expect(Array.from(memory.slice(pointer, pointer + 4))).toEqual([1, 2, 3, 255]);
          expect([width, height]).toEqual([1, 1]);
          return { format: "QRCode", bytes: new Uint8Array([9, 8, 7]) };
        },
      }),
    });

    expect(Array.from((await engine.scan(rgba())) || [])).toEqual([9, 8, 7]);
    await expect(engine.memoryCapacityBytes()).resolves.toBe(64);
    expect(Array.from(memory.slice(8, 12))).toEqual([0, 0, 0, 0]);
    expect(freed).toBe(8);
    engine.dispose();
  });

  it("does not surface non-QR result bytes", async () => {
    const engine = new ConsultaQrOnlyEngine({
      wasmUrl: "https://embed.example/consulta_qr_reader.wasm",
      moduleFactory: async () => ({
        HEAPU8: new Uint8Array(64),
        _malloc: () => 1,
        _free: () => {},
        readQrCodeFromPixmap: () => ({ format: "DataMatrix", bytes: new Uint8Array([1]) }),
      }),
    });

    await expect(engine.scan(rgba())).resolves.toBeNull();
    engine.dispose();
  });

  it("uses the baseline only when the candidate cannot prepare", async () => {
    const calls: string[] = [];
    const candidate: QrEngine = {
      prepare: async () => { calls.push("candidate.prepare"); throw new Error("candidate unavailable"); },
      scan: async () => { calls.push("candidate.scan"); return null; },
      dispose: () => { calls.push("candidate.dispose"); },
    };
    const baseline: QrEngine = {
      prepare: async () => { calls.push("baseline.prepare"); },
      scan: async () => { calls.push("baseline.scan"); return new Uint8Array([42]); },
      dispose: () => { calls.push("baseline.dispose"); },
    };
    const engine = new FallbackQrEngine({ primary: candidate, fallback: baseline });

    expect(Array.from((await engine.scan(rgba())) || [])).toEqual([42]);
    expect(calls).toEqual(["candidate.prepare", "candidate.dispose", "baseline.prepare", "baseline.scan"]);
    engine.dispose();
    expect(calls).toContain("baseline.dispose");
  });
});
