// Gamificação: XP, nível, sequência, trilha de graus e conquistas.
import { fmtDate, fmtDuration, lang, t } from './i18n.js';
import * as S from './stats.js';
import { $, state, h, fill, svg, toast, grade, gymOf } from './core.js';

// ---------- gamificação: XP, nível, sequência, trilha, conquistas ----------
export const ICONS = {
  sessions: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4',
  sends: 'M3 19 9 7l4 7 2-3 6 8Z',
  flash: 'M13 3 5 14h6l-1 7 8-11h-6Z',
  grade: 'M4 19 12 5l8 14Z',
  projects: 'M6 21V4M6 5h11l-2 4 2 4H6',
  streak: 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-3-1-5 0-7Z',
  big: 'M4 18h16M6 14h12M8 10h8M10 6h4',
  check: 'M5 12l5 5 9-10',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  gyms: 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
};
export const HOLD_SHAPES = [
  'M30 12c14-8 38-6 50 8s10 38-2 52-34 22-50 14S6 60 8 42s8-22 22-30Z',
  'M50 8c18 0 36 14 40 32s-4 40-22 48-42 4-52-12S4 36 16 22 32 8 50 8Z',
  'M22 20c12-14 40-14 56-2s20 38 8 54-38 20-54 10S2 52 6 38s4-6 16-18Z',
  'M58 10c16 4 30 20 30 38s-14 34-32 40-38-2-46-18-4-36 10-48 22-16 38-12Z',
];
export const PIN_ICON = 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';
export const PENCIL_ICON = 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4';
export const CHECK_ICON = 'M5 12.5l4.5 4.5L19 7.5';
export const SHARE_ICON = 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6';
/** Ícone de traço (pin, compartilhar), na cor do texto. */
export const lineIcon = (d) => svg('svg', { class: 'line-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d }));
export const HOLD_COLORS = ['#ff3d7f', '#ffc531', '#1fbf6a', '#2f5bff', '#ff7a1a', '#9b5cff', '#00b8d9'];
export let holdSeq = 0;
/** Agarra em SVG. fill = cor; fillPct (0-1) enche de baixo para cima sobre a cor de fundo. */
export function hold(i, fill, { fillPct = 1, track = 'var(--surface-2)' } = {}) {
  const d = HOLD_SHAPES[i % HOLD_SHAPES.length];
  if (fillPct >= 1) return svg('svg', { class: 'hold', viewBox: '0 0 100 100', 'aria-hidden': 'true' }, svg('path', { d, fill }), svg('circle', { class: 'bolt', cx: 50, cy: 50, r: 5 }));
  const id = `hg${++holdSeq}`;
  const at = `${Math.round(fillPct * 100)}%`;
  return svg('svg', { class: 'hold', viewBox: '0 0 100 100', 'aria-hidden': 'true' },
    svg('defs', {}, svg('linearGradient', { id, x1: 0, y1: 1, x2: 0, y2: 0 },
      svg('stop', { offset: at, 'stop-color': fill }), svg('stop', { offset: at, 'stop-color': track }))),
    svg('path', { d, fill: `url(#${id})` }), svg('circle', { class: 'bolt', cx: 50, cy: 50, r: 5 }));
}
/** Risco de giz desenhado à mão (filtro #chalk no index.html). */
export const TICK = 'M24 52c6 5 12 12 17 20 9-17 22-34 40-48';
export const KIND_COLOR = { sessions: '#2f5bff', sends: '#1fbf6a', flash: '#ffc531', grade: '#ff3d7f', projects: '#9b5cff', streak: '#ff7a1a', big: '#00b8d9', gyms: '#00b8d9' };

export const icon = (kind) => svg('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true' }, svg('path', { d: ICONS[kind] }));

export function achLabel(id) {
  const [kind, v] = id.split(':');
  const n = Number(v);
  return {
    sessions: n === 1 ? t('ach.session1') : t('ach.sessions', { n }),
    sends: t('ach.sends', { n }),
    flash: n === 1 ? t('ach.flash1') : t('ach.flash', { n }),
    grade: t('ach.grade', { g: grade(n) }),
    projects: n === 1 ? t('ach.project1') : t('ach.projects', { n }),
    streak: t('ach.streak', { n }),
    big: t('ach.big'),
    gyms: t('ach.gyms', { n }),
  }[kind];
}
export function achValue(id) {
  const [kind, v] = id.split(':');
  return kind === 'grade' ? grade(Number(v)) : kind === 'big' ? '10+' : v;
}
/** O que já tem + a próxima meta de cada tipo (bloqueada, para dar vontade). */
export function achCatalog() {
  const got = S.achievements(state.sessions, state.climbs);
  const ids = new Set(got.map((a) => a.id));
  const ladders = { sessions: [1, 10, 25, 50, 100], sends: [10, 50, 100, 250, 500], flash: [1, 10, 50], projects: [1, 5, 10], streak: [2, 4, 8, 12, 26], gyms: [2, 3, 5, 10] };
  const next = [];
  for (const [k, steps] of Object.entries(ladders)) {
    const n = steps.find((x) => !ids.has(`${k}:${x}`));
    if (n) next.push({ id: `${k}:${n}` });
  }
  const best = Math.max(-1, ...state.climbs.filter(S.isSend).map((c) => c.grade));
  if (best < 17) next.unshift({ id: `grade:${best + 1}` });
  if (!ids.has('big:10')) next.push({ id: 'big:10' });
  return { got: [...got].reverse(), next };
}

export function streakPill() {
  const n = S.streakWeeks(state.sessions);
  const el = $('#streak-pill');
  el.hidden = !n;
  el.replaceChildren(icon('streak'), String(n));
  el.setAttribute('aria-label', `${n} ${t('streak.weeks')}`);
}
