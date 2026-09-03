import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageDirectory = resolve(import.meta.dirname, "..");
const recipeDirectory = resolve(packageDirectory, "qr-only");
const recipe = JSON.parse(readFileSync(resolve(recipeDirectory, "manifest.json"), "utf8"));
const outputDirectory = resolve(process.env.QR_ONLY_OUTPUT_DIR || resolve(packageDirectory, ".qr-only-build"));
const withoutCache = process.env.QR_ONLY_BUILD_NO_CACHE === "1";

if (process.env.QR_ONLY_BUILD_NO_CACHE && !withoutCache) {
  throw new Error("QR_ONLY_BUILD_NO_CACHE deve ser 1 quando definido.");
}

if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
  throw new Error(`A saída já contém arquivos: ${outputDirectory}. Use QR_ONLY_OUTPUT_DIR apontando para uma pasta vazia.`);
}
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const docker = spawnSync(
  "docker",
  [
    "buildx", "build",
    "--platform", recipe.emscripten.platform,
    "--build-arg", `EMSDK_IMAGE=${recipe.emscripten.image}`,
    "--build-arg", `ZXING_CPP_REPOSITORY=${recipe.zxing_cpp.repository}`,
    "--build-arg", `ZXING_CPP_COMMIT=${recipe.zxing_cpp.commit}`,
    "--output", `type=local,dest=${outputDirectory}`,
    ...(withoutCache ? ["--no-cache"] : []),
    recipeDirectory,
  ],
  { stdio: "inherit" },
);

if (docker.error) throw new Error("Docker Buildx é necessário para compilar o leitor QR-only.", { cause: docker.error });
if (docker.status !== 0) process.exit(docker.status || 1);

const files = ["consulta_qr_reader.js", "consulta_qr_reader.wasm", "emscripten-version.txt"];
const artifactFiles = Object.fromEntries(files.map((name) => {
  const path = resolve(outputDirectory, name);
  if (!existsSync(path)) throw new Error(`O build não produziu ${name}.`);
  const bytes = readFileSync(path);
  return [name, { bytes: statSync(path).size, sha256: createHash("sha256").update(bytes).digest("hex") }];
}));

writeFileSync(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify({ schema_version: 1, recipe, artifacts: artifactFiles }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600, flag: "wx" },
);

console.log(`Leitor QR-only compilado em ${outputDirectory}`);
