import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const verifier = resolve(import.meta.dirname, "..", "scripts", "verify-qr-only-reproducible.mjs");

function makeBuild(files: Record<string, string>): string {
  const directory = mkdtempSync(resolve(tmpdir(), "consulta-qr-only-reproducibility-"));
  temporaryDirectories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(directory, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return directory;
}

function runVerifier(primary: string, repeated: string) {
  return spawnSync(process.execPath, [verifier], {
    encoding: "utf8",
    env: {
      ...process.env,
      QR_ONLY_OUTPUT_DIR: primary,
      QR_ONLY_REPRODUCIBLE_OUTPUT_DIR: repeated,
    },
  });
}

const files = {
  "consulta_qr_reader.js": "synthetic-module",
  "consulta_qr_reader.wasm": "synthetic-wasm",
  "emscripten-version.txt": "synthetic-compiler",
  "manifest.json": "{\"synthetic\":true}\n",
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("QR-only reproducibility verifier", () => {
  it("accepts two byte-identical synthetic builds", () => {
    const result = runVerifier(makeBuild(files), makeBuild(files));

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      reproducible: true,
      compared: {
        "consulta_qr_reader.wasm": { bytes: "synthetic-wasm".length },
      },
    });
  });

  it("rejects a divergent output", () => {
    const result = runVerifier(makeBuild(files), makeBuild({ ...files, "consulta_qr_reader.wasm": "different" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Build QR-only não reproduzível: consulta_qr_reader.wasm divergiu");
  });
});
