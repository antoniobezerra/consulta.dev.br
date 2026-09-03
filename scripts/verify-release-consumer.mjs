import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.env.CONSULTA_RELEASE_OUTPUT_DIR || resolve(workspaceDirectory, ".release-artifacts"));
const manifestPath = resolve(outputDirectory, "release-manifest.json");
const expectedPackages = ["@consulta-dev/autofill", "@consulta-dev/qr-engine"];

if (!existsSync(manifestPath)) {
  throw new Error("Prepare e verifique a coleção de release antes de validar um consumidor npm.");
}

function artifactPath(path) {
  if (typeof path !== "string") throw new Error("O manifest de release contém um caminho de pacote inválido.");
  const absolute = resolve(outputDirectory, path);
  const pathRelative = relative(outputDirectory, absolute);
  if (!pathRelative || pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || !existsSync(absolute)) {
    throw new Error("O tarball declarado no manifest está fora da coleção verificada.");
  }
  return absolute;
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_loglevel: "error",
      ...options?.env,
    },
  });
  if (result.status === 0 && !result.error) return;
  const details = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  throw new Error(`Falha ao validar a instalação por npm: ${command} ${args.join(" ")}.${details ? ` ${details}` : ""}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const records = new Map((Array.isArray(manifest.packages) ? manifest.packages : []).map((item) => [item?.name, item]));
const dependencies = {};

for (const name of expectedPackages) {
  const record = records.get(name);
  if (!record || typeof record.version !== "string" || !record.path?.endsWith(".tgz")) {
    throw new Error(`O manifest de release não contém o tarball esperado de ${name}.`);
  }
  dependencies[name] = pathToFileURL(artifactPath(record.path)).href;
}

const consumerDirectory = mkdtempSync(resolve(tmpdir(), "consulta-release-consumer-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  writeFileSync(resolve(consumerDirectory, "package.json"), `${JSON.stringify({
    name: "consulta-release-consumer-check",
    private: true,
    type: "module",
    dependencies,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });

  run(npmCommand, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--prefer-offline"], {
    cwd: consumerDirectory,
  });

  run(process.execPath, ["--input-type=module", "--eval", `
    const autofill = await import("@consulta-dev/autofill");
    const protocol = await import("@consulta-dev/autofill/protocol");
    const qrEngine = await import("@consulta-dev/qr-engine");
    if (autofill.AUTOFILL_PACKAGE_NAME !== "@consulta-dev/autofill") throw new Error("Autofill export inválido.");
    if (protocol.AUTOFILL_PROTOCOL_VERSION !== 1) throw new Error("Protocol export inválido.");
    if (qrEngine.QR_ENGINE_INTERFACE_VERSION !== 1) throw new Error("QR engine export inválido.");
  `], { cwd: consumerDirectory });

  console.log(JSON.stringify({
    success: true,
    consumer: "npm",
    packages: expectedPackages.map((name) => ({ name, version: records.get(name).version })),
  }, null, 2));
} finally {
  // The directory is created by mkdtempSync above solely for this check.
  rmSync(consumerDirectory, { recursive: true, force: true, maxRetries: 2 });
}
