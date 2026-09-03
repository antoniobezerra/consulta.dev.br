export const AUTOFILL_PACKAGE_NAME = "@consulta-dev/autofill";

import { defineConsultaAutofill } from "./component.js";
import { defineConsultaAutofillField } from "./field.js";

export { ConsultaAutofillElement, defineConsultaAutofill } from "./component.js";
export { ConsultaAutofillFieldElement, defineConsultaAutofillField } from "./field.js";

export {
  AUTOFILL_DECODED_DOCUMENT_TYPES,
  AUTOFILL_DOCUMENT_TYPES,
  AUTOFILL_ERROR_CODES,
  AUTOFILL_FRAME_MESSAGE_TYPES,
  AUTOFILL_PROTOCOL_VERSION,
  isAutofillEmbedReadyMessage,
  isAutofillFrameMessage,
} from "./protocol.js";

if (typeof window !== "undefined") {
  defineConsultaAutofill();
  defineConsultaAutofillField();
}

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
  AutofillEmbedReadyMessage,
  AutofillFrameMessage,
  AutofillFrameMessageType,
  AutofillPhoto,
  AutofillSession,
  AutofillSessionCreateRequest,
  AutofillSessionResponse,
  AutofillSessionSuccessResponse,
} from "./protocol.js";
