import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer as createViteServer } from "vite";
import {
  prepareZXingModule as prepareWriter,
  purgeZXingModule as purgeWriter,
  writeBarcode,
} from "zxing-wasm/writer";

const packageDirectory = resolve(import.meta.dirname, "..");
const workspaceDirectory = resolve(packageDirectory, "..", "..");
const embedDirectory = resolve(workspaceDirectory, "apps", "embed");
const outputDirectory = resolve(process.env.QR_ONLY_OUTPUT_DIR || resolve(packageDirectory, ".qr-only-build"));
const maximumSlowdownPercent = Number(process.env.QR_ONLY_MAX_SLOWDOWN_PERCENT || "10");
const fixtureScale = 16;
const require = createRequire(import.meta.url);

if (!Number.isFinite(maximumSlowdownPercent) || maximumSlowdownPercent < 0) {
  throw new Error("QR_ONLY_MAX_SLOWDOWN_PERCENT deve ser um número não negativo.");
}

const artifactFiles = new Map([
  ["/consulta_qr_reader.js", { path: resolve(outputDirectory, "consulta_qr_reader.js"), type: "application/javascript; charset=utf-8" }],
  ["/consulta_qr_reader.wasm", { path: resolve(outputDirectory, "consulta_qr_reader.wasm"), type: "application/wasm" }],
]);

for (const artifact of artifactFiles.values()) readFileSync(artifact.path);

function wasmBinary(subpath) {
  const source = readFileSync(require.resolve(subpath));
  return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createFixture() {
  const payload = new TextEncoder().encode("consulta-qr-browser-benchmark-v1");
  await prepareWriter({
    overrides: { wasmBinary: wasmBinary("zxing-wasm/writer/zxing_writer.wasm") },
    fireImmediately: true,
  });
  try {
    const written = await writeBarcode(payload, { format: "QRCode", scale: 8, addQuietZones: true });
    if (written.error) throw new Error(`Não foi possível criar o fixture de benchmark: ${written.error}`);
    const width = written.symbol.width * fixtureScale;
    const height = written.symbol.height * fixtureScale;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = written.symbol.data[Math.floor(y / fixtureScale) * written.symbol.width + Math.floor(x / fixtureScale)];
        const offset = (y * width + x) * 4;
        rgba[offset] = value;
        rgba[offset + 1] = value;
        rgba[offset + 2] = value;
        rgba[offset + 3] = 255;
      }
    }
    written.symbol.data.fill(0);
    return {
      body: JSON.stringify({
        width,
        height,
        rgba_base64: Buffer.from(rgba).toString("base64"),
        expected_sha256: sha256(payload),
      }),
      dispose: () => rgba.fill(0),
    };
  } finally {
    purgeWriter();
    payload.fill(0);
  }
}

const fixture = await createFixture();
const server = await createViteServer({
  root: embedDirectory,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: true },
  plugins: [
    {
      name: "consulta-qr-benchmark-artifacts",
      configureServer(viteServer) {
        viteServer.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
          if (pathname === "/__consulta-qr-benchmark/fixture.json") {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(fixture.body);
            return;
          }
          if (!pathname.startsWith("/__consulta-qr-benchmark/artifacts")) return next();
          const artifact = artifactFiles.get(pathname.slice("/__consulta-qr-benchmark/artifacts".length));
          if (!artifact) return next();
          response.statusCode = 200;
          response.setHeader("Content-Type", artifact.type);
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(artifact.path));
        });
      },
    },
  ],
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Não foi possível determinar a porta do servidor de benchmark.");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${origin}/dev/qr-benchmark.html`, { waitUntil: "networkidle" });
  const result = await page.evaluate(async ({ candidateModuleUrl, candidateWasmUrl, maximumSlowdown }) => {
    if (!globalThis.consultaQrBenchmark) throw new Error("O harness de benchmark não iniciou.");
    return globalThis.consultaQrBenchmark.run({ candidateModuleUrl, candidateWasmUrl, maximumSlowdownPercent: maximumSlowdown });
  }, {
    candidateModuleUrl: `${origin}/__consulta-qr-benchmark/artifacts/consulta_qr_reader.js`,
    candidateWasmUrl: `${origin}/__consulta-qr-benchmark/artifacts/consulta_qr_reader.wasm`,
    maximumSlowdown: maximumSlowdownPercent,
  });
  console.log(JSON.stringify({ browser: browser.version(), maximum_slowdown_percent: maximumSlowdownPercent, ...result }, null, 2));
} finally {
  await browser?.close();
  fixture.dispose();
  await server.close();
}
