import { describe, expect, it } from "vitest";
import { AUTOFILL_PACKAGE_NAME, AUTOFILL_PROTOCOL_VERSION } from "../packages/autofill/src/index.js";
import { QR_ENGINE_INTERFACE_VERSION } from "../packages/qr-engine/src/index.js";

describe("public workspace", () => {
  it("exposes the first public protocol version consistently", () => {
    expect(AUTOFILL_PACKAGE_NAME).toBe("@consulta-dev/autofill");
    expect(AUTOFILL_PROTOCOL_VERSION).toBe(QR_ENGINE_INTERFACE_VERSION);
  });
});

