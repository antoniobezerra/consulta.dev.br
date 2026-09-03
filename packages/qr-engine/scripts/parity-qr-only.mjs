import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  prepareZXingModule as prepareBaselineReader,
  purgeZXingModule as purgeBaselineReader,
  readBarcodes,
} from "zxing-wasm/reader";
import {
  prepareZXingModule as prepareWriter,
  purgeZXingModule as purgeWriter,
  writeBarcode,
} from "zxing-wasm/writer";

const packageDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.env.QR_ONLY_OUTPUT_DIR || resolve(packageDirectory, ".qr-only-build"));
const modulePath = resolve(outputDirectory, "consulta_qr_reader.js");
const wasmPath = resolve(outputDirectory, "consulta_qr_reader.wasm");

const encoder = new TextEncoder();
const readerOptions = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 1,
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
};

const fixtures = [
  {
    name: "ascii",
    payload: encoder.encode("consulta-qr-parity-ascii-v1"),
    writerOptions: { scale: 5, addQuietZones: true },
  },
  {
    name: "utf8-rotated",
    payload: encoder.encode("consulta-qr-parity-ação-v1"),
    writerOptions: { scale: 5, rotate: 90, addQuietZones: true },
  },
  {
    name: "binary-inverted",
    payload: new Uint8Array([0, 1, 2, 127, 128, 255, 0, 67, 79, 78, 83, 85, 76, 84, 65]),
    writerOptions: { scale: 6, invert: true, addQuietZones: true },
  },
];

function wasmBinary(subpath) {
  const source = readFileSync(require.resolve(subpath));
  return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
}

const require = createRequire(import.meta.url);

function rgbaFromSymbol(symbol) {
  const rgba = new Uint8ClampedArray(symbol.data.length * 4);
  for (let index = 0; index < symbol.data.length; index += 1) {
    const value = symbol.data[index];
    const offset = index * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return { data: rgba, width: symbol.width, height: symbol.height };
}

function copyPixmap(pixmap) {
  return { data: new Uint8ClampedArray(pixmap.data), width: pixmap.width, height: pixmap.height };
}

function bytesDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertReaderModule(module) {
  if (
    !module ||
    !(module.HEAPU8 instanceof Uint8Array) ||
    typeof module._malloc !== "function" ||
    typeof module._free !== "function" ||
    typeof module.readQrCodeFromPixmap !== "function"
  ) {
    throw new Error("O artefato QR-only não exporta a interface de leitura esperada.");
  }
}

function readCandidate(module, pixmap) {
  const byteLength = pixmap.data.byteLength;
  const pointer = module._malloc(byteLength);
  if (!Number.isSafeInteger(pointer) || pointer < 1 || pointer + byteLength > module.HEAPU8.byteLength) {
    throw new Error("O artefato QR-only não conseguiu alocar a imagem sintética.");
  }
  try {
    module.HEAPU8.set(pixmap.data, pointer);
    const result = module.readQrCodeFromPixmap(pointer, pixmap.width, pixmap.height);
    if (result?.format !== "QRCode" || !(result.bytes instanceof Uint8Array)) {
      throw new Error(`O candidato não encontrou um QR Code: ${String(result?.error || "sem detalhe")}`);
    }
    return result.bytes.slice();
  } finally {
    module.HEAPU8.fill(0, pointer, pointer + byteLength);
    module._free(pointer);
  }
}

async function readBaseline(pixmap) {
  const [result] = await readBarcodes(pixmap, readerOptions);
  if (!(result?.bytes instanceof Uint8Array)) {
    throw new Error("O baseline não encontrou um QR Code na imagem sintética.");
  }
  return result.bytes.slice();
}

await prepareWriter({
  overrides: { wasmBinary: wasmBinary("zxing-wasm/writer/zxing_writer.wasm") },
  fireImmediately: true,
});
await prepareBaselineReader({
  overrides: { wasmBinary: wasmBinary("zxing-wasm/reader/zxing_reader.wasm") },
  fireImmediately: true,
});

const namespace = await import(pathToFileURL(modulePath).href);
const factory = namespace.default || namespace.createConsultaQrReader;
if (typeof factory !== "function") throw new Error("O artefato QR-only não exporta a factory Emscripten esperada.");
const candidate = await factory({ wasmBinary: readFileSync(wasmPath) });
assertReaderModule(candidate);

const results = [];
try {
  for (const fixture of fixtures) {
    const written = await writeBarcode(fixture.payload, { format: "QRCode", ...fixture.writerOptions });
    if (written.error) throw new Error(`Não foi possível gerar o fixture ${fixture.name}: ${written.error}`);

    const pixmap = rgbaFromSymbol(written.symbol);
    let baseline;
    let candidateBytes;
    try {
      baseline = await readBaseline(copyPixmap(pixmap));
      candidateBytes = readCandidate(candidate, copyPixmap(pixmap));
      assert.deepEqual(Array.from(candidateBytes), Array.from(baseline), `${fixture.name}: bytes divergentes entre candidate e baseline`);
      assert.deepEqual(Array.from(candidateBytes), Array.from(fixture.payload), `${fixture.name}: payload divergente do fixture sintético`);
      results.push({
        name: fixture.name,
        bytes: candidateBytes.byteLength,
        sha256: bytesDigest(candidateBytes),
      });
    } finally {
      candidateBytes?.fill(0);
      baseline?.fill(0);
      pixmap.data.fill(0);
    }
  }
} finally {
  purgeBaselineReader();
  purgeWriter();
  for (const fixture of fixtures) fixture.payload.fill(0);
}

console.log(JSON.stringify({ compared: results.length, fixtures: results }, null, 2));
