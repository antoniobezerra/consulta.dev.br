import assert from "node:assert/strict";
import test from "node:test";
import { POST, createAutofillPostHandler } from "../app/api/consulta-autofill/[action]/route.ts";

const environment = {
  CONSULTA_API_BASE_URL: "https://consulta.example",
  CONSULTA_API_KEY: "test_server_key",
  CONSULTA_PROJECT_ID: "pub_test_project",
  CONSULTA_PARTNER_ORIGIN: "https://partner.example",
};
const sessionToken = "a".repeat(32);

async function withEnvironment(callback) {
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(action, body, origin = environment.CONSULTA_PARTNER_ORIGIN) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`https://partner.example/api/consulta-autofill/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function context(action) {
  return { params: Promise.resolve({ action }) };
}

test("encaminha sessão apenas para o destino, projeto e origem fixados no servidor", async () => {
  await withEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true, request_id: "req_synthetic", data: {} }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const handler = createAutofillPostHandler({ authorize: async () => true });
      const response = await handler(request("session", { protocol_version: 1, document_type: "cnh-e" }), context("session"));
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).success, true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, "https://consulta.example/api/v1/autofill/sessions");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("x-api-key"), environment.CONSULTA_API_KEY);
    assert.equal(headers.get("x-consulta-product"), "autofill");
    assert.equal(headers.get("x-consulta-project-id"), environment.CONSULTA_PROJECT_ID);
    assert.deepEqual(JSON.parse(init.body), {
      protocol_version: 1,
      document_type: "cnh-e",
      partner_origin: environment.CONSULTA_PARTNER_ORIGIN,
    });
  });
});

test("rejeita origem e campos de métrica extras antes do upstream", async () => {
  await withEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("upstream não deve ser chamado");
    };
    try {
      const wrongOrigin = await POST(
        request("session", { protocol_version: 1, document_type: "auto" }, "https://attacker.example"),
        context("session"),
      );
      assert.equal(wrongOrigin.status, 403);
      assert.equal((await wrongOrigin.json()).error.code, "INVALID_ORIGIN");

      const missingOrigin = await POST(
        request("session", { protocol_version: 1, document_type: "auto" }, null),
        context("session"),
      );
      assert.equal(missingOrigin.status, 403);
      assert.equal((await missingOrigin.json()).error.code, "INVALID_ORIGIN");

      const extraMetric = await POST(
        request("metrics", {
          protocol_version: 1,
          session_token: sessionToken,
          event: "filled",
          fields: { cpf: "00000000000" },
        }),
        context("metrics"),
      );
      assert.equal(extraMetric.status, 401);

      const authorizedHandler = createAutofillPostHandler({ authorize: async () => true });
      const authorizedExtraMetric = await authorizedHandler(
        request("metrics", {
          protocol_version: 1,
          session_token: sessionToken,
          event: "filled",
          fields: { cpf: "00000000000" },
        }),
        context("metrics"),
      );
      assert.equal(authorizedExtraMetric.status, 400);
      assert.equal((await authorizedExtraMetric.json()).error.code, "INVALID_REQUEST");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("fecha a ponte sem uma integração de autenticação e não chama o upstream", async () => {
  await withEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("upstream não deve ser chamado");
    };
    try {
      const response = await POST(request("session", { protocol_version: 1, document_type: "auto" }), context("session"));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("limita a solicitação autorizada antes do upstream", async () => {
  await withEnvironment(async () => {
    let calls = 0;
    const handler = createAutofillPostHandler({
      authorize: async () => true,
      rateLimiter: { allow: () => false },
      forwardRequest: async () => {
        calls += 1;
        throw new Error("upstream não deve ser chamado");
      },
    });
    const response = await handler(request("session", { protocol_version: 1, document_type: "auto" }), context("session"));
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
    assert.equal(calls, 0);
  });
});

test("não usa headers controlados pelo browser como chave de rate limit", async () => {
  await withEnvironment(async () => {
    let receivedKey = null;
    const handler = createAutofillPostHandler({
      authorize: async () => true,
      rateLimiter: {
        allow: (_scope, key) => {
          receivedKey = key;
          return true;
        },
      },
      forwardRequest: async () => ({
        status: 201,
        body: { success: true, request_id: "req_synthetic", data: {} },
      }),
    });
    const response = await handler(new Request("https://partner.example/api/consulta-autofill/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: environment.CONSULTA_PARTNER_ORIGIN,
        "x-forwarded-for": "203.0.113.99",
        "x-real-ip": "203.0.113.98",
      },
      body: JSON.stringify({ protocol_version: 1, document_type: "auto" }),
    }), context("session"));
    assert.equal(response.status, 201);
    assert.equal(receivedKey, "authenticated");
  });
});
