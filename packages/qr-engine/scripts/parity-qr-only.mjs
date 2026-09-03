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
  {
    name: "binary-all-bytes-ecc-h",
    payload: Uint8Array.from({ length: 256 }, (_, index) => index),
    writerOptions: { scale: 5, addQuietZones: true, options: "ecLevel=H" },
    transform: { rasterScale: 4 },
  },
  {
    name: "low-contrast-lighting",
    payload: encoder.encode("consulta-qr-parity-low-contrast-v1"),
    writerOptions: { scale: 8, addQuietZones: true, options: "ecLevel=H,version=5" },
    transform: { rasterScale: 4, contrast: 0.95, brightness: 3, verticalGradient: 3 },
  },
  {
    name: "blurred-high-ecc",
    payload: encoder.encode("consulta-qr-parity-blur-v1"),
    writerOptions: { scale: 10, addQuietZones: true, options: "ecLevel=H,version=5" },
    transform: { rasterScale: 8, blurRadius: 1 },
  },
  {
    name: "trapezoid-high-ecc",
    payload: encoder.encode("consulta-qr-parity-trapezoid-v1"),
    writerOptions: { scale: 12, addQuietZones: true, options: "ecLevel=H,version=5" },
    transform: { rasterScale: 8, trapezoidInset: 8, contrast: 0.95, brightness: 2 },
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

function upscalePixmap(pixmap, factor) {
  if (!Number.isSafeInteger(factor) || factor < 1) throw new Error("A escala sintética do fixture é inválida.");
  if (factor === 1) return pixmap;
  const { width, height, data } = pixmap;
  const scaledWidth = width * factor;
  const scaledHeight = height * factor;
  const output = new Uint8ClampedArray(scaledWidth * scaledHeight * 4);
  for (let y = 0; y < scaledHeight; y += 1) {
    const sourceY = Math.floor(y / factor);
    for (let x = 0; x < scaledWidth; x += 1) {
      const sourceX = Math.floor(x / factor);
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (y * scaledWidth + x) * 4;
      output[targetOffset] = data[sourceOffset];
      output[targetOffset + 1] = data[sourceOffset + 1];
      output[targetOffset + 2] = data[sourceOffset + 2];
      output[targetOffset + 3] = 255;
    }
  }
  data.fill(0);
  return { data: output, width: scaledWidth, height: scaledHeight };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Produz um QR trapezoidal determinístico sem depender de imagem, câmera ou
 * documento externo. O quiet zone segue junto com o símbolo, para que ambos os
 * leitores recebam exatamente os mesmos pixels RGBA.
 */
function trapezoidPixmap(pixmap, inset) {
  const { width, height, data } = pixmap;
  const output = new Uint8ClampedArray(data.length);
  output.fill(255);
  for (let y = 0; y < height; y += 1) {
    const progress = height > 1 ? y / (height - 1) : 0;
    const left = inset * (1 - progress);
    const right = (width - 1) - left;
    for (let x = Math.ceil(left); x <= Math.floor(right); x += 1) {
      const sourceX = Math.round(((x - left) / (right - left)) * (width - 1));
      const sourceOffset = (y * width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      output[targetOffset] = data[sourceOffset];
      output[targetOffset + 1] = data[sourceOffset + 1];
      output[targetOffset + 2] = data[sourceOffset + 2];
      output[targetOffset + 3] = 255;
    }
  }
  data.fill(0);
  return { data: output, width, height };
}

function blurPixmap(pixmap, radius) {
  const { width, height, data } = pixmap;
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    const startY = Math.max(0, y - radius);
    const endY = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const startX = Math.max(0, x - radius);
      const endX = Math.min(width - 1, x + radius);
      let total = 0;
      let samples = 0;
      for (let sampleY = startY; sampleY <= endY; sampleY += 1) {
        for (let sampleX = startX; sampleX <= endX; sampleX += 1) {
          total += data[(sampleY * width + sampleX) * 4];
          samples += 1;
        }
      }
      const offset = (y * width + x) * 4;
      const value = Math.round(total / samples);
      output[offset] = value;
      output[offset + 1] = value;
      output[offset + 2] = value;
      output[offset + 3] = 255;
    }
  }
  data.fill(0);
  return { data: output, width, height };
}

function adjustLighting(pixmap, { contrast = 1, brightness = 0, verticalGradient = 0 }) {
  const { width, height, data } = pixmap;
  for (let y = 0; y < height; y += 1) {
    const gradient = height > 1 ? ((y / (height - 1)) - 0.5) * verticalGradient * 2 : 0;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = clampByte(128 + ((data[offset] - 128) * contrast) + brightness + gradient);
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return pixmap;
}

function transformPixmap(pixmap, transform = {}) {
  let result = pixmap;
  if (transform.rasterScale) result = upscalePixmap(result, transform.rasterScale);
  if (transform.trapezoidInset) result = trapezoidPixmap(result, transform.trapezoidInset);
  if (transform.blurRadius) result = blurPixmap(result, transform.blurRadius);
  return adjustLighting(result, transform);
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

function readCandidate(module, pixmap, fixtureName) {
  const byteLength = pixmap.data.byteLength;
  const pointer = module._malloc(byteLength);
  if (!Number.isSafeInteger(pointer) || pointer < 1 || pointer + byteLength > module.HEAPU8.byteLength) {
    throw new Error("O artefato QR-only não conseguiu alocar a imagem sintética.");
  }
  try {
    module.HEAPU8.set(pixmap.data, pointer);
    const result = module.readQrCodeFromPixmap(pointer, pixmap.width, pixmap.height);
    if (result?.format !== "QRCode" || !(result.bytes instanceof Uint8Array)) {
      throw new Error(`O candidato não encontrou um QR Code no fixture sintético ${fixtureName}: ${String(result?.error || "sem detalhe")}`);
    }
    return result.bytes.slice();
  } finally {
    module.HEAPU8.fill(0, pointer, pointer + byteLength);
    module._free(pointer);
  }
}

async function readBaseline(pixmap, fixtureName) {
  const [result] = await readBarcodes(pixmap, readerOptions);
  if (!(result?.bytes instanceof Uint8Array)) {
    throw new Error(`O baseline não encontrou um QR Code no fixture sintético ${fixtureName}.`);
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
    written.symbol.data.fill(0);
    const transformed = transformPixmap(pixmap, fixture.transform);
    let baseline;
    let candidateBytes;
    try {
      const baselinePixmap = copyPixmap(transformed);
      try {
        baseline = await readBaseline(baselinePixmap, fixture.name);
      } finally {
        baselinePixmap.data.fill(0);
      }

      const candidatePixmap = copyPixmap(transformed);
      try {
        candidateBytes = readCandidate(candidate, candidatePixmap, fixture.name);
      } finally {
        candidatePixmap.data.fill(0);
      }
      assert.deepEqual(Array.from(candidateBytes), Array.from(baseline), `${fixture.name}: bytes divergentes entre candidate e baseline`);
      assert.deepEqual(Array.from(candidateBytes), Array.from(fixture.payload), `${fixture.name}: payload divergente do fixture sintético`);
      results.push({
        name: fixture.name,
        width: transformed.width,
        height: transformed.height,
        bytes: candidateBytes.byteLength,
        sha256: bytesDigest(candidateBytes),
      });
    } finally {
      candidateBytes?.fill(0);
      baseline?.fill(0);
      transformed.data.fill(0);
    }
  }
} finally {
  purgeBaselineReader();
  purgeWriter();
  for (const fixture of fixtures) fixture.payload.fill(0);
}

console.log(JSON.stringify({ compared: results.length, fixtures: results }, null, 2));
