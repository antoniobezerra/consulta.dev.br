export const QR_WORKER_PROTOCOL_VERSION = 1;
export const MAX_QR_PIXELS = 4_194_304;

export type QrWorkerConfiguration = {
  baselineWasmUrl: string;
  qrOnlyModuleUrl?: string;
  qrOnlyWasmUrl?: string;
};

export type QrWorkerRequest =
  | { type: "configure"; version: number; configuration: QrWorkerConfiguration }
  | { type: "scan"; version: number; id: number; width: number; height: number; pixels: ArrayBuffer }
  | { type: "dispose"; version: number };

export type QrWorkerErrorCode = "CONFIGURATION_FAILED" | "NOT_READY" | "BUSY" | "SCAN_FAILED";

export type QrWorkerResponse =
  | { type: "ready"; version: number }
  | { type: "result"; version: number; id: number; payload: ArrayBuffer | null }
  | { type: "error"; version: number; id?: number; code: QrWorkerErrorCode };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validDimensions(value: Record<string, unknown>): value is Record<string, unknown> & { width: number; height: number } {
  const { width, height } = value;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return false;
  }
  return width * height <= MAX_QR_PIXELS;
}

export function isQrWorkerConfiguration(value: unknown): value is QrWorkerConfiguration {
  if (!record(value) || typeof value.baselineWasmUrl !== "string" || !value.baselineWasmUrl) return false;
  const moduleUrl = value.qrOnlyModuleUrl;
  const wasmUrl = value.qrOnlyWasmUrl;
  if (moduleUrl === undefined && wasmUrl === undefined) return true;
  return typeof moduleUrl === "string" && Boolean(moduleUrl) && typeof wasmUrl === "string" && Boolean(wasmUrl);
}

export function isQrWorkerRequest(value: unknown): value is QrWorkerRequest {
  if (!record(value) || value.version !== QR_WORKER_PROTOCOL_VERSION || typeof value.type !== "string") return false;
  if (value.type === "configure") return isQrWorkerConfiguration(value.configuration);
  if (value.type === "dispose") return true;
  return value.type === "scan" && validId(value.id) && validDimensions(value) && value.pixels instanceof ArrayBuffer && value.pixels.byteLength === value.width * value.height * 4;
}

export function isQrWorkerResponse(value: unknown): value is QrWorkerResponse {
  if (!record(value) || value.version !== QR_WORKER_PROTOCOL_VERSION || typeof value.type !== "string") return false;
  if (value.type === "ready") return true;
  if (value.type === "result") return validId(value.id) && (value.payload === null || value.payload instanceof ArrayBuffer);
  return value.type === "error" && (value.id === undefined || validId(value.id)) && (
    value.code === "CONFIGURATION_FAILED" ||
    value.code === "NOT_READY" ||
    value.code === "BUSY" ||
    value.code === "SCAN_FAILED"
  );
}
