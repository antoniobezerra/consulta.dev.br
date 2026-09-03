import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.env.CONSULTA_RELEASE_OUTPUT_DIR || resolve(workspaceDirectory, ".release-artifacts"));
const manifestPath = resolve(outputDirectory, "release-manifest.json");
const checksumPath = resolve(outputDirectory, "SHA256SUMS");
const sbomPath = resolve(outputDirectory, "sbom.cdx.json");
const expectedReleaseVersion = process.env.CONSULTA_EXPECTED_RELEASE_VERSION?.trim() || null;

if (!existsSync(manifestPath) || !existsSync(checksumPath) || !existsSync(sbomPath)) {
  throw new Error("A coleção de release precisa conter release-manifest.json, sbom.cdx.json e SHA256SUMS.");
}
const outputRealPath = realpathSync(outputDirectory);

function digest(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function integrity(bytes) {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function insideOutput(path) {
  const absolute = resolve(outputDirectory, path);
  const pathRelative = relative(outputDirectory, absolute);
  if (!pathRelative || pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) {
    throw new Error("Um caminho de release está fora do diretório de saída.");
  }
  if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) throw new Error("Um arquivo de release não pode ser um link simbólico.");
  const resolvedRelative = relative(outputRealPath, realpathSync(absolute));
  if (resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`)) {
    throw new Error("Um arquivo de release resolve fora do diretório de saída.");
  }
  return absolute;
}

function verifyFile(path, expected) {
  const absolute = insideOutput(path);
  if (!lstatSync(absolute).isFile()) throw new Error(`Arquivo de release ausente: ${path}.`);
  const bytes = readFileSync(absolute);
  if (digest(bytes) !== expected.sha256) throw new Error(`SHA-256 divergente para ${path}.`);
  if (expected.integrity && integrity(bytes) !== expected.integrity) throw new Error(`SRI divergente para ${path}.`);
}

function tarballFile(archive, member) {
  if (!/^package\/dist\/[A-Za-z0-9._/-]+$/.test(member)) {
    throw new Error("O membro declarado do tarball não é permitido.");
  }
  const result = spawnSync("tar", ["-xOf", archive, "--", member], { encoding: null });
  if (result.error || result.status !== 0 || !result.stdout) throw new Error(`Não foi possível extrair ${member} do tarball.`);
  return result.stdout;
}

function sourceRecord(value, releaseVersion) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("O manifest de release não registra a origem do código.");
  }
  const source = value;
  if (typeof source.commit !== "string" || !/^[a-f0-9]{40}$/i.test(source.commit)) {
    throw new Error("O commit de origem no manifest de release é inválido.");
  }
  if (source.tag !== null && source.tag !== `v${releaseVersion}`) {
    throw new Error("A tag de origem no manifest de release não corresponde à versão.");
  }
  return source;
}

function remoteTagCommit(tag) {
  const result = spawnSync("git", ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
    cwd: workspaceDirectory,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) throw new Error("Não foi possível consultar a tag remota da release.");
  let direct = null;
  let peeled = null;
  for (const line of result.stdout.trim().split("\n")) {
    const [commit, reference] = line.split(/\s+/);
    if (!/^[a-f0-9]{40}$/i.test(commit)) continue;
    if (reference === `refs/tags/${tag}`) direct = commit;
    if (reference === `refs/tags/${tag}^{}`) peeled = commit;
  }
  return peeled || direct;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
if (manifest?.schema_version !== 2 || typeof manifest.release_version !== "string" || !isSemver(manifest.release_version) || !Array.isArray(manifest.packages) || !Array.isArray(manifest.cdn_assets) || !Array.isArray(manifest.equivalences) || manifest.qr_only_candidate_included !== false) {
  throw new Error("O manifest de release não corresponde à coleção permitida.");
}
if (sbom?.bomFormat !== "CycloneDX" || sbom?.specVersion !== "1.5" || !Array.isArray(sbom.components)) {
  throw new Error("O SBOM CycloneDX da release é inválido.");
}
const source = sourceRecord(manifest.source, manifest.release_version);
if (expectedReleaseVersion) {
  if (!isSemver(expectedReleaseVersion) || expectedReleaseVersion !== manifest.release_version) {
    throw new Error("A versão esperada não corresponde ao manifest de release.");
  }
  if (source.tag !== `v${expectedReleaseVersion}`) {
    throw new Error("A coleção de release não foi preparada a partir da tag esperada.");
  }
  const remoteCommit = remoteTagCommit(source.tag);
  if (!remoteCommit || remoteCommit !== source.commit) {
    throw new Error("A tag remota mudou desde a preparação da coleção de release.");
  }
}

for (const item of [...manifest.packages, ...manifest.cdn_assets]) verifyFile(item.path, item);

for (const equivalence of manifest.equivalences) {
  const archive = insideOutput(equivalence.tarball_path);
  const packed = tarballFile(archive, equivalence.tarball_member);
  const cdn = readFileSync(insideOutput(equivalence.cdn_path));
  if (!packed.equals(cdn) || digest(cdn) !== equivalence.sha256) {
    throw new Error(`Os bytes da equivalência ${equivalence.package} não conferem.`);
  }
}

const checksums = new Map();
for (const line of readFileSync(checksumPath, "utf8").trim().split("\n")) {
  const match = /^([a-f0-9]{64})[ ]{2}(.+)$/.exec(line);
  if (!match || checksums.has(match[2])) throw new Error("SHA256SUMS contém uma entrada inválida ou duplicada.");
  checksums.set(match[2], match[1]);
}
for (const [path, expected] of checksums) {
  const bytes = readFileSync(insideOutput(path));
  if (digest(bytes) !== expected) throw new Error(`SHA256SUMS diverge para ${path}.`);
}
for (const path of ["release-manifest.json", "sbom.cdx.json", ...manifest.packages.map((item) => item.path), ...manifest.cdn_assets.map((item) => item.path)]) {
  if (!checksums.has(path)) throw new Error(`SHA256SUMS não registra ${path}.`);
}

console.log(JSON.stringify({
  success: true,
  release_version: manifest.release_version,
  source,
  packages: manifest.packages.length,
  cdn_assets: manifest.cdn_assets.length,
  sbom_components: sbom.components.length,
  qr_only_candidate_included: false,
}, null, 2));
