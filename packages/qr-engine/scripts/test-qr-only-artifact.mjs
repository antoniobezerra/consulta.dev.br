import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeBarcode } from "zxing-wasm/writer";

const packageDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.env.QR_ONLY_OUTPUT_DIR || resolve(packageDirectory, ".qr-only-build"));
const modulePath = resolve(outputDirectory, "consulta_qr_reader.js");
const wasmPath = resolve(outputDirectory, "consulta_qr_reader.wasm");
const fixtureText = "consulta-qr-only-fixture-v1";

const generated = await writeBarcode(fixtureText, {
  format: "QRCode",
  scale: 6,
  addQuietZones: true,
});
if (generated.error) throw new Error(`Não foi possível gerar o QR sintético: ${generated.error}`);

const rgba = new Uint8Array(generated.symbol.data.length * 4);
for (let index = 0; index < generated.symbol.data.length; index += 1) {
  const value = generated.symbol.data[index];
  const offset = index * 4;
  rgba[offset] = value;
  rgba[offset + 1] = value;
  rgba[offset + 2] = value;
  rgba[offset + 3] = 255;
}

const namespace = await import(pathToFileURL(modulePath).href);
const factory = namespace.default || namespace.createConsultaQrReader;
if (typeof factory !== "function") throw new Error("O módulo QR-only não exporta a factory esperada.");
const module = await factory({ wasmBinary: readFileSync(wasmPath) });
const pointer = module._malloc(rgba.byteLength);
if (!pointer) throw new Error("O módulo QR-only não conseguiu alocar memória para o QR sintético.");

try {
  module.HEAPU8.set(rgba, pointer);
  const result = module.readQrCodeFromPixmap(pointer, generated.symbol.width, generated.symbol.height);
  const decoded = result?.bytes instanceof Uint8Array ? new TextDecoder().decode(result.bytes) : "";
  if (result?.format !== "QRCode" || decoded !== fixtureText) {
    throw new Error(`Leitura QR-only divergente: formato=${String(result?.format)} texto=${decoded}`);
  }
  console.log(JSON.stringify({ format: result.format, decoded, width: generated.symbol.width, height: generated.symbol.height }));
} finally {
  module.HEAPU8.fill(0, pointer, pointer + rgba.byteLength);
  module._free(pointer);
  rgba.fill(0);
}
