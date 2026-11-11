// Chalkmark: SPA sem framework. Rotas por hash, dados em memória, API em /api.
import './style.css';
import { fmtDate, fmtDuration, fmtPct, lang, t } from './i18n.js';
import { boxLab, calibrate, COLORS, sampleLab, suggest, SWATCH } from './color.js';
// detect.js é leve; o onnxruntime-web e o modelo (~10 MB) só baixam na primeira foto.
import { detectHolds, holdAt, routeHolds } from './detect.js';

const PHOTO_TERMS_VERSION = '2026-11-11'; // igual a services/api.ts
import * as S from './stats.js';

const HOLD_TYPES = ['crimp', 'sloper', 'jug', 'pinch', 'pocket', 'volume', 'edge'];
const WALL_ANGLES = ['slab', 'vertical', 'overhang', 'roof'];
const STYLE_TAGS = ['dynamic', 'static', 'compression', 'balance', 'power', 'technical', 'coordination', 'heel_hook', 'toe_hook', 'mantle'];
const RESULTS = ['flash', 'sent', 'project'];

const $ = (s) => document.querySelector(s);
const view = $('#view');
let cfg;
const state = { gyms: [], sessions: [], climbs: [], settings: { scale: 'v', weeklySessions: 0, gradeGoal: null }, loadedAt: 0 };
let timers = [];

// ---------- DOM ----------
/** Cria elemento. on* = evento; style = objeto de propriedades (CSP proíbe atributo style). */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
    else if (k === 'class' || typeof v === 'string' || typeof v === 'number' || v === true) el.setAttribute(k, v === true ? '' : v);
    else el[k] = v;
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}
/** Troca o conteúdo ignorando null/undefined/false (replaceChildren os viraria texto). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null) el.setAttribute(k, v);
  el.append(...kids.flat().filter(Boolean));
  return el;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2800);
}
const fail = (e) => {
  console.error(e);
  toast(e?.code === 'AI_DAILY_LIMIT' ? t('ai.limit') : e?.code === 'AI_UNAVAILABLE' || e?.code === 'AI_FAILED' ? t('ai.unavailable') : navigator.onLine ? t('error.generic') : t('error.offline'));
};

const sessionsText = (n) => (n === 1 ? t('unit.session1') : t('unit.sessions', { n }));
const colorName = (c) => t(`color.${c}`);
const grade = (g) => S.gradeLabel(g, state.settings.scale);
const swatch = (c) => h('span', { class: `swatch ${c === 'other' ? 'other' : ''}`, style: c === 'other' ? null : { background: SWATCH[c] } });

/** Botões de escolha única (segmented). */
function seg(options, value, onPick) {
  return h('div', { class: 'seg', role: 'group' }, options.map(([v, label]) =>
    h('button', { type: 'button', 'data-v': String(v), 'aria-pressed': String(v === value), onclick: () => onPick(v) }, label)));
}
function stepper(value, min, max, onChange, label) {
  const out = h('output', { 'aria-live': 'polite', 'aria-label': label }, String(value));
  const set = (n) => { value = Math.min(max, Math.max(min, n)); out.textContent = value; onChange(value); };
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': '−', onclick: () => set(value - 1) }, '−'), out,
    h('button', { type: 'button', 'aria-label': '+', onclick: () => set(value + 1) }, '+'));
}

// ---------- autenticação (Cognito Managed Login, Authorization Code + PKCE) ----------
const TOKENS = 'bl:tokens';
const VERIFIER = 'bl:verifier';
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const loadTokens = () => { try { return JSON.parse(localStorage.getItem(TOKENS)); } catch { return null; } };
const saveTokens = (tk) => { try { localStorage.setItem(TOKENS, JSON.stringify({ ...tk, obtainedAt: Date.now() })); } catch {} };

