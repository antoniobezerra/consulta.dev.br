import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const releaseDirectory = mkdtempSync(join(tmpdir(), "consulta-release-dry-run-"));

function sourcePackageVersion() {
  const packageNames = ["autofill", "qr-engine"];
  const versions = packageNames.map((name) => JSON.parse(readFileSync(
    resolve(workspaceDirectory, "packages", name, "package.json"),
    "utf8",
  )).version);
  if (versions.some((version) => typeof version !== "string") || new Set(versions).size !== 1) {
    throw new Error("Os pacotes públicos precisam ter a mesma versão antes do ensaio de release.");
  }
  return versions[0];
}

const baseEnvironment = {
  ...process.env,
  // A dry run is untagged, but must exercise the exact version invariant that
  // will apply to the next tag instead of assuming the initial 0.0.0 state.
  CONSULTA_RELEASE_VERSION: sourcePackageVersion(),
  CONSULTA_RELEASE_OUTPUT_DIR: releaseDirectory,
};

function run(command, args, environment = baseEnvironment) {
  const result = spawnSync(command, args, {
    cwd: workspaceDirectory,
    env: environment,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status === 0 && !result.error) return;
  const details = (result.stderr || result.error?.message || "").trim();
  throw new Error(`Falha no ensaio de release: ${command} ${args.join(" ")}.${details ? ` ${details}` : ""}`);
}

function expectFailure(command, args, environment, message) {
  const result = spawnSync(command, args, {
    cwd: workspaceDirectory,
    env: environment,
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status === 0 || result.error || !output.includes(message)) {
    throw new Error(`O ensaio deveria rejeitar ${command} ${args.join(" ")}.`);
  }
}

try {
  run("pnpm", ["licenses:verify"]);
  run("pnpm", ["release:prepare"]);
  run("pnpm", ["release:verify"]);
  expectFailure("pnpm", ["release:verify"], {
    ...baseEnvironment,
    CONSULTA_EXPECTED_RELEASE_VERSION: baseEnvironment.CONSULTA_RELEASE_VERSION,
  }, "tag esperada");
  run("pnpm", ["release:publish-cdn", "--", "--dry-run"], {
    ...baseEnvironment,
    CONSULTA_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    CONSULTA_R2_BUCKET: "consulta-autofill-assets",
    CONSULTA_CDN_PUBLIC_BASE_URL: "https://cdn.example.test/",
  });
  console.log("Ensaio de release aprovado sem rede ou credenciais reais.");
} finally {
  // This directory was allocated solely by mkdtempSync above; no workspace
  // path or user-provided location is ever removed by this cleanup.
  rmSync(releaseDirectory, { recursive: true, force: true, maxRetries: 2 });
}
