import "dotenv/config";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

const config = {
  port: Number(process.env.PORT || 3000),
  apiBaseUrl: (process.env.CONSULTA_API_BASE_URL || "https://consulta.dev.br").replace(/\/$/, ""),
  apiKey: process.env.CONSULTA_API_KEY || "",
  projectId: process.env.CONSULTA_PROJECT_ID || "",
  partnerOrigin: process.env.CONSULTA_PARTNER_ORIGIN || "",
};

if (!config.apiKey || !config.projectId || !config.partnerOrigin) {
  throw new Error("Defina CONSULTA_API_KEY, CONSULTA_PROJECT_ID e CONSULTA_PARTNER_ORIGIN no ambiente do servidor.");
}

const sessionSchema = z.object({
  protocol_version: z.literal(1),
  document_type: z.enum(["auto", "cnh-e", "crlv-e"]),
}).strict();
const decodeSchema = z.object({
  protocol_version: z.literal(1),
  session_token: z.string().min(32).max(4096),
  payload_base64: z.string().min(4).max(1_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  include_photo: z.boolean(),
}).strict();
const metricSchema = z.object({
  protocol_version: z.literal(1),
  session_token: z.string().min(32).max(4096),
  event: z.enum([
    "opened", "camera_requested", "camera_granted", "camera_denied", "qr_found",
    "decoded", "confirmed", "filled", "closed", "error",
  ]),
}).strict();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb", type: "application/json" }));

function apiError(code, message, status = 400) {
  return { status, body: { success: false, error: { code, message, retryable: status >= 500 }, request_id: "partner_local" } };
}

function requireSamePartnerOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin && origin !== config.partnerOrigin) {
    const error = apiError("INVALID_ORIGIN", "Origem não autorizada.", 403);
    return res.status(error.status).json(error.body);
  }
  return next();
}

function requirePartnerAccess(_req, _res, next) {
  // Conecte à sessão/ACL do seu produto antes de liberar o Autofill.
  // Não use project_id enviado pelo browser para decidir acesso ou credencial.
  return next();
}

async function forward(path, body) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
      "X-Consulta-Product": "autofill",
      "X-Consulta-Project-ID": config.projectId,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function relay(path, schema, transform) {
  return async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const error = apiError("INVALID_REQUEST", "A requisição Autofill é inválida.");
      return res.status(error.status).json(error.body);
    }
    try {
      const result = await forward(path, transform(parsed.data));
      res.set("Cache-Control", "no-store");
      return res.status(result.status).json(result.data || apiError("UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", 503).body);
    } catch (error) {
      // Não imprima req.body, token, QR ou dados de documento nos logs.
      console.error("consulta_autofill_upstream_failed", { path, reason: error instanceof Error ? error.name : "unknown" });
      const unavailable = apiError("UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", 503);
      return res.status(unavailable.status).json(unavailable.body);
    }
  };
}

const sessionLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const decodeLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
const metricsLimit = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false });

app.post("/api/consulta-autofill/session", requireSamePartnerOrigin, requirePartnerAccess, sessionLimit,
  relay("/api/v1/autofill/sessions", sessionSchema, (body) => ({ ...body, partner_origin: config.partnerOrigin })));
app.post("/api/consulta-autofill/decode", requireSamePartnerOrigin, requirePartnerAccess, decodeLimit,
  relay("/api/v1/autofill/decode", decodeSchema, (body) => body));
app.post("/api/consulta-autofill/metrics", requireSamePartnerOrigin, requirePartnerAccess, metricsLimit,
  relay("/api/v1/autofill/metrics", metricSchema, (body) => body));

app.use((error, _req, res, _next) => {
  void _next;
  if (error instanceof SyntaxError) {
    const response = apiError("INVALID_REQUEST", "JSON inválido.");
    return res.status(response.status).json(response.body);
  }
  const response = apiError("INTERNAL_ERROR", "Erro interno.", 500);
  return res.status(response.status).json(response.body);
});

app.listen(config.port, () => console.info(`Consulta Autofill partner bridge listening on :${config.port}`));
