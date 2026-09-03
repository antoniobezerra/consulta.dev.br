import { ConsultaQrOnlyEngine, ZXingWasmQrEngine, type QrEngine } from "@consulta-dev/qr-engine";
import jsQR from "jsqr";
import { EmbedQrScanner } from "./qr-scanner.js";

type BenchmarkFixture = {
  width: number;
  height: number;
  rgba_base64: string;
  expected_sha256: string;
};

type BenchmarkOptions = {
  candidateModuleUrl: string;
  candidateWasmUrl: string;
  maximumSlowdownPercent: number;
};

type QrCompatibilityOptions = Pick<BenchmarkOptions, "candidateModuleUrl" | "candidateWasmUrl">;

type BenchmarkResult = {
  worker_probe: true;
  fixture: { width: number; height: number; pixels: number };
  samples: number;
  scans_per_sample: number;
  cycles: number;
  baseline_median_ms: number;
  candidate_median_ms: number;
  candidate_slowdown_percent: number;
  baseline_p95_ms: number;
  candidate_p95_ms: number;
  candidate_p95_slowdown_percent: number;
  baseline_initialization_ms: number;
  candidate_initialization_ms: number;
  candidate_initialization_slowdown_percent: number;
  experimental_jsqr: {
    available: boolean;
    raw_bytes: true;
    samples?: number;
    median_ms?: number;
    p95_ms?: number;
  };
  candidate_heap_after_warmup_bytes: number;
  candidate_heap_after_cycles_bytes: number;
};

type QrCompatibilityResult = {
  worker_probe: true;
  baseline_probe: true;
  candidate_probe: true;
  fixture: { width: number; height: number; pixels: number };
};

const WARMUP_SCANS = 5;
const MEASURED_SCANS = 30;
const SCANS_PER_SAMPLE = 5;
const TOTAL_SCANS = 100;
const readerWasmUrl = new URL(`${import.meta.env.BASE_URL}zxing_reader.wasm`, window.location.origin).toString();

