/** Bytes extracted from a QR Code. Decoding the official document remains private. */
export type QrPayloadBytes = Uint8Array;

export interface QrEngine {
  prepare(): Promise<void>;
  scan(input: ImageData | Blob): Promise<QrPayloadBytes | null>;
  dispose(): void;
}

/**
 * The implementation is selected by the embed application. The interface is
 * intentionally public so partners can type their integration without access
 * to the VIO decoder.
 */
export const QR_ENGINE_INTERFACE_VERSION = 1;