async function login(path = 'oauth2/authorize') {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(VERIFIER, verifier);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL(`${cfg.cognitoDomain}/${path}`);
  Object.entries({
    response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: 'openid email',
    code_challenge_method: 'S256', code_challenge: challenge, lang: lang === 'pt' ? 'pt-BR' : 'en',
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  location.assign(url);
}

function logout() {
  try { localStorage.removeItem(TOKENS); } catch {}
  const url = new URL(`${cfg.cognitoDomain}/logout`);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('logout_uri', cfg.redirectUri);
  location.assign(url);
}

async function tokenCall(body) {
  const res = await fetch(`${cfg.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...body }),
  });
  return res.ok ? res.json() : null;
}

let refreshing;
async function idToken() {
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    history.replaceState({}, '', '/');
    const tk = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: sessionStorage.getItem(VERIFIER) || '' });
    sessionStorage.removeItem(VERIFIER);
    if (tk) saveTokens(tk);
  }
  let tk = loadTokens();
  if (tk && Date.now() - tk.obtainedAt > (tk.expires_in - 120) * 1000) {
    // Um refresh por vez, mesmo com várias chamadas em paralelo.
    refreshing ??= tokenCall({ grant_type: 'refresh_token', refresh_token: tk.refresh_token }).finally(() => (refreshing = null));
    const fresh = tk.refresh_token && (await refreshing);
    if (fresh) saveTokens((tk = { ...fresh, refresh_token: tk.refresh_token }));
    else { try { localStorage.removeItem(TOKENS); } catch {} tk = null; }
  }
  return tk?.id_token ?? null;
}

async function api(path, { method = 'GET', body } = {}) {
  const jwt = await idToken();
  if (!jwt) { showAuth(); throw new Error('auth'); }
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${jwt}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showAuth(); throw new Error('auth'); }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.error, status: res.status });
  return data;
}

// ---------- dados ----------
async function loadAll() {
  const [gyms, sessions, climbs, settings] = await Promise.all([api('/gyms'), api('/sessions'), api('/climbs'), api('/settings')]);
  Object.assign(state, { gyms, sessions, climbs, loadedAt: Date.now() });
  state.settings = { ...state.settings, ...settings };
}
const activeSession = () => state.sessions.find((s) => !s.endedAt);
const gymOf = (id) => state.gyms.find((g) => g.id === id);
const climbOf = (id) => state.climbs.find((c) => c.id === id);
const rootOf = (c) => (c.projectId ? climbOf(c.projectId) ?? c : c);
const upsert = (list, item) => { const i = list.findIndex((x) => x.id === item.id); i < 0 ? list.push(item) : (list[i] = { ...list[i], ...item }); };

// ---------- fotos ----------
async function toCanvas(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}
const encode = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));
/** WebP quando o navegador codifica; senão JPEG (Safari antigo devolve PNG para webp). */
async function compress(canvas, q) {
  const webp = await encode(canvas, 'image/webp', q);
  return webp?.type === 'image/webp' ? webp : encode(canvas, 'image/jpeg', q);
}
/** Envia a foto direto ao S3; tenta 3 vezes (sinal ruim no ginásio é comum). */
async function upload({ url, fields }, blob) {
  for (let attempt = 1; ; attempt++) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', blob);
    try {
      const res = await fetch(url, { method: 'POST', body: fd });
      if (res.ok) return;
      if (res.status < 500 || attempt === 3) throw new Error('UPLOAD');
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

// ---------- componentes ----------
function climbRow(c) {
  const root = rootOf(c);
  const thumb = root.thumbUrl
    ? h('img', { class: 'thumb', src: root.thumbUrl, alt: '', loading: 'lazy', decoding: 'async', width: 52, height: 52 })
    : h('div', { class: 'thumb color' }, swatch(c.color));
  return h('li', {}, h('a', { class: 'climb-row', href: `#/climb/${c.id}` },
    thumb,
    h('div', { class: 'grow' },
      h('div', { class: 'title' }, colorName(c.color), h('span', { class: 'grade-pill' }, grade(c.grade))),
      h('div', { class: 'meta' }, h('span', {}, fmtDate(c.createdAt, { hour: '2-digit', minute: '2-digit' })), c.projectId && h('span', {}, t('climb.project')))),
    h('span', { class: `badge ${c.result}` }, t(`result.${c.result}`))));
}

// ---------- gamificação: XP, nível, sequência, trilha, conquistas ----------
const ICONS = {
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
const HOLD_SHAPES = [
  'M30 12c14-8 38-6 50 8s10 38-2 52-34 22-50 14S6 60 8 42s8-22 22-30Z',
  'M50 8c18 0 36 14 40 32s-4 40-22 48-42 4-52-12S4 36 16 22 32 8 50 8Z',
  'M22 20c12-14 40-14 56-2s20 38 8 54-38 20-54 10S2 52 6 38s4-6 16-18Z',
  'M58 10c16 4 30 20 30 38s-14 34-32 40-38-2-46-18-4-36 10-48 22-16 38-12Z',
];
const HOLD_COLORS = ['#ff3d7f', '#ffc531', '#1fbf6a', '#2f5bff', '#ff7a1a', '#9b5cff', '#00b8d9'];
let holdSeq = 0;
/** Agarra em SVG. fill = cor; fillPct (0-1) enche de baixo para cima sobre a cor de fundo. */
function hold(i, fill, { fillPct = 1, track = 'var(--surface-2)' } = {}) {
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
const TICK = 'M24 52c6 5 12 12 17 20 9-17 22-34 40-48';
const chalkTick = (cls = '') => svg('svg', { class: `tick ${cls}`, viewBox: '0 0 100 100', 'aria-hidden': 'true' },
  svg('path', { class: 'chalk-stroke', filter: 'url(#chalk)', d: TICK }));

/** Pó de giz subindo (comemorações). */
const chalkPuff = () => h('div', { class: 'puff', 'aria-hidden': 'true' },
  [...Array(14)].map((_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const r = 60 + (i % 3) * 22;
    return h('i', { style: { '--dx': `${Math.round(Math.cos(a) * r)}px`, '--dy': `${Math.round(Math.sin(a) * r * 0.7 - 20)}px`, '--s': `${6 + (i % 4) * 3}px`, '--d': `${(i % 5) * 40}ms` } });
  }));

const KIND_COLOR = { sessions: '#2f5bff', sends: '#1fbf6a', flash: '#ffc531', grade: '#ff3d7f', projects: '#9b5cff', streak: '#ff7a1a', big: '#00b8d9', gyms: '#00b8d9' };

const icon = (kind) => svg('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true' }, svg('path', { d: ICONS[kind] }));

function achLabel(id) {
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
function achValue(id) {
  const [kind, v] = id.split(':');
  return kind === 'grade' ? grade(Number(v)) : kind === 'big' ? '10+' : v;
}
function achBadge(a, locked = false) {
  const kind = a.id.split(':')[0];
  return h('li', { class: `ach ${locked ? 'locked' : ''}`, title: locked ? t('ach.locked') : fmtDate(a.at) },
    h('span', { class: 'medal' }, hold(kind.length + (a.id.length % 4), locked ? 'var(--surface-2)' : KIND_COLOR[kind]), icon(kind), h('b', { class: 'num' }, achValue(a.id))),
    h('span', { class: 'label' }, achLabel(a.id)));
}

/** O que já tem + a próxima meta de cada tipo (bloqueada, para dar vontade). */
function achCatalog() {
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

const weekdayNames = () => [...Array(7)].map((_, i) => new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));

/** Cartão principal: sequência semanal, dias da semana e nível/XP. */
function hero() {
  const n = S.streakWeeks(state.sessions);
  const dots = S.weekDots(state.sessions);
  const wd = weekdayNames();
  const today = (new Date().getDay() + 6) % 7;
  const lv = S.level(S.totalXp(state.climbs));
  return h('section', { class: `hero ${n ? 'on' : ''}` },
    h('div', { class: 'hero-top' },
      h('span', { class: 'flame' }, icon('streak')),
      h('div', { class: 'grow' }, h('b', { class: 'num' }, String(n)), h('span', {}, n === 1 ? t('streak.week') : t('streak.weeks'))),
      h('div', { class: 'lv' }, h('span', { class: 'lv-badge num' }, String(lv.level)), h('span', { class: 'small' }, t('xp.level', { n: lv.level })))),
    h('ol', { class: 'week' }, dots.map((on, i) => h('li', { class: [on ? 'on' : 'off', i === today && 'today'].filter(Boolean).join(' ') },
      hold(i, on ? HOLD_COLORS[i] : 'none'), on && chalkTick(), h('span', {}, wd[i])))),
    h('div', { class: 'xp' },
      h('div', { class: 'progress' }, h('span', { style: { '--w': `${(lv.into / lv.need) * 100}%` } })),
      h('span', { class: 'small num' }, t('xp.toNext', { a: lv.into, b: lv.need }))),
    h('p', { class: 'small hero-msg' }, dots.some(Boolean) ? t('streak.done') : n ? t('streak.keep') : t('streak.start')));
}

function streakPill() {
  const n = S.streakWeeks(state.sessions);
  const el = $('#streak-pill');
  el.hidden = !n;
  el.replaceChildren(icon('streak'), String(n));
  el.setAttribute('aria-label', `${n} ${t('streak.weeks')}`);
}

/** Trilha de graus no estilo "caminho": cada grau vira um nó que você domina mandando vias. */
function gradePathCard() {
  // Só o trecho que importa: os 3 graus dominados mais altos e o que vem pela frente.
  const all = S.gradePath(state.climbs);
  const lastMastered = all.map((p) => p.mastered).lastIndexOf(true);
  const path = all.slice(Math.max(0, Math.min(lastMastered - 2, all.length - 5)));
  const offsets = [0, 1, 2, 1, 0, -1, -2, -1];
  return h('section', { class: 'card' },
    h('h2', {}, t('path.title')),
    h('p', { class: 'muted small' }, t('path.hint', { m: S.MASTERY })),
    h('ol', { class: 'path' }, path.map((p, i) => {
      const pct = Math.min(1, p.sends / S.MASTERY);
      const state_ = p.mastered ? 'mastered' : p.unlocked ? 'open' : 'locked';
      const isNext = !p.mastered && p.unlocked && path.slice(0, i).every((q) => q.mastered);
      const color = p.mastered ? HOLD_COLORS[p.grade % HOLD_COLORS.length] : p.unlocked ? '#2f5bff' : 'var(--surface-2)';
      return h('li', { class: [state_, isNext && 'next'].filter(Boolean).join(' '), style: { '--off': offsets[i % offsets.length] } },
        h('span', { class: 'node', 'aria-label': `${grade(p.grade)}: ${p.sends}/${S.MASTERY}` },
          hold(p.grade, color, { fillPct: p.mastered ? 1 : p.unlocked ? Math.max(0.12, pct) : 1, track: 'var(--line)' }),
          h('b', { class: 'num' }, grade(p.grade)), p.mastered && chalkTick('small')),
        h('span', { class: 'node-meta small' }, p.mastered ? [icon('check'), t('path.mastered')] : p.unlocked ? `${p.sends}/${S.MASTERY}` : icon('lock')));
    }).reverse()));
}

/** Comemoração: recorde de grau e subida de nível ganham destaque; conquistas em lista. */
function celebrate({ unlocked, xp, levelUp }) {
  if (!unlocked.length && !levelUp) { toast(t('xp.gain', { n: xp })); return; }
  const pr = unlocked.filter((a) => a.id.startsWith('grade:')).map((a) => Number(a.id.split(':')[1])).sort((a, b) => b - a)[0];
  const best = Math.max(...state.climbs.filter(S.isSend).map((c) => c.grade));
  const isPr = pr != null && pr >= best;
  openSheet(h('div', { class: 'stack celebrate' },
    h('div', { class: 'burst' }, chalkPuff(), chalkTick('draw')),
    isPr
      ? [h('p', { class: 'kicker' }, t('ach.pr')), h('div', { class: 'big-grade num' }, grade(pr)), h('p', { class: 'muted center' }, t('ach.prLead', { g: grade(pr) }))]
      : levelUp
        ? [h('p', { class: 'kicker' }, t('xp.levelUp', { n: levelUp })), h('div', { class: 'big-grade num' }, String(levelUp))]
        : h('p', { class: 'kicker' }, unlocked.length === 1 ? t('ach.new') : t('ach.newMany', { n: unlocked.length })),
    h('p', { class: 'xp-gain num center' }, t('xp.gain', { n: xp })),
    unlocked.length > 0 && h('ul', { class: 'achs' }, unlocked.map((a) => achBadge(a))),
    h('button', { class: 'btn primary big block', type: 'button', onclick: () => $('#sheet').close() }, t('nice'))));
}

function recapSheet(s, unlocked) {
  const cs = state.climbs.filter((c) => c.sessionId === s.id);
  const sum = S.sessionSummaries([s], state.climbs)[0];
  const flashes = cs.filter((c) => c.result === 'flash').length;
  const big = (v, label) => h('div', { class: 'kpi' }, h('b', {}, v), h('span', {}, label));
  openSheet(h('div', { class: 'stack celebrate' },
    h('div', { class: 'burst' }, chalkPuff(), chalkTick('draw')),
    h('p', { class: 'kicker' }, t('recap.title')),
    h('p', { class: 'muted center num' }, `${gymOf(s.gymId)?.name ?? ''}, ${fmtDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}`),
    h('p', { class: 'xp-gain num center' }, t('xp.gain', { n: S.totalXp(cs) })),
    h('div', { class: 'kpis' },
      big(String(sum.climbs), t('recap.climbs')), big(String(sum.sends), t('recap.sends')),
      big(String(flashes), t('recap.flash')), big(sum.maxGrade != null ? grade(sum.maxGrade) : '—', t('recap.max'))),
    hero(),
    unlocked.length > 0 && h('ul', { class: 'achs' }, unlocked.map((a) => achBadge(a))),
    h('button', { class: 'btn primary big block', type: 'button', onclick: () => $('#sheet').close() }, t('recap.close'))));
}

function achievementsCard() {
  const { got, next } = achCatalog();
  return h('section', { class: 'card' },
    h('div', { class: 'session-head' }, h('h2', {}, t('ach.title')), h('span', { class: 'muted small' }, t('ach.count', { n: got.length }))),
    h('ul', { class: 'achs scroll' }, got.map((a) => achBadge(a)), next.map((a) => achBadge(a, true))));
}

// ---------- localização (opcional) ----------
const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
  );
});
const geoGranted = async () => {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch { return false; }
};

