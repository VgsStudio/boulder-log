// Detector de agarras no próprio navegador: YOLOv8n (ONNX, ~7 MB) via onnxruntime-web, rodando num
// Web Worker (detect-worker.js) para não travar a tela. Modelo: jwlarocque/yolov8n-freeclimbs-detect-2
// (Hugging Face, AGPL-3.0). Carrega só na primeira foto; depois fica no cache do navegador.
// A cor de cada agarra vem do color.js (mesmo método do toque).
import { boxLab, colorDistance, rgbToLab, sampleLab, suggest } from './color.js';

export const SIZE = 2560; // entrada fixa do modelo exportado
const CONF = 0.3; // abaixo disso aparecem pedaços de parede lisa como "agarra"
const IOU = 0.5;
/* global __WORKER_URL__ */
// Definido no build (scripts/build-web.mjs): o worker é um arquivo próprio, com hash no nome.
const WORKER_URL = typeof __WORKER_URL__ !== 'undefined' ? __WORKER_URL__ : '';

let worker;
let seq = 0;
const pending = new Map();
function getWorker() {
  if (!worker) {
    worker = new Worker(WORKER_URL, { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error)); else p?.resolve(data.boxes);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(e);
      pending.clear();
      worker = undefined; // recria na próxima foto
    };
  }
  return worker;
}
/** Começa a baixar runtime e modelo antes da primeira foto (o worker carrega sob demanda). */

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
  for (const b of boxes) {
    b.lab = boxLab(rgba, W, H, b);
    b.color = suggest(b.lab, palette).best;
  }
  return boxes;
}

/** Detecta as agarras da foto (canvas). Devolve [{x, y, w, h, conf, color, lab}] normalizados 0-1.
 *  Aqui só desenha o letterbox (rápido); conversão e modelo rodam no worker. */
export function detectHolds(canvas, palette = {}) {
  const W = canvas.width, H = canvas.height;
  const scale = SIZE / Math.max(W, H);
  const lb = document.createElement('canvas');
  lb.width = lb.height = SIZE;
  const ctx = lb.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(canvas, 0, 0, Math.round(W * scale), Math.round(H * scale));
  const lbPx = ctx.getImageData(0, 0, SIZE, SIZE).data.buffer;
  const full = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data.buffer;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, lb: lbPx, full, W, H, scale, palette }, [lbPx, full]);
  });
}

/** Agarras da via: as da mesma cor encadeadas a partir da tocada. Uma agarra entra se
 *  estiver a até `maxGap` (fração do lado maior da foto) de alguma já incluída, então
 *  vias da mesma cor em outro canto da parede ficam de fora.
 *  ponytail: distância fixa; se errar muito, usar a mediana da distância entre agarras vizinhas. */
export function routeHolds(boxes, seed, width, height, maxGap = 0.18, tolerance = 16) {
  const side = Math.max(width, height);
  const cx = (b) => (b.x + b.w / 2) * width, cy = (b) => (b.y + b.h / 2) * height;
  // Distância entre bordas (não centros): volumes grandes não ficam isolados.
  const gap = (a, b) => {
    const dx = Math.max(0, Math.abs(cx(a) - cx(b)) - (a.w + b.w) * width / 2);
    const dy = Math.max(0, Math.abs(cy(a) - cy(b)) - (a.h + b.h) * height / 2);
    return Math.hypot(dx, dy) / side;
  };
  // Mesma via = cor medida parecida com a da agarra tocada (não o nome da cor: uma roxa com
  // magnésio pode virar "branca" na paleta, mas a cor medida continua perto das outras roxas).
  // Agarra neutra (branca, cinza, preta) não tem matiz para comparar: aí o claro/escuro decide,
  // senão branca e cinza viram a mesma via.
  const neutral = seed.lab && Math.hypot(seed.lab[1], seed.lab[2]) < 12;
  const near = (a, c) => (neutral
    ? Math.hypot((a[0] - c[0]) / 1.6, a[1] - c[1], a[2] - c[2]) <= 15
    : colorDistance(a, c) <= tolerance);
  const similar = (b) => (b.lab && seed.lab ? near(b.lab, seed.lab) : b.color === seed.color);
  // Fora: caixas minúsculas (adesivos, etiquetas de grau, parafusos) e caixas sem contraste com
  // a parede em volta (pedaço de parede lisa que o detector confundiu com agarra; ver boxLab).
  const junk = (b) => b.w * b.h < 0.00025 || b.plain;
  const left = new Set(boxes.filter((b) => b !== seed && !junk(b) && similar(b)));
  const route = [seed];
  for (let i = 0; i < route.length; i++) {
    for (const b of left) if (gap(route[i], b) <= maxGap) { left.delete(b); route.push(b); }
  }
  return route;
}

