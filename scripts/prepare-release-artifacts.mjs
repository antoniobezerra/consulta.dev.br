import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const releaseVersion = process.env.CONSULTA_RELEASE_VERSION;
const outputDirectory = resolve(process.env.CONSULTA_RELEASE_OUTPUT_DIR || resolve(workspaceDirectory, ".release-artifacts"));
const packageDirectory = resolve(outputDirectory, "packages");
const cdnDirectory = resolve(outputDirectory, "cdn");

const packages = [
  {
    name: "@consulta-dev/autofill",
    directory: resolve(workspaceDirectory, "packages", "autofill"),
    source: "dist/index.js",
    cdnPath: "autofill",
    cdnFilename: "consulta-autofill.min.js",
  },
  {
    name: "@consulta-dev/qr-engine",
    directory: resolve(workspaceDirectory, "packages", "qr-engine"),
    source: "dist/index.js",
    cdnPath: "qr-engine",
    cdnFilename: "consulta-qr-engine.min.js",
  },
];
const localPackageVersions = new Map(packages.map((definition) => [
  definition.name,
  readJson(resolve(definition.directory, "package.json")).version,
]));

if (!releaseVersion || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(releaseVersion)) {
  throw new Error("Defina CONSULTA_RELEASE_VERSION com uma versão semver, sem o prefixo v.");
}

if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
  throw new Error(`A saída de release já contém arquivos: ${outputDirectory}. Escolha um diretório vazio.`);
}