// ---------- tela: sessão ----------
function viewSession() {
  const s = activeSession();
  return s ? activeSessionView(s) : startView();
}

function startView() {
  const last = S.sessionSummaries(state.sessions, state.climbs)[0];
  let gymId = localStorage.getItem('bl:gym') ?? state.gyms[0]?.id;
  if (!gymOf(gymId)) gymId = state.gyms[0]?.id;
  const nameInput = h('input', { type: 'text', maxlength: 40, placeholder: t('session.gymName'), autocomplete: 'off' });
  const newGymBox = h('div', { hidden: state.gyms.length > 0 }, h('label', { class: 'field' }, h('span', {}, t('session.newGym')), nameInput));
  const select = state.gyms.length
    ? h('label', { class: 'field' }, h('span', {}, t('session.gym')),
      h('select', { onchange: (e) => { gymId = e.target.value; newGymBox.hidden = gymId !== '__new'; } },
        state.gyms.map((g) => h('option', { value: g.id, selected: g.id === gymId }, g.name)),
        h('option', { value: '__new' }, `+ ${t('session.newGym')}`)))
    : null;

  const hint = h('p', { class: 'small muted', hidden: true });
  // Com permissão já dada, escolhe sozinho o ginásio onde você está.
  geoGranted().then(async (ok) => {
    if (!ok || !state.gyms.some((g) => g.loc)) return;
    const pos = await getPos();
    const near = pos && S.nearestGym(state.gyms, pos);
    if (!near || !view.contains(hint)) return;
    gymId = near.id;
    const sel = view.querySelector('select');
    if (sel) sel.value = near.id;
    newGymBox.hidden = true;
    hint.replaceChildren(icon('gyms'), t('session.detected'));
    hint.hidden = false;
  });

  const start = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (!state.gyms.length || gymId === '__new') {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); btn.disabled = false; return; }
        const loc = await getPos(); // pede permissão só aqui, ao cadastrar o ginásio
        const gym = await api('/gyms', { method: 'POST', body: { name, ...(loc ? { loc } : {}) } });
        state.gyms.push(gym);
        gymId = gym.id;
      }
      localStorage.setItem('bl:gym', gymId);
      state.sessions.push(await api('/sessions', { method: 'POST', body: { gymId } }));
      render();
    } catch (err) { fail(err); btn.disabled = false; }
  };

  return h('div', { class: 'stack' },
    h('h1', {}, t('session.ready')),
    hero(),
    goalsCard(),
    h('div', { class: 'card stack' }, select, hint, newGymBox,
      h('button', { class: 'btn primary big block', type: 'button', onclick: start }, t('session.start'))),
    last && h('section', {},
      h('h2', { class: 'muted small' }, t('session.last')),
      h('div', { class: 'card' }, sessionHeader(last))));
}

function sessionHeader(s) {
  return [
    h('div', { class: 'session-head' },
      h('strong', {}, gymOf(s.gymId)?.name ?? '—'),
      h('span', { class: 'muted small' }, fmtDate(s.startedAt, { weekday: 'short', day: 'numeric', month: 'short' }))),
    h('div', { class: 'stat-line num' },
      h('span', {}, t('stat.boulders', { n: s.climbs })), h('span', {}, t('stat.sends', { n: s.sends })),
      s.maxGrade != null && h('span', {}, `max ${grade(s.maxGrade)}`),
      s.endedAt && h('span', {}, fmtDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt)))),
  ];
}

