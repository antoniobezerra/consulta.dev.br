import { describe, expect, it } from "vitest";
import { publicSanitizationViolations } from "../scripts/public-sanitization-policy.mjs";

describe("public sanitization policy", () => {
  it("rejects document-like binary files and archives before they can enter source control", () => {
    expect(publicSanitizationViolations("fixtures/document.pdf", Buffer.from("%PDF"))).toContain("imagem ou documento binário não pode ser versionado no repositório público");
    expect(publicSanitizationViolations("fixtures/document.jpeg", Buffer.from([0xff, 0xd8]))).toContain("imagem ou documento binário não pode ser versionado no repositório público");
    expect(publicSanitizationViolations("fixtures/archive.zip", Buffer.from("PK"))).toContain("arquivo compactado não pode ser versionado no repositório público");
  });

  it("detects a valid CPF without echoing its value", () => {
    const cpf = ["123", "456", "789", "09"].join("");
    expect(publicSanitizationViolations("fixtures/payload.txt", Buffer.from(`cpf=${cpf}`))).toContain("possível CPF válido");
    expect(publicSanitizationViolations("fixtures/payload.txt", Buffer.from("cpf=00000000000"))).not.toContain("possível CPF válido");
  });

  it("rejects large inline document data while keeping WASM and small synthetic test data eligible", () => {
    const inlineDocument = `data:image/png;base64,${"A".repeat(4_096)}`;
    expect(publicSanitizationViolations("fixtures/example.ts", Buffer.from(inlineDocument))).toContain("possível documento ou imagem embutida em base64");
    expect(publicSanitizationViolations("apps/embed/public/zxing_reader.wasm", Buffer.from([0, 97, 115, 109]))).toEqual([]);
    expect(publicSanitizationViolations("fixtures/opaque.bin", Buffer.from([0, 1, 2]))).toContain("artefato binário não aprovado no repositório público");
    expect(publicSanitizationViolations("fixtures/tiny-example.ts", Buffer.from("data:image/png;base64,AAAA"))).toEqual([]);
  });
});
