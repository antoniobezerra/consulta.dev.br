import {
  prepareZXingModule,
  purgeZXingModule,
  readBarcodes,
  type ZXingModuleOverrides,
} from "zxing-wasm/reader";

let activeZXingEngines = 0;

/** Bytes extracted from a QR Code. Decoding the official document remains private. */
export type QrPayloadBytes = Uint8Array;

export interface QrEngine {
  prepare(): Promise<void>;
  scan(input: ImageData | Blob): Promise<QrPayloadBytes | null>;
  dispose(): void;
}

export interface ZXingWasmQrEngineOptions {
  /**
   * Version-pinned Reader WASM asset served by the hosted embed or a partner
   * deployment. Keeping this explicit avoids an implicit third-party CDN
   * request at scan time.
   */
  wasmUrl?: string;
  /** Useful for deterministic Node tests; browser integrations should use wasmUrl. */
  wasmBinary?: ArrayBuffer;
}

/**
 * QR-only adapter over `zxing-wasm/reader`. It deliberately constrains the
 * reader to QRCode and returns raw bytes rather than text, since the bytes are
 * forwarded to the private Consulta decoder without interpretation here.
 */
export class ZXingWasmQrEngine implements QrEngine {
  private preparation: Promise<void> | null = null;
  private disposed = false;
  private readonly overrides: ZXingModuleOverrides;

  constructor({ wasmUrl, wasmBinary }: ZXingWasmQrEngineOptions) {
    if ((wasmUrl ? 1 : 0) + (wasmBinary ? 1 : 0) !== 1) {
      throw new Error("Informe exatamente um de wasmUrl ou wasmBinary para o leitor QR.");
    }
    if (wasmBinary) {
      this.overrides = { wasmBinary };
    } else {
      const resolved = new URL(wasmUrl as string, globalThis.location?.href).toString();
      this.overrides = {
        locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? resolved : `${prefix}${path}`),
      };
    }
    activeZXingEngines += 1;
  }

  async prepare(): Promise<void> {
    this.assertActive();
    if (!this.preparation) {
      const module = prepareZXingModule({
        overrides: this.overrides,
        fireImmediately: true,
      });
      this.preparation = module.then(() => undefined).catch((error: unknown) => {
        this.preparation = null;
        throw error;
      });
    }
    await this.preparation;
  }

  async scan(input: ImageData | Blob): Promise<QrPayloadBytes | null> {
    await this.prepare();
    const [result] = await readBarcodes(input, {
      formats: ["QRCode"],
      maxNumberOfSymbols: 1,
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
    });
    return result?.bytes ? result.bytes.slice() : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preparation = null;
    activeZXingEngines = Math.max(0, activeZXingEngines - 1);
    if (activeZXingEngines === 0) purgeZXingModule();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("O leitor QR já foi descartado.");
  }
}

/**
 * The implementation is selected by the embed application. The interface is
 * intentionally public so partners can type their integration without access
 * to the VIO decoder.
 */
export const QR_ENGINE_INTERFACE_VERSION = 1;