function median(samples: number[]): number {
  if (!samples.length) throw new Error("O benchmark não coletou amostras.");
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(samples: number[], percent: number): number {
  if (!samples.length) throw new Error("O benchmark não coletou amostras.");
  const sorted = [...samples].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percent;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function slowdownPercent(candidate: number, baseline: number, label: string): number {
  if (!Number.isFinite(baseline) || baseline <= 0) throw new Error(`A referência de ${label} do baseline é inválida.`);
  if (!Number.isFinite(candidate) || candidate <= 0) throw new Error(`A medição de ${label} do candidato é inválida.`);
  return ((candidate / baseline) - 1) * 100;
}

function assertSlowdownWithinBudget(candidate: number, baseline: number, label: string, maximum: number): number {
  const slowdown = slowdownPercent(candidate, baseline, label);
  if (slowdown > maximum) {
    throw new Error(`O candidato ficou ${slowdown.toFixed(2)}% mais lento em ${label}; máximo permitido: ${maximum}%.`);
  }
  return slowdown;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchFixture(): Promise<ImageData & { expectedSha256: string }> {
  const response = await fetch("/__consulta-qr-benchmark/fixture.json", { cache: "no-store" });
  const fixture = await response.json().catch(() => null) as Partial<BenchmarkFixture> | null;
  if (
    !response.ok ||
    !fixture ||
    typeof fixture.width !== "number" ||
    typeof fixture.height !== "number" ||
    typeof fixture.rgba_base64 !== "string" ||
    typeof fixture.expected_sha256 !== "string"
  ) {
    throw new Error("O fixture sintético do benchmark não é válido.");
  }
  const bytes = bytesFromBase64(fixture.rgba_base64);
  const expectedLength = fixture.width * fixture.height * 4;
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 4 || bytes.byteLength !== expectedLength) {
    bytes.fill(0);
    throw new Error("O fixture sintético tem dimensões inválidas.");
  }
  const pixels = new Uint8ClampedArray(bytes.byteLength);
  pixels.set(bytes);
  bytes.fill(0);
  const image = new ImageData(pixels, fixture.width, fixture.height) as ImageData & { expectedSha256: string };
  image.expectedSha256 = fixture.expected_sha256;
  return image;
}

async function assertExpectedBytes(bytes: Uint8Array, expectedSha256: string): Promise<void> {
  if (await sha256(bytes) !== expectedSha256) throw new Error("O leitor retornou bytes diferentes do fixture sintético.");
}

async function scanExpected(engine: QrEngine, image: ImageData, expectedSha256: string): Promise<void> {
  const bytes = await engine.scan(image);
  if (!bytes) throw new Error("O leitor não encontrou o QR Code sintético.");
  try {
    await assertExpectedBytes(bytes, expectedSha256);
  } finally {
    bytes.fill(0);
  }
}

async function timedSample(engine: QrEngine, image: ImageData, expectedSha256: string): Promise<number> {
  const results: Uint8Array[] = [];
  const started = performance.now();
  try {
    for (let index = 0; index < SCANS_PER_SAMPLE; index += 1) {
      const bytes = await engine.scan(image);
      if (!bytes) throw new Error("O leitor não encontrou o QR Code sintético.");
      results.push(bytes);
    }
    const elapsed = performance.now() - started;
    for (const bytes of results) await assertExpectedBytes(bytes, expectedSha256);
    return elapsed / SCANS_PER_SAMPLE;
  } finally {
    for (const bytes of results) bytes.fill(0);
  }
}

function readJsQr(image: ImageData): Uint8Array {
  const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
  if (!result) throw new Error("O jsQR não encontrou o QR Code sintético.");
  return Uint8Array.from(result.binaryData);
}

async function timedJsQrSample(image: ImageData, expectedSha256: string): Promise<number> {
  const results: Uint8Array[] = [];
  const started = performance.now();
  try {
    for (let index = 0; index < SCANS_PER_SAMPLE; index += 1) results.push(readJsQr(image));
    const elapsed = performance.now() - started;
    for (const bytes of results) await assertExpectedBytes(bytes, expectedSha256);
    return elapsed / SCANS_PER_SAMPLE;
  } finally {
    for (const bytes of results) bytes.fill(0);
  }
}

async function measureJsQrReference(image: ImageData, expectedSha256: string): Promise<BenchmarkResult["experimental_jsqr"]> {
  try {
    for (let index = 0; index < WARMUP_SCANS; index += 1) {
      const bytes = readJsQr(image);
      try {
        await assertExpectedBytes(bytes, expectedSha256);
      } finally {
        bytes.fill(0);
      }
    }
    const samples: number[] = [];
    for (let index = 0; index < MEASURED_SCANS; index += 1) {
      samples.push(await timedJsQrSample(image, expectedSha256));
    }
    return {
      available: true,
      raw_bytes: true,
      samples: MEASURED_SCANS,
      median_ms: Number(median(samples).toFixed(4)),
      p95_ms: Number(percentile(samples, 0.95).toFixed(4)),
    };
  } catch {
    // jsQR is a non-gating reference only. Its result must never change the
    // selected engine or turn an otherwise valid QR-only candidate into a
    // release decision.
    return { available: false, raw_bytes: true };
  }
}

function copyImage(image: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

async function scanCopiedExpected(engine: QrEngine, image: ImageData & { expectedSha256: string }): Promise<void> {
  const copy = copyImage(image);
  try {
    await scanExpected(engine, copy, image.expectedSha256);
  } finally {
    if (copy.data.byteLength) copy.data.fill(0);
  }
}

async function verifyWorkerProbe(image: ImageData & { expectedSha256: string }, options: QrCompatibilityOptions): Promise<void> {
  const pixels = new Uint8ClampedArray(image.data);
  const workerImage = new ImageData(pixels, image.width, image.height);
  const scanner = new EmbedQrScanner({
    baselineWasmUrl: readerWasmUrl,
    qrOnlyModuleUrl: options.candidateModuleUrl,
    qrOnlyWasmUrl: options.candidateWasmUrl,
  });
  try {
    await scanner.prepare();
    if (!scanner.usingWorker) throw new Error("O benchmark não conseguiu iniciar o Worker QR.");
    await scanExpected(scanner, workerImage, image.expectedSha256);
  } finally {
    if (workerImage.data.byteLength) workerImage.data.fill(0);
    scanner.dispose();
  }
}

/**
 * Functional browser gate used outside Chromium's performance benchmark. It
 * proves that both readers and the embed-owned Worker can read the same
 * synthetic QR, without making browser-specific timing a promotion gate.
 */
export async function runQrCompatibilityProbe(options: QrCompatibilityOptions): Promise<QrCompatibilityResult> {
  const image = await fetchFixture();
  const baseline = new ZXingWasmQrEngine({ wasmUrl: readerWasmUrl });
  const candidate = new ConsultaQrOnlyEngine({
    moduleUrl: options.candidateModuleUrl,
    wasmUrl: options.candidateWasmUrl,
  });
  try {
    await verifyWorkerProbe(image, options);
    await baseline.prepare();
    await candidate.prepare();
    await scanCopiedExpected(baseline, image);
    await scanCopiedExpected(candidate, image);
    return {
      worker_probe: true,
      baseline_probe: true,
      candidate_probe: true,
      fixture: { width: image.width, height: image.height, pixels: image.width * image.height },
    };
  } finally {
    image.data.fill(0);
    candidate.dispose();
    baseline.dispose();
  }
}

export async function runQrBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  if (!Number.isFinite(options.maximumSlowdownPercent) || options.maximumSlowdownPercent < 0) {
    throw new Error("O orçamento de desempenho do QR-only é inválido.");
  }
  const image = await fetchFixture();
  await verifyWorkerProbe(image, options);
  const baseline = new ZXingWasmQrEngine({ wasmUrl: readerWasmUrl });
  const candidate = new ConsultaQrOnlyEngine({
    moduleUrl: options.candidateModuleUrl,
    wasmUrl: options.candidateWasmUrl,
  });
  const baselineSamples: number[] = [];
  const candidateSamples: number[] = [];

  try {
    const baselineInitializationStarted = performance.now();
    await baseline.prepare();
    const baselineInitialization = performance.now() - baselineInitializationStarted;
    const candidateInitializationStarted = performance.now();
    await candidate.prepare();
    const candidateInitialization = performance.now() - candidateInitializationStarted;
    const initializationSlowdown = assertSlowdownWithinBudget(
      candidateInitialization,
      baselineInitialization,
      "inicialização",
      options.maximumSlowdownPercent,
    );
    for (let index = 0; index < WARMUP_SCANS; index += 1) {
      await scanExpected(baseline, image, image.expectedSha256);
      await scanExpected(candidate, image, image.expectedSha256);
    }

    const heapAfterWarmup = await candidate.memoryCapacityBytes();
    for (let index = 0; index < TOTAL_SCANS; index += 1) {
      const candidateFirst = index % 2 === 0;
      if (candidateFirst) {
        await scanExpected(candidate, image, image.expectedSha256);
        await scanExpected(baseline, image, image.expectedSha256);
      } else {
        await scanExpected(baseline, image, image.expectedSha256);
        await scanExpected(candidate, image, image.expectedSha256);
      }
    }

    const heapAfterCycles = await candidate.memoryCapacityBytes();
    if (heapAfterCycles !== heapAfterWarmup) {
      throw new Error(`O heap do candidato cresceu após ${TOTAL_SCANS} ciclos: ${heapAfterWarmup} → ${heapAfterCycles}.`);
    }
    for (let index = 0; index < MEASURED_SCANS; index += 1) {
      if (index % 2 === 0) {
        candidateSamples.push(await timedSample(candidate, image, image.expectedSha256));
        baselineSamples.push(await timedSample(baseline, image, image.expectedSha256));
      } else {
        baselineSamples.push(await timedSample(baseline, image, image.expectedSha256));
        candidateSamples.push(await timedSample(candidate, image, image.expectedSha256));
      }
    }
    const baselineMedian = median(baselineSamples);
    const candidateMedian = median(candidateSamples);
    const medianSlowdown = assertSlowdownWithinBudget(candidateMedian, baselineMedian, "mediana", options.maximumSlowdownPercent);
    const baselineP95 = percentile(baselineSamples, 0.95);
    const candidateP95 = percentile(candidateSamples, 0.95);
    const p95Slowdown = assertSlowdownWithinBudget(candidateP95, baselineP95, "p95", options.maximumSlowdownPercent);
    const jsQrReference = await measureJsQrReference(image, image.expectedSha256);
    return {
      worker_probe: true,
      fixture: { width: image.width, height: image.height, pixels: image.width * image.height },
      samples: MEASURED_SCANS,
      scans_per_sample: SCANS_PER_SAMPLE,
      cycles: TOTAL_SCANS,
      baseline_median_ms: Number(baselineMedian.toFixed(4)),
      candidate_median_ms: Number(candidateMedian.toFixed(4)),
      candidate_slowdown_percent: Number(medianSlowdown.toFixed(2)),
      baseline_p95_ms: Number(baselineP95.toFixed(4)),
      candidate_p95_ms: Number(candidateP95.toFixed(4)),
      candidate_p95_slowdown_percent: Number(p95Slowdown.toFixed(2)),
      baseline_initialization_ms: Number(baselineInitialization.toFixed(4)),
      candidate_initialization_ms: Number(candidateInitialization.toFixed(4)),
      candidate_initialization_slowdown_percent: Number(initializationSlowdown.toFixed(2)),
      experimental_jsqr: jsQrReference,
      candidate_heap_after_warmup_bytes: heapAfterWarmup,
      candidate_heap_after_cycles_bytes: heapAfterCycles,
    };
  } finally {
    image.data.fill(0);
    candidate.dispose();
    baseline.dispose();
  }
}

declare global {
  interface Window {
    consultaQrBenchmark?: {
      run: (options: BenchmarkOptions) => Promise<BenchmarkResult>;
      compatibility: (options: QrCompatibilityOptions) => Promise<QrCompatibilityResult>;
    };
  }
}

window.consultaQrBenchmark = { run: runQrBenchmark, compatibility: runQrCompatibilityProbe };
