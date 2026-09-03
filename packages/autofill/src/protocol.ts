/** Version shared by the Web Component, hosted embed and partner endpoint. */
export const AUTOFILL_PROTOCOL_VERSION = 1 as const;

export const AUTOFILL_DOCUMENT_TYPES = ["auto", "cnh-e", "crlv-e"] as const;
export const AUTOFILL_DECODED_DOCUMENT_TYPES = ["cnh-e", "crlv-e"] as const;
export type AutofillDocumentType = (typeof AUTOFILL_DOCUMENT_TYPES)[number];
export type AutofillDecodedDocumentType = (typeof AUTOFILL_DECODED_DOCUMENT_TYPES)[number];

export const AUTOFILL_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "INVALID_API_KEY",
  "INVALID_PRODUCT",
  "INVALID_ORIGIN",
  "INVALID_SESSION",
  "SESSION_EXPIRED",
  "SESSION_REPLAYED",
  "SESSION_ATTEMPTS_EXCEEDED",
  "PROJECT_NOT_FOUND",
  "PROJECT_DISABLED",
  "DOCUMENT_NOT_ALLOWED",
  "PHOTO_NOT_ALLOWED",
  "CAMERA_DENIED",
  "CAMERA_UNAVAILABLE",
  "FILE_UNSUPPORTED",
  "QR_NOT_FOUND",
  "DECODE_FAILED",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;
export type AutofillErrorCode = (typeof AUTOFILL_ERROR_CODES)[number];

export interface AutofillError {
  code: AutofillErrorCode;
  message: string;
  retryable: boolean;
}

export interface AutofillErrorResponse {
  success: false;
  error: AutofillError;
  request_id: string;
}

/** Request emitted by the component to the partner's same-origin session endpoint. */
export interface AutofillSessionCreateRequest {
  protocol_version: typeof AUTOFILL_PROTOCOL_VERSION;
  document_type: AutofillDocumentType;
}

export interface AutofillSession {
  session_id: string;
  /** Opaque, short-lived credential. Never put it in a URL or log it. */
  session_token: string;
  project_id: string;
  expires_at: string;
  embed_url: string;
  /** Consulta endpoint that only the hosted iframe may call for bootstrap. */
  bootstrap_url: string;
  allowed_document_types: AutofillDecodedDocumentType[];
  /** True only when the project policy permits image delivery and the user confirms it. */
  photo_enabled: boolean;
}

export interface AutofillSessionSuccessResponse {
  success: true;
  data: AutofillSession;
  request_id: string;
}

export type AutofillSessionResponse = AutofillSessionSuccessResponse | AutofillErrorResponse;

/** Request sent by the component to the partner after the embed extracts QR bytes. */
export interface AutofillDecodeRequest {
  protocol_version: typeof AUTOFILL_PROTOCOL_VERSION;
  session_token: string;
  payload_base64: string;
  /** User confirmation. The API still rejects it unless the project permits photos. */
  include_photo: boolean;
}

export interface AutofillPhoto {
  mime_type: "image/jpeg" | "image/png";
  base64: string;
}

export interface AutofillDecodedDocument {
  type: AutofillDecodedDocumentType;
  label: string;
}

export interface AutofillDecodeData {
  document: AutofillDecodedDocument;
  /** Values are normalized to strings before the form mapping/review step. */
  fields: Record<string, string>;
  photo: AutofillPhoto | null;
}

export interface AutofillDecodeSuccessResponse {
  success: true;
  data: AutofillDecodeData;
  request_id: string;
}

export type AutofillDecodeResponse = AutofillDecodeSuccessResponse | AutofillErrorResponse;

export const AUTOFILL_FRAME_MESSAGE_TYPES = [
  "parent.session",
  "embed.payload",
  "parent.result",
  "parent.error",
  "parent.close",
  "embed.cancel",
  "embed.confirm",
] as const;
export type AutofillFrameMessageType = (typeof AUTOFILL_FRAME_MESSAGE_TYPES)[number];

/** Initial message sent over window.postMessage before a MessagePort exists. */
export interface AutofillEmbedReadyMessage {
  protocol: "consulta-autofill";
  version: typeof AUTOFILL_PROTOCOL_VERSION;
  type: "embed.ready";
  project_id: string;
  nonce: string;
}

/**
 * Every cross-origin message must also be validated against event.origin and
 * event.source by the receiver. A valid shape alone is never a trust signal.
 */
export interface AutofillFrameMessage<TPayload = unknown> {
  protocol: "consulta-autofill";
  version: typeof AUTOFILL_PROTOCOL_VERSION;
  type: AutofillFrameMessageType;
  project_id: string;
  session_id: string;
  nonce: string;
  payload?: TPayload;
}

export function isAutofillFrameMessage(value: unknown): value is AutofillFrameMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Partial<AutofillFrameMessage>;
  return (
    message.protocol === "consulta-autofill" &&
    message.version === AUTOFILL_PROTOCOL_VERSION &&
    typeof message.type === "string" &&
    AUTOFILL_FRAME_MESSAGE_TYPES.includes(message.type as AutofillFrameMessageType) &&
    typeof message.project_id === "string" &&
    typeof message.session_id === "string" &&
    typeof message.nonce === "string"
  );
}

export function isAutofillEmbedReadyMessage(value: unknown): value is AutofillEmbedReadyMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AutofillEmbedReadyMessage>;
  return (
    message.protocol === "consulta-autofill" &&
    message.version === AUTOFILL_PROTOCOL_VERSION &&
    message.type === "embed.ready" &&
    typeof message.project_id === "string" &&
    typeof message.nonce === "string"
  );
}
