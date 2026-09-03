import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicSanitizationViolations } from "./public-sanitization-policy.mjs";

const workspaceDirectory = resolve(import.meta.dirname, "..");

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

const violations = [];
const candidates = publicCandidatePaths();
for (const filePath of candidates) {
  const bytes = readFileSync(resolve(workspaceDirectory, filePath));
  for (const violation of publicSanitizationViolations(filePath, bytes)) violations.push(`${filePath}: ${violation}`);
}

if (violations.length) {
  throw new Error(`Sanitização pública falhou:\n${violations.join("\n")}`);
}

console.log(`Sanitização pública aprovada para ${candidates.length} arquivos públicos candidatos.`);
