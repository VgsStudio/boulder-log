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
/** Selo inclinado (FLASH / MANDEI). */
function sticker(ctx, x, y, text, bg, fg) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.07);
  ctx.font = `900 64px ${FONT}`;
  const w = ctx.measureText(text).width + 70;
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.fillStyle = bg;
  rr(ctx, 0, -56, w, 112, 30); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 35, 2);
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

/** Boulder mandado: foto em tela cheia com a via marcada; grau gigante, selo do resultado, via, lugar e data. */
export async function climbCard(c, { photoUrl, gymName }) {
  const [cv, ctx] = canvas();
  const bmp = photoUrl ? await photoBitmap(photoUrl) : null;
  if (bmp) {
    const k = Math.max(W / bmp.width, H / bmp.height);
    const dw = bmp.width * k, dh = bmp.height * k, dx = (W - dw) / 2, dy = (H - dh) / 2 - 120; // sobe um pouco: a via costuma estar no meio/alto
    ctx.drawImage(bmp, dx, dy, dw, dh);
    // Agarras da via: contorno branco com brilho; início verde e topo vermelho.
    for (const b of c.holds ?? []) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 18;
      ctx.lineWidth = 9;
      ctx.strokeStyle = b.role === 'start' ? GREEN : b.role === 'top' ? '#ff3d4f' : '#fff';
      rr(ctx, dx + b.x * dw - 6, dy + b.y * dh - 6, b.w * dw + 12, b.h * dh + 12, 16);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, SWATCH[c.color] ?? BLUE); g.addColorStop(1, NAVY);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // Escurece em cima (marca) e embaixo (dados) para o texto ler bem sobre qualquer foto.
  let g = ctx.createLinearGradient(0, 0, 0, 360);
  g.addColorStop(0, 'rgba(11,16,36,.65)'); g.addColorStop(1, 'rgba(11,16,36,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 360);
  g = ctx.createLinearGradient(0, H * 0.48, 0, H);
  g.addColorStop(0, 'rgba(11,16,36,0)'); g.addColorStop(0.45, 'rgba(11,16,36,.82)'); g.addColorStop(1, 'rgba(11,16,36,.96)');
  ctx.fillStyle = g; ctx.fillRect(0, H * 0.48, W, H * 0.52);

  await brandPill(ctx, 64, 96);

  const flash = c.result === 'flash';
  sticker(ctx, 72, 1150, flash ? `${t('result.flash').toUpperCase()} ⚡` : t('story.sent').toUpperCase(), flash ? YELLOW : GREEN, flash ? NAVY : '#fff');

  // Grau gigante com risco de giz embaixo.
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 380px ${FONT}`;
  const gTxt = grade(c.grade);
  ctx.fillText(gTxt, 56, 1550);
  chalk(ctx, 70, 1598, Math.min(W - 140, ctx.measureText(gTxt).width + 10), flash ? YELLOW : BLUE);

  // Via (bolinha da cor) e lugar · data.
  const dotY = 1690;
  ctx.fillStyle = SWATCH[c.color] ?? '#fff';
  ctx.beginPath(); ctx.arc(86, dotY - 16, 22, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `800 54px ${FONT}`;
  const route = c.color === 'other' ? t('story.routePlain') : t('story.route', { c: colorName(c.color).toLowerCase() });
  ctx.fillText(route, 128, dotY);
  ctx.font = `600 40px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.fillText([gymName, fmtDate(c.createdAt, { day: 'numeric', month: 'short' })].filter(Boolean).join('  ·  '), 64, dotY + 76);
  footer(ctx);
  return cv;
}

/** Fim de sessão: fundo da marca, números grandes em cartões e o melhor grau em destaque. */
export async function sessionCard({ gymName, startedAt, endedAt, climbs, sends, flashes, maxGrade, xp }) {
  const [cv, ctx] = canvas();
  let g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, BLUE); g.addColorStop(1, NAVY);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Textura de giz: riscos largos e claros na diagonal.
  for (let i = 0; i < 6; i++) chalk(ctx, -60, 420 + i * 270, W + 120, 'rgba(255,255,255,.06)');
  await brandPill(ctx, 64, 96);

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 104px ${FONT}`;
  ctx.fillText(t('story.session'), 64, 400);
  chalk(ctx, 70, 440, 560, YELLOW);
  ctx.font = `600 44px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText([gymName, fmtDate(startedAt, { day: 'numeric', month: 'short' }), fmtDuration(Date.parse(endedAt) - Date.parse(startedAt))].filter(Boolean).join('  ·  '), 64, 540);

  // Melhor grau em destaque.
  ctx.fillStyle = 'rgba(255,255,255,.1)';
  rr(ctx, 64, 620, W - 128, 420, 48); ctx.fill();
  ctx.fillStyle = YELLOW;
  ctx.font = `800 46px ${FONT}`;
  ctx.fillText(t('recap.max'), 110, 710);
  ctx.fillStyle = '#fff';
  ctx.font = `900 300px ${FONT}`;
  ctx.fillText(maxGrade != null ? grade(maxGrade) : '—', 100, 990);

  const big = [[String(climbs), t('recap.climbs')], [String(sends), t('recap.sends')], [String(flashes), t('recap.flash')]];
  const cw = (W - 128 - 40) / 3;
  big.forEach(([v, l], i) => {
    const x = 64 + i * (cw + 20), y = 1080;
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    rr(ctx, x, y, cw, 330, 40); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `900 150px ${FONT}`;
    ctx.fillText(v, x + 36, y + 200);
    ctx.font = `700 40px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText(l, x + 38, y + 280);
  });
  sticker(ctx, 72, 1560, `+${xp} XP`, YELLOW, NAVY);
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
