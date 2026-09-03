import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

type ContractSchema = {
  $id: string;
};

const schema = JSON.parse(
  readFileSync(new URL("../packages/autofill/contracts/v1/autofill.schema.json", import.meta.url), "utf8"),
) as ContractSchema;

function validator(definition: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  const result = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
  if (!result) throw new Error(`Missing schema definition: ${definition}`);
  return result;
}

describe("Autofill v1 JSON Schema", () => {
  it("accepts a partner session request and response", () => {
    const validateRequest = validator("sessionCreateRequest");
    const validateResponse = validator("sessionSuccessResponse");

    expect(validateRequest({ protocol_version: 1, document_type: "auto" })).toBe(true);
    expect(
      validateResponse({
        success: true,
        request_id: "req_12345678",
        data: {
          session_id: "afs_12345678",
          session_token: "a".repeat(32),
          project_id: "pub_12345678",
          expires_at: "2026-09-03T12:00:00.000Z",
          embed_url: "https://embed.consulta.dev.br/v1",
          allowed_document_types: ["cnh-e", "crlv-e"],
        },
      }),
    ).toBe(true);
  });

  it("accepts a decoded response without a photo by default", () => {
    const validate = validator("decodeSuccessResponse");

    expect(
      validate({
        success: true,
        request_id: "req_12345678",
        data: {
          document: { type: "cnh-e", label: "CNH-e" },
          fields: { full_name: "Pessoa de Teste", cpf: "00000000000" },
          photo: null,
        },
      }),
    ).toBe(true);
  });

  it("rejects browser-controlled project identifiers and unsupported fields", () => {
    const validateSessionRequest = validator("sessionCreateRequest");
    const validateDecodeRequest = validator("decodeRequest");

    expect(
      validateSessionRequest({
        protocol_version: 1,
        document_type: "auto",
        project_id: "pub_12345678",
      }),
    ).toBe(false);
    expect(
      validateDecodeRequest({
        protocol_version: 1,
        session_token: "a".repeat(32),
        payload_base64: "not base64!",
      }),
    ).toBe(false);
  });

  it("keeps error responses safe and versioned", () => {
    const validate = validator("errorResponse");

    expect(
      validate({
        success: false,
        request_id: "req_12345678",
        error: { code: "SESSION_EXPIRED", message: "A sessão expirou.", retryable: true },
      }),
    ).toBe(true);
    expect(
      validate({
        success: false,
        request_id: "req_12345678",
        error: { code: "UNKNOWN", message: "Erro", retryable: false },
      }),
    ).toBe(false);
  });
});
