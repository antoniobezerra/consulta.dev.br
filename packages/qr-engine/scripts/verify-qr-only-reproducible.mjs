import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const primaryDirectory = resolve(process.env.QR_ONLY_OUTPUT_DIR || resolve(packageDirectory, ".qr-only-build"));
const repeatedDirectory = resolve(process.env.QR_ONLY_REPRODUCIBLE_OUTPUT_DIR || resolve(packageDirectory, ".qr-only-reproducible-build"));
const artifactNames = [
  "consulta_qr_reader.js",
  "consulta_qr_reader.wasm",
  "emscripten-version.txt",
  "manifest.json",
];

if (!existsSync(primaryDirectory) || !existsSync(repeatedDirectory)) {
  throw new Error("As duas saídas QR-only devem existir antes da verificação de reprodutibilidade.");
}

if (realpathSync(primaryDirectory) === realpathSync(repeatedDirectory)) {
  throw new Error("As duas saídas QR-only devem ser diretórios distintos.");
}

function readArtifact(directory, name) {
  const path = resolve(directory, name);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Artefato QR-only ausente em ${directory}: ${name}`);
  }
  return readFileSync(path);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const compared = {};
for (const name of artifactNames) {
  const primary = readArtifact(primaryDirectory, name);
  const repeated = readArtifact(repeatedDirectory, name);
  const primaryDigest = digest(primary);
  const repeatedDigest = digest(repeated);

  if (primaryDigest !== repeatedDigest || !primary.equals(repeated)) {
    throw new Error(`Build QR-only não reproduzível: ${name} divergiu (${primaryDigest} != ${repeatedDigest}).`);
  }

  compared[name] = { bytes: primary.byteLength, sha256: primaryDigest };
}

console.log(JSON.stringify({ reproducible: true, compared }, null, 2));