function activeSessionView(s) {
  const summary = S.sessionSummaries([s], state.climbs)[0];
  const climbs = state.climbs.filter((c) => c.sessionId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const elapsed = h('span', { class: 'num' }, fmtDuration(Date.now() - Date.parse(s.startedAt)));
  timers.push(setInterval(() => (elapsed.textContent = fmtDuration(Date.now() - Date.parse(s.startedAt))), 30_000));
  return h('div', { class: 'stack' },
    h('div', {},
      h('h1', {}, gymOf(s.gymId)?.name ?? '—'),
      h('div', { class: 'stat-line num' }, elapsed, h('span', {}, t('stat.boulders', { n: summary.climbs })), h('span', {}, t('stat.sends', { n: summary.sends })),
        summary.maxGrade != null && h('span', {}, `max ${grade(summary.maxGrade)}`),
        h('span', { class: 'xp-chip' }, t('xp.gain', { n: S.totalXp(state.climbs.filter((c) => c.sessionId === s.id)) })))),
    h('a', { class: 'btn go big block', href: '#/new' }, `+ ${t('session.add')}`),
    climbs.length
      ? h('ul', { class: 'list card' }, climbs.map(climbRow))
      : h('p', { class: 'muted' }, t('session.empty')),
    h('button', { class: 'btn block', type: 'button', onclick: () => endSessionSheet(s) }, t('session.end')));
}

function endSessionSheet(s) {
  let feeling = 3;
  const note = h('textarea', { maxlength: 500, placeholder: t('climb.note') });
  const save = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const body = { end: true, feeling, ...(note.value.trim() ? { note: note.value.trim() } : {}) };
      upsert(state.sessions, await api(`/sessions/${s.id}`, { method: 'PATCH', body }));
      $('#sheet').close();
      render();
      const ended = state.sessions.find((x) => x.id === s.id);
      // Conquistas desta sessão: as que caíram desde o início dela.
      recapSheet(ended, S.achievements(state.sessions, state.climbs).filter((a) => a.at >= ended.startedAt));
    } catch (err) { fail(err); e.target.disabled = false; }
  };
  const feelSeg = () => seg([1, 2, 3, 4, 5].map((n) => [n, String(n)]), feeling, (v) => { feeling = v; feelBox.replaceChildren(feelSeg()); });
  const feelBox = h('div', {}, feelSeg());
  openSheet(h('div', { class: 'stack' },
    h('h2', {}, t('session.feeling')), feelBox, note,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', type: 'button', onclick: () => $('#sheet').close() }, t('cancel')),
      h('button', { class: 'btn primary grow', type: 'button', onclick: save }, t('session.save')))));
}

function openSheet(content) {
  const d = $('#sheet');
  d.replaceChildren(content);
  d.showModal();
}

// ---------- termo de uso das fotos ----------
function termsBody() {
  return h('ul', { class: 'terms' }, ['private', 'rights', 'people', 'training', 'delete', 'remove'].map((k) => h('li', {}, t(`terms.${k}`))));
}

/** Pede o aceite do termo antes da primeira foto. Resolve true se aceito (agora ou antes). */
function ensurePhotoTerms() {
  if (state.settings.photoTermsVersion === PHOTO_TERMS_VERSION) return Promise.resolve(true);
  return new Promise((resolve) => {
    let accepted = false;
    const btn = h('button', { class: 'btn primary big block', type: 'button', disabled: true }, t('terms.accept'));
    const check = h('input', { type: 'checkbox', onchange: (e) => (btn.disabled = !e.target.checked) });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        state.settings = { ...state.settings, ...(await api('/settings', { method: 'PUT', body: { acceptPhotoTerms: PHOTO_TERMS_VERSION } })) };
        accepted = true;
        $('#sheet').close();
      } catch (err) { fail(err); btn.disabled = false; }
    });
    openSheet(h('div', { class: 'stack' },
      h('h2', {}, t('terms.title')),
      h('p', { class: 'muted' }, t('terms.lead')),
      termsBody(),
      h('label', { class: 'check' }, check, h('span', {}, t('terms.check'))),
      btn));
    $('#sheet').addEventListener('close', () => resolve(accepted), { once: true });
  });
}

