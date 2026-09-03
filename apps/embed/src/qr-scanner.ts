import { ConsultaQrOnlyEngine, FallbackQrEngine, ZXingWasmQrEngine, type QrEngine } from "@consulta-dev/qr-engine";
import {
  MAX_QR_PIXELS,
  QR_WORKER_PROTOCOL_VERSION,
  isQrWorkerResponse,
  type QrWorkerConfiguration,
  type QrWorkerErrorCode,
} from "./qr-worker-protocol.js";

export type EmbedQrScannerOptions = QrWorkerConfiguration;

type PendingScan = {
  resolve: (value: Uint8Array | null) => void;
  reject: (reason: Error) => void;
};

function mainThreadEngine(options: EmbedQrScannerOptions): QrEngine {
  const baseline = new ZXingWasmQrEngine({ wasmUrl: options.baselineWasmUrl });
  if (!options.qrOnlyModuleUrl || !options.qrOnlyWasmUrl) return baseline;
  return new FallbackQrEngine({
    primary: new ConsultaQrOnlyEngine({ moduleUrl: options.qrOnlyModuleUrl, wasmUrl: options.qrOnlyWasmUrl }),
    fallback: baseline,
  });
}

function workerError(code: QrWorkerErrorCode): Error {
  return new Error(`O Worker QR não conseguiu concluir a leitura (${code}).`);
}

class QrWorkerClient {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: Error) => void;
  private readyResolved = false;
  private disposed = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingScan>();

  constructor(configuration: EmbedQrScannerOptions) {
    this.worker = new Worker(new URL("./qr-worker.ts", import.meta.url), { type: "module", name: "consulta-autofill-qr" });
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A close before the first scan is normal. Keep that rejection observed
    // while preserving the original promise for prepare().
    void this.ready.catch(() => {});
    this.worker.addEventListener("message", this.receive);
    this.worker.addEventListener("error", this.fail);
    try {
      this.worker.postMessage({ type: "configure", version: QR_WORKER_PROTOCOL_VERSION, configuration });
    } catch (cause) {
      this.worker.removeEventListener("message", this.receive);
      this.worker.removeEventListener("error", this.fail);
      this.worker.terminate();
      throw cause;
    }
  }

  async prepare(): Promise<void> {
    if (this.disposed) throw new Error("O Worker QR já foi descartado.");
    await this.ready;
  }

  async scan(image: ImageData): Promise<Uint8Array | null> {
    await this.prepare();
    if (this.disposed) throw new Error("O Worker QR já foi descartado.");
    const { data, width, height } = image;
    const pixels = width * height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || pixels > MAX_QR_PIXELS || data.byteLength !== pixels * 4) {
      throw new Error("A imagem fornecida ao Worker QR é inválida ou grande demais.");
    }

    let buffer: ArrayBuffer;
    if (data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
      buffer = data.buffer;
    } else {
      const copy = new Uint8ClampedArray(data);
      if (data.byteLength) data.fill(0);
      buffer = copy.buffer;
    }
    const id = this.nextId++;
    return new Promise<Uint8Array | null>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ type: "scan", version: QR_WORKER_PROTOCOL_VERSION, id, width, height, pixels: buffer }, [buffer]);
      } catch (cause) {
        this.pending.delete(id);
        if (buffer.byteLength) new Uint8Array(buffer).fill(0);
        reject(cause instanceof Error ? cause : new Error("Não foi possível transferir a imagem ao Worker QR."));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error("O Worker QR foi descartado.");
    if (!this.readyResolved) this.rejectReady(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    try {
      this.worker.postMessage({ type: "dispose", version: QR_WORKER_PROTOCOL_VERSION });
    } catch {
      // Worker termination below still releases its memory and transferred input.
    }
    this.worker.removeEventListener("message", this.receive);
    this.worker.removeEventListener("error", this.fail);
    this.worker.terminate();
  }

  private readonly receive = (event: MessageEvent<unknown>): void => {
    if (!isQrWorkerResponse(event.data)) return;
    const message = event.data;
    if (this.disposed) {
      if (message.type === "result" && message.payload) new Uint8Array(message.payload).fill(0);
      return;
    }
    if (message.type === "ready") {
      this.readyResolved = true;
      this.resolveReady();
      return;
    }
    if (message.type === "error") {
      const error = workerError(message.code);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.reject(error);
        }
      } else if (!this.readyResolved) {
        this.rejectReady(error);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      if (message.payload) new Uint8Array(message.payload).fill(0);
      return;
    }
    this.pending.delete(message.id);
    pending.resolve(message.payload ? new Uint8Array(message.payload) : null);
  };

  private readonly fail = (): void => {
    const error = new Error("O Worker QR foi interrompido.");
    if (!this.readyResolved) this.rejectReady(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  };
}

/**
 * Runs QR extraction in an embed-owned Worker. A main-thread engine exists
 * only as a compatibility fallback when the Worker cannot be configured before
 * any image pixels are transferred.
 */
export class EmbedQrScanner implements QrEngine {
  private readonly fallback: QrEngine;
  private worker: QrWorkerClient | null = null;
  private fallbackActive = false;
  private disposed = false;

  constructor(options: EmbedQrScannerOptions) {
    this.fallback = mainThreadEngine(options);
    if (typeof Worker === "undefined") {
      this.fallbackActive = true;
      return;
    }
    try {
      this.worker = new QrWorkerClient(options);
    } catch {
      this.fallbackActive = true;
    }
  }

  async prepare(): Promise<void> {
    this.assertActive();
    if (!this.worker || this.fallbackActive) return this.fallback.prepare();
    try {
      await this.worker.prepare();
    } catch {
      this.worker.dispose();
      this.worker = null;
      this.fallbackActive = true;
      await this.fallback.prepare();
    }
  }

  async scan(input: ImageData | Blob): Promise<Uint8Array | null> {
    this.assertActive();
    if (input instanceof Blob) throw new Error("O Worker QR recebe pixels RGBA, não arquivos codificados.");
    await this.prepare();
    if (this.worker && !this.fallbackActive) return this.worker.scan(input);
    return this.fallback.scan(input);
  }

  /** True only after the Worker passed its configuration handshake. */
  get usingWorker(): boolean {
    return Boolean(this.worker && !this.fallbackActive && !this.disposed);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.dispose();
    this.worker = null;
    this.fallback.dispose();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("O leitor QR já foi descartado.");
  }
}
