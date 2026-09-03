import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const thirdPartyPath = resolve(workspaceDirectory, "third-party", "README.md");
const thirdPartyText = readFileSync(thirdPartyPath, "utf8");
const violations = [];

function readJson(relativePath) {
  const path = resolve(workspaceDirectory, relativePath);
  if (!existsSync(path)) {
    violations.push(`${relativePath}: arquivo de licença ou manifest ausente`);
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function expect(condition, message) {
  if (!condition) violations.push(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const firstPartyManifests = [
  "package.json",
  "packages/autofill/package.json",
  "packages/qr-engine/package.json",
  "apps/embed/package.json",
];

for (const path of firstPartyManifests) {
  const manifest = readJson(path);
  expect(manifest.license === "Apache-2.0", `${path}: código próprio precisa declarar Apache-2.0`);
}

const licenseText = readFileSync(resolve(workspaceDirectory, "LICENSE"), "utf8");
expect(licenseText.includes("Apache License") && licenseText.includes("Version 2.0"), "LICENSE: texto Apache-2.0 ausente");

const noticeText = readFileSync(resolve(workspaceDirectory, "NOTICE"), "utf8");
expect(noticeText.includes("Consulta Autofill"), "NOTICE: atribuição do Consulta Autofill ausente");
expect(noticeText.includes("ZXing-C++") && noticeText.includes("Apache-2.0"), "NOTICE: atribuição ZXing-C++ ausente");

const distributedComponents = [
  {
    packageName: "zxing-wasm",
    version: "3.1.3",
    license: "MIT",
    workspaceManifest: "packages/qr-engine/package.json",
    installedManifest: "packages/qr-engine/node_modules/zxing-wasm/package.json",
  },
  {
    packageName: "pdfjs-dist",
    version: "6.3.289",
    license: "Apache-2.0",
    workspaceManifest: "apps/embed/package.json",
    installedManifest: "apps/embed/node_modules/pdfjs-dist/package.json",
  },
  {
    packageName: "jsqr",
    version: "1.4.0",
    license: "Apache-2.0",
    workspaceManifest: "apps/embed/package.json",
    installedManifest: "apps/embed/node_modules/jsqr/package.json",
  },
  {
    packageName: "aws4fetch",
    version: "1.0.20",
    license: "MIT",
    workspaceManifest: "package.json",
    installedManifest: "node_modules/aws4fetch/package.json",
  },
];

for (const component of distributedComponents) {
  const workspaceManifest = readJson(component.workspaceManifest);
  const declaredVersion = workspaceManifest.dependencies?.[component.packageName] || workspaceManifest.devDependencies?.[component.packageName];
  expect(
    declaredVersion === component.version,
    `${component.workspaceManifest}: ${component.packageName} precisa permanecer fixado em ${component.version}`,
  );
  const installedManifest = readJson(component.installedManifest);
  expect(
    installedManifest.version === component.version && installedManifest.license === component.license,
    `${component.packageName}: versão/licença instalada diverge do registro ${component.version} / ${component.license}`,
  );
  expect(
    thirdPartyText.includes(`${component.packageName}@${component.version}`),
    `third-party/README.md: falta registro de ${component.packageName}@${component.version}`,
  );
}

const baselinePath = resolve(workspaceDirectory, "apps/embed/public/zxing_reader.wasm");
const baselineHash = sha256(readFileSync(baselinePath));
expect(
  thirdPartyText.includes(`SHA-256 \`${baselineHash}\``),
  "third-party/README.md: hash do baseline zxing_reader.wasm diverge",
);

const qrOnlyRecipe = readJson("packages/qr-engine/qr-only/manifest.json");
expect(qrOnlyRecipe.zxing_cpp?.license === "Apache-2.0", "Receita QR-only: licença ZXing-C++ precisa ser Apache-2.0");
expect(
  typeof qrOnlyRecipe.zxing_cpp?.commit === "string" && thirdPartyText.includes(qrOnlyRecipe.zxing_cpp.commit),
  "third-party/README.md: commit ZXing-C++ da receita QR-only não está registrado",
);
expect(
  typeof qrOnlyRecipe.emscripten?.image === "string" && thirdPartyText.includes(qrOnlyRecipe.emscripten.image),
  "third-party/README.md: imagem Emscripten fixada da receita QR-only não está registrada",
);

if (violations.length) {
  throw new Error(`Verificação de licenças falhou:\n${violations.join("\n")}`);
}

console.log(JSON.stringify({
  success: true,
  first_party_packages: firstPartyManifests.length,
  distributed_components: distributedComponents.map(({ packageName, version, license }) => ({ package: packageName, version, license })),
  baseline_wasm_sha256: baselineHash,
}, null, 2));