// ---------- tela: novo boulder ----------
function viewNew() {
  const s = activeSession();
  if (!s) { location.hash = '#/'; return h('div'); }
  const gym = gymOf(s.gymId);
  const lastGrade = [...state.climbs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.grade ?? 3;
  const d = { color: null, grade: lastGrade, attempts: 1, result: 'sent', note: '', tap: null, projectId: null, canvas: null, lab: null, suggestion: null,
    boxes: null, rgba: null, seed: null, route: null, detect: null };
  const palette = gym?.palette ?? {};
  const openProjects = S.projects(state.climbs).filter(S.isOpenProject);

  const root = h('div', { class: 'stack' });
  const draw = () => fill(root, parts());

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !(await ensurePhotoTerms())) return;
    d.preparing = true;
    draw();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // deixa o aviso aparecer antes do trabalho pesado
    try {
      const canvas = await toCanvas(file, 1568);
      d.preparing = false;
      Object.assign(d, { canvas, tap: null, lab: null, suggestion: null, boxes: null, seed: null, route: null, detect: 'loading' });
      d.rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      draw();
      // Detecta as agarras em segundo plano enquanto você preenche o resto.
      detectHolds(canvas, palette).then((boxes) => {
        if (d.canvas !== canvas) return;
        Object.assign(d, { boxes, detect: 'done' });
        if (d.tap) applyTap(d.tap.x, d.tap.y);
        draw();
      }, (err) => {
        console.error(err);
        if (d.canvas === canvas) { d.detect = 'failed'; draw(); }
      });
    } catch (err) { d.preparing = false; draw(); fail(err); }
  };
  const fileInput = () => h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: pickPhoto });

  /** Toque: com o detector pronto, a cor vem da agarra inteira (descontando a parede) e a via é
   *  o grupo de agarras dessa cor encadeadas a partir dela; sem detector, mede só em volta do toque. */
  const applyTap = (x, y) => {
    const c = d.canvas;
    d.tap = { x: +x.toFixed(4), y: +y.toFixed(4) };
    d.seed = d.boxes && holdAt(d.boxes, x, y);
    if (d.seed) {
      d.lab = boxLab(d.rgba, c.width, c.height, d.seed);
    } else {
      const half = Math.max(8, Math.round(c.width / 64)), px = Math.round(x * c.width), py = Math.round(y * c.height);
      d.lab = sampleLab(c.getContext('2d', { willReadFrequently: true }).getImageData(Math.max(0, px - half), Math.max(0, py - half), half * 2 + 1, half * 2 + 1).data);
    }
    d.suggestion = suggest(d.lab, palette);
    setColor(d.suggestion.best);
  };
  /** Muda a cor da via (toque ou chip) e refaz o grupo de agarras. */
  const setColor = (color) => {
    d.color = color;
    if (d.seed) {
      d.seed.color = color;
      d.route = routeHolds(d.boxes, d.seed, d.canvas.width, d.canvas.height);
    }
  };
  const onTap = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const hit = d.route && d.boxes && holdAt(d.boxes, x, y);
    if (hit && hit !== d.seed) {
      // Ajuste manual: toque numa agarra inclui ou tira ela da via.
      d.route = d.route.includes(hit) ? d.route.filter((b) => b !== hit) : [...d.route, hit];
    } else if (!hit || !d.route) {
      applyTap(x, y);
    }
    draw();
  };
  const resetRoute = () => { Object.assign(d, { tap: null, seed: null, route: null, suggestion: null, lab: null }); draw(); };

  const doCalibrate = async () => {
    if (!gym || !d.lab || !d.color || d.color === 'other') return;
    try {
      const palette = calibrate(gym.palette ?? {}, d.color, d.lab);
      upsert(state.gyms, await api(`/gyms/${gym.id}`, { method: 'PATCH', body: { palette } }));
      toast(t('climb.calibrated'));
    } catch (err) { fail(err); }
  };

  const save = async (e) => {
    if (!d.color) { toast(t('climb.color')); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('climb.saving');
    try {
      let full, thumb;
      if (d.canvas) {
        full = await compress(d.canvas, 0.82);
        const small = h('canvas', { width: 400, height: Math.round((400 * d.canvas.height) / d.canvas.width) });
        small.getContext('2d').drawImage(d.canvas, 0, 0, small.width, small.height);
        thumb = await encode(small, full.type, 0.75);
      }
      const body = {
        sessionId: s.id, color: d.color, grade: d.grade, attempts: d.attempts, result: d.result,
        ...(d.note.trim() ? { note: d.note.trim() } : {}),
        ...(d.tap ? { tap: d.tap } : {}),
        ...(d.route?.length ? { holds: d.route.slice(0, 80).map(({ x, y, w, h: hh }) => ({ x, y, w, h: hh })) } : {}),
        ...(d.projectId ? { projectId: d.projectId } : {}),
        ...(full ? { photoType: full.type } : {}),
      };
      const before = S.achievements(state.sessions, state.climbs);
      const lvBefore = S.level(S.totalXp(state.climbs)).level;
      const { climb, uploads } = await api('/climbs', { method: 'POST', body });
      if (uploads) {
        await Promise.all([upload(uploads.full, full), upload(uploads.thumb, thumb)]);
        climb.thumbUrl = URL.createObjectURL(thumb);
      }
      state.climbs.push(climb);
      // Estilo da via (tipo de agarra, parede, estilo) em segundo plano; falha não atrapalha o registro.
      if (uploads) {
        api(`/climbs/${climb.id}/analyze`, { method: 'POST' }).then((x) => {
          upsert(state.climbs, x);
          if (location.hash === `#/climb/${climb.id}`) render();
        }, (err) => console.warn('analyze', err));
      }
      const unlocked = S.newAchievements(before, S.achievements(state.sessions, state.climbs));
      const lvAfter = S.level(S.totalXp(state.climbs)).level;
      setTimeout(() => celebrate({ unlocked, xp: S.xpFor(climb), levelUp: lvAfter > lvBefore ? lvAfter : 0 }), 50);
      location.replace(`#/climb/${climb.id}`); // sem voltar para o formulário
    } catch (err) {
      fail(err);
      btn.disabled = false;
      btn.textContent = t('climb.save');
    }
  };

  const parts = () => {
    const project = d.projectId && climbOf(d.projectId);
    return [
      h('div', { class: 'row' }, h('a', { class: 'link', href: '#/' }, `‹ ${t('back')}`)),
      h('h1', {}, t('climb.new')),

      openProjects.length > 0 && h('section', {},
        h('h2', { class: 'muted small' }, t('climb.continue')),
        h('div', { class: 'chips scroll' }, openProjects.map((p) =>
          h('button', {
            class: 'chip', type: 'button', 'aria-pressed': String(d.projectId === p.root.id),
            onclick: () => {
              if (d.projectId === p.root.id) Object.assign(d, { projectId: null });
              else Object.assign(d, { projectId: p.root.id, color: p.root.color, grade: p.root.grade, result: 'project', canvas: null, tap: null });
              draw();
            },
          }, swatch(p.root.color), h('strong', {}, grade(p.root.grade)), h('span', { class: 'muted' }, sessionsText(p.sessions)))))),

      // Foto + toque na agarra (não quando continua um projeto: usa a foto dele).
      project
        ? (project.thumbUrl && h('img', { class: 'thumb', src: project.thumbUrl, alt: '', style: { width: '96px', height: '96px' } }))
        : d.canvas
          ? h('section', {},
            h('div', { class: 'stage', onclick: onTap }, d.canvas,
              holdsOverlay(d.route, d.boxes),
              d.tap && h('span', { class: 'marker', style: { '--x': `${d.tap.x * 100}%`, '--y': `${d.tap.y * 100}%` } })),
            h('p', { class: `small detect-status ${d.detect ?? ''}` },
              d.detect === 'loading' ? t('detect.loading')
                : d.detect === 'failed' ? t('detect.failed')
                  : d.route ? [t('detect.route', { n: d.route.length }), ' ', h('button', { class: 'link small', type: 'button', onclick: resetRoute }, t('detect.reset'))]
                    : d.boxes ? t('detect.found', { n: d.boxes.length }) : ''),
            d.suggestion
              ? h('div', { class: 'suggestion small' },
                h('strong', {}, t('climb.suggest', { c: colorName(d.suggestion.best).toLowerCase() })),
                h('span', { class: 'muted' }, t('climb.or', { c: colorName(d.suggestion.second).toLowerCase() })),
                d.color && d.color !== 'other' && h('button', { class: 'link small', type: 'button', onclick: doCalibrate }, t('climb.calibrate', { c: colorName(d.color).toLowerCase() })))
              : h('p', { class: 'muted small' }, t('climb.tapHint')),
            h('label', { class: 'link small' }, t('climb.retake'), fileInput()))
          : d.preparing
            ? h('div', { class: 'photo-pick' }, h('p', { class: 'small detect-status loading' }, t('detect.preparing')))
            : h('label', { class: 'photo-pick' },
              h('div', {}, svgCamera(), t('climb.photo')), fileInput()),

      // Cor: o toque escolhe sozinho; a lista só aparece sem toque ou se pedir para trocar.
      h('section', {}, h('h2', {}, t('climb.color')),
        d.color && d.tap && !d.pickColor
          ? h('div', { class: 'color-auto' }, swatch(d.color), h('strong', {}, colorName(d.color)),
            h('span', { class: 'muted small grow' }, t('climb.colorAuto')),
            h('button', { class: 'link', type: 'button', onclick: () => { d.pickColor = true; draw(); } }, t('climb.change')))
          : h('div', { class: 'chips', role: 'group' }, COLORS.map((c) =>
            h('button', { class: 'chip', type: 'button', 'aria-pressed': String(d.color === c), onclick: () => { setColor(c); d.pickColor = false; draw(); } }, swatch(c), colorName(c))))),

      h('section', {}, h('h2', {}, t('climb.grade')),
        h('div', { class: 'chips scroll', role: 'group' }, S.GRADES.map((g) =>
          h('button', { class: 'chip grade', type: 'button', 'aria-pressed': String(d.grade === g), onclick: () => { d.grade = g; draw(); } }, grade(g))))),

      h('section', {}, h('h2', {}, t('climb.result')),
        seg(RESULTS.map((r) => [r, t(`result.${r}`)]), d.result, (r) => { d.result = r; draw(); })),


      h('label', { class: 'field' }, h('span', {}, t('climb.note')),
        h('textarea', { maxlength: 500, value: d.note, oninput: (e) => (d.note = e.target.value) })),

      h('div', { class: 'sticky-save' },
        h('button', { class: 'btn primary big block', type: 'button', onclick: save }, t('climb.save'))),
    ];
  };
  draw();
  // Grau atual visível na faixa rolável.
  requestAnimationFrame(() => root.querySelector('.chip.grade[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  return root;
}

/** Caixas das agarras da via sobre a foto (coordenadas 0-1). */
function holdsOverlay(holds, all = []) {
  if (!holds?.length && !all?.length) return null;
  const others = (all ?? []).filter((b) => !holds?.includes(b));
  return svg('svg', { class: 'overlay', viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    others.map((b) => svg('rect', { class: 'cand', x: b.x, y: b.y, width: b.w, height: b.h })),
    (holds ?? []).flatMap((b) => [
      svg('rect', { class: 'under', x: b.x, y: b.y, width: b.w, height: b.h }),
      svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h }),
    ]));
}

const svgCamera = () => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  svg('path', { d: 'M4 8h3l2-3h6l2 3h3v11H4Z', 'stroke-linejoin': 'round' }), svg('circle', { cx: 12, cy: 13, r: 3.5 }));

