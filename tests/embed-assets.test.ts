import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const embedSource = readFileSync(new URL("../apps/embed/src/embed.ts", import.meta.url), "utf8");
const embedStyles = readFileSync(new URL("../apps/embed/src/embed.css", import.meta.url), "utf8");

describe("embed assets", () => {
  it("keeps styles in a static asset so a strict CSP does not need unsafe-inline", () => {
    expect(embedSource).not.toContain("<style>");
    expect(embedStyles).toContain(".shell");
    expect(embedStyles).toContain(".camera");
  });
});
