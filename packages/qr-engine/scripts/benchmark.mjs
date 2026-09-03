import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputDirectory = process.env.QR_ONLY_OUTPUT_DIR?.trim();

if (!outputDirectory) {
  console.error("O benchmark não foi executado: defina QR_ONLY_OUTPUT_DIR com um artefato QR-only compilado.");
  console.error("Use QR_ONLY_OUTPUT_DIR=<artefato> pnpm --filter @consulta-dev/qr-engine run qr-only:benchmark.");
  process.exitCode = 1;
} else if (!existsSync(resolve(outputDirectory))) {
  console.error("O benchmark não foi executado: QR_ONLY_OUTPUT_DIR não existe.");
  process.exitCode = 1;
} else {
  const result = spawnSync("pnpm", ["run", "qr-only:benchmark"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    process.exitCode = result.status || 1;
  }
}
