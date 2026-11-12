// Detector de agarras fora da linha principal: o YOLO (ONNX) leva segundos no celular e, rodando
// junto com a tela, congelava o app. Aqui ele roda num Web Worker e a tela continua respondendo.
// Recebe a foto já em letterbox (RGBA SIZE×SIZE) e a foto inteira (RGBA W×H); devolve as caixas com cor.
import * as ort from 'onnxruntime-web/wasm';
import { colorize, decode, SIZE } from './detect.js';

/* global __ORT_BASE__ */
const ORT_BASE = typeof __ORT_BASE__ !== 'undefined' ? __ORT_BASE__ : '/assets/ort/';
const MODEL_URL = '/assets/models/holds-yolov8n-fp16.onnx';

let sessionPromise;
function session() {
  sessionPromise ??= (async () => {
    ort.env.wasm.wasmPaths = { wasm: `${ORT_BASE}ort-wasm-simd-threaded.wasm` };
    // ponytail: 1 thread. Com várias, o runtime tenta abrir workers dentro deste worker a partir do
    // bundle e trava; no iPhone já era 1 thread (Safari não isola a origem). Se precisar de mais
    // velocidade no Android/PC, servir o glue .mjs do onnxruntime e liberar numThreads.
    ort.env.wasm.numThreads = 1;
    return ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
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
// Tabela dos 256 valores de canal já em float16: a conversão vira uma consulta.
const HALF = new Uint16Array(256).map((_, i) => toHalf(i / 255));

self.onmessage = async ({ data: { id, lb, full, W, H, scale, palette } }) => {
  try {
    const s = await session();
    const px = new Uint8ClampedArray(lb);
    const plane = SIZE * SIZE;
    const bits = new Uint16Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      bits[i] = HALF[px[i * 4]];
      bits[plane + i] = HALF[px[i * 4 + 1]];
      bits[2 * plane + i] = HALF[px[i * 4 + 2]];
    }
    // Navegadores com Float16Array nativo exigem esse tipo; os demais aceitam os bits em Uint16Array.
    const input = typeof Float16Array !== 'undefined' ? new Float16Array(bits.buffer) : bits;
    const out = (await s.run({ [s.inputNames[0]]: new ort.Tensor('float16', input, [1, 3, SIZE, SIZE]) }))[s.outputNames[0]];
    const n = out.dims[2];
    const raw = out.data;
    const read = raw instanceof Uint16Array ? (c, i) => fromHalf(raw[c * n + i]) : (c, i) => Number(raw[c * n + i]);
    const boxes = colorize(decode(read, n, scale, W, H), new Uint8ClampedArray(full), W, H, palette);
    self.postMessage({ id, boxes });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
