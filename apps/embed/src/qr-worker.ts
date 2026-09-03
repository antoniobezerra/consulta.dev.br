import { ConsultaQrOnlyEngine, FallbackQrEngine, ZXingWasmQrEngine, type QrEngine } from "@consulta-dev/qr-engine";
import {
  QR_WORKER_PROTOCOL_VERSION,
  isQrWorkerRequest,
  type QrWorkerConfiguration,
  type QrWorkerResponse,
} from "./qr-worker-protocol.js";

type WorkerScope = {
  location: { href: string };
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: QrWorkerResponse, transfer?: Transferable[]) => void;
  close: () => void;
};

const worker = globalThis as unknown as WorkerScope;
let engine: QrEngine | null = null;
let scanning = false;

function localHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

function trustedAssetUrl(value: string): string {
  const url = new URL(value, worker.location.href);
  if ((!localHttp(url) && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Invalid QR asset URL");
  }
  return url.toString();
}

function createEngine(configuration: QrWorkerConfiguration): QrEngine {
  const baseline = new ZXingWasmQrEngine({ wasmUrl: trustedAssetUrl(configuration.baselineWasmUrl) });
  if (!configuration.qrOnlyModuleUrl || !configuration.qrOnlyWasmUrl) return baseline;
  return new FallbackQrEngine({
    primary: new ConsultaQrOnlyEngine({
      moduleUrl: trustedAssetUrl(configuration.qrOnlyModuleUrl),
      wasmUrl: trustedAssetUrl(configuration.qrOnlyWasmUrl),
    }),
    fallback: baseline,
  });
}

function post(message: QrWorkerResponse, transfer?: Transferable[]): void {
  worker.postMessage(message, transfer);
}

function wipeUnknownPixels(value: unknown): void {
  if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0);
}

async function scan(id: number, width: number, height: number, pixelsBuffer: ArrayBuffer): Promise<void> {
  if (!engine) {
    wipeUnknownPixels(pixelsBuffer);
    post({ type: "error", version: QR_WORKER_PROTOCOL_VERSION, id, code: "NOT_READY" });
    return;
  }
  if (scanning) {
    wipeUnknownPixels(pixelsBuffer);
    post({ type: "error", version: QR_WORKER_PROTOCOL_VERSION, id, code: "BUSY" });
    return;
  }

  scanning = true;
  const pixels = new Uint8ClampedArray(pixelsBuffer);
  let result: Uint8Array | null = null;
  let output: Uint8Array | null = null;
  try {
    result = await engine.scan({ data: pixels, width, height } as ImageData);
    if (!result) {
      post({ type: "result", version: QR_WORKER_PROTOCOL_VERSION, id, payload: null });
      return;
    }
    output = new Uint8Array(result.byteLength);
    output.set(result);
    result.fill(0);
    result = null;
    const payload = output.buffer;
    if (!(payload instanceof ArrayBuffer)) throw new Error("Invalid QR payload buffer");
    post({ type: "result", version: QR_WORKER_PROTOCOL_VERSION, id, payload }, [payload]);
    output = null;
  } catch {
    result?.fill(0);
    output?.fill(0);
    post({ type: "error", version: QR_WORKER_PROTOCOL_VERSION, id, code: "SCAN_FAILED" });
  } finally {
    pixels.fill(0);
    scanning = false;
  }
}

worker.onmessage = (event) => {
  const message = event.data;
  if (!isQrWorkerRequest(message)) {
    if (message && typeof message === "object") wipeUnknownPixels((message as { pixels?: unknown }).pixels);
    post({ type: "error", version: QR_WORKER_PROTOCOL_VERSION, code: "CONFIGURATION_FAILED" });
    return;
  }
  if (message.type === "configure") {
    if (engine) {
      post({ type: "error", version: QR_WORKER_PROTOCOL_VERSION, code: "CONFIGURATION_FAILED" });
      return;
    }
    try {
      engine = createEngine(message.configuration);
      post({ type: "ready", version: QR_WORKER_PROTOCOL_VERSION });
    } catch {
      engine?.dispose();
      engine = null;
      post({ type: "error", version: QR_WORKER_PROTOCOL_VERSION, code: "CONFIGURATION_FAILED" });
    }
    return;
  }
  if (message.type === "dispose") {
    engine?.dispose();
    engine = null;
    worker.close();
    return;
  }
  void scan(message.id, message.width, message.height, message.pixels);
};
