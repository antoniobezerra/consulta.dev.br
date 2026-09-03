import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const releaseDirectory = mkdtempSync(join(tmpdir(), "consulta-release-consumer-dry-run-"));

function sourcePackageVersion() {
  const packageNames = ["autofill", "qr-engine"];
  const versions = packageNames.map((name) => JSON.parse(readFileSync(
    resolve(workspaceDirectory, "packages", name, "package.json"),
    "utf8",
  )).version);
  if (versions.some((version) => typeof version !== "string") || new Set(versions).size !== 1) {
    throw new Error("Os pacotes públicos precisam ter a mesma versão antes do ensaio de consumidor.");
  }
  return versions[0];
}

const environment = {
  ...process.env,
  CONSULTA_RELEASE_VERSION: sourcePackageVersion(),
  CONSULTA_RELEASE_OUTPUT_DIR: releaseDirectory,
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspaceDirectory,
    env: environment,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status === 0 && !result.error) return;
  const details = (result.stderr || result.error?.message || "").trim();
  throw new Error(`Falha no ensaio de consumidor: ${command} ${args.join(" ")}.${details ? ` ${details}` : ""}`);
}

try {
  run("pnpm", ["release:prepare"]);
  run("pnpm", ["release:verify"]);
  run("pnpm", ["release:verify-consumer"]);
  console.log("Ensaio de instalação do consumidor npm aprovado.");
} finally {
  // This directory is allocated solely by mkdtempSync above.
  rmSync(releaseDirectory, { recursive: true, force: true, maxRetries: 2 });
}
