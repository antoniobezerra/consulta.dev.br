import { ConsultaQrOnlyEngine, ZXingWasmQrEngine, type QrEngine } from "@consulta-dev/qr-engine";
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

type BenchmarkResult = {
  worker_probe: true;
  fixture: { width: number; height: number; pixels: number };
  samples: number;
  scans_per_sample: number;
  cycles: number;
  baseline_median_ms: number;
  candidate_median_ms: number;
  candidate_slowdown_percent: number;
  candidate_heap_after_warmup_bytes: number;
  candidate_heap_after_cycles_bytes: number;
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

async function verifyWorkerProbe(image: ImageData & { expectedSha256: string }, options: BenchmarkOptions): Promise<void> {
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
    await baseline.prepare();
    await candidate.prepare();
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
    if (baselineMedian <= 0) throw new Error("A mediana do baseline é inválida.");
    const slowdownPercent = ((candidateMedian / baselineMedian) - 1) * 100;
    if (slowdownPercent > options.maximumSlowdownPercent) {
      throw new Error(`O candidato ficou ${slowdownPercent.toFixed(2)}% mais lento; máximo permitido: ${options.maximumSlowdownPercent}%.`);
    }
    return {
      worker_probe: true,
      fixture: { width: image.width, height: image.height, pixels: image.width * image.height },
      samples: MEASURED_SCANS,
      scans_per_sample: SCANS_PER_SAMPLE,
      cycles: TOTAL_SCANS,
      baseline_median_ms: Number(baselineMedian.toFixed(4)),
      candidate_median_ms: Number(candidateMedian.toFixed(4)),
      candidate_slowdown_percent: Number(slowdownPercent.toFixed(2)),
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
    consultaQrBenchmark?: { run: (options: BenchmarkOptions) => Promise<BenchmarkResult> };
  }
}

window.consultaQrBenchmark = { run: runQrBenchmark };
