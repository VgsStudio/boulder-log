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
  const src = keep[0].length >= all[0].length / 4 ? keep : all;
  return rgbToLab(src.map(median));
}

// Distância em LCh: a luz do ginásio muda muito a luminosidade (L) e a saturação (C),
// pouco o matiz (h). Por isso L pesa 1/3, C pesa 1/2 e o matiz pesa inteiro.
const dist = ([L1, a1, b1], [L2, a2, b2]) => {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((Math.atan2(b1, a1) - Math.atan2(b2, a2)) / 2);
  return Math.hypot((L1 - L2) / 3, (C1 - C2) / 2, dH);
};

/** Cores ordenadas pela distância. Distância acima de `limit` → sugere "other". */
export function suggest(lab, palette = DEFAULT_PALETTE, limit = 22) {
  const ranked = Object.entries({ ...DEFAULT_PALETTE, ...palette })
    .map(([color, ref]) => ({ color, d: dist(lab, ref) }))
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
