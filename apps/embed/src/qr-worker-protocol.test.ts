import { describe, expect, it } from "vitest";
import {
  QR_WORKER_PROTOCOL_VERSION,
  isQrWorkerRequest,
  isQrWorkerResponse,
} from "./qr-worker-protocol.js";

describe("QR Worker protocol", () => {
  it("accepts only a bounded RGBA scan request", () => {
    expect(isQrWorkerRequest({
      type: "scan",
      version: QR_WORKER_PROTOCOL_VERSION,
      id: 1,
      width: 2,
      height: 1,
      pixels: new ArrayBuffer(8),
    })).toBe(true);
    expect(isQrWorkerRequest({
      type: "scan",
      version: QR_WORKER_PROTOCOL_VERSION,
      id: 1,
      width: 2,
      height: 1,
      pixels: new ArrayBuffer(4),
    })).toBe(false);
  });

  it("requires paired candidate asset URLs and stable responses", () => {
    expect(isQrWorkerRequest({
      type: "configure",
      version: QR_WORKER_PROTOCOL_VERSION,
      configuration: { baselineWasmUrl: "https://embed.example/zxing_reader.wasm", qrOnlyModuleUrl: "https://cdn.example/reader.js" },
    })).toBe(false);
    expect(isQrWorkerResponse({
      type: "result",
      version: QR_WORKER_PROTOCOL_VERSION,
      id: 2,
      payload: new ArrayBuffer(3),
    })).toBe(true);
    expect(isQrWorkerResponse({
      type: "error",
      version: QR_WORKER_PROTOCOL_VERSION,
      id: 2,
      code: "DOCUMENT_BYTES",
    })).toBe(false);
  });
});
