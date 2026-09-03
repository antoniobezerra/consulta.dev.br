export const AUTOFILL_PACKAGE_NAME = "@consulta-dev/autofill";

export {
  AUTOFILL_DECODED_DOCUMENT_TYPES,
  AUTOFILL_DOCUMENT_TYPES,
  AUTOFILL_ERROR_CODES,
  AUTOFILL_FRAME_MESSAGE_TYPES,
  AUTOFILL_PROTOCOL_VERSION,
  isAutofillFrameMessage,
} from "./protocol.js";

export type {
  AutofillDecodeData,
  AutofillDecodeRequest,
  AutofillDecodeResponse,
  AutofillDecodeSuccessResponse,
  AutofillDecodedDocument,
  AutofillDecodedDocumentType,
  AutofillDocumentType,
  AutofillError,
  AutofillErrorCode,
  AutofillErrorResponse,
  AutofillFrameMessage,
  AutofillFrameMessageType,
  AutofillPhoto,
  AutofillSession,
  AutofillSessionCreateRequest,
  AutofillSessionResponse,
  AutofillSessionSuccessResponse,
} from "./protocol.js";