// ---------- tela: detalhe do boulder ----------
function viewClimb(id) {
  const c = climbOf(id);
  if (!c) return h('p', { class: 'muted' }, '—');
  const root = rootOf(c);
  const box = h('div', { class: 'stack' });
  let confirmDelete = false;
  let photo = null; // { url }

  const patchClimb = async (fields) => {
    try { upsert(state.climbs, await api(`/climbs/${c.id}`, { method: 'PATCH', body: fields })); draw(); } catch (err) { fail(err); }
  };
  const analyze = async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = t('ai.analyzing');
    try {
      upsert(state.climbs, await api(`/climbs/${root.id}/analyze`, { method: 'POST' }));
    } catch (err) { fail(err); }
    draw();
  };
  /** Nova tentativa de um projeto (mandou ou ainda não), ligada à raiz, na sessão ativa. */
  const logTry = async (rootClimb, result, btn) => {
    const s = activeSession();
    if (!s) { toast(t('project.needSession')); return; }
    btn.disabled = true;
    try {
      const before = S.achievements(state.sessions, state.climbs);
      const lvBefore = S.level(S.totalXp(state.climbs)).level;
      const { climb } = await api('/climbs', {
        method: 'POST',
        body: { sessionId: s.id, color: rootClimb.color, grade: rootClimb.grade, attempts: 1, result, projectId: rootClimb.id },
      });
      state.climbs.push(climb);
      const lvAfter = S.level(S.totalXp(state.climbs)).level;
      celebrate({ unlocked: S.newAchievements(before, S.achievements(state.sessions, state.climbs)), xp: S.xpFor(climb), levelUp: lvAfter > lvBefore ? lvAfter : 0 });
      draw();
    } catch (err) { fail(err); btn.disabled = false; }
  };
  const del = async (e) => {
    if (!confirmDelete) { confirmDelete = true; e.currentTarget.textContent = t('climb.confirmDelete'); return; }
    try {
      await api(`/climbs/${c.id}`, { method: 'DELETE' });
      state.climbs = state.climbs.filter((x) => x.id !== c.id);
      history.back();
    } catch (err) { fail(err); }
  };

  const draw = () => {
    const cur = climbOf(id);
    const r = rootOf(cur);
    const ai = r.ai;
    const proj = S.projects(state.climbs).find((p) => p.root.id === r.id);
    const tries = proj ? [r, ...state.climbs.filter((x) => x.projectId === r.id)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
    const patchAi = (fields) => api(`/climbs/${r.id}`, { method: 'PATCH', body: { ai: { ...ai, ...fields } } })
      .then((x) => { upsert(state.climbs, x); draw(); }, fail);
    const toggle = (list, v, max) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].slice(-max));

    fill(box, 
      h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => history.back() }, `‹ ${t('back')}`)),
      h('h1', { class: 'row' }, swatch(cur.color), colorName(cur.color), h('span', { class: 'grade-pill' }, grade(cur.grade))),

      r.photoType && h('div', { class: 'stage' },
        photo?.url
          ? h('img', { src: photo.url, alt: '', decoding: 'async' })
          : r.thumbUrl && h('img', { src: r.thumbUrl, alt: '' }),
        holdsOverlay(r.holds),
        r.tap && h('span', { class: 'marker', style: { '--x': `${r.tap.x * 100}%`, '--y': `${r.tap.y * 100}%` } })),

      h('section', { class: 'card stack' },
        seg(RESULTS.map((x) => [x, t(`result.${x}`)]), cur.result, (x) => patchClimb({ result: x })),
        cur.note && h('p', { class: 'muted' }, cur.note),
        h('p', { class: 'muted small' }, fmtDate(cur.createdAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }), ', ', gymOf(state.sessions.find((s) => s.id === cur.sessionId)?.gymId)?.name ?? '')),

      proj && h('section', { class: 'card' },
        h('h2', {}, t('climb.project')),
        h('p', { class: 'num' }, proj.sentAt
          ? t('climb.projectSent', { d: fmtDate(proj.sentAt, { day: 'numeric', month: 'long' }) })
          : proj.dropped ? t('project.droppedOn', { d: fmtDate(r.droppedAt ?? r.createdAt, { day: 'numeric', month: 'long' }) })
            : t('climb.projectProgress', { s: sessionsText(proj.sessions) })),
        // Projeto aberto: registrar a nova tentativa direto daqui, na sessão de hoje.
        !proj.sentAt && !proj.dropped && h('div', { class: 'row project-actions' },
          h('button', { class: 'btn go big grow', type: 'button', onclick: (e) => logTry(r, 'sent', e.currentTarget) }, t('project.sent')),
          h('button', { class: 'btn big grow', type: 'button', onclick: (e) => logTry(r, 'project', e.currentTarget) }, t('project.again'))),
        !proj.sentAt && h('button', {
          class: 'btn ghost block', type: 'button',
          onclick: () => api(`/climbs/${r.id}`, { method: 'PATCH', body: { dropped: !proj.dropped } }).then((x) => { upsert(state.climbs, x); draw(); }, fail),
        }, proj.dropped ? t('project.reopen') : t('project.drop')),
        h('ul', { class: 'list' }, tries.map(climbRow))),

      r.photoType && h('section', { class: 'card stack' },
        h('h2', {}, t('ai.title')),
        ai
          ? [
            h('p', { class: 'muted small' }, t('ai.disclaimer')),
            h('div', {}, h('div', { class: 'small muted' }, t('ai.angle')),
              seg(WALL_ANGLES.map((a) => [a, t(`angle.${a}`)]), ai.wallAngle, (a) => patchAi({ wallAngle: a }))),
            h('div', {}, h('div', { class: 'small muted' }, t('ai.holds')),
              h('div', { class: 'chips' }, HOLD_TYPES.map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ai.holdTypes.includes(x)), onclick: () => patchAi({ holdTypes: toggle(ai.holdTypes, x, 7) }) }, t(`hold.${x}`))))),
            h('div', {}, h('div', { class: 'small muted' }, t('ai.style')),
              h('div', { class: 'chips' }, STYLE_TAGS.map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ai.styleTags.includes(x)), onclick: () => patchAi({ styleTags: toggle(ai.styleTags, x, 3) }) }, t(`style.${x}`))))),
          ]
          : h('button', { class: 'btn block', type: 'button', onclick: analyze }, t('ai.analyze'))),

      h('button', { class: 'btn ghost danger block', type: 'button', onclick: del }, t('climb.delete')),
    );
  };

  draw();
  if (root.photoType) api(`/climbs/${root.id}/media`).then((m) => { photo = { url: m.photoUrl }; draw(); }, () => {});
  return box;
}

const capitalize = (x) => x.charAt(0).toUpperCase() + x.slice(1);

function debounce(fn, ms) {
  let tm;
  return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); };
}

// ---------- tela: histórico (calendário + sessões + galeria) ----------
const historyUi = { month: null, day: null, tab: 'sessions', color: '', result: '' };

