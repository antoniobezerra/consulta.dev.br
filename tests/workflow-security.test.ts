import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowsDirectory = new URL("../.github/workflows/", import.meta.url);

describe("GitHub Actions supply chain", () => {
  it("pins every third-party action to an immutable full commit SHA", () => {
    const workflowNames = readdirSync(workflowsDirectory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
    const references: string[] = [];
    for (const workflowName of workflowNames) {
      const source = readFileSync(new URL(workflowName, workflowsDirectory), "utf8");
      for (const match of source.matchAll(/^\s*-\s+uses:\s+([^\s#]+)/gm)) references.push(match[1]);
    }

    expect(references).not.toHaveLength(0);
    for (const reference of references) {
      expect(reference).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/);
    }
  });
});
