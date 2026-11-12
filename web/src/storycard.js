// Cartão para stories (1080×1920), desenhado no próprio celular, e o compartilhar nativo (Instagram, WhatsApp…).
// Visual: foto da parede em tela cheia, dados por cima (como Strava), selo do resultado e risco de giz.
import { fmtDate, fmtDuration, t } from './i18n.js';
import { SWATCH } from './color.js';
import { colorName, grade, toast } from './core.js';
import { track } from './analytics.js';

const W = 1080, H = 1920;
const FONT = '"SF Pro Rounded", ui-rounded, "Arial Rounded MT Bold", Nunito, system-ui, sans-serif';
const NAVY = '#0b1024', BLUE = '#2f5bff', YELLOW = '#ffc531', GREEN = '#1fbf6a';

const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
/** Foto de outro domínio (S3) sem "sujar" o canvas: baixa como blob (o bucket libera GET para o app). */
async function photoBitmap(url) {
  try { return await createImageBitmap(await (await fetch(url)).blob()); } catch { return null; }
}
const canvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d')]; };
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** Risco de giz à mão: traço grosso com falhas (várias passadas finas e irregulares). */
function chalk(ctx, x, y, w, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = 0.35 + (i % 3) * 0.2;
    ctx.lineWidth = 7 + (i % 4) * 3;
    ctx.beginPath();
    const o = (i - 4) * 3.2;
    ctx.moveTo(x, y + o + Math.sin(i) * 3);
    ctx.bezierCurveTo(x + w * 0.3, y + o - 10, x + w * 0.65, y + o + 9, x + w, y + o - 6 + Math.cos(i) * 4);
    ctx.stroke();
  }
  ctx.restore();
}

/** Marca: logo + nome numa pílula de vidro. */
async function brandPill(ctx, x, y) {
  ctx.save();
  ctx.font = `900 46px ${FONT}`;
  const w = 96 + ctx.measureText('Chalkmark').width + 40;
  ctx.fillStyle = 'rgba(11,16,36,.55)';
  rr(ctx, x, y, w, 92, 46); ctx.fill();
  try { const logo = await loadImg('/icon.svg'); ctx.drawImage(logo, x + 18, y + 14, 64, 64); } catch {}
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText('Chalkmark', x + 96, y + 48);
  ctx.restore();
}
function footer(ctx) {
  ctx.save();
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.textAlign = 'center';
  ctx.fillText('chalkmark.vsoller.com.br', W / 2, H - 70);
  ctx.restore();
}

/** Foto cortada para cobrir o retângulo; devolve onde ela ficou (para desenhar as agarras por cima). */
function cover(ctx, bmp, x, y, w, h, lift = 0) {
  const k = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * k, dh = bmp.height * k, dx = x + (w - dw) / 2, dy = y + (h - dh) / 2 - lift;
  ctx.drawImage(bmp, dx, dy, dw, dh);
  return { dx, dy, dw, dh };
}
function holdsOn(ctx, holds, { dx, dy, dw, dh }, color = '#fff', width = 9) {
  for (const b of holds ?? []) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 16;
    ctx.lineWidth = width;
    ctx.strokeStyle = b.role === 'start' ? GREEN : b.role === 'top' ? '#ff3d4f' : color;
    rr(ctx, dx + b.x * dw - 6, dy + b.y * dh - 6, b.w * dw + 12, b.h * dh + 12, 16);
    ctx.stroke();
    ctx.restore();
  }
}
const placeText = (c, gymName) => [gymName, fmtDate(c.createdAt, { day: 'numeric', month: 'short' })].filter(Boolean).join('  ·  ');