function viewHistory() {
  const box = h('div', { class: 'stack' });
  const now = new Date();
  historyUi.month ??= new Date(now.getFullYear(), now.getMonth(), 1);

  const draw = () => {
    const m = historyUi.month;
    const days = S.climbingDays(state.sessions, m.getFullYear(), m.getMonth());
    const first = (m.getDay() + 6) % 7; // segunda = 0
    const total = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const isThisMonth = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth();
    const wd = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));
    const shift = (n) => { historyUi.month = new Date(m.getFullYear(), m.getMonth() + n, 1); historyUi.day = null; draw(); };

    let summaries = S.sessionSummaries(state.sessions, state.climbs);
    if (historyUi.day) summaries = summaries.filter((s) => {
      const d = new Date(s.startedAt);
      return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth() && d.getDate() === historyUi.day;
    });
    const gallery = state.climbs
      .filter((c) => c.thumbUrl && (!historyUi.color || c.color === historyUi.color) && (!historyUi.result || c.result === historyUi.result))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    fill(box, 
      h('h1', {}, t('tab.history')),
      h('section', { class: 'card' },
        h('div', { class: 'cal-head' },
          h('button', { type: 'button', 'aria-label': '‹', onclick: () => shift(-1) }, '‹'),
          h('div', { class: 'center' },
            h('strong', {}, capitalize(fmtDate(m, { month: 'long', year: 'numeric' }))),
            h('div', { class: 'muted small' }, t('calendar.days', { n: days.size }))),
          h('button', { type: 'button', 'aria-label': '›', onclick: () => shift(1), disabled: isThisMonth }, '›')),
        h('div', { class: 'cal', role: 'grid', 'aria-label': t('calendar.title') },
          wd.map((w) => h('span', { class: 'wd' }, w)),
          [...Array(first)].map(() => h('span')),
          [...Array(total)].map((_, i) => {
            const day = i + 1;
            const on = days.get(day);
            const cls = [on && 'on', on?.length > 1 && 'multi', historyUi.day === day && 'sel', isThisMonth && day === now.getDate() && 'today'].filter(Boolean).join(' ');
            return h('button', {
              type: 'button', class: cls, disabled: !on, 'aria-pressed': on ? String(historyUi.day === day) : null,
              onclick: () => { historyUi.day = historyUi.day === day ? null : day; historyUi.tab = 'sessions'; draw(); },
            }, String(day));
          }))),

      seg([['sessions', t('history.sessions')], ['gallery', t('history.gallery')]], historyUi.tab, (v) => { historyUi.tab = v; draw(); }),

      historyUi.tab === 'sessions'
        ? (summaries.length
          ? h('ul', { class: 'list card' }, summaries.map((s) => h('li', {}, h('details', { class: 'session', open: summaries.length === 1 },
            h('summary', {}, h('div', { class: 'grow' }, sessionHeader(s))),
            h('ul', { class: 'list' }, state.climbs.filter((c) => c.sessionId === s.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(climbRow))))))
          : h('p', { class: 'muted' }, t('history.empty')))
        : h('section', {},
          h('div', { class: 'row' },
            h('select', { class: 'grow', 'aria-label': t('climb.color'), onchange: (e) => { historyUi.color = e.target.value; draw(); } },
              h('option', { value: '' }, `${t('climb.color')}: ${t('history.all')}`),
              COLORS.map((c) => h('option', { value: c, selected: historyUi.color === c }, colorName(c)))),
            h('select', { class: 'grow', 'aria-label': t('climb.result'), onchange: (e) => { historyUi.result = e.target.value; draw(); } },
              h('option', { value: '' }, `${t('climb.result')}: ${t('history.all')}`),
              RESULTS.map((r) => h('option', { value: r, selected: historyUi.result === r }, t(`result.${r}`))))),
          h('div', { class: 'gallery' }, gallery.map((c) => h('a', { href: `#/climb/${c.id}` },
            h('img', { src: c.thumbUrl, alt: `${colorName(c.color)} ${grade(c.grade)}`, loading: 'lazy', decoding: 'async', width: 200, height: 200 }),
            h('span', { class: 'tag' }, swatch(c.color), grade(c.grade)))))),
    );
  };
  draw();
  return box;
}

// ---------- tela: evolução ----------
function goalsCard() {
  const { weeklySessions, gradeGoal } = state.settings;
  if (!weeklySessions && gradeGoal == null) {
    return h('button', { class: 'link', type: 'button', onclick: settingsSheet }, `+ ${t('goal.set')}`);
  }
  const n = S.sessionsThisWeek(state.sessions);
  const reached = S.goalReachedAt(state.climbs, gradeGoal);
  const best = Math.max(-1, ...state.climbs.filter(S.isSend).map((c) => c.grade));
  return h('section', { class: 'card stack' },
    weeklySessions > 0 && h('div', {},
      h('div', { class: 'session-head' }, h('strong', {}, t('goal.week')), h('span', { class: 'num muted' }, t('goal.weekProgress', { n, g: weeklySessions }))),
      h('div', { class: 'progress' }, h('span', { style: { '--w': `${Math.min(100, (n / weeklySessions) * 100)}%` } }))),
    gradeGoal != null && h('div', {},
      h('div', { class: 'session-head' }, h('strong', {}, `${t('goal.grade')}: ${grade(gradeGoal)}`),
        h('span', { class: 'num muted' }, reached ? t('goal.gradeDone', { d: fmtDate(reached) }) : best >= 0 ? t('goal.gradeBest', { g: grade(best) }) : '')),
      h('div', { class: 'progress' }, h('span', { style: { '--w': `${reached ? 100 : Math.max(0, ((best + 1) / (gradeGoal + 1)) * 100)}%` } }))));
}

function viewProgress() {
  if (!state.climbs.length) return h('div', { class: 'stack' }, h('h1', {}, t('tab.progress')), hero(), gradePathCard(), goalsCard(), h('p', { class: 'muted' }, t('progress.empty')));
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const recent = state.climbs.filter((c) => c.createdAt >= since);
  const recentSends = recent.filter(S.isSend);
  const weekly = S.weeklyGrades(state.climbs).slice(-12);
  const volume = S.sessionSummaries(state.sessions, state.climbs).slice(0, 12).reverse();
  const pyr = S.pyramid(state.climbs);
  const open = S.projects(state.climbs).filter(S.isOpenProject);
  const styles = S.styleStats(state.climbs);

  const kpi = (value, label) => h('div', { class: 'kpi' }, h('b', {}, value), h('span', {}, label));
  const maxVol = Math.max(1, ...volume.map((s) => s.climbs));
  const maxPyr = Math.max(1, ...pyr.map((p) => p.sends));
  const maxStyle = Math.max(1, ...styles.map((s) => s.sends + s.projects));
  const styleLabel = (key) => { const [kind, v] = key.split(':'); return t(`${kind === 'hold' ? 'hold' : 'angle'}.${v}`); };

  return h('div', { class: 'stack' },
    h('h1', {}, t('tab.progress')),
    hero(),
    gradePathCard(),
    achievementsCard(),
    goalsCard(),
    h('div', { class: 'kpis' },
      kpi(recentSends.length ? grade(Math.max(...recentSends.map((c) => c.grade))) : '—', t('progress.max')),
      kpi(String(state.sessions.filter((s) => s.startedAt >= since).length), t('progress.sessions')),
      kpi(fmtPct(S.flashRate(state.climbs)), t('progress.flash')),
      kpi(String(S.streakWeeks(state.sessions)), t('progress.streak'))),

    weekly.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.weekly')), lineChart(weekly),
      h('div', { class: 'legend' }, h('span', {}, h('i'), t('progress.weeklyMax')), h('span', {}, h('i', { class: 'med' }), t('progress.weeklyMedian')))),

    volume.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.volume')),
      h('div', { class: 'bars-v', role: 'img', 'aria-label': t('progress.volume') }, volume.map((s) =>
        h('div', {}, h('span', { class: 'num' }, String(s.climbs)), h('span', { class: 'fill', style: { '--h': `${(s.climbs / maxVol) * 100}%` } }),
          h('span', {}, fmtDate(s.startedAt, { day: 'numeric', month: 'numeric' })))))),

    pyr.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.pyramid')),
      h('div', { class: 'bars-h' }, pyr.map((p) => h('div', {},
        h('strong', { class: 'num' }, grade(p.grade)),
        h('div', { class: 'track', title: `${p.flashes} flash` },
          h('span', { class: 'fill accent', style: { '--w': `${(p.flashes / maxPyr) * 100}%` } }),
          h('span', { class: 'fill', style: { '--w': `${((p.sends - p.flashes) / maxPyr) * 100}%` } })),
        h('span', { class: 'num muted' }, String(p.sends))))),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'flash-i' }), t('result.flash')), h('span', {}, h('i', { class: 'sent-i' }), t('result.sent')))),

    h('section', { class: 'card' }, h('h2', {}, t('progress.projects')),
      open.length
        ? h('ul', { class: 'list' }, open.map((p) => climbRowProject(p)))
        : h('p', { class: 'muted' }, t('progress.noProjects'))),

    styles.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.styles')),
      h('p', { class: 'muted small' }, t('progress.stylesHint')),
      h('div', { class: 'bars-h styles' }, styles.slice(0, 10).map((s) => h('div', {},
        h('span', {}, styleLabel(s.key)),
        h('div', { class: 'track' },
          h('span', { class: 'fill', style: { '--w': `${(s.sends / maxStyle) * 100}%` } }),
          h('span', { class: 'fill soft', style: { '--w': `${(s.projects / maxStyle) * 100}%` } })),
        h('span', { class: 'num muted' }, `${s.sends}/${s.sends + s.projects}`)))),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'sent-i' }), t('progress.sends')), h('span', {}, h('i', { class: 'soft-i' }), t('progress.open')))),
  );
}

