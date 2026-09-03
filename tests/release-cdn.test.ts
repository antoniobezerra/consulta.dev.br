import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceDirectory = resolve(import.meta.dirname, "..");
const publisher = resolve(workspaceDirectory, "scripts", "publish-cdn-release.mjs");
const temporaryDirectories: string[] = [];

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function integrity(bytes: Buffer) {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

function checksumEntries(directory: string, paths: string[]) {
  return paths.map((path) => `${sha256(readFileSync(join(directory, path)))}  ${path}`).sort().join("\n");
}

function writeFixture(assetPath = "cdn/embed/v1.0.0/assets/consulta-embed.js") {
  const directory = mkdtempSync(join(tmpdir(), "consulta-cdn-release-"));
  temporaryDirectories.push(directory);
  const bytes = Buffer.from("console.log('consulta autofill');\n");
  mkdirSync(dirname(join(directory, assetPath)), { recursive: true });
  writeFileSync(join(directory, assetPath), bytes);

  const packages = [
    {
      name: "@consulta-dev/autofill",
      archive: "packages/consulta-dev-autofill-1.0.0.tgz",
      cdnPath: "cdn/autofill/v1.0.0/consulta-autofill.min.js",
    },
    {
      name: "@consulta-dev/qr-engine",
      archive: "packages/consulta-dev-qr-engine-1.0.0.tgz",
      cdnPath: "cdn/qr-engine/v1.0.0/consulta-qr-engine.min.js",
    },
  ].map((definition, index) => {
    const staging = join(directory, "staging", String(index));
    const packageDirectory = join(staging, "package");
    const distDirectory = join(packageDirectory, "dist");
    const packageBytes = Buffer.from(`export const fixture = ${index};\n`);
    mkdirSync(distDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "package.json"), `${JSON.stringify({ name: definition.name, version: "1.0.0", type: "module" })}\n`);
    writeFileSync(join(distDirectory, "index.js"), packageBytes);
    mkdirSync(dirname(join(directory, definition.archive)), { recursive: true });
    const packed = spawnSync("tar", ["-czf", join(directory, definition.archive), "-C", staging, "package"], { encoding: "utf8" });
    if (packed.status !== 0 || packed.error) throw new Error("Não foi possível preparar fixture de pacote.");
    mkdirSync(dirname(join(directory, definition.cdnPath)), { recursive: true });
    writeFileSync(join(directory, definition.cdnPath), packageBytes);
    return {
      ...definition,
      bytes: packageBytes,
    };
  });

  const manifest = {
    schema_version: 2,
    release_version: "1.0.0",
    source: { tag: null, commit: "a".repeat(40) },
    packages: packages.map((definition) => {
      const archive = readFileSync(join(directory, definition.archive));
      return {
        name: definition.name,
        version: "1.0.0",
        path: definition.archive,
        bytes: archive.byteLength,
        sha256: sha256(archive),
        integrity: integrity(archive),
      };
    }),
    cdn_assets: [
      {
        path: assetPath,
        content_type: "application/javascript; charset=utf-8",
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        integrity: integrity(bytes),
      },
      ...packages.map((definition) => ({
        path: definition.cdnPath,
        content_type: "application/javascript; charset=utf-8",
        bytes: definition.bytes.byteLength,
        sha256: sha256(definition.bytes),
        integrity: integrity(definition.bytes),
      })),
    ],
    equivalences: packages.map((definition) => ({
      package: definition.name,
      tarball_path: definition.archive,
      tarball_member: "package/dist/index.js",
      cdn_path: definition.cdnPath,
      sha256: sha256(definition.bytes),
    })),
    qr_only_candidate_included: false,
  };
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", components: [] };
  writeFileSync(join(directory, "release-manifest.json"), `${JSON.stringify(manifest)}\n`);
  writeFileSync(join(directory, "sbom.cdx.json"), `${JSON.stringify(sbom)}\n`);
  writeFileSync(join(directory, "SHA256SUMS"), `${checksumEntries(directory, [
    "release-manifest.json",
    "sbom.cdx.json",
    assetPath,
    ...packages.flatMap((definition) => [definition.archive, definition.cdnPath]),
  ])}\n`);
  return directory;
}

function runPublisher(directory: string, options: { dryRun?: boolean; credentials?: boolean; expectedReleaseVersion?: string } = {}) {
  const result = spawnSync(process.execPath, [publisher, ...(options.dryRun === false ? [] : ["--dry-run"])], {
    cwd: workspaceDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      CONSULTA_RELEASE_OUTPUT_DIR: directory,
      CONSULTA_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CONSULTA_R2_BUCKET: "consulta-autofill-assets",
      CONSULTA_CDN_PUBLIC_BASE_URL: "https://cdn.example.test/",
      AWS_ACCESS_KEY_ID: options.credentials ? "test-access-key" : "",
      AWS_SECRET_ACCESS_KEY: options.credentials ? "test-secret-key" : "",
      AWS_SESSION_TOKEN: "",
      CONSULTA_EXPECTED_RELEASE_VERSION: options.expectedReleaseVersion || "",
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("CDN release publisher", () => {
  it("plans only verified exact-version assets in dry-run mode", () => {
    const result = runPublisher(writeFixture());

    expect(result.status).toBe(0);
    expect(result.output).toContain('"dry_run": true');
    expect(result.output).toContain('"aliases_mutated": false');
    expect(result.output).toContain('"key": "embed/v1.0.0/assets/consulta-embed.js"');
  });

  it("rejects a CDN path that does not match the release version", () => {
    const result = runPublisher(writeFixture("cdn/embed/v9.9.9/assets/consulta-embed.js"));

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("precisa ser versionado pela release v1.0.0");
  });

  it("requires S3 credentials before any non-dry-run upload", () => {
    const result = runPublisher(writeFixture(), { dryRun: false });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Defina AWS_ACCESS_KEY_ID");
  });

  it("rejects a collection without the approved source tag", () => {
    const result = runPublisher(writeFixture(), { expectedReleaseVersion: "1.0.0" });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("não foi preparada a partir da tag esperada");
  });
});