function digest(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function integrity(bytes) {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileInfo(path) {
  const bytes = readFileSync(path);
  return { bytes: bytes.byteLength, sha256: digest(bytes), integrity: integrity(bytes) };
}

function relativePath(path) {
  const value = relative(outputDirectory, path);
  if (!value || value === ".." || value.startsWith(`..${sep}`)) throw new Error("O artefato de release saiu do diretório de saída.");
  return value.split(sep).join("/");
}

function filesIn(directory) {
  const paths = [];
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) paths.push(...filesIn(path));
    else paths.push(path);
  }
  return paths;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: workspaceDirectory, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Falha ao executar ${command} para preparar a release.`);
  }
  return result;
}

function packPackage(definition) {
  const before = new Set(readdirSync(packageDirectory));
  run("pnpm", ["--filter", definition.name, "pack", "--pack-destination", packageDirectory]);
  const archive = readdirSync(packageDirectory).find((name) => name.endsWith(".tgz") && !before.has(name));
  if (!archive) throw new Error(`O pacote ${definition.name} não produziu um tarball.`);
  return resolve(packageDirectory, archive);
}

function tarballFile(archive, source) {
  const result = spawnSync("tar", ["-xOf", archive, "--", `package/${source}`], { encoding: null });
  if (result.error || result.status !== 0 || !result.stdout) {
    throw new Error(`O tarball ${archive} não contém package/${source}.`);
  }
  return result.stdout;
}

function packageComponent(name, manifest) {
  return {
    type: "library",
    name,
    version: manifest.version,
    purl: `pkg:npm/${name}@${manifest.version}`,
    licenses: [{ license: { id: manifest.license || "NOASSERTION" } }],
  };
}

function dependencyComponents(manifest) {
  return Object.entries(manifest.dependencies || {}).map(([name, version]) => {
    const resolvedVersion = typeof version === "string" && version.startsWith("workspace:")
      ? localPackageVersions.get(name) || version
      : version;
    const dependencyManifestPath = resolve(workspaceDirectory, "node_modules", name, "package.json");
    const dependencyManifest = existsSync(dependencyManifestPath) ? readJson(dependencyManifestPath) : {};
    return {
      type: "library",
      name,
      version: resolvedVersion,
      purl: `pkg:npm/${name}@${resolvedVersion}`,
      licenses: [{ license: { id: dependencyManifest.license || "NOASSERTION" } }],
    };
  });
}

mkdirSync(packageDirectory, { recursive: true, mode: 0o700 });
mkdirSync(cdnDirectory, { recursive: true, mode: 0o700 });

const packageRecords = [];
const cdnAssets = [];
const equivalences = [];
const components = [];

for (const definition of packages) {
  const manifest = readJson(resolve(definition.directory, "package.json"));
  const sourcePath = resolve(definition.directory, definition.source);
  if (!existsSync(sourcePath)) throw new Error(`Build ausente para ${definition.name}: ${sourcePath}. Execute pnpm build antes da release.`);
  const archivePath = packPackage(definition);
  const cdnPath = resolve(cdnDirectory, definition.cdnPath, `v${releaseVersion}`, definition.cdnFilename);
  mkdirSync(resolve(cdnPath, ".."), { recursive: true, mode: 0o700 });
  cpSync(sourcePath, cdnPath);

  const source = readFileSync(sourcePath);
  const packed = tarballFile(archivePath, definition.source);
  if (!source.equals(packed)) {
    throw new Error(`Os bytes publicados no CDN divergem de ${definition.name}/${definition.source} dentro do tarball.`);
  }

  const archiveInfo = fileInfo(archivePath);
  const cdnInfo = fileInfo(cdnPath);
  packageRecords.push({ name: definition.name, version: manifest.version, path: relativePath(archivePath), ...archiveInfo });
  cdnAssets.push({ path: relativePath(cdnPath), content_type: "application/javascript; charset=utf-8", ...cdnInfo });
  equivalences.push({ package: definition.name, tarball_path: relativePath(archivePath), tarball_member: `package/${definition.source}`, cdn_path: relativePath(cdnPath), sha256: cdnInfo.sha256 });
  components.push(packageComponent(definition.name, manifest), ...dependencyComponents(manifest));
}

const embedDirectory = resolve(workspaceDirectory, "apps", "embed");
const embedManifest = readJson(resolve(embedDirectory, "package.json"));
const embedBuild = resolve(embedDirectory, "dist");
if (!existsSync(embedBuild)) throw new Error("Build ausente para apps/embed/dist. Execute pnpm build antes da release.");
const embedCdnDirectory = resolve(cdnDirectory, "embed", `v${releaseVersion}`);
cpSync(embedBuild, embedCdnDirectory, { recursive: true });
for (const path of filesIn(embedCdnDirectory)) {
  const extension = path.slice(path.lastIndexOf("."));
  const contentType = extension === ".js" || extension === ".mjs"
    ? "application/javascript; charset=utf-8"
    : extension === ".css"
      ? "text/css; charset=utf-8"
      : extension === ".html"
        ? "text/html; charset=utf-8"
      : extension === ".wasm"
        ? "application/wasm"
        : "application/octet-stream";
  cdnAssets.push({ path: relativePath(path), content_type: contentType, ...fileInfo(path) });
}
components.push(packageComponent("@consulta-dev/embed", { ...embedManifest, version: releaseVersion }), ...dependencyComponents(embedManifest));

const uniqueComponents = Array.from(new Map(components.map((component) => [component.purl, component])).values()).sort((left, right) => left.purl.localeCompare(right.purl));
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "consulta-autofill-release",
      version: releaseVersion,
      licenses: [{ license: { id: "Apache-2.0" } }],
    },
  },
  components: uniqueComponents,
};

const releaseManifest = {
  schema_version: 1,
  release_version: releaseVersion,
  packages: packageRecords.sort((left, right) => left.name.localeCompare(right.name)),
  cdn_assets: cdnAssets.sort((left, right) => left.path.localeCompare(right.path)),
  equivalences,
  qr_only_candidate_included: false,
};

writeFileSync(resolve(outputDirectory, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
writeFileSync(resolve(outputDirectory, "sbom.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });

const checksums = filesIn(outputDirectory)
  .filter((path) => relativePath(path) !== "SHA256SUMS")
  .map((path) => `${digest(readFileSync(path))}  ${relativePath(path)}`)
  .sort()
  .join("\n");
writeFileSync(resolve(outputDirectory, "SHA256SUMS"), `${checksums}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });

console.log(JSON.stringify({
  success: true,
  release_version: releaseVersion,
  packages: packageRecords.length,
  cdn_assets: cdnAssets.length,
  qr_only_candidate_included: false,
}, null, 2));