/** Agarra que o detector não viu (volume grande, agarra rente): cresce a região pela cor a
 *  partir do toque, como um balde de tinta, numa grade reduzida. Devolve a caixa ou null.
 *  ponytail: crescimento simples por cor; parede da mesma cor da agarra vaza até o limite de área. */
export function growRegion(rgba, W, H, x, y, { tolerance = 12, maxArea = 0.2 } = {}) {
  const step = Math.max(1, Math.round(Math.max(W, H) / 360));
  const gw = Math.ceil(W / step), gh = Math.ceil(H / step);
  const labs = new Map();
  const lab = (gx, gy) => {
    const k = gy * gw + gx;
    if (!labs.has(k)) {
      const i = (Math.min(H - 1, gy * step) * W + Math.min(W - 1, gx * step)) * 4;
      labs.set(k, rgbToLab([rgba[i], rgba[i + 1], rgba[i + 2]]));
    }
    return labs.get(k);
  };
  const sx = Math.min(gw - 1, Math.round(x * W / step)), sy = Math.min(gh - 1, Math.round(y * H / step));
  // Cor de referência: mediana do miolo em volta do toque (com o desconto de magnésio do sampleLab).
  const around = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = (Math.min(H - 1, Math.max(0, (sy + dy) * step)) * W + Math.min(W - 1, Math.max(0, (sx + dx) * step))) * 4;
    around.push(rgba[i], rgba[i + 1], rgba[i + 2], 255);
  }
  const ref = sampleLab(around);
  const seen = new Uint8Array(gw * gh);
  const queue = [[sx, sy]];
  seen[sy * gw + sx] = 1;
  let x0 = sx, x1 = sx, y0 = sy, y1 = sy, n = 0;
  const limit = maxArea * gw * gh;
  while (queue.length) {
    const [cx, cy] = queue.pop();
    if (++n > limit) return null; // vazou para a parede
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || seen[ny * gw + nx]) continue;
      seen[ny * gw + nx] = 1;
      if (colorDistance(lab(nx, ny), ref) <= tolerance) queue.push([nx, ny]);
    }
  }
  if (n < 6) return null; // só um ponto: provavelmente parede ou sombra
  return { x: (x0 * step) / W, y: (y0 * step) / H, w: ((x1 - x0 + 1) * step) / W, h: ((y1 - y0 + 1) * step) / H, conf: 0, lab: ref, grown: true };
}

/** Caixa no ponto tocado: a menor que contém o ponto; senão a mais próxima até `margin`
 *  (fração do lado maior), porque o dedo raramente cai exatamente dentro da caixa. */
export function holdAt(boxes, x, y, margin = 0.03, aspect = 1) {
  const inside = boxes
    .filter((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
  if (inside) return inside;
  const gap = (b) => Math.hypot(Math.max(0, b.x - x, x - b.x - b.w) * aspect, Math.max(0, b.y - y, y - b.y - b.h));
  const nearest = boxes.map((b) => [b, gap(b)]).sort((a, b) => a[1] - b[1])[0];
  return nearest && nearest[1] <= margin ? nearest[0] : undefined;
}

