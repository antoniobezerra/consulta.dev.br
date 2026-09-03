import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const packageManifest = JSON.parse(readFileSync(resolve(workspaceDirectory, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const changesetConfiguration = JSON.parse(readFileSync(resolve(workspaceDirectory, ".changeset", "config.json"), "utf8")) as {
  fixed?: string[][];
};

describe("release policy", () => {
  it("does not expose a local npm publication command", () => {
    expect(packageManifest.scripts?.release).toBe("node ./scripts/refuse-local-release.mjs");
    const result = spawnSync(process.execPath, ["scripts/refuse-local-release.mjs"], {
      cwd: workspaceDirectory,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("Publicação local bloqueada");
  });

  it("versions the compatible public SDK packages as one release", () => {
    expect(changesetConfiguration.fixed).toContainEqual([
      "@consulta-dev/autofill",
      "@consulta-dev/qr-engine",
    ]);
  });

  it("rejects a release collection whose version diverges from the SDK packages", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "consulta-release-version-policy-"));
    try {
      const result = spawnSync(process.execPath, ["scripts/prepare-release-artifacts.mjs"], {
        cwd: workspaceDirectory,
        encoding: "utf8",
        env: {
          ...process.env,
          CONSULTA_RELEASE_VERSION: "999.0.0",
          CONSULTA_RELEASE_OUTPUT_DIR: outputDirectory,
        },
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("precisa corresponder à coleção 999.0.0");
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it("does not treat a missing QR-only artifact as a successful benchmark", () => {
    const result = spawnSync("pnpm", ["--filter", "@consulta-dev/qr-engine", "run", "benchmark"], {
      cwd: workspaceDirectory,
      encoding: "utf8",
      env: { ...process.env, QR_ONLY_OUTPUT_DIR: "" },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("O benchmark não foi executado");
  });
});
