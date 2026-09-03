import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "./server.mjs";

const settings = {
  port: 0,
  apiBaseUrl: "https://consulta.example",
  apiKey: "test_server_key",
  projectId: "pub_test_project",
  partnerOrigin: "https://partner.example",
};
const sessionToken = "a".repeat(32);

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Servidor de teste não iniciou.");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
}

test("encaminha sessão somente para o upstream e as credenciais fixadas no servidor", async () => {
  const calls = [];
  const app = createApp(settings, async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, request_id: "req_synthetic", data: {} }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }, { authorize: async () => true });

  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/consulta-autofill/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: settings.partnerOrigin },
      body: JSON.stringify({ protocol_version: 1, document_type: "cnh-e" }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).success, true);
  });

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "https://consulta.example/api/v1/autofill/sessions");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("x-api-key"), settings.apiKey);
  assert.equal(headers.get("x-consulta-product"), "autofill");
  assert.equal(headers.get("x-consulta-project-id"), settings.projectId);
  assert.deepEqual(JSON.parse(init.body), {
    protocol_version: 1,
    document_type: "cnh-e",
    partner_origin: settings.partnerOrigin,
  });
});

test("rejeita origem e campos extras antes de chamar o upstream", async () => {
  let calls = 0;
  const app = createApp(settings, async () => {
    calls += 1;
    throw new Error("upstream não deve ser chamado");
  }, { authorize: async () => true });

  await withServer(app, async (origin) => {
    const wrongOrigin = await fetch(`${origin}/api/consulta-autofill/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ protocol_version: 1, document_type: "auto" }),
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal((await wrongOrigin.json()).error.code, "INVALID_ORIGIN");

    const missingOrigin = await fetch(`${origin}/api/consulta-autofill/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocol_version: 1, document_type: "auto" }),
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).error.code, "INVALID_ORIGIN");

    const extraMetric = await fetch(`${origin}/api/consulta-autofill/metrics`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: settings.partnerOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        session_token: sessionToken,
        event: "filled",
        fields: { cpf: "00000000000" },
      }),
    });
    assert.equal(extraMetric.status, 400);
    assert.equal((await extraMetric.json()).error.code, "INVALID_REQUEST");
  });

  assert.equal(calls, 0);
});

test("fecha a ponte sem uma integração de autenticação e não chama o upstream", async () => {
  let calls = 0;
  const app = createApp(settings, async () => {
    calls += 1;
    throw new Error("upstream não deve ser chamado");
  });

  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/consulta-autofill/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: settings.partnerOrigin },
      body: JSON.stringify({ protocol_version: 1, document_type: "auto" }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
  });

  assert.equal(calls, 0);
});