function climbRowProject(p) {
  const row = climbRow(p.root);
  row.querySelector('.meta').textContent = t('climb.projectProgress', { s: sessionsText(p.sessions) });
  return row;
}

/** Linha do grau máximo (cheia) e mediano (tracejada) por semana, em SVG. */
function lineChart(weeks) {
  const W = 320, H = 150, L = 30, R = 8, T = 10, B = 22;
  const lo = Math.max(0, Math.min(...weeks.map((w) => w.median)) - 1);
  const hi = Math.max(...weeks.map((w) => w.max)) + 1;
  const x = (i) => L + (weeks.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (weeks.length - 1));
  const y = (g) => T + ((hi - g) * (H - T - B)) / (hi - lo || 1);
  const ticks = [...new Set([lo, Math.round((lo + hi) / 2), hi])];
  const pts = (k) => weeks.map((w, i) => `${x(i)},${y(w[k])}`).join(' ');
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('progress.weekly') },
    ticks.map((g) => [
      svg('line', { class: 'grid', x1: L, x2: W - R, y1: y(g), y2: y(g) }),
      svg('text', { class: 'axis', x: L - 6, y: y(g) + 3, 'text-anchor': 'end' }, document.createTextNode(grade(g))),
    ]).flat(),
    svg('polyline', { class: 'med', points: pts('median') }),
    svg('polyline', { class: 'max', points: pts('max') }),
    weeks.map((w, i) => svg('circle', { class: 'dot', cx: x(i), cy: y(w.max), r: 3.5 })),
    [0, weeks.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) =>
      svg('text', { class: 'axis', x: x(i), y: H - 4, 'text-anchor': i === 0 && weeks.length > 1 ? 'start' : 'end' },
        document.createTextNode(fmtDate(`${weeks[i].week}T12:00:00`)))));
}

// ---------- ajustes ----------
function settingsSheet() {
  const st = { ...state.settings };
  const box = h('div', { class: 'stack' });
  const draw = () => fill(box, 
    h('h2', {}, t('settings.title')),
    h('div', {}, h('div', { class: 'small muted' }, t('settings.scale')),
      seg([['v', 'V (Hueco)'], ['font', 'Font']], st.scale, (v) => { st.scale = v; draw(); })),
    h('h2', {}, t('settings.goals')),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, t('settings.weekly')),
      stepper(st.weeklySessions, 0, 7, (n) => (st.weeklySessions = n), t('settings.weekly'))),
    h('label', { class: 'field' }, h('span', {}, t('settings.gradeGoal')),
      h('select', { onchange: (e) => (st.gradeGoal = e.target.value === '' ? null : Number(e.target.value)) },
        h('option', { value: '' }, t('settings.none')),
        S.GRADES.map((g) => h('option', { value: String(g), selected: st.gradeGoal === g }, S.gradeLabel(g, st.scale))))),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close')),
      h('button', {
        class: 'btn primary grow', type: 'button',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            state.settings = { ...state.settings, ...(await api('/settings', { method: 'PUT', body: { scale: st.scale, weeklySessions: st.weeklySessions, gradeGoal: st.gradeGoal } })) };
            $('#sheet').close();
            render();
          } catch (err) { fail(err); e.target.disabled = false; }
        },
      }, t('settings.save'))),
    h('button', { class: 'link', type: 'button', onclick: () => openSheet(h('div', { class: 'stack' }, h('h2', {}, t('terms.view')), termsBody(),
      state.settings.photoTermsAt && h('p', { class: 'muted small' }, t('terms.accepted', { d: fmtDate(state.settings.photoTermsAt, { day: 'numeric', month: 'long', year: 'numeric' }) })),
      h('button', { class: 'btn block', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close')))) }, t('terms.view')),
    h('button', { class: 'btn ghost danger block', type: 'button', onclick: logout }, t('settings.logout')),
  );
  draw();
  openSheet(box);
}

// ---------- roteamento ----------
const ROUTES = [
  [/^#?\/?$/, viewSession, 'session'],
  [/^#\/new$/, viewNew, 'session'],
  [/^#\/climb\/([a-z0-9]{19})$/, viewClimb, null],
  [/^#\/history$/, viewHistory, 'history'],
  [/^#\/progress$/, viewProgress, 'progress'],
];

function render() {
  timers.forEach(clearInterval);
  timers = [];
  const hash = location.hash || '#/';
  const [re, fn, tab] = ROUTES.find(([r]) => r.test(hash)) ?? ROUTES[0];
  view.replaceChildren(fn(...(hash.match(re)?.slice(1) ?? [])));
  streakPill();
  document.querySelectorAll('#tabbar a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

function showAuth() {
  $('#tabbar').hidden = true;
  $('#open-settings').hidden = true;
  view.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'auth-mark' }, hold(0, '#2f5bff'), chalkTick('draw')),
    h('h1', {}, t('auth.title')),
    h('p', {}, t('auth.lead')),
    h('button', { class: 'btn primary big block', type: 'button', onclick: () => login() }, t('auth.login')),
    h('button', { class: 'btn big block', type: 'button', onclick: () => login('signup') }, t('auth.signup'))));
}

async function boot() {
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  $('#open-settings').setAttribute('aria-label', t('settings.title'));
  $('#open-settings').addEventListener('click', settingsSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  cfg = await (await fetch('/config.json', { cache: 'no-store' })).json();
  if (!(await idToken())) return showAuth();
  try {
    await loadAll();
  } catch (e) {
    if (e.message !== 'auth') fail(e);
    return;
  }
  $('#tabbar').hidden = false;
  $('#open-settings').hidden = false;
  window.addEventListener('hashchange', render);
  // URLs assinadas das miniaturas valem 1 h: recarrega ao voltar ao app depois de um tempo.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 45 * 60_000) {
      try { await loadAll(); render(); } catch {}
    }
  });
  render();
}

boot().catch(fail);
