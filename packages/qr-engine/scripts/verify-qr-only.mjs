import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.env.QR_ONLY_OUTPUT_DIR || resolve(packageDirectory, ".qr-only-build"));
const recipe = JSON.parse(readFileSync(resolve(packageDirectory, "qr-only", "manifest.json"), "utf8"));
const buildManifestPath = resolve(outputDirectory, "manifest.json");

if (!existsSync(buildManifestPath)) {
  throw new Error(`Build QR-only ausente em ${outputDirectory}. Execute qr-only:build em um ambiente com Docker Buildx.`);
}

const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
if (JSON.stringify(buildManifest.recipe) !== JSON.stringify(recipe)) {
  throw new Error("O artefato QR-only foi produzido por uma receita diferente da versão fixada no repositório.");
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

for (const name of ["consulta_qr_reader.js", "consulta_qr_reader.wasm", "emscripten-version.txt"]) {
  const path = resolve(outputDirectory, name);
  if (!existsSync(path)) throw new Error(`Artefato QR-only ausente: ${name}`);
  const bytes = readFileSync(path);
  if (buildManifest.artifacts?.[name]?.sha256 !== digest(bytes)) {
    throw new Error(`Hash divergente para ${name}; descarte esse artefato e reconstrua em uma pasta vazia.`);
  }
}

const wasm = readFileSync(resolve(outputDirectory, "consulta_qr_reader.wasm"));
const baselinePath = resolve(packageDirectory, "..", "..", "apps", "embed", "public", "zxing_reader.wasm");
const baselineBytes = statSync(baselinePath).size;
const reduction = 1 - wasm.byteLength / baselineBytes;

if (wasm.byteLength > recipe.build.maximum_wasm_bytes) {
  throw new Error(`WASM QR-only tem ${wasm.byteLength} bytes; máximo permitido: ${recipe.build.maximum_wasm_bytes}.`);
}
if (reduction < recipe.build.minimum_size_reduction) {
  throw new Error(`Redução de ${(reduction * 100).toFixed(1)}% é inferior ao mínimo de ${(recipe.build.minimum_size_reduction * 100).toFixed(0)}%.`);
}

console.log(JSON.stringify({
  wasm_bytes: wasm.byteLength,
  wasm_gzip_bytes: gzipSync(wasm, { level: 9 }).byteLength,
  baseline_wasm_bytes: baselineBytes,
  reduction_percent: Number((reduction * 100).toFixed(2)),
  sha256: digest(wasm),
}, null, 2));
