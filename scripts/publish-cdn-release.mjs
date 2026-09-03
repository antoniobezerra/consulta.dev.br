import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.env.CONSULTA_RELEASE_OUTPUT_DIR || resolve(workspaceDirectory, ".release-artifacts"));
const manifestPath = resolve(outputDirectory, "release-manifest.json");
const cacheControl = "public, max-age=31536000, immutable";
const publisherArguments = process.argv.slice(2).filter((argument) => argument !== "--");
const dryRun = publisherArguments.includes("--dry-run");

if (publisherArguments.some((argument) => argument !== "--dry-run")) {
  throw new Error("Uso: node scripts/publish-cdn-release.mjs [--dry-run].");
}

function digest(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function integrity(bytes) {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Defina ${name} para publicar os assets no CDN.`);
  return value;
}

function releaseVerifier() {
  const result = spawnSync(process.execPath, [resolve(workspaceDirectory, "scripts", "verify-release-artifacts.mjs")], {
    cwd: workspaceDirectory,
    encoding: "utf8",
    env: { ...process.env, CONSULTA_RELEASE_OUTPUT_DIR: outputDirectory },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0 || result.error) {
    const details = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`A coleção de release não passou na verificação obrigatória.${details ? ` ${details}` : ""}`);
  }
}

function insideOutput(path, outputRealPath) {
  const absolute = resolve(outputDirectory, path);
  const pathRelative = relative(outputDirectory, absolute);
  if (!pathRelative || pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) {
    throw new Error(`O asset de CDN está fora da coleção de release: ${path}.`);
  }
  if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()) {
    throw new Error(`O asset de CDN não é um arquivo regular: ${path}.`);
  }
  const resolvedRelative = relative(outputRealPath, realpathSync(absolute));
  if (resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`)) {
    throw new Error(`O asset de CDN resolve fora da coleção de release: ${path}.`);
  }
  return absolute;
}

function cdnKey(path, releaseVersion) {
  const components = path.split("/");
  const version = `v${releaseVersion}`;
  if (
    components.length < 4 ||
    components[0] !== "cdn" ||
    components.filter((component) => component === version).length !== 1 ||
    components.at(-1) === version ||
    components.some((component) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(component))
  ) {
    throw new Error(`O caminho de CDN precisa ser versionado pela release ${version}: ${path}.`);
  }
  return components.slice(1).join("/");
}

function validContentType(value) {
  return /^[A-Za-z0-9!#$&^_.+/-]+(?:;[ \t]*[A-Za-z0-9!#$&^_.+/-]+=[A-Za-z0-9!#$&^_.+/-]+)*$/.test(value);
}

function normalizeContentType(value) {
  return value.replace(/\s*;\s*/g, ";").toLowerCase();
}

function cacheDirectives(value) {
  return new Set(value.split(",").map((directive) => directive.trim().toLowerCase()).filter(Boolean));
}

function hasExpectedCacheControl(value) {
  const actual = cacheDirectives(value);
  const expected = cacheDirectives(cacheControl);
  return actual.size === expected.size && [...expected].every((directive) => actual.has(directive));
}

function configuredTarget() {
  const accountId = requiredEnvironment("CONSULTA_R2_ACCOUNT_ID");
  const bucket = requiredEnvironment("CONSULTA_R2_BUCKET");
  const publicBase = requiredEnvironment("CONSULTA_CDN_PUBLIC_BASE_URL");
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error("CONSULTA_R2_ACCOUNT_ID deve ser o Account ID hexadecimal do Cloudflare.");
  if (!/^[a-z0-9](?:[a-z0-9.-]{1,61})[a-z0-9]$/.test(bucket)) throw new Error("CONSULTA_R2_BUCKET não é um nome de bucket R2 permitido.");

  let publicUrl;
  try {
    publicUrl = new URL(publicBase);
  } catch {
    throw new Error("CONSULTA_CDN_PUBLIC_BASE_URL precisa ser uma URL HTTPS válida.");
  }
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || !publicUrl.pathname.endsWith("/")) {
    throw new Error("CONSULTA_CDN_PUBLIC_BASE_URL precisa ser uma URL HTTPS sem credenciais, query ou hash e terminar em '/'.");
  }
  return {
    accountId,
    bucket,
    publicUrl,
    endpoint: new URL(`https://${accountId}.r2.cloudflarestorage.com/`),
  };
}

function objectUrl(target, key) {
  return new URL(`${target.bucket}/${key}`, target.endpoint).toString();
}

function publicAssetUrl(target, key) {
  return new URL(key, target.publicUrl).toString();
}

function errorDetails(response) {
  return response.text()
    .then((body) => body.replace(/\s+/g, " ").trim().slice(0, 800))
    .catch(() => "");
}

async function failedResponse(operation, asset, response) {
  const details = await errorDetails(response);
  throw new Error(`${operation} falhou para ${asset.path} (HTTP ${response.status}).${details ? ` ${details}` : ""}`);
}

function headersFor(asset, releaseVersion) {
  return {
    "Cache-Control": cacheControl,
    "Content-MD5": createHash("md5").update(asset.bytes).digest("base64"),
    "Content-Type": asset.contentType,
    "If-None-Match": "*",
    "X-Amz-Meta-Consulta-Release-Version": releaseVersion,
    "X-Amz-Meta-Consulta-Sha256": asset.sha256,
  };
}

function requestOptions(options = {}) {
  return {
    ...options,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    aws: { allHeaders: true },
  };
}

