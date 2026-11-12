// Cor da agarra tocada: mediana dos pixels em volta do toque → CIELAB → cor mais
// próxima da paleta do ginásio. Tudo no navegador, sem rede.

export const COLORS = ['green', 'purple', 'yellow', 'white', 'wood', 'red', 'blue', 'black', 'orange', 'pink', 'other'];

// Referências genéricas (sRGB). A calibração por ginásio substitui estas.
const DEFAULT_RGB = {
  green: [46, 158, 79],
  purple: [107, 63, 160],
  yellow: [242, 208, 36],
  white: [236, 236, 230],
  wood: [180, 138, 90],
  red: [208, 48, 48],
  blue: [47, 111, 208],
  black: [40, 40, 40],
  orange: [240, 122, 32],
  pink: [236, 111, 168],
};

// Cor para desenhar o chip (só visual).
export const SWATCH = {
  ...Object.fromEntries(Object.entries(DEFAULT_RGB).map(([k, [r, g, b]]) => [k, `rgb(${r} ${g} ${b})`])),
  other: 'transparent',
};

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** sRGB (0-255) → CIELAB (D65). */
export function rgbToLab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export const DEFAULT_PALETTE = Object.fromEntries(Object.entries(DEFAULT_RGB).map(([k, v]) => [k, rgbToLab(v)]));

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

/** RGBA de getImageData → Lab da mediana, ignorando sombra e reflexo estourado. */
export function sampleLab(rgba) {
  const keep = [[], [], []];
  const all = [[], [], []];
  for (let i = 0; i < rgba.length; i += 4) {
    const px = [rgba[i], rgba[i + 1], rgba[i + 2]];
    const max = Math.max(...px), min = Math.min(...px);
    px.forEach((v, c) => all[c].push(v));
    if (max < 25 || min > 250) continue;
    px.forEach((v, c) => keep[c].push(v));
  }
  // Agarra preta ou branca pura: se o filtro tirou quase tudo, usa todos os pixels.
  let src = keep[0].length >= all[0].length / 4 ? keep : all;
  // Magnésio deixa a agarra acinzentada: se ao menos 20% dos pixels têm cor de verdade
  // (saturação), a mediana sai só deles. Agarra branca/preta não tem esses 20% e segue igual.
  const vivid = [[], [], []];
  for (let i = 0; i < src[0].length; i++) {
    const r = src[0][i], g = src[1][i], b = src[2][i];
    if (Math.max(r, g, b) - Math.min(r, g, b) >= 35) { vivid[0].push(r); vivid[1].push(g); vivid[2].push(b); }
  }
  if (vivid[0].length >= src[0].length * 0.2) src = vivid;
  return rgbToLab(src.map(median));
}

/** Cor da agarra dentro de uma caixa da imagem inteira (RGBA, largura W): desconta a parede.
 *  A cor da parede é a mediana de um anel em volta da caixa; da agarra contam só os pixels
 *  que diferem dela. Caixa = {x, y, w, h} normalizados 0-1. */
export function boxLab(rgba, W, H, b) {
  const x0 = Math.max(0, Math.floor(b.x * W)), y0 = Math.max(0, Math.floor(b.y * H));
  const x1 = Math.min(W, Math.ceil((b.x + b.w) * W)), y1 = Math.min(H, Math.ceil((b.y + b.h) * H));
  const pad = Math.max(3, Math.round(Math.min(x1 - x0, y1 - y0) * 0.25));
  const step = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) / 60)); // ~60x60 amostras no máximo
  const inner = [], ring = [];
  for (let y = Math.max(0, y0 - pad); y < Math.min(H, y1 + pad); y += step) {
    for (let x = Math.max(0, x0 - pad); x < Math.min(W, x1 + pad); x += step) {
      const i = (y * W + x) * 4;
      (x >= x0 && x < x1 && y >= y0 && y < y1 ? inner : ring).push(rgba[i], rgba[i + 1], rgba[i + 2], 255);
    }
  }
  if (!ring.length) return sampleLab(inner);
  const wall = sampleLab(ring);
  const hold = [];
  for (let i = 0; i < inner.length; i += 4) {
    const lab = rgbToLab([inner[i], inner[i + 1], inner[i + 2]]);
    if (Math.hypot(lab[0] - wall[0], lab[1] - wall[1], lab[2] - wall[2]) > 18) hold.push(inner[i], inner[i + 1], inner[i + 2], 255);
  }
  // Quase nada difere da parede: provavelmente é parede lisa, não agarra.
  b.plain = hold.length < inner.length * 0.15;
  return sampleLab(b.plain ? inner : hold);
}

// Distância em LCh: a luz do ginásio muda muito a luminosidade (L) e a saturação (C),
// pouco o matiz (h). Por isso L pesa 1/3, C pesa 1/2 e o matiz pesa inteiro.
export const colorDistance = ([L1, a1, b1], [L2, a2, b2]) => {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((Math.atan2(b1, a1) - Math.atan2(b2, a2)) / 2);
  return Math.hypot((L1 - L2) / 3, (C1 - C2) / 2, dH);
};

/** Cores ordenadas pela distância. Distância acima de `limit` → sugere "other". */
export function suggest(lab, palette = DEFAULT_PALETTE, limit = 22) {
  const ranked = Object.entries({ ...DEFAULT_PALETTE, ...palette })
    .map(([color, ref]) => ({ color, d: colorDistance(lab, ref) }))
    .sort((a, b) => a.d - b.d);
  const best = ranked[0].d > limit ? 'other' : ranked[0].color;
  return { best, second: best === 'other' ? ranked[0].color : ranked[1].color, distance: ranked[0].d };
}

/** Grava a medição como referência da cor (média móvel com o que já havia calibrado). */
export function calibrate(palette, color, lab, weight = 0.5) {
  if (color === 'other') return palette;
  const old = palette[color];
  const next = old ? old.map((v, i) => v * (1 - weight) + lab[i] * weight) : lab;
  return { ...palette, [color]: next.map((n) => Math.round(n * 10) / 10) };
}
