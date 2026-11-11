// Detector de agarras no próprio navegador: YOLOv8n (ONNX, ~7 MB) via onnxruntime-web.
// Modelo: jwlarocque/yolov8n-freeclimbs-detect-2 (Hugging Face, AGPL-3.0). Carrega só
// quando o usuário tira a primeira foto; depois fica no cache do navegador.
// A cor de cada agarra vem do color.js (mesmo método do toque).
import { boxLab, suggest } from './color.js';

const SIZE = 2560; // entrada fixa do modelo exportado
const CONF = 0.25;
const IOU = 0.5;
const MODEL_URL = '/assets/models/holds-yolov8n-fp16.onnx';
/* global __ORT_BASE__ */
// Definido no build (scripts/build-web.mjs) com a versão do onnxruntime-web no caminho.
const ORT_BASE = typeof __ORT_BASE__ !== 'undefined' ? __ORT_BASE__ : '/assets/ort/';

let sessionPromise;

/** Carrega (uma vez) o runtime e o modelo. */
export function loadDetector() {
  sessionPromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    // Só o .wasm vem do nosso caminho; a "cola" JS já está embutida no bundle.
    ort.env.wasm.wasmPaths = { wasm: `${ORT_BASE}ort-wasm-simd-threaded.wasm` };
    // Multithread só com isolamento de origem (COOP/COEP); senão roda em 1 thread.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session };
  })();
  sessionPromise.catch(() => (sessionPromise = undefined)); // tenta de novo na próxima foto
  return sessionPromise;
}

// float32 → bits float16 (o modelo recebe float16).
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
}
function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
  return e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? s * Infinity : s * 2 ** (e - 15) * (1 + m / 1024);
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Pós-processamento: saída [1, 5, N] (cx, cy, w, h, conf) em px do letterbox → caixas 0-1 da foto, com NMS. */
export function decode(read, n, scale, width, height, conf = CONF) {
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const c = read(4, i);
    if (c < conf) continue;
    const w = read(2, i) / scale, h = read(3, i) / scale;
    const x = read(0, i) / scale - w / 2, y = read(1, i) / scale - h / 2;
    if (x >= width || y >= height) continue; // caiu no preenchimento
    boxes.push({ x: Math.max(0, x) / width, y: Math.max(0, y) / height, w: Math.min(w, width - Math.max(0, x)) / width, h: Math.min(h, height - Math.max(0, y)) / height, conf: c });
  }
  boxes.sort((a, b) => b.conf - a.conf);
  const kept = [];
  for (const b of boxes) if (kept.every((k) => iou(k, b) < IOU)) kept.push(b);
  return kept;
}

/** Cor de cada caixa, descontando a cor da parede em volta (color.boxLab). */
export function colorize(boxes, rgba, W, H, palette) {
  for (const b of boxes) b.color = suggest(boxLab(rgba, W, H, b), palette).best;
  return boxes;
}

/** Detecta as agarras da foto (canvas). Devolve [{x, y, w, h, conf, color}] normalizados 0-1. */
export async function detectHolds(canvas, palette = {}) {
  const { ort, session } = await loadDetector();
  const W = canvas.width, H = canvas.height;
  const scale = SIZE / Math.max(W, H);
  const lb = document.createElement('canvas');
  lb.width = lb.height = SIZE;
  const ctx = lb.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(canvas, 0, 0, Math.round(W * scale), Math.round(H * scale));
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE;
  const bits = new Uint16Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    bits[i] = toHalf(px[i * 4] / 255);
    bits[plane + i] = toHalf(px[i * 4 + 1] / 255);
    bits[2 * plane + i] = toHalf(px[i * 4 + 2] / 255);
  }
  // Navegadores com Float16Array nativo exigem esse tipo; os demais aceitam os bits em Uint16Array.
  const data = typeof Float16Array !== 'undefined' ? new Float16Array(bits.buffer) : bits;
  const out = (await session.run({ [session.inputNames[0]]: new ort.Tensor('float16', data, [1, 3, SIZE, SIZE]) }))[session.outputNames[0]];
  const n = out.dims[2];
  const raw = out.data;
  const read = raw instanceof Uint16Array ? (c, i) => fromHalf(raw[c * n + i]) : (c, i) => Number(raw[c * n + i]);
  const full = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  return colorize(decode(read, n, scale, W, H), full, W, H, palette);
}

/** Agarras da via: as da mesma cor encadeadas a partir da tocada. Uma agarra entra se
 *  estiver a até `maxGap` (fração do lado maior da foto) de alguma já incluída, então
 *  vias da mesma cor em outro canto da parede ficam de fora.
 *  ponytail: distância fixa; se errar muito, usar a mediana da distância entre agarras vizinhas. */
export function routeHolds(boxes, seed, width, height, maxGap = 0.1) {
  const side = Math.max(width, height);
  const cx = (b) => (b.x + b.w / 2) * width, cy = (b) => (b.y + b.h / 2) * height;
  // Distância entre bordas (não centros): volumes grandes não ficam isolados.
  const gap = (a, b) => {
    const dx = Math.max(0, Math.abs(cx(a) - cx(b)) - (a.w + b.w) * width / 2);
    const dy = Math.max(0, Math.abs(cy(a) - cy(b)) - (a.h + b.h) * height / 2);
    return Math.hypot(dx, dy) / side;
  };
  const left = new Set(boxes.filter((b) => b !== seed && b.color === seed.color));
  const route = [seed];
  for (let i = 0; i < route.length; i++) {
    for (const b of left) if (gap(route[i], b) <= maxGap) { left.delete(b); route.push(b); }
  }
  return route;
}

/** Caixa que contém o ponto tocado (a menor, se houver sobreposição). */
export function holdAt(boxes, x, y) {
  return boxes
    .filter((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
}
