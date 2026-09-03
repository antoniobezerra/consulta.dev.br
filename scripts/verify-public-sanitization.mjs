import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const prohibitedFileExtensions = /\.(?:bak|backup|db|key|p12|pfx|pem|sqlite|sqlite3)$/i;
const secretPatterns = [
  { name: "chave Consulta", expression: /\bcvio_(?:live|test)_[A-Za-z0-9_-]{16,}\b/ },
  { name: "segredo de webhook", expression: /\bwhsec_[A-Za-z0-9_-]{16,}\b/ },
  { name: "chave AWS", expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "token GitHub", expression: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: "token GitHub fine-grained", expression: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "chave privada", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

function publicCandidatePaths() {
  // Include non-ignored working-tree candidates so a developer sees a problem
  // before staging or pushing it. Ignored local .env files and build output
  // stay outside this public-source check until explicitly added to Git.
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: workspaceDirectory,
    encoding: "buffer",
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return [...new Set(paths)];
}

function prohibitedPath(filePath) {
  const filename = basename(filePath);
  if (filename === ".env" || (filename.startsWith(".env.") && filename !== ".env.example")) return true;
  if (["db.json", "db.sqlite", "db.sqlite3"].includes(filename)) return true;
  return prohibitedFileExtensions.test(filename);
}

const violations = [];
const candidates = publicCandidatePaths();
for (const filePath of candidates) {
  if (prohibitedPath(filePath)) {
    violations.push(`${filePath}: arquivo privado ou segredo não pode ser versionado`);
    continue;
  }

  const bytes = readFileSync(resolve(workspaceDirectory, filePath));
  // Binary artifacts do not carry source text and are checked by their
  // filename. Avoid attempting to decode arbitrary WASM or image bytes.
  if (bytes.includes(0)) continue;
  const source = bytes.toString("utf8");
  for (const pattern of secretPatterns) {
    if (pattern.expression.test(source)) violations.push(`${filePath}: possível ${pattern.name}`);
  }
}

if (violations.length) {
  throw new Error(`Sanitização pública falhou:\n${violations.join("\n")}`);
}

console.log(`Sanitização pública aprovada para ${candidates.length} arquivos públicos candidatos.`);