/** Boulder mandado (estilo Strava): foto em tela cheia com a via marcada e uma faixa de dados limpa embaixo. */
export async function climbCard(c, { photoUrl, gymName }) {
  const [cv, ctx] = canvas();
  const bmp = photoUrl ? await photoBitmap(photoUrl) : null;
  const flash = c.result === 'flash';
  ctx.textBaseline = 'alphabetic';
  if (bmp) { const at = cover(ctx, bmp, 0, 0, W, H, 140); holdsOn(ctx, c.holds, at); }
  else { ctx.fillStyle = SWATCH[c.color] ?? BLUE; ctx.fillRect(0, 0, W, H); }
  shade(ctx, 1100);
  await brandPill(ctx, 64, 96);
  stats(ctx, [[grade(c.grade), t('story.grade')], [flash ? '⚡' : '✓', flash ? t('result.flash') : t('result.sent')], [colorName(c.color), t('story.color')]], 1600);
  chalk(ctx, 64, 1700, W - 128, flash ? YELLOW : GREEN);
  ctx.fillStyle = '#fff'; ctx.font = `700 44px ${FONT}`;
  ctx.fillText(placeText(c, gymName), 64, 1790);
  footer(ctx);
  return cv;
}

/** Degradê escuro da metade de baixo, para o texto ler bem sobre qualquer foto. */
function shade(ctx, from) {
  const g = ctx.createLinearGradient(0, from, 0, H);
  g.addColorStop(0, 'rgba(11,16,36,0)'); g.addColorStop(0.35, 'rgba(11,16,36,.85)'); g.addColorStop(1, 'rgba(11,16,36,.97)');
  ctx.fillStyle = g; ctx.fillRect(0, from, W, H - from);
}
/** Linha de números com legenda (o primeiro maior). */
function stats(ctx, cols, y) {
  const cw = (W - 128) / cols.length;
  cols.forEach(([v, l], k) => {
    const x = 64 + k * cw;
    ctx.fillStyle = '#fff'; ctx.font = `900 ${k === 0 ? 150 : 92}px ${FONT}`;
    ctx.fillText(v, x, y);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `700 ${cols.length > 3 ? 28 : 36}px ${FONT}`;
    ctx.fillText(l.toUpperCase(), x, y + 60);
  });
}

/** Fim de sessão, no mesmo estilo: fundo da marca, título, e a faixa de números embaixo. */
export async function sessionCard({ gymName, startedAt, endedAt, climbs, sends, flashes, maxGrade, xp, photoUrl, holds }) {
  const [cv, ctx] = canvas();
  const bmp = photoUrl ? await photoBitmap(photoUrl) : null;
  if (bmp) { const at = cover(ctx, bmp, 0, 0, W, H, 160); holdsOn(ctx, holds, at); }
  else {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, BLUE); g.addColorStop(1, NAVY); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Sem foto: a agarra do logo, grande e inclinada, ocupa o topo.
    try { const logo = await loadImg('/icon.svg'); ctx.save(); ctx.globalAlpha = 0.9; ctx.translate(W / 2, 640); ctx.rotate(-0.12); ctx.drawImage(logo, -330, -330, 660, 660); ctx.restore(); } catch {}
  }
  shade(ctx, 900);
  ctx.textBaseline = 'alphabetic';
  await brandPill(ctx, 64, 96);
  ctx.fillStyle = '#fff'; ctx.font = `900 96px ${FONT}`;
  ctx.fillText(t('story.session'), 64, 1330);
  ctx.font = `700 42px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText([gymName, fmtDate(startedAt, { day: 'numeric', month: 'short' }), fmtDuration(Date.parse(endedAt) - Date.parse(startedAt))].filter(Boolean).join('  ·  '), 64, 1400);
  stats(ctx, [[maxGrade != null ? grade(maxGrade) : '—', t('recap.max')], [String(sends), t('recap.sends')], [String(flashes), t('recap.flash')], [String(climbs), t('recap.climbs')]], 1600);
  chalk(ctx, 64, 1700, W - 128, YELLOW);
  ctx.fillStyle = '#fff'; ctx.font = `900 56px ${FONT}`;
  ctx.fillText(`+${xp} XP`, 64, 1790);
  footer(ctx);
  return cv;
}

/** Abre o compartilhar do celular com a imagem (Instagram Stories, WhatsApp…); sem suporte, baixa a imagem. */
export async function shareCard(cnv, name, kind) {
  const blob = await new Promise((r) => cnv.toBlob(r, 'image/png'));
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  track('story_shared', { kind });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: 'chalkmark.vsoller.com.br' }); } catch { /* cancelou */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('story.saved'));
}
