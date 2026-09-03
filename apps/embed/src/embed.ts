import {
  AUTOFILL_PROTOCOL_VERSION,
  isAutofillFrameMessage,
  type AutofillDecodedDocument,
  type AutofillFrameMessage,
} from "@consulta-dev/autofill/protocol";
import { ZXingWasmQrEngine, type QrEngine } from "@consulta-dev/qr-engine";
import { AnnotationMode, getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const PROJECT_ID_PATTERN = /^pub_[A-Za-z0-9_-]{8,128}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 3;
const MAX_RENDER_EDGE = 2_048;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const readerWasmUrl = new URL(`${import.meta.env.BASE_URL}zxing_reader.wasm`, window.location.origin).toString();

type EmbedQuery = { projectId: string; nonce: string; parentOrigin: string };
type BootstrapConfig = {
  projectId: string;
  sessionId: string;
  expiresAt: string;
  photoEnabled: boolean;
};
type DecodedResult = {
  document: AutofillDecodedDocument;
  fields: Record<string, string>;
  photoUrl: string | null;
};
type SessionPayload = { sessionToken: string; bootstrapUrl: string; parentOrigin: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function exactOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && isLocalHost(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function queryFromLocation(): EmbedQuery | null {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project_id") || "";
  const nonce = params.get("nonce") || "";
  const parentOrigin = exactOrigin(params.get("parent_origin") || "");
  return PROJECT_ID_PATTERN.test(projectId) && NONCE_PATTERN.test(nonce) && parentOrigin
    ? { projectId, nonce, parentOrigin }
    : null;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function messageText(value: unknown, fallback: string): string {
  return isRecord(value) && isRecord(value.error) && typeof value.error.message === "string" ? value.error.message : fallback;
}

function sessionPayload(value: unknown, query: EmbedQuery): SessionPayload | null {
  if (!isRecord(value)) return null;
  const token = value.session_token;
  const url = value.bootstrap_url;
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    token.length > 4_096 ||
    typeof url !== "string" ||
    value.parent_origin !== query.parentOrigin
  ) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const local = parsed.protocol === "http:" && isLocalHost(parsed.hostname);
    if ((parsed.protocol !== "https:" && !local) || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return { sessionToken: token, bootstrapUrl: url, parentOrigin: query.parentOrigin };
}

function bootstrapConfig(value: unknown, query: EmbedQuery, sessionId: string): BootstrapConfig | null {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return null;
  const data = value.data;
  if (
    data.protocol_version !== AUTOFILL_PROTOCOL_VERSION ||
    data.project_id !== query.projectId ||
    data.session_id !== sessionId ||
    typeof data.expires_at !== "string" ||
    typeof data.photo_enabled !== "boolean" ||
    !Array.isArray(data.allowed_document_types)
  ) {
    return null;
  }
  const validTypes = data.allowed_document_types.every((type) => type === "cnh-e" || type === "crlv-e");
  if (!validTypes || !data.allowed_document_types.length || Date.parse(data.expires_at) <= Date.now()) return null;
  return { projectId: query.projectId, sessionId, expiresAt: data.expires_at, photoEnabled: data.photo_enabled };
}

function decodeResult(value: unknown): DecodedResult | null {
  if (!isRecord(value) || !isRecord(value.document) || !isRecord(value.fields)) return null;
  const document = value.document;
  if ((document.type !== "cnh-e" && document.type !== "crlv-e") || typeof document.label !== "string" || !document.label) return null;
  const fields: Record<string, string> = {};
  for (const [key, field] of Object.entries(value.fields)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof field !== "string" || field.length > 4_096) return null;
    fields[key] = field;
  }
  let photoUrl: string | null = null;
  if (isRecord(value.photo) && (value.photo.mime_type === "image/jpeg" || value.photo.mime_type === "image/png") && typeof value.photo.base64 === "string") {
    const bytes = fromBase64(value.photo.base64);
    if (bytes && bytes.byteLength <= MAX_PHOTO_BYTES) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      photoUrl = URL.createObjectURL(new Blob([copy.buffer], { type: value.photo.mime_type }));
      bytes.fill(0);
    }
  }
  return { document: { type: document.type, label: document.label }, fields, photoUrl };
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    full_name: "Nome completo",
    cpf: "CPF",
    birth_date: "Data de nascimento",
    mother_name: "Nome da mãe",
    cnh_number: "Número da CNH",
    category: "Categoria",
    validity_date: "Validade",
    license_plate: "Placa",
    renavam: "RENAVAM",
    vehicle_brand: "Marca/modelo",
    vehicle_year: "Ano do veículo",
  };
  return labels[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

class EmbedController {
  private readonly engine: QrEngine = new ZXingWasmQrEngine({ wasmUrl: readerWasmUrl });
  private readonly panel: HTMLElement;
  private readonly status: HTMLElement;
  private port: MessagePort | null = null;
  private sessionId: string | null = null;
  private config: BootstrapConfig | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: number | null = null;
  private looping = false;
  private scanning = false;
  private payload: Uint8Array | null = null;
  private result: DecodedResult | null = null;
  private disposed = false;
  private readyAttempts = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly query: EmbedQuery,
  ) {
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; } body { margin: 0; } .shell { min-height: 100vh; color: #101828; background: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        header { display:flex; align-items:center; justify-content:space-between; min-height:4.25rem; padding:.85rem 1rem; border-bottom:1px solid #e4e7ec; background:#fff; } .brand { display:flex; gap:.65rem; align-items:center; font-weight:750; } .mark { display:grid; place-items:center; width:2rem; height:2rem; border-radius:.65rem; color:#fff; background:#155eef; } button { font:inherit; } button:focus-visible,input:focus-visible { outline:3px solid #84adff; outline-offset:2px; }
        .close { width:2.25rem; height:2.25rem; border:0; border-radius:.6rem; color:#475467; background:transparent; cursor:pointer; font-size:1.45rem; } .close:hover { background:#f2f4f7; } main { display:grid; min-height:calc(100vh - 4.25rem); place-items:center; padding:1.25rem; } .panel { width:min(100%,31rem); } .card { padding:1.35rem; border:1px solid #e4e7ec; border-radius:1rem; background:#fff; box-shadow:0 14px 30px rgb(16 24 40 / .08); }
        h1 { margin:0; font-size:1.35rem; letter-spacing:-.025em; } p { margin:.55rem 0 0; color:#475467; font-size:.93rem; line-height:1.52; } .actions { display:grid; gap:.65rem; margin-top:1.25rem; } .button { min-height:2.8rem; padding:.65rem .85rem; border:1px solid transparent; border-radius:.65rem; cursor:pointer; font-weight:650; } .primary { color:#fff; background:#155eef; } .primary:hover { background:#004eeb; } .secondary { color:#344054; border-color:#d0d5dd; background:#fff; } .secondary:hover { background:#f9fafb; }
        .option { display:grid; grid-template-columns:2.55rem 1fr auto; align-items:center; gap:.85rem; min-height:4.8rem; padding:.85rem; border:1px solid #d0d5dd; border-radius:.8rem; color:#101828; background:#fff; cursor:pointer; text-align:left; } .option:hover { border-color:#84adff; background:#f5f8ff; } .icon { display:grid; place-items:center; width:2.55rem; height:2.55rem; border-radius:.7rem; color:#155eef; background:#eff8ff; } .option strong,.option span { display:block; } .option span { margin-top:.12rem; color:#667085; font-size:.79rem; font-weight:400; line-height:1.4; } .arrow { color:#98a2b3; font-size:1.15rem; }
        .notice { margin-top:1rem; padding:.75rem; border-radius:.65rem; color:#344054; background:#f9fafb; font-size:.8rem; line-height:1.45; } .status { min-height:1.5rem; margin:0; padding:0 1rem 1rem; color:#667085; font-size:.78rem; text-align:center; } .spinner { display:inline-block; width:1rem; height:1rem; margin-right:.5rem; border:2px solid #d0d5dd; border-top-color:#155eef; border-radius:50%; vertical-align:-.16rem; animation:spin .75s linear infinite; }
        .camera { position:relative; overflow:hidden; margin-top:1rem; border-radius:.85rem; background:#101828; aspect-ratio:4/3; } video { width:100%; height:100%; object-fit:cover; } .guide { position:absolute; inset:50% auto auto 50%; width:min(64vw,15rem); aspect-ratio:1; transform:translate(-50%,-50%); border:2px solid rgb(255 255 255 / .9); border-radius:1rem; box-shadow:0 0 0 999px rgb(16 24 40 / .22); } .guide::after { content:""; position:absolute; top:50%; left:10%; right:10%; height:2px; background:#84adff; box-shadow:0 0 14px #84adff; animation:sweep 2s ease-in-out infinite; }
        .check { display:flex; gap:.65rem; align-items:flex-start; margin-top:1rem; padding:.78rem; border:1px solid #d0d5dd; border-radius:.7rem; color:#344054; font-size:.84rem; line-height:1.45; } .check input { width:1rem; height:1rem; margin:.1rem 0 0; accent-color:#155eef; } .badge { display:inline-flex; margin-top:.75rem; padding:.32rem .5rem; border-radius:999px; color:#175cd3; background:#eff8ff; font-size:.76rem; font-weight:700; } .field { display:grid; gap:.35rem; margin-top:.8rem; } .field label { color:#344054; font-size:.78rem; font-weight:650; } .field input { min-height:2.65rem; padding:.55rem .65rem; border:1px solid #d0d5dd; border-radius:.55rem; color:#101828; font:inherit; } .photo { display:block; width:6.3rem; height:7.8rem; margin:1rem auto 0; border:1px solid #d0d5dd; border-radius:.6rem; object-fit:cover; background:#f2f4f7; } .error { border-color:#fecdca; background:#fffbfa; } .error h1 { color:#b42318; } .hidden { display:none; }
        @keyframes spin { to { transform:rotate(360deg); } } @keyframes sweep { 0%,100% { transform:translateY(-3.5rem); opacity:.35; } 50% { transform:translateY(3.5rem); opacity:1; } }
      </style>
      <section class="shell"><header><div class="brand"><span class="mark">✓</span><span>Consulta Autofill</span></div><button type="button" class="close" aria-label="Fechar">×</button></header><main><section class="panel" aria-live="polite"></section></main><p class="status" role="status" aria-live="polite"></p></section>`;
    const panel = root.querySelector<HTMLElement>(".panel");
    const status = root.querySelector<HTMLElement>(".status");
    if (!panel || !status) throw new Error("Não foi possível inicializar o Autofill.");
    this.panel = panel;
    this.status = status;
    root.querySelector<HTMLButtonElement>(".close")?.addEventListener("click", () => this.cancel());
  }

  init(): void {
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    window.addEventListener("message", this.receiveWindowMessage);
    this.loading("Conectando ao Autofill", "Aguardando a sessão segura do seu cadastro…");
    this.announceReady();
  }

  private announceReady(): void {
    if (this.disposed || this.port || this.readyAttempts >= 3) return;
    this.readyAttempts += 1;
    window.parent.postMessage({ protocol: "consulta-autofill", version: 1, type: "embed.ready", project_id: this.query.projectId, nonce: this.query.nonce }, this.query.parentOrigin);
    window.setTimeout(() => this.announceReady(), 600);
  }

  private readonly receiveWindowMessage = (event: MessageEvent<unknown>): void => {
    if (this.port || event.origin !== this.query.parentOrigin || event.source !== window.parent || event.ports.length !== 1) return;
    if (!isAutofillFrameMessage(event.data) || event.data.type !== "parent.session") return;
    if (event.data.project_id !== this.query.projectId || event.data.nonce !== this.query.nonce) return;
    const payload = sessionPayload(event.data.payload, this.query);
    if (!payload) {
      this.error("A sessão recebida não é válida. Feche e tente novamente.");
      return;
    }
    this.sessionId = event.data.session_id;
    this.port = event.ports[0];
    this.port.onmessage = this.receivePortMessage;
    this.port.start();
    window.removeEventListener("message", this.receiveWindowMessage);
    void this.bootstrap(payload);
  };

  private async bootstrap(payload: SessionPayload): Promise<void> {
    try {
      this.setStatus("Validando sessão segura…");
      const response = await fetch(payload.bootstrapUrl, {
        method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: payload.sessionToken, parent_origin: payload.parentOrigin }),
      });
      const body: unknown = await response.json().catch(() => null);
      const config = this.sessionId ? bootstrapConfig(body, this.query, this.sessionId) : null;
      if (!response.ok || !config) throw new Error(messageText(body, "Não foi possível validar esta sessão Autofill."));
      this.config = config;
      this.setStatus("Pronto para ler seu documento.");
      this.options();
    } catch (cause) {
      this.error(cause instanceof Error ? cause.message : "Não foi possível validar esta sessão Autofill.");
    }
  }

  private readonly receivePortMessage = (event: MessageEvent<unknown>): void => {
    if (!this.config || !isAutofillFrameMessage(event.data)) return;
    const message = event.data;
    if (message.project_id !== this.config.projectId || message.session_id !== this.config.sessionId || message.nonce !== this.query.nonce) return;
    if (message.type === "parent.error") {
      this.error(messageText(message.payload, "Não foi possível decodificar o documento."));
      return;
    }
    if (message.type === "parent.close") return this.shutdown();
    if (message.type !== "parent.result") return;
    const result = decodeResult(message.payload);
    if (!result) return this.error("A resposta recebida não segue o contrato do Autofill.");
    this.result = result;
    this.clearPayload();
    this.setStatus("Confira os dados antes de preencher o formulário.");
    this.review();
  };

  private options(): void {
    if (!this.config || this.disposed) return;
    this.stopCamera();
    this.clearResult();
    this.clearPayload();
    const card = this.card("Como prefere ler o documento?", "O QR Code é lido neste dispositivo. Seus dados só seguem para a Consulta após sua confirmação.");
    const actions = document.createElement("div"); actions.className = "actions";
    actions.append(
      this.option("◉", "Usar câmera", "Aponte a câmera para o QR Code do documento.", () => void this.startCamera()),
      this.option("▧", "Enviar imagem", "JPG, PNG ou WebP com o QR Code visível.", () => this.filePicker("image/*")),
      this.option("▤", "Enviar PDF", "Lemos até as três primeiras páginas do documento.", () => this.filePicker("application/pdf")),
    );
    const notice = document.createElement("div"); notice.className = "notice"; notice.textContent = "🔒 A câmera só é ativada após seu toque. O componente não envia imagens, QR Codes ou dados para analytics.";
    card.append(actions, notice); this.panel.replaceChildren(card);
  }

  private async startCamera(): Promise<void> {
    if (!this.config || !navigator.mediaDevices?.getUserMedia) return this.error("A câmera não está disponível neste navegador.");
    this.stopCamera();
    const card = this.card("Posicione o QR Code", "Mantenha o documento iluminado e enquadre o QR dentro da área marcada.");
    const camera = document.createElement("div"); camera.className = "camera";
    const video = document.createElement("video"); video.autoplay = true; video.muted = true; video.playsInline = true;
    const guide = document.createElement("div"); guide.className = "guide"; guide.setAttribute("aria-hidden", "true"); camera.append(video, guide);
    const actions = document.createElement("div"); actions.className = "actions";
    actions.append(this.button("Ler agora", "primary", () => void this.scanCamera(true)), this.button("Voltar", "secondary", () => this.options()));
    card.append(camera, actions); this.panel.replaceChildren(card); this.video = video;
    this.setStatus("Solicitando acesso à câmera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (this.disposed || !this.video) return stream.getTracks().forEach((track) => track.stop());
      this.stream = stream; this.video.srcObject = stream; await this.video.play(); this.looping = true;
      this.setStatus("Procurando o QR Code…"); this.schedule(250);
    } catch (cause) {
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      this.error(denied ? "A câmera foi bloqueada. Você pode enviar uma imagem ou PDF." : "Não foi possível iniciar a câmera.");
    }
  }

  private schedule(delay: number): void {
    if (!this.looping || this.disposed) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; void this.scanCamera(false); }, delay);
  }

  private async scanCamera(manual: boolean): Promise<void> {
    if (!this.video || !this.looping || this.scanning) return;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !this.video.videoWidth || !this.video.videoHeight) return this.schedule(250);
    this.scanning = true;
    try {
      const payload = await this.engine.scan(this.videoImage());
      if (payload) { this.payload = payload; this.stopCamera(); this.setStatus("QR Code encontrado."); return this.confirmPayload(); }
      if (manual) this.setStatus("Ainda não encontramos um QR Code. Aproxime o documento e tente novamente.");
    } catch {
      if (manual) this.setStatus("Não foi possível ler este quadro. Tente melhorar a iluminação.");
    } finally {
      this.scanning = false;
      if (this.looping && !this.payload) this.schedule(450);
    }
  }

  private videoImage(): ImageData {
    if (!this.video) throw new Error("A câmera não está ativa.");
    const scale = Math.min(1, 1_280 / Math.max(this.video.videoWidth, this.video.videoHeight));
    const width = Math.max(1, Math.round(this.video.videoWidth * scale)); const height = Math.max(1, Math.round(this.video.videoHeight * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("Não foi possível preparar a imagem da câmera.");
    context.drawImage(this.video, 0, 0, width, height); const image = context.getImageData(0, 0, width, height); canvas.width = 1; canvas.height = 1; return image;
  }

  private filePicker(accept: string): void {
    const input = document.createElement("input"); input.type = "file"; input.accept = accept; input.className = "hidden";
    input.addEventListener("change", () => { const file = input.files?.[0]; input.remove(); if (file) void this.scanFile(file); });
    this.root.append(input); input.click();
  }

  private async scanFile(file: File): Promise<void> {
    if (!file.size || file.size > MAX_UPLOAD_BYTES) return this.error("Escolha um arquivo de até 10 MB.");
    const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!pdf && !file.type.startsWith("image/")) return this.error("Envie uma imagem (JPG, PNG ou WebP) ou um PDF.");
    this.stopCamera(); this.loading("Lendo o documento", pdf ? "Procurando o QR nas páginas iniciais do PDF…" : "Procurando o QR na imagem…");
    try {
      const payload = pdf ? await this.scanPdf(file) : await this.engine.scan(file);
      if (!payload) throw new Error("Não encontramos um QR Code neste arquivo.");
      this.payload = payload; this.setStatus("QR Code encontrado."); this.confirmPayload();
    } catch (cause) {
      this.error(cause instanceof Error ? cause.message : "Não foi possível ler este arquivo.");
    }
  }

  private async scanPdf(file: File): Promise<Uint8Array | null> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const task = getDocument({ data: bytes, stopAtErrors: true, disableFontFace: true, enableXfa: false, maxImageSize: MAX_RENDER_EDGE * MAX_RENDER_EDGE });
    try {
      const pdf = await task.promise;
      const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
      for (let number = 1; number <= pages; number += 1) {
        this.setStatus(`Lendo a página ${number} de ${pages}…`);
        const page = await pdf.getPage(number);
        try {
          const natural = page.getViewport({ scale: 1 }); const scale = Math.max(.2, Math.min(2, MAX_RENDER_EDGE / Math.max(natural.width, natural.height)));
          const viewport = page.getViewport({ scale }); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
          const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("Não foi possível renderizar o PDF.");
          await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
          const result = await this.engine.scan(context.getImageData(0, 0, canvas.width, canvas.height)); canvas.width = 1; canvas.height = 1;
          if (result) return result;
        } finally { page.cleanup(); }
      }
      return null;
    } finally {
      await task.destroy(); bytes.fill(0);
    }
  }

  private confirmPayload(): void {
    if (!this.payload || !this.config) return;
    const card = this.card("QR Code encontrado", "Antes de buscar os dados, confirme o que deseja incluir na leitura.");
    const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "✓ QR Code pronto para leitura"; card.append(badge);
    let includePhoto = false;
    if (this.config.photoEnabled) {
      const label = document.createElement("label"); label.className = "check"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.addEventListener("change", () => { includePhoto = checkbox.checked; });
      const text = document.createElement("span"); text.textContent = "Incluir a foto retornada pelo documento nesta revisão. Esta opção é opcional e fica desmarcada por padrão."; label.append(checkbox, text); card.append(label);
    }
    const actions = document.createElement("div"); actions.className = "actions";
    actions.append(this.button("Buscar dados do documento", "primary", () => this.requestDecode(includePhoto)), this.button("Ler outro documento", "secondary", () => this.options()));
    card.append(actions); this.panel.replaceChildren(card);
  }

  private requestDecode(includePhoto: boolean): void {
    if (!this.payload || !this.config) return;
    if (Date.parse(this.config.expiresAt) <= Date.now()) return this.error("A sessão expirou. Feche e abra o Autofill novamente.");
    this.loading("Buscando os dados", "A Consulta está validando o documento. Isso pode levar alguns segundos…"); this.setStatus("Decodificando documento…");
    this.post("embed.payload", { payload_base64: base64(this.payload), include_photo: includePhoto });
  }

  private review(): void {
    if (!this.result) return;
    const card = this.card("Confira antes de preencher", "Você pode editar os campos abaixo. Os valores existentes no formulário parceiro serão preservados por padrão.");
    const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = `✓ ${this.result.document.label} reconhecida`; card.append(badge);
    if (this.result.photoUrl) { const photo = document.createElement("img"); photo.className = "photo"; photo.src = this.result.photoUrl; photo.alt = "Foto retornada pelo documento"; card.append(photo); }
    const inputs = new Map<string, HTMLInputElement>();
    for (const [key, value] of Object.entries(this.result.fields)) {
      const field = document.createElement("div"); field.className = "field"; const label = document.createElement("label"); const input = document.createElement("input"); const id = `consulta-field-${key}`;
      label.htmlFor = id; label.textContent = fieldLabel(key); input.id = id; input.value = value; input.autocomplete = "off"; field.append(label, input); card.append(field); inputs.set(key, input);
    }
    const actions = document.createElement("div"); actions.className = "actions";
    actions.append(this.button("Preencher formulário", "primary", () => {
      const fields = Object.fromEntries(Array.from(inputs, ([key, input]) => [key, input.value])); this.post("embed.confirm", { document: this.result?.document, fields }); this.setStatus("Preenchendo o formulário parceiro…");
    }), this.button("Ler outro documento", "secondary", () => this.options()));
    card.append(actions); this.panel.replaceChildren(card);
  }

  private loading(title: string, text: string): void {
    const card = this.card(title, text); const spinner = document.createElement("span"); spinner.className = "spinner"; spinner.setAttribute("aria-hidden", "true"); card.querySelector("p")?.prepend(spinner); this.panel.replaceChildren(card); this.setStatus(text);
  }

  private error(text: string): void {
    this.stopCamera(); const card = this.card("Não foi possível concluir a leitura", text); card.classList.add("error"); const actions = document.createElement("div"); actions.className = "actions";
    if (this.config) actions.append(this.button("Tentar novamente", "primary", () => this.options())); actions.append(this.button("Fechar", "secondary", () => this.cancel())); card.append(actions); this.panel.replaceChildren(card); this.setStatus(text);
  }

  private card(title: string, text: string): HTMLElement {
    const card = document.createElement("section"); card.className = "card"; const heading = document.createElement("h1"); heading.textContent = title; const description = document.createElement("p"); description.textContent = text; card.append(heading, description); return card;
  }

  private option(icon: string, title: string, text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "option"; const symbol = document.createElement("span"); symbol.className = "icon"; symbol.textContent = icon; const copy = document.createElement("span"); const heading = document.createElement("strong"); heading.textContent = title; const description = document.createElement("span"); description.textContent = text; copy.append(heading, description); const arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "›"; button.append(symbol, copy, arrow); button.addEventListener("click", action); return button;
  }

  private button(label: string, kind: "primary" | "secondary", action: () => void): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = `button ${kind}`; button.textContent = label; button.addEventListener("click", action); return button;
  }

  private post(type: AutofillFrameMessage["type"], payload?: unknown): void {
    if (!this.port || !this.sessionId || this.disposed) return;
    this.port.postMessage({ protocol: "consulta-autofill", version: AUTOFILL_PROTOCOL_VERSION, type, project_id: this.query.projectId, session_id: this.sessionId, nonce: this.query.nonce, payload } satisfies AutofillFrameMessage);
  }

  private cancel(): void { this.post("embed.cancel"); this.shutdown(); }

  private stopCamera(): void {
    this.looping = false; if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; } this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null; if (this.video) this.video.srcObject = null; this.video = null;
  }

  private clearPayload(): void { this.payload?.fill(0); this.payload = null; }
  private clearResult(): void { if (this.result?.photoUrl) URL.revokeObjectURL(this.result.photoUrl); this.result = null; }

  private shutdown(): void {
    if (this.disposed) return;
    this.disposed = true; window.removeEventListener("message", this.receiveWindowMessage); this.stopCamera(); this.clearPayload(); this.clearResult(); this.port?.close(); this.port = null; this.engine.dispose(); this.panel.replaceChildren(this.card("Scanner fechado", "Você pode fechar esta janela e voltar ao cadastro.")); this.setStatus("Scanner fechado.");
  }

  private setStatus(text: string): void { this.status.textContent = text; }
}

export function startEmbed(root: HTMLElement): void {
  const query = queryFromLocation();
  if (!query) {
    root.textContent = "Esta janela do Consulta Autofill não recebeu uma configuração válida.";
    return;
  }
  new EmbedController(root, query).init();
}
