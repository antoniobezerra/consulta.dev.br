import { basename } from "node:path";

const prohibitedFileExtensions = /\.(?:bak|backup|db|key|p12|pfx|pem|sqlite|sqlite3)$/i;
const documentOrImageExtensions = /\.(?:avif|gif|heic|heif|jpe?g|pdf|png|tiff?|webp)$/i;
const archiveExtensions = /\.(?:7z|gz|rar|tar|tgz|zip)$/i;
const approvedBinaryAssets = new Set(["apps/embed/public/zxing_reader.wasm"]);
const secretPatterns = [
  { name: "chave Consulta", expression: /\bcvio_(?:live|test)_[A-Za-z0-9_-]{16,}\b/ },
  { name: "segredo de webhook", expression: /\bwhsec_[A-Za-z0-9_-]{16,}\b/ },
  { name: "chave AWS", expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "token GitHub", expression: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: "token GitHub fine-grained", expression: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "chave privada", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const CPF_CANDIDATE = /(?:^|[^0-9])(\d{3}[.\s-]?\d{3}[.\s-]?\d{3}-?\d{2})(?!\d)/g;
const LARGE_EMBEDDED_DOCUMENT = /data:(?:application\/pdf|image\/(?:avif|gif|heic|heif|jpeg|png|tiff|webp));base64,[A-Za-z0-9+/=\s]{4096,}/i;

function prohibitedPath(filePath) {
  const filename = basename(filePath);
  if (filename === ".env" || (filename.startsWith(".env.") && filename !== ".env.example")) return true;
  if (["db.json", "db.sqlite", "db.sqlite3"].includes(filename)) return true;
  return prohibitedFileExtensions.test(filename);
}

function validCpf(value) {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (let position = 9; position <= 10; position += 1) {
    let total = 0;
    for (let index = 0; index < position; index += 1) total += Number(digits[index]) * (position + 1 - index);
    const expected = (total * 10) % 11 % 10;
    if (Number(digits[position]) !== expected) return false;
  }
  return true;
}

/**
 * Returns non-sensitive descriptions of policy violations. The input value is
 * deliberately never included in an error, so a failed local scan does not
 * echo a possible document number or credential into CI logs.
 */
export function publicSanitizationViolations(filePath, bytes) {
  const violations = [];
  if (prohibitedPath(filePath)) {
    violations.push("arquivo privado ou segredo não pode ser versionado");
    return violations;
  }
  if (documentOrImageExtensions.test(filePath)) {
    violations.push("imagem ou documento binário não pode ser versionado no repositório público");
    return violations;
  }
  if (archiveExtensions.test(filePath)) {
    violations.push("arquivo compactado não pode ser versionado no repositório público");
    return violations;
  }

  // The baseline WASM is separately pinned by hash and license verification.
  // Any other binary source cannot be inspected reliably and is rejected.
  if (bytes.includes(0)) {
    if (!approvedBinaryAssets.has(filePath)) violations.push("artefato binário não aprovado no repositório público");
    return violations;
  }
  const source = bytes.toString("utf8");
  for (const pattern of secretPatterns) {
    if (pattern.expression.test(source)) violations.push(`possível ${pattern.name}`);
  }
  for (const match of source.matchAll(CPF_CANDIDATE)) {
    if (validCpf(match[1])) {
      violations.push("possível CPF válido");
      break;
    }
  }
  if (LARGE_EMBEDDED_DOCUMENT.test(source)) {
    violations.push("possível documento ou imagem embutida em base64");
  }
  return violations;
}
