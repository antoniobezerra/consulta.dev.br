export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;

function config() {
  const apiBaseUrl = (process.env.CONSULTA_API_BASE_URL || "https://consulta.dev.br").replace(/\/$/, "");
  const apiKey = process.env.CONSULTA_API_KEY;
  const projectId = process.env.CONSULTA_PROJECT_ID;
  const partnerOrigin = process.env.CONSULTA_PARTNER_ORIGIN;
  if (!apiKey || !projectId || !partnerOrigin) throw new Error("Consulta Autofill server configuration is missing.");
  return { apiBaseUrl, apiKey, projectId, partnerOrigin };
}

function error(code: string, message: string, status = 400) {
  return Response.json(
    { success: false, error: { code, message, retryable: status >= 500 }, request_id: "partner_local" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function validSessionBody(value: unknown): value is { protocol_version: 1; document_type: "auto" | "cnh-e" | "crlv-e" } {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return body.protocol_version === 1 && (body.document_type === "auto" || body.document_type === "cnh-e" || body.document_type === "crlv-e") && Object.keys(body).length === 2;
}

function validDecodeBody(value: unknown): value is { protocol_version: 1; session_token: string; payload_base64: string; include_photo: boolean } {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return body.protocol_version === 1 && typeof body.session_token === "string" && body.session_token.length >= 32 && body.session_token.length <= 4096 &&
    typeof body.payload_base64 === "string" && body.payload_base64.length >= 4 && body.payload_base64.length <= MAX_BODY_BYTES && /^[A-Za-z0-9+/]+={0,2}$/.test(body.payload_base64) &&
    typeof body.include_photo === "boolean" && Object.keys(body).length === 4;
}

async function requestJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as unknown;
}

async function forward(path: string, body: unknown) {
  const settings = config();
  const response = await fetch(`${settings.apiBaseUrl}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": settings.apiKey,
      "X-Consulta-Product": "autofill",
      "X-Consulta-Project-ID": settings.projectId,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  let settings: ReturnType<typeof config>;
  try {
    settings = config();
  } catch {
    return error("INTERNAL_ERROR", "Configuração do Autofill indisponível.", 500);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== settings.partnerOrigin) return error("INVALID_ORIGIN", "Origem não autorizada.", 403);

  // TODO: verifique aqui a sessão/ACL do usuário do seu produto.
  // Nunca use project_id vindo do browser; o projeto é fixado nas variáveis de servidor.
  const { action } = await context.params;
  try {
    const body = await requestJson(request);
    let endpoint: string;
    let upstreamBody: unknown;
    if (action === "session") {
      if (!validSessionBody(body)) return error("INVALID_REQUEST", "Sessão Autofill inválida.");
      endpoint = "/api/v1/autofill/sessions";
      upstreamBody = { ...body, partner_origin: settings.partnerOrigin };
    } else if (action === "decode") {
      if (!validDecodeBody(body)) return error("INVALID_REQUEST", "Decode Autofill inválido.");
      endpoint = "/api/v1/autofill/decode";
      upstreamBody = body;
    } else {
      return error("INVALID_REQUEST", "Ação Autofill não suportada.", 404);
    }
    const upstream = await forward(endpoint, upstreamBody);
    return Response.json(upstream.body || { success: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Serviço indisponível.", retryable: true }, request_id: "partner_local" }, {
      status: upstream.body ? upstream.status : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    // Não logue request body, QR, token, imagem, foto ou campos.
    if (cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE") return error("INVALID_REQUEST", "Payload muito grande.", 413);
    if (cause instanceof SyntaxError) return error("INVALID_REQUEST", "JSON inválido.");
    return error("UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", 503);
  }
}
