// Monta o conjunto de treino a partir dos dados do app, respeitando o termo das fotos.
//
// Uso (só leitura na AWS):  TABLE=<tabela> BUCKET=<bucket de fotos> node ml/export.mjs
// Saída em ml/data/ (fora do git):
//   images/<id>.<webp|jpg>   foto do boulder
//   labels.jsonl             uma linha por foto: candidatas do detector, agarras da via, início/topo,
//                            via sugerida pelo app, cor, grau
//   review.html              prancha para revisar; ids em exclude.txt ficam fora do treino
//
// Regras (termo das fotos + política de privacidade):
// - só entra boulder com foto que ainda existe (apagou o boulder ou a conta = some daqui no próximo export);
// - só de quem aceitou o termo das fotos (SETTINGS.photoTermsVersion);
// - a conta vira um código (hash), nunca o id real; nada de nome, e-mail, ginásio, anotação ou data exata;
// - ml/data/ é apagado e refeito a cada export, para nunca guardar foto excluída.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const { TABLE, BUCKET } = process.env;
if (!TABLE || !BUCKET) { console.error('defina TABLE e BUCKET'); process.exit(1); }
const out = path.join(import.meta.dirname, 'data');
const exclude = new Set(existsSync(path.join(out, 'exclude.txt'))
  ? readFileSync(path.join(out, 'exclude.txt'), 'utf8').split(/\s+/).filter(Boolean) : []);
rmSync(path.join(out, 'images'), { recursive: true, force: true });
mkdirSync(path.join(out, 'images'), { recursive: true });

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const scan = async (FilterExpression, ExpressionAttributeValues) => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: TABLE, FilterExpression, ExpressionAttributeValues, ExclusiveStartKey }));
    items.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};

const consented = new Set((await scan('sk = :s AND attribute_exists(photoTermsVersion)', { ':s': 'SETTINGS' })).map((x) => x.pk));
const climbs = await scan('begins_with(sk, :c) AND attribute_exists(photoType) AND attribute_exists(holds)', { ':c': 'CLIMB#' });
const owner = (pk) => createHash('sha256').update(String(pk)).digest('hex').slice(0, 12);

const lines = [];
let skipped = { terms: 0, photo: 0, excluded: 0, copy: 0 };
for (const c of climbs) {
  const id = String(c.sk).slice(6);
  if (!consented.has(c.pk)) { skipped.terms++; continue; }
  if (exclude.has(id)) { skipped.excluded++; continue; }
  if (c.sharedBy || c.sharedFrom) { skipped.copy++; continue; } // cópia de boulder de amigo: a foto é dele
  const sub = String(c.pk).slice(5);
  const ext = c.photoType === 'image/webp' ? 'webp' : 'jpg';
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `photos/${sub}/${id}/full` }));
    writeFileSync(path.join(out, 'images', `${id}.${ext}`), Buffer.from(await obj.Body.transformToByteArray()));
  } catch { skipped.photo++; continue; }
  lines.push(JSON.stringify({
    id, image: `images/${id}.${ext}`, owner: owner(c.pk),
    color: c.color, grade: c.grade, result: c.result,
    tap: c.tap ?? null, holds: c.holds ?? [], autoHolds: c.autoHolds ?? null,
    cands: c.cands ?? null, detector: c.detector ?? null,
  }));
}
writeFileSync(path.join(out, 'labels.jsonl'), lines.join('\n') + '\n');

// Prancha de revisão: foto com a via marcada (verde início, vermelho topo); para tirar, ponha o id em exclude.txt.
const card = (l) => {
  const j = JSON.parse(l);
  const rect = (b, cls) => `<rect class="${cls}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
  return `<figure><div class="ph"><img src="${j.image}" loading="lazy"><svg viewBox="0 0 1 1" preserveAspectRatio="none">${(j.cands ?? []).map((b) => rect(b, 'c')).join('')}${j.holds.map((b) => rect(b, b.role ?? 'h')).join('')}</svg></div><figcaption>${j.id} · ${j.color} V${j.grade} · ${j.holds.length} na via${j.cands ? ` / ${j.cands.length} cand.` : ''}</figcaption></figure>`;
};
writeFileSync(path.join(out, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Revisão do conjunto</title><style>
body{font:14px system-ui;margin:16px;background:#111;color:#eee}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.ph{position:relative}.ph img{width:100%;display:block}.ph svg{position:absolute;inset:0;width:100%;height:100%}
rect{fill:none;vector-effect:non-scaling-stroke;stroke-width:2}.c{stroke:#fff6;stroke-dasharray:3 3}.h{stroke:#0ef}.start{stroke:#1fbf6a;stroke-width:3}.top{stroke:#ff3d4f;stroke-width:3}
figcaption{font-family:monospace;font-size:12px;margin-top:4px}</style>
<h1>${lines.length} fotos</h1><p>Descarte fotos com pessoas identificáveis ou via errada: copie o id para ml/data/exclude.txt e rode o export de novo.</p>
<main>${lines.map(card).join('')}</main>`);
console.log(`ok: ${lines.length} fotos | fora: sem termo ${skipped.terms}, sem foto ${skipped.photo}, excluídas ${skipped.excluded}, cópias ${skipped.copy}`);