function assertRemoteHeaders(asset, releaseVersion, headers, source) {
  const receivedType = headers.get("content-type");
  if (!receivedType || normalizeContentType(receivedType) !== normalizeContentType(asset.contentType)) {
    throw new Error(`${source} retornou Content-Type inesperado para ${asset.path}.`);
  }
  const receivedCacheControl = headers.get("cache-control");
  if (!receivedCacheControl || !hasExpectedCacheControl(receivedCacheControl)) {
    throw new Error(`${source} retornou Cache-Control inesperado para ${asset.path}.`);
  }
  if (source === "R2") {
    if (headers.get("x-amz-meta-consulta-release-version") !== releaseVersion) {
      throw new Error(`R2 não preservou a versão da release em ${asset.path}.`);
    }
    if (headers.get("x-amz-meta-consulta-sha256") !== asset.sha256) {
      throw new Error(`R2 não preservou o SHA-256 da release em ${asset.path}.`);
    }
  }
}

async function readAndVerify(client, url, asset, releaseVersion, source) {
  const response = await client.fetch(url, requestOptions({ method: "GET" }));
  if (!response.ok) await failedResponse(`Leitura de verificação no ${source}`, asset, response);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== asset.sha256 || bytes.byteLength !== asset.bytes.byteLength) {
    throw new Error(`${source} retornou bytes divergentes para ${asset.path}.`);
  }
  assertRemoteHeaders(asset, releaseVersion, response.headers, source);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function eventually(operation) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(250 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function publicSmoke(target, asset, releaseVersion) {
  const url = publicAssetUrl(target, asset.key);
  await eventually(async () => {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Origin: "https://embed.consulta.dev.br" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) await failedResponse("Smoke público do CDN", asset, response);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== asset.sha256 || bytes.byteLength !== asset.bytes.byteLength) {
      throw new Error(`O CDN público retornou bytes divergentes para ${asset.path}.`);
    }
    assertRemoteHeaders(asset, releaseVersion, response.headers, "CDN público");
    if (response.headers.get("access-control-allow-origin") !== "*") {
      throw new Error(`O CDN público precisa retornar Access-Control-Allow-Origin: * para ${asset.path}.`);
    }
  });
}

releaseVerifier();

if (!existsSync(manifestPath)) throw new Error("release-manifest.json não foi encontrado na coleção verificada.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (
  manifest?.schema_version !== 2 ||
  typeof manifest.release_version !== "string" ||
  !Array.isArray(manifest.cdn_assets) ||
  manifest.cdn_assets.length === 0 ||
  manifest.qr_only_candidate_included !== false
) {
  throw new Error("O manifest não permite a publicação de CDN desta coleção.");
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(manifest.release_version)) {
  throw new Error("A versão declarada no manifest de CDN não é semver.");
}
const outputRealPath = realpathSync(outputDirectory);
const keys = new Set();
const assets = manifest.cdn_assets.map((entry) => {
  if (!entry || typeof entry.path !== "string" || typeof entry.sha256 !== "string" || typeof entry.content_type !== "string") {
    throw new Error("Um asset de CDN no manifest é inválido.");
  }
  if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !validContentType(entry.content_type)) {
    throw new Error(`Os metadados do asset de CDN são inválidos: ${entry.path}.`);
  }
  const key = cdnKey(entry.path, manifest.release_version);
  if (keys.has(key)) throw new Error(`O manifest repete a chave de CDN ${key}.`);
  keys.add(key);
  const bytes = readFileSync(insideOutput(entry.path, outputRealPath));
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes !== bytes.byteLength || digest(bytes) !== entry.sha256 || integrity(bytes) !== entry.integrity) {
    throw new Error(`O arquivo local diverge do manifest de CDN: ${entry.path}.`);
  }
  return { path: entry.path, key, sha256: entry.sha256, contentType: entry.content_type, bytes };
});
const target = configuredTarget();

if (dryRun) {
  console.log(JSON.stringify({
    success: true,
    dry_run: true,
    release_version: manifest.release_version,
    bucket: target.bucket,
    cdn_public_base_url: target.publicUrl.toString(),
    cache_control: cacheControl,
    aliases_mutated: false,
    assets: assets.map((asset) => ({ path: asset.path, key: asset.key, sha256: asset.sha256, content_type: asset.contentType })),
  }, null, 2));
  process.exit(0);
}

const client = new AwsClient({
  accessKeyId: requiredEnvironment("AWS_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnvironment("AWS_SECRET_ACCESS_KEY"),
  sessionToken: process.env.AWS_SESSION_TOKEN?.trim() || undefined,
  service: "s3",
  region: "auto",
  retries: 2,
  initRetryMs: 250,
});
const results = [];
for (const asset of assets) {
  const response = await client.fetch(objectUrl(target, asset.key), requestOptions({
    method: "PUT",
    headers: headersFor(asset, manifest.release_version),
    body: asset.bytes,
  }));
  let status = "uploaded";
  if (response.status === 412) status = "already_exists";
  else if (!response.ok) await failedResponse("Upload para R2", asset, response);

  await readAndVerify(client, objectUrl(target, asset.key), asset, manifest.release_version, "R2");
  console.log(`CDN ${status}: ${asset.key}`);
  results.push({ key: asset.key, status });
}

for (const asset of assets) {
  await publicSmoke(target, asset, manifest.release_version);
  console.log(`CDN público verificado: ${asset.key}`);
}

console.log(JSON.stringify({
  success: true,
  release_version: manifest.release_version,
  bucket: target.bucket,
  cache_control: cacheControl,
  aliases_mutated: false,
  assets: results,
}, null, 2));
