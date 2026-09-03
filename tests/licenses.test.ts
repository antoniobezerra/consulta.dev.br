import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceDirectory = resolve(import.meta.dirname, "..");

describe("license policy", () => {
  it("verifies public source and distributed dependency records", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-licenses.mjs"], {
      cwd: workspaceDirectory,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('"success": true');
  });
});
