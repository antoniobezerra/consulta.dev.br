import { describe, expect, it } from "vitest";
import {
  AUTOFILL_PACKAGE_NAME,
  AUTOFILL_PROTOCOL_VERSION,
  isAutofillFrameMessage,
} from "../packages/autofill/src/index.js";
import { QR_ENGINE_INTERFACE_VERSION } from "../packages/qr-engine/src/index.js";

describe("public workspace", () => {
  it("exposes the first public protocol version consistently", () => {
    expect(AUTOFILL_PACKAGE_NAME).toBe("@consulta-dev/autofill");
    expect(AUTOFILL_PROTOCOL_VERSION).toBe(QR_ENGINE_INTERFACE_VERSION);
  });

  it("rejects incomplete iframe messages before origin validation", () => {
    expect(
      isAutofillFrameMessage({
        protocol: "consulta-autofill",
        version: 1,
        type: "embed.ready",
        project_id: "pub_12345678",
        session_id: "afs_12345678",
        nonce: "nonce-with-at-least-16-chars",
      }),
    ).toBe(true);
    expect(isAutofillFrameMessage({ protocol: "consulta-autofill", version: 1 })).toBe(false);
  });
});
