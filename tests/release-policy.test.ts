import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const packageManifest = JSON.parse(readFileSync(resolve(workspaceDirectory, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
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
});
