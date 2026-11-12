// Cartão para stories (1080×1920), desenhado no próprio celular, e o compartilhar nativo (Instagram, WhatsApp…).
import { fmtDate, fmtDuration, t } from './i18n.js';
import { SWATCH } from './color.js';
import { colorName, grade, toast } from './core.js';
import { track } from './analytics.js';

const W = 1080, H = 1920;
const BLUE = '#2f5bff', INK = '#ffffff';
const FONT = '"SF Pro Rounded", ui-rounded, "Arial Rounded MT Bold", Nunito, system-ui, sans-serif';

const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
/** Foto de outro domínio (S3) sem "sujar" o canvas: baixa como blob (o bucket libera GET para o app). */
async function photoBitmap(url) {
  try { return await createImageBitmap(await (await fetch(url)).blob()); } catch { return null; }
}

function base(ctx) {
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, 0, W, H);
  // Riscos de giz no fundo (marca do app).
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 26;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(-100, 260 + i * 260); ctx.lineTo(W + 100, 120 + i * 260); ctx.stroke(); }
}
async function brand(ctx) {
  try { const logo = await loadImg('/icon.svg'); ctx.drawImage(logo, 80, 90, 110, 110); } catch {}
  ctx.fillStyle = INK;
  ctx.font = `900 64px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Chalkmark', 215, 147);
  ctx.font = `700 38px ${FONT}`;
  ctx.globalAlpha = 0.85;
  ctx.textAlign = 'center';
  ctx.fillText('chalkmark.vsoller.com.br', W / 2, H - 110);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Boulder mandado: foto com a via marcada, grau, cor e resultado. */
export async function climbCard(c, { photoUrl, gymName }) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  base(ctx);
  await brand(ctx);
  // Foto (cortada para caber no quadro) com as agarras da via.
  const bmp = photoUrl ? await photoBitmap(photoUrl) : null;
  const fx = 80, fy = 260, fw = W - 160, fh = 1060;
  ctx.save();
  roundRect(ctx, fx, fy, fw, fh, 48);
  ctx.clip();
  if (bmp) {
    const k = Math.max(fw / bmp.width, fh / bmp.height);
    const dw = bmp.width * k, dh = bmp.height * k, dx = fx + (fw - dw) / 2, dy = fy + (fh - dh) / 2;
    ctx.drawImage(bmp, dx, dy, dw, dh);
    ctx.lineWidth = 7;
    for (const b of c.holds ?? []) {
      ctx.strokeStyle = b.role === 'start' ? '#1fbf6a' : b.role === 'top' ? '#ff3d4f' : '#2fe3ff';
      ctx.strokeRect(dx + b.x * dw, dy + b.y * dh, b.w * dw, b.h * dh);
    }
  } else {
    ctx.fillStyle = SWATCH[c.color] ?? '#1c3ccc';
    ctx.fillRect(fx, fy, fw, fh);
  }
  ctx.restore();
  // Grau grande e o resultado.
  const flash = c.result === 'flash';
  ctx.fillStyle = INK;
  ctx.font = `900 230px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(grade(c.grade), 80, 1560);
  const gw = ctx.measureText(grade(c.grade)).width;
  ctx.font = `900 64px ${FONT}`;
  ctx.fillText(flash ? `${t('result.flash')} ⚡` : t('story.sent'), 110 + gw, 1475);
  ctx.font = `700 52px ${FONT}`;
  ctx.globalAlpha = 0.9;
  ctx.fillText(`${t('story.route', { c: colorName(c.color).toLowerCase() })}`, 110 + gw, 1550);
  ctx.globalAlpha = 0.8;
  ctx.font = `600 44px ${FONT}`;
  ctx.fillText([gymName, fmtDate(c.createdAt, { day: 'numeric', month: 'long' })].filter(Boolean).join(' · '), 80, 1650);
  ctx.globalAlpha = 1;
  return cv;
}

/** Fim de sessão: números grandes. */
export async function sessionCard({ gymName, startedAt, endedAt, climbs, sends, flashes, maxGrade, xp }) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  base(ctx);
  await brand(ctx);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 96px ${FONT}`;
  ctx.fillText(t('story.session'), 80, 420);
  ctx.font = `700 50px ${FONT}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText([gymName, fmtDate(startedAt, { day: 'numeric', month: 'long' }), fmtDuration(Date.parse(endedAt) - Date.parse(startedAt))].filter(Boolean).join(' · '), 80, 500);
  ctx.globalAlpha = 1;
  const big = [[String(climbs), t('recap.climbs')], [String(sends), t('recap.sends')], [String(flashes), t('recap.flash')], [maxGrade != null ? grade(maxGrade) : '—', t('recap.max')]];
  big.forEach(([v, l], i) => {
    const x = 80 + (i % 2) * 470, y = 680 + Math.floor(i / 2) * 420;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    roundRect(ctx, x, y, 450, 380, 44); ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `900 170px ${FONT}`;
    ctx.fillText(v, x + 40, y + 220);
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(l, x + 44, y + 320);
  });
  ctx.font = `900 72px ${FONT}`;
  ctx.fillText(`+${xp} XP`, 80, 1620);
  return cv;
}

/** Abre o compartilhar do celular com a imagem (Instagram Stories, WhatsApp…); sem suporte, baixa a imagem. */
export async function shareCard(canvas, name, kind) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
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
