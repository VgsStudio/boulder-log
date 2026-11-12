// Mede o agrupamento da via (web/src/detect.js) contra as vias corrigidas pelas pessoas.
//
// Uso: node ml/eval.mjs            (depois do ml/export.mjs)
// Para cada foto com candidatas salvas: cor de cada candidata pelo mesmo color.js do app, via automática
// a partir do toque, comparação com a via salva. Mostra acerto, sobra, falta e "toques para corrigir"
// (quantas agarras a pessoa teria que ligar/desligar). Qualquer modelo novo tem que melhorar esses números.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { colorize, holdAt, routeHolds } from '../web/src/detect.js';

const dir = path.join(import.meta.dirname, 'data');
const rows = readFileSync(path.join(dir, 'labels.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i);
};
const T = { photos: 0, hit: 0, extra: 0, miss: 0, clicks: 0 };
for (const r of rows) {
  if (!r.cands?.length || !r.tap || !r.holds.length) continue;
  // Mesma resolução do app (lado maior 1568) para a cor bater com o que o celular mede.
  const { data, info } = await sharp(path.join(dir, r.image)).rotate().resize(1568, 1568, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const boxes = colorize(r.cands.map((b) => ({ ...b })), new Uint8ClampedArray(data), info.width, info.height, {});
  const seed = holdAt(boxes, r.tap.x, r.tap.y, 0.03, info.width / info.height);
  if (!seed) continue;
  const auto = routeHolds(boxes, seed, info.width, info.height);
  const hit = r.holds.filter((s) => auto.some((a) => iou(a, s) > 0.4)).length;
  const extra = auto.filter((a) => !r.holds.some((s) => iou(a, s) > 0.4)).length;
  const miss = r.holds.length - hit;
  Object.assign(T, { photos: T.photos + 1, hit: T.hit + hit, extra: T.extra + extra, miss: T.miss + miss, clicks: T.clicks + extra + miss });
  console.log(`${r.id} ${r.color.padEnd(6)} via=${r.holds.length} acerto=${hit} sobrou=${extra} faltou=${miss}`);
}
const p = T.hit / (T.hit + T.extra || 1), c = T.hit / (T.hit + T.miss || 1);
console.log(`\n${T.photos} fotos | precisão ${p.toFixed(2)} | cobertura ${c.toFixed(2)} | toques para corrigir ${T.clicks} (${(T.clicks / (T.photos || 1)).toFixed(1)} por foto)`);
