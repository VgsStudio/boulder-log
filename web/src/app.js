// Chalkmark: SPA sem framework. Rotas por hash, dados em memória, API em /api.
import './style.css';

// Endereço principal: chalkmark.vsoller.com.br. O boulder.* continua respondendo e manda para lá,
// mantendo o caminho e o # (links de boulder compartilhado e de perfil continuam valendo).
if (location.hostname.startsWith('boulder.')) {
  location.replace(`https://chalkmark.${location.hostname.slice('boulder.'.length)}${location.pathname}${location.search}${location.hash}`);
}
import { fmtDate, fmtDuration, fmtPct, lang, langChoice, setLang, t } from './i18n.js';
import { boxLab, calibrate, COLORS, sampleLab, suggest, SWATCH } from './color.js';
// detect.js é leve; o onnxruntime-web e o modelo (~10 MB) só baixam na primeira foto.
import { detectHolds, growRegion, holdAt, routeHolds } from './detect.js';
import { playFanfare, playSent, playTick, setSound, soundOn } from './sound.js';
import { bumpNags, clearGuest, getPhoto, guestApi, guestLocked, guestNags, guestPending, putPhoto, startGuest } from './guest.js';

const PHOTO_TERMS_VERSION = '2026-11-12'; // igual a services/api.ts
import * as S from './stats.js';

const HOLD_TYPES = ['crimp', 'sloper', 'jug', 'pinch', 'pocket', 'volume', 'edge'];
const WALL_ANGLES = ['slab', 'vertical', 'overhang', 'roof'];
const STYLE_TAGS = ['dynamic', 'static', 'compression', 'balance', 'power', 'technical', 'coordination', 'heel_hook', 'toe_hook', 'mantle'];
const RESULTS = ['flash', 'sent', 'project'];

const $ = (s) => document.querySelector(s);

// ---------- tema: automático (segue o aparelho), claro ou escuro ----------
const THEME_COLORS = { light: '#eef1f6', dark: '#0f1226' };
const getTheme = () => { try { return localStorage.getItem('cm:theme') || 'auto'; } catch { return 'auto'; } };
function applyTheme(theme = getTheme()) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  // Barra do navegador acompanha a escolha.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = theme === 'auto' ? THEME_COLORS[m.media.includes('dark') ? 'dark' : 'light'] : THEME_COLORS[theme];
  });
}
function setTheme(theme) {
  try { if (theme === 'auto') localStorage.removeItem('cm:theme'); else localStorage.setItem('cm:theme', theme); } catch {}
  applyTheme(theme);
}
applyTheme();
// Sem zoom de pinça na página (só na foto, que tem zoom próprio). O Safari ignora user-scalable=no.
document.addEventListener('gesturestart', (e) => e.preventDefault());
const view = $('#view');
let cfg;
/** Volta do login para o mesmo endereço em que a pessoa está (o app responde em mais de um domínio). */
const redirectUri = () => `${location.origin}/`;
const state = { gyms: [], sessions: [], climbs: [], settings: { scale: 'v', weeklySessions: 0, gradeGoal: null }, profile: null, loadedAt: 0 };
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
  if (e?.code === 'NEED_ACCOUNT') { needAccount(); return; }
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

// ---------- login no próprio app (API do Cognito: e-mail e senha) ----------
/** Chama a API pública do Cognito (sem credencial AWS; só o id do cliente do app). */
async function cognitoApi(action, body) {
  const res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify({ ClientId: cfg.clientId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || action), { code: String(data.__type || '').split('#').pop() });
  return data;
}
const fromAuthResult = (r) => ({ id_token: r.IdToken, access_token: r.AccessToken, refresh_token: r.RefreshToken, expires_in: r.ExpiresIn, via: 'api' });

async function login(path = 'oauth2/authorize', extra = {}) {
  try { if (location.hash.length > 2) sessionStorage.setItem('cm:after', location.hash); } catch {}
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(VERIFIER, verifier);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL(`${cfg.cognitoDomain}/${path}`);
  Object.entries({
    response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri(), scope: 'openid email',
    code_challenge_method: 'S256', code_challenge: challenge, lang: lang === 'pt' ? 'pt-BR' : 'en', ...extra,
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  location.assign(url);
}

function logout() {
  try { localStorage.removeItem(TOKENS); } catch {}
  const url = new URL(`${cfg.cognitoDomain}/logout`);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('logout_uri', redirectUri());
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
  // Primeira entrada com Google numa conta que acabou de ser vinculada: o Cognito devolve um erro
  // ("Already found an entry") uma única vez; tentar de novo já entra na conta certa.
  const desc = new URLSearchParams(location.search).get('error_description') ?? '';
  if (/already found an entry/i.test(desc)) {
    history.replaceState({}, '', '/');
    let retried = false;
    try { retried = sessionStorage.getItem('cm:linkRetry') === '1'; sessionStorage.setItem('cm:linkRetry', '1'); } catch {}
    if (!retried) { await login('oauth2/authorize', { identity_provider: 'Google' }); return null; }
  }
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    history.replaceState({}, '', '/');
    const tk = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: sessionStorage.getItem(VERIFIER) || '' });
    sessionStorage.removeItem(VERIFIER);
    if (tk) saveTokens(tk);
  }
  let tk = loadTokens();
  if (tk && Date.now() - tk.obtainedAt > (tk.expires_in - 120) * 1000) {
    // Um refresh por vez, mesmo com várias chamadas em paralelo.
    refreshing ??= (tk.via === 'api'
      ? cognitoApi('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: tk.refresh_token } })
        .then((r) => fromAuthResult(r.AuthenticationResult), () => null)
      : tokenCall({ grant_type: 'refresh_token', refresh_token: tk.refresh_token })).finally(() => (refreshing = null));
    const fresh = tk.refresh_token && (await refreshing);
    if (fresh) saveTokens((tk = { ...fresh, refresh_token: tk.refresh_token, via: tk.via }));
    else { try { localStorage.removeItem(TOKENS); } catch {} tk = null; }
  }
  return tk?.id_token ?? null;
}

/** Usando sem conta (dados só neste navegador; ver guest.js). */
let guestMode = false;

async function api(path, { method = 'GET', body } = {}) {
  const jwt = await idToken();
  if (!jwt && guestMode) return guestApi(path, { method, body });
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

/** Leitura pública (sem login): boulder compartilhado e cartão de perfil. */
async function publicApi(path) {
  const res = await fetch(`/api/public${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.error, status: res.status });
  return data;
}

// ---------- dados ----------
async function loadAll() {
  const [gyms, sessions, climbs, settings, profile] = await Promise.all([api('/gyms'), api('/sessions'), api('/climbs'), api('/settings'), api('/profile')]);
  Object.assign(state, { gyms, sessions, climbs, profile: profile.handle ? profile : null, loadedAt: Date.now() });
  state.settings = { ...state.settings, ...settings };
  // Cópia para abrir sem sinal (ginásio). Fotos não vão (URLs assinadas expiram).
  if (!guestMode) {
    try { localStorage.setItem('cm:snap', JSON.stringify({ gyms, sessions, climbs: climbs.map(({ thumbUrl: _t, ...c }) => c), settings, profile })); } catch {}
  }
}
/** Sem sinal: abre com a última cópia dos dados (só leitura de verdade; gravar pede conexão). */
function loadSnapshot() {
  try {
    const s = JSON.parse(localStorage.getItem('cm:snap'));
    if (!s) return false;
    Object.assign(state, { gyms: s.gyms, sessions: s.sessions, climbs: s.climbs, profile: s.profile?.handle ? s.profile : null, loadedAt: 0 });
    state.settings = { ...state.settings, ...s.settings };
    return true;
  } catch { return false; }
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
async function upload({ url, fields, guest }, blob) {
  if (guest) return putPhoto(guest, blob); // sem conta: a foto fica no navegador até criar conta
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
const PIN_ICON = 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';
const PENCIL_ICON = 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4';
const CHECK_ICON = 'M5 12.5l4.5 4.5L19 7.5';
const SHARE_ICON = 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6';
/** Ícone de traço (pin, compartilhar), na cor do texto. */
const lineIcon = (d) => svg('svg', { class: 'line-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d }));
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

/** O que é o foguinho: a sequência de semanas, com a semana atual. */
function streakSheet() {
  const n = S.streakWeeks(state.sessions);
  const thisWeek = S.weekDots(state.sessions).some(Boolean);
  openSheet(h('div', { class: 'stack' },
    h('h2', {}, t('streak.title', { n })),
    h('p', {}, t('streak.explain')),
    hero(),
    h('p', { class: 'muted' }, thisWeek ? t('streak.safe') : t('streak.risk')),
    h('button', { class: 'btn block', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close'))));
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
function celebrate({ unlocked, xp, levelUp, sent = false }) {
  if (!unlocked.length && !levelUp) { (sent ? playSent : playTick)(); toast(t('xp.gain', { n: xp })); return; }
  playFanfare();
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
  playFanfare();
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
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
    () => resolve(null),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
  );
});
const geoGranted = async () => {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch { return false; }
};

// ---------- encerramento automático da sessão ----------
// Site não acompanha a localização com o app fechado: a conferência roda ao abrir o app, ao voltar
// para ele e a cada 5 min enquanto está aberto.
const LEFT_KM = 1; // GPS dentro de ginásio erra centenas de metros
const IDLE_MS = 4 * 3600_000; // sem registrar boulder por 4 h = sessão esquecida aberta
let autoEndBusy = false;
async function checkAutoEnd() {
  const s = activeSession();
  if (!s || autoEndBusy || document.visibilityState !== 'visible') return;
  autoEndBusy = true;
  try {
    const last = [s.startedAt, ...state.climbs.filter((c) => c.sessionId === s.id).map((c) => c.createdAt)].sort().at(-1);
    if (Date.now() - Date.parse(last) > IDLE_MS) return await autoEnd(s, 'idle', last);
    const gym = gymOf(s.gymId);
    if (!gym?.loc || !(await geoGranted())) return;
    const pos = await getPos();
    if (pos && pos.acc < 800 && S.distanceKm(gym.loc, pos) > LEFT_KM) await autoEnd(s, 'left', new Date().toISOString());
  } finally { autoEndBusy = false; }
}
async function autoEnd(s, reason, endedAt) {
  const prev = { ...s };
  upsert(state.sessions, { id: s.id, endedAt, autoEnded: reason });
  render();
  try {
    upsert(state.sessions, await api(`/sessions/${s.id}`, { method: 'PATCH', body: { end: true, endedAt, auto: reason } }));
    toast(t(reason === 'left' ? 'session.autoLeft' : 'session.autoIdle'));
  } catch (err) { upsert(state.sessions, { ...prev, endedAt: undefined, autoEnded: undefined }); render(); fail(err); }
}

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
      const prev = { ...s };
      upsert(state.sessions, { id: s.id, endedAt: new Date().toISOString(), feeling, ...(body.note ? { note: body.note } : {}) });
      $('#sheet').close();
      render();
      const ended = state.sessions.find((x) => x.id === s.id);
      // Conquistas desta sessão: as que caíram desde o início dela.
      recapSheet(ended, S.achievements(state.sessions, state.climbs).filter((a) => a.at >= ended.startedAt));
      api(`/sessions/${s.id}`, { method: 'PATCH', body })
        .then((x) => upsert(state.sessions, x), (err) => { upsert(state.sessions, { ...prev, endedAt: undefined }); render(); fail(err); });
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
      Object.assign(d, { canvas, tap: null, lab: null, suggestion: null, boxes: null, seed: null, route: null, detect: 'loading', zoom: { k: 1, x: 0, y: 0 } });
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
    d.seed = d.boxes && findHold(x, y);
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
      d.autoRoute = [...d.route]; // o que o app sugeriu sozinho, antes das correções (medir acerto / treino)
    }
  };
  /** Agarra no ponto: a detectada mais próxima; senão cresce a região pela cor (volume ou agarra
   *  que o detector não viu) e passa a tratá-la como agarra detectada. */
  const findHold = (x, y) => {
    const c = d.canvas;
    const found = holdAt(d.boxes, x, y, 0.03, c.width / c.height);
    if (found) return found;
    const grown = growRegion(d.rgba, c.width, c.height, x, y);
    if (grown) d.boxes.push(grown);
    return grown ?? undefined;
  };
  const onTap = (x, y) => {
    const hit = d.route && d.boxes && findHold(x, y);
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
    if (!d.result) { toast(t('climb.pickResult')); document.querySelector('.seg')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
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
        ...(d.route?.length ? { holds: d.route.slice(0, 80).map(holdOut) } : {}),
        ...(d.boxes?.length ? { cands: d.boxes.slice(0, 300).map(boxOut), detector: DETECTOR_ID } : {}),
        ...(d.autoRoute?.length ? { autoHolds: d.autoRoute.slice(0, 80).map(boxOut) } : {}),
        ...(d.projectId ? { projectId: d.projectId } : {}),
        ...(full ? { photoType: full.type } : {}),
      };
      const before = S.achievements(state.sessions, state.climbs);
      const lvBefore = S.level(S.totalXp(state.climbs)).level;
      const { climb, uploads } = await api('/climbs', { method: 'POST', body });
      if (uploads) climb.thumbUrl = URL.createObjectURL(thumb); // mostra a foto local já
      state.climbs.push(climb);
      const unlocked = S.newAchievements(before, S.achievements(state.sessions, state.climbs));
      const lvAfter = S.level(S.totalXp(state.climbs)).level;
      setTimeout(() => celebrate({ unlocked, xp: S.xpFor(climb), levelUp: lvAfter > lvBefore ? lvAfter : 0, sent: S.isSend(climb) }), 50);
      location.replace(`#/climb/${climb.id}`); // sem voltar para o formulário
      if (guestMode) setTimeout(needAccount, 1600); // depois da comemoração
      // A foto sobe em segundo plano; depois dela, o estilo da via (IA). Nada disso segura a tela.
      if (uploads) {
        Promise.all([upload(uploads.full, full), upload(uploads.thumb, thumb)])
          .then(() => !guestMode && api(`/climbs/${climb.id}/analyze`, { method: 'POST' }).then((x) => {
            upsert(state.climbs, x);
            if (location.hash === `#/climb/${climb.id}`) render();
          }, (err) => console.warn('analyze', err)))
          .catch(() => toast(t('upload.failed')));
      }
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
              else Object.assign(d, { projectId: p.root.id, color: p.root.color, grade: p.root.grade, result: null, canvas: null, tap: null }); // escolha explícita: mandou ou não
              draw();
            },
          }, swatch(p.root.color), h('strong', {}, grade(p.root.grade)), h('span', { class: 'muted' }, sessionsText(p.sessions)))))),

      // Foto + toque na agarra (não quando continua um projeto: usa a foto dele).
      project
        ? (project.thumbUrl && h('img', { class: 'thumb', src: project.thumbUrl, alt: '', style: { width: '96px', height: '96px' } }))
        : d.canvas
          ? h('section', {},
            scanning(d.detect === 'loading', stage([d.canvas,
              holdsOverlay(d.route, d.boxes),
              // A bolinha do toque só enquanto não há via marcada (depois as caixas mostram tudo).
              d.tap && !d.route?.length && h('span', { class: 'marker', style: { '--x': `${d.tap.x * 100}%`, '--y': `${d.tap.y * 100}%` } })], onTap, d.zoom,
              (x, y) => { if (d.route && cycleRole(d.route, x, y)) { playTick(); draw(); } })),
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

/** Toque longo numa agarra marcada: início (verde) → topo (vermelha) → normal. */
function cycleRole(holds, x, y) {
  const b = holds.filter((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h).sort((a, c) => a.w * a.h - c.w * c.h)[0];
  if (!b) return false;
  b.role = b.role === 'start' ? 'top' : b.role === 'top' ? undefined : 'start';
  if (!b.role) delete b.role;
  return true;
}
/** Modelo que achou as candidatas (muda quando o detector for trocado ou retreinado). */
const DETECTOR_ID = 'yolov8n-freeclimbs-2';
const holdOut = ({ x, y, w, h: hh, role }) => ({ x, y, w, h: hh, ...(role ? { role } : {}) });
const boxOut = ({ x, y, w, h: hh }) => ({ x, y, w, h: hh });

/** Caixas das agarras da via sobre a foto (coordenadas 0-1). */
function holdsOverlay(holds, all = []) {
  if (!holds?.length && !all?.length) return null;
  const others = (all ?? []).filter((b) => !holds?.includes(b));
  return svg('svg', { class: 'overlay', viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    others.map((b) => svg('rect', { class: 'cand', x: b.x, y: b.y, width: b.w, height: b.h })),
    (holds ?? []).flatMap((b) => [
      svg('rect', { class: 'under', x: b.x, y: b.y, width: b.w, height: b.h }),
      svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: b.role ?? null }),
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
  let editing = false; // cor e grau abertos para edição
  let photo = null; // { url }

  const patchClimb = (fields) => {
    const prev = { ...climbOf(c.id) };
    upsert(state.climbs, { id: c.id, ...fields });
    if (fields.result && S.isSend({ result: fields.result }) && !S.isSend(prev)) playSent();
    draw();
    api(`/climbs/${c.id}`, { method: 'PATCH', body: fields })
      .then((x) => upsert(state.climbs, x), (err) => { upsert(state.climbs, prev); draw(); fail(err); });
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
  let lastTry = 0;
  const logTry = async (rootClimb, result, btn) => {
    // Toques repetidos em sequência criavam vários registros: ignora por 1,5 s depois de registrar.
    if (Date.now() - lastTry < 1500) return;
    lastTry = Date.now();
    const s = activeSession();
    if (!s) { toast(t('project.needSession')); return; }
    btn.disabled = true;
    const body = { sessionId: s.id, color: rootClimb.color, grade: rootClimb.grade, attempts: 1, result, projectId: rootClimb.id };
    const before = S.achievements(state.sessions, state.climbs);
    const lvBefore = S.level(S.totalXp(state.climbs)).level;
    // Registro provisório para a tela reagir já; troca pelo do servidor quando ele responder.
    const temp = { ...body, id: `tmp${Date.now()}`, createdAt: new Date().toISOString() };
    state.climbs.push(temp);
    const lvAfter = S.level(S.totalXp(state.climbs)).level;
    celebrate({ unlocked: S.newAchievements(before, S.achievements(state.sessions, state.climbs)), xp: S.xpFor(temp), levelUp: lvAfter > lvBefore ? lvAfter : 0, sent: result === 'sent' });
    draw();
    try {
      const { climb } = await api('/climbs', { method: 'POST', body });
      state.climbs = state.climbs.map((x) => (x === temp ? climb : x));
      draw();
    } catch (err) {
      state.climbs = state.climbs.filter((x) => x !== temp);
      draw();
      fail(err);
    }
  };
  // Excluir: numa raiz de projeto apaga o projeto inteiro (raiz + tentativas); numa tentativa, só ela.
  const tryIds = () => state.climbs.filter((x) => x.projectId === c.id).map((x) => x.id);
  const del = async (e) => {
    if (!confirmDelete) { confirmDelete = true; e.currentTarget.textContent = t('climb.confirmDelete'); return; }
    e.currentTarget.disabled = true;
    const ids = [...tryIds(), c.id];
    try {
      for (const x of ids) await api(`/climbs/${x}`, { method: 'DELETE' });
      state.climbs = state.climbs.filter((x) => !ids.includes(x.id));
      if (state.profile?.pinned && ids.includes(state.profile.pinned)) state.profile.pinned = null;
      toast(t('climb.deleted'));
      history.back();
    } catch (err) {
      // O que já saiu, saiu: recarrega para a tela não mostrar registro apagado.
      fail(err);
      loadAll().then(render, () => {});
    }
  };

  // Edição das agarras da via sobre a foto salva: o detector roda de novo e cada toque inclui ou tira.
  let holdEdit = null; // { canvas, rgba, boxes, holds, status }
  const startHoldEdit = async () => {
    const r = rootOf(climbOf(id));
    holdEdit = { holds: (r.holds ?? []).map((b) => ({ ...b })), status: 'loading', zoom: { k: 1, x: 0, y: 0 } };
    draw();
    try {
      const url = photo?.url ?? (await api(`/climbs/${r.id}/media`)).photoUrl;
      const blob = await (await fetch(url, { cache: 'no-store' })).blob();
      const canvas = await toCanvas(blob, 1568);
      if (!holdEdit) return;
      Object.assign(holdEdit, { canvas, rgba: canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data });
      draw();
      const gym = gymOf(state.sessions.find((s) => s.id === r.sessionId)?.gymId);
      const boxes = await detectHolds(canvas, gym?.palette ?? {});
      if (holdEdit) { Object.assign(holdEdit, { boxes, status: 'done' }); draw(); }
    } catch (err) {
      console.error(err);
      if (holdEdit) { holdEdit.status = holdEdit.canvas ? 'failed' : 'done'; if (!holdEdit.canvas) { holdEdit = null; fail(err); } draw(); }
    }
  };
  const tapHold = (x, y) => {
    const e = holdEdit;
    const c = e.canvas;
    const inside = (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    const had = e.holds.findIndex(inside);
    if (had >= 0) { e.holds.splice(had, 1); draw(); return; }
    let b = e.boxes && holdAt(e.boxes, x, y, 0.03, c.width / c.height);
    if (!b) { b = growRegion(e.rgba, c.width, c.height, x, y); if (b) e.boxes?.push(b); }
    if (!b) return;
    if (!e.holds.includes(b)) e.holds.push(b);
    playTick();
    draw();
  };
  const saveHolds = async (ev) => {
    ev.currentTarget.disabled = true;
    const r = rootOf(climbOf(id));
    const holds = holdEdit.holds.slice(0, 80).map(holdOut);
    const cands = holdEdit.boxes?.length ? { cands: holdEdit.boxes.slice(0, 300).map(boxOut), detector: DETECTOR_ID } : {};
    try {
      upsert(state.climbs, await api(`/climbs/${r.id}`, { method: 'PATCH', body: { holds, ...cands } }));
      holdEdit = null;
      toast(t('holds.saved'));
      draw();
    } catch (err) { fail(err); ev.target.disabled = false; }
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

    const ni = navList.indexOf(id);
    const goNav = (d) => { const nid = navList[ni + d]; if (nid) location.replace(`#/climb/${nid}`); };
    fill(box, 
      h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => history.back() }, `‹ ${t('back')}`),
        ni >= 0 && navList.length > 1 && h('span', { class: 'grow' }),
        ni >= 0 && navList.length > 1 && h('div', { class: 'row nav-top' },
          h('button', { class: 'icon-btn', type: 'button', disabled: ni <= 0, 'aria-label': t('nav.prev'), onclick: () => goNav(-1) }, '‹'),
          h('span', { class: 'small muted num' }, `${ni + 1}/${navList.length}`),
          h('button', { class: 'icon-btn', type: 'button', disabled: ni >= navList.length - 1, 'aria-label': t('nav.next'), onclick: () => goNav(1) }, '›'))),
      h('div', { class: 'row title-row' },
        h('h1', { class: 'row grow title-main' }, swatch(cur.color), h('span', { class: 'title-name' }, colorName(cur.color)), h('span', { class: 'grade-pill' }, grade(cur.grade))),
        // Ações do boulder: mesma cor e tamanho; o alfinete fica preenchido quando fixado, o lápis quando editando.
        h('div', { class: 'title-actions' },
          h('button', {
            class: 'icon-btn act-btn', type: 'button', onclick: () => pinClimb(r),
            'aria-pressed': String(state.profile?.pinned === r.id), 'aria-label': state.profile?.pinned === r.id ? t('pin.remove') : t('pin.add'),
          }, lineIcon(PIN_ICON)),
          h('button', { class: 'icon-btn act-btn', type: 'button', 'aria-label': t('share.button'), onclick: (e) => shareClimb(r, e.currentTarget) }, lineIcon(SHARE_ICON)),
          h('button', { class: 'icon-btn act-btn', type: 'button', 'aria-pressed': String(editing), 'aria-label': editing ? t('climb.done') : t('climb.edit'), onclick: () => { editing = !editing; draw(); } }, lineIcon(editing ? CHECK_ICON : PENCIL_ICON)))),
      // Edição de cor e grau (num projeto, as tentativas seguintes usam a cor/grau da raiz).
      editing && h('section', { class: 'card stack' },
        h('div', {}, h('h2', {}, t('climb.color')),
          h('div', { class: 'chips', role: 'group' }, COLORS.map((col) =>
            h('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur.color === col), onclick: () => patchClimb({ color: col }) }, swatch(col), colorName(col))))),
        h('div', {}, h('h2', {}, t('climb.grade')),
          h('div', { class: 'chips scroll', role: 'group' }, S.GRADES.map((g) =>
            h('button', { class: 'chip grade', type: 'button', 'aria-pressed': String(cur.grade === g), onclick: () => patchClimb({ grade: g }) }, grade(g)))))),

      r.photoType && (holdEdit
        ? h('section', { class: 'stack' },
          holdEdit.canvas
            ? scanning(holdEdit.status === 'loading', stage([holdEdit.canvas, holdsOverlay(holdEdit.holds, holdEdit.boxes ?? [])], tapHold, holdEdit.zoom,
              (x, y) => { if (cycleRole(holdEdit.holds, x, y)) { playTick(); draw(); } }))
            : null,
          h('p', { class: `small detect-status ${holdEdit.status}` },
            holdEdit.status === 'loading' ? t('detect.loading') : holdEdit.status === 'failed' ? t('detect.failed') : t('holds.hint', { n: holdEdit.holds.length })),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost grow', type: 'button', onclick: () => { holdEdit = null; draw(); } }, t('holds.cancel')),
            h('button', { class: 'btn primary grow', type: 'button', onclick: saveHolds }, t('holds.save'))))
        : [(() => {
          const i = navList.indexOf(id);
          const go = (d) => { const nid = navList[i + d]; if (nid) location.replace(`#/climb/${nid}`); };
          return withNav(climbStage(photo?.url ?? r.thumbUrl, r), i > 0, i >= 0 && i < navList.length - 1, go);
        })(),
          h('button', { class: 'link small', type: 'button', onclick: startHoldEdit }, t('holds.edit'))]),

      h('section', { class: 'card stack' },
        seg(RESULTS.map((x) => [x, t(`result.${x}`)]), cur.result, (x) => patchClimb({ result: x })),
        cur.note && h('p', { class: 'muted' }, cur.note),
        h('p', { class: 'muted small' }, fmtDate(cur.createdAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }), ', ', gymOf(state.sessions.find((s) => s.id === cur.sessionId)?.gymId)?.name ?? r.gymName ?? '')),

      proj && h('section', { class: 'card' },
        h('h2', {}, t('climb.project')),
        h('p', { class: 'num' }, proj.sentAt
          ? t('climb.projectSent', { d: fmtDate(proj.sentAt, { day: 'numeric', month: 'long' }) })
          : proj.dropped ? t('project.droppedOn', { d: fmtDate(r.droppedAt ?? r.createdAt, { day: 'numeric', month: 'long' }) })
            : proj.sessions ? t('climb.projectProgress', { s: sessionsText(proj.sessions) }) : t('project.notYet')),
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

      h('button', { class: 'btn ghost danger block', type: 'button', onclick: del },
        cur.id === r.id && tryIds().length ? t('climb.deleteProject', { n: tryIds().length + 1 }) : t('climb.delete')),
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

// ---------- compartilhar ----------
/** Gera o link e abre a folha com "Enviar" (compartilhamento nativo, chamado direto do toque,
 *  como o iOS exige) e "Copiar link". */
async function shareClimb(c, btn) {
  btn.disabled = true;
  try {
    const { token } = await api(`/climbs/${c.id}/share`, { method: 'POST' });
    const url = `${location.origin}/#/s/${token}`;
    const gym = gymOf(state.sessions.find((s) => s.id === c.sessionId)?.gymId)?.name ?? c.gymName;
    const text = gym
      ? t('share.textGym', { c: colorName(c.color).toLowerCase(), g: grade(c.grade), gym })
      : t('share.text', { c: colorName(c.color).toLowerCase(), g: grade(c.grade) });
    const copy = async () => {
      try { await navigator.clipboard.writeText(url); toast(t('share.copied')); } catch { toast(url); }
    };
    openSheet(h('div', { class: 'stack' },
      h('h2', {}, t('share.title')),
      h('p', { class: 'muted' }, t('share.lead')),
      h('input', { type: 'text', value: url, readonly: true, onfocus: (e) => e.target.select() }),
      navigator.share && h('button', { class: 'btn primary big block', type: 'button', onclick: () => navigator.share({ title: 'Chalkmark', text, url }).catch(() => {}) }, t('share.send')),
      h('button', { class: 'btn block', type: 'button', onclick: copy }, t('share.copy'))));
  } catch (err) { fail(err); }
  btn.disabled = false;
}

/** Boulder recebido por link: ver e adicionar aos próprios projetos. */
function viewShare(token) {
  const box = h('div', { class: 'stack' }, h('p', { class: 'small detect-status loading' }, t('share.loading')));
  (guestMode ? publicApi : api)(`/shares/${token}`).then((sh) => {
    if (guestMode) setTimeout(needAccount, 1200);
    const add = async (e) => {
      if (guestMode) { needAccount(); return; }
      e.currentTarget.disabled = true;
      try {
        const climb = await api(`/shares/${token}/accept`, { method: 'POST' });
        state.climbs.push(climb);
        playTick();
        toast(t('share.added'));
        location.replace(`#/climb/${climb.id}`);
      } catch (err) { fail(err); e.target.disabled = false; }
    };
    fill(box,
      h('p', { class: 'muted small' }, sh.owner ? t('share.receivedFrom', { n: sh.owner.name }) : t('share.received')),
      h('h1', { class: 'row' }, swatch(sh.color), colorName(sh.color), h('span', { class: 'grade-pill' }, grade(sh.grade))),
      sh.gymName && h('p', { class: 'muted' }, t('share.atGym', { gym: sh.gymName })),
      sh.owner && h('a', { class: 'row person', href: `#/u/${sh.owner.handle}` }, avatar(sh.owner), h('span', {}, h('strong', {}, sh.owner.name), h('span', { class: 'muted small' }, ` @${sh.owner.handle}`))),
      sh.photoUrl && climbStage(sh.photoUrl, sh),
      sh.ai && h('div', { class: 'chips' },
        sh.ai.wallAngle && h('span', { class: 'chip' }, t(`angle.${sh.ai.wallAngle}`)),
        (sh.ai.holdTypes ?? []).map((x) => h('span', { class: 'chip' }, t(`hold.${x}`)))),
      sh.mine
        ? h('p', { class: 'muted' }, t('share.mine'))
        : h('button', { class: 'btn go big block', type: 'button', onclick: add }, t('share.add')));
  }, (err) => fill(box, h('p', { class: 'muted' }, err.status === 404 ? t('share.gone') : t('error.generic'))));
  return box;
}

// ---------- foto com zoom ----------
/** Quadro da foto com pinça para ampliar só a foto (não a página) e arrastar quando ampliada.
 *  Toque curto sem mexer = onTap(x, y) em coordenadas 0-1 da foto, já descontando o zoom. */
function stage(content, onTap, z = { k: 1, x: 0, y: 0 }, onLong = null) {
  const inner = h('div', { class: 'zoom' }, content);
  const reset = h('button', { class: 'zoom-reset', type: 'button', hidden: true, onclick: (e) => { e.stopPropagation(); z.k = 1; z.x = z.y = 0; apply(); } }, t('zoom.reset'));
  const box = h('div', { class: 'stage' }, inner, reset);
  const pts = new Map();
  let start = null; // gesto atual: posição, zoom e distância iniciais
  const apply = () => {
    const w = box.clientWidth, hh = box.clientHeight;
    // Não deixa a foto sair do quadro.
    z.x = Math.min(0, Math.max(w - w * z.k, z.x));
    z.y = Math.min(0, Math.max(hh - hh * z.k, z.y));
    inner.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.k})`;
    box.classList.toggle('zoomed', z.k > 1.01);
    reset.hidden = z.k <= 1.01;
  };
  const snapshot = () => {
    const [a, b] = [...pts.values()];
    const r = box.getBoundingClientRect();
    const mid = b ? { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } : { x: a.x - r.left, y: a.y - r.top };
    return { mid, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, k: z.k, x: z.x, y: z.y, n: pts.size };
  };
  let longTimer;
  const at = (cx, cy) => {
    const r = inner.getBoundingClientRect(); // já com o zoom aplicado
    return [Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height))];
  };
  box.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t0: Date.now(), x0: e.clientX, y0: e.clientY });
    start = snapshot();
    clearTimeout(longTimer);
    if (pts.size > 1) start.multi = true;
    else if (onLong) {
      // Segurar ~0,5 s parado = toque longo (marca início/topo).
      const g = start;
      longTimer = setTimeout(() => {
        if (g !== start || g.moved || g.multi || pts.size !== 1) return;
        g.long = true;
        try { navigator.vibrate?.(25); } catch {}
        onLong(...at(e.clientX, e.clientY));
      }, 500);
    }
  });
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  box.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) start.moved = true;
    const now = snapshot();
    if (pts.size === 2 && start.dist) {
      const k = Math.min(5, Math.max(1, start.k * (now.dist / start.dist)));
      // Mantém o ponto entre os dedos parado enquanto amplia.
      z.x = now.mid.x - ((start.mid.x - start.x) / start.k) * k;
      z.y = now.mid.y - ((start.mid.y - start.y) / start.k) * k;
      z.k = k;
      apply();
    } else if (pts.size === 1 && z.k > 1.01 && start.n === 1) {
      z.x = start.x + (now.mid.x - start.mid.x);
      z.y = start.y + (now.mid.y - start.mid.y);
      apply();
    }
  });
  const end = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    pts.delete(e.pointerId);
    clearTimeout(longTimer);
    if (e.type === 'pointerup' && onTap && !pts.size && !start.multi && !start.moved && !start.long && Date.now() - p.t0 < 600) {
      onTap(...at(e.clientX, e.clientY));
    }
    if (pts.size) start = { ...snapshot(), multi: true };
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  // Redesenho com zoom já aplicado: reaplica assim que o quadro tiver tamanho.
  if (z.k > 1.01) requestAnimationFrame(apply);
  return box;
}

/** Foto que aparece na hora: começa pela miniatura (leve) e troca pela grande quando ela chega;
 *  se a grande falhar (upload que não terminou), a miniatura fica. */
function photoImg(full, thumb) {
  const img = h('img', { src: thumb || full, alt: '', decoding: 'async', onerror: () => { if (img.src !== full && full) img.src = full; } });
  if (thumb && full && full !== thumb) {
    const pre = new Image();
    pre.onload = () => { img.src = full; };
    pre.src = full;
  }
  return img;
}

// ---------- navegar entre boulders (‹ › e arrastar, como no Instagram) ----------
/** Ids na ordem da lista de onde o boulder foi aberto (perfil, galeria, histórico). */
let navList = [];
const setNav = (ids) => { navList = ids; };
/** Setas nas laterais da foto e arrasto horizontal; `go(+1|-1)` troca de boulder. */
function withNav(el, hasPrev, hasNext, go) {
  if (!el || (!hasPrev && !hasNext)) return el;
  const wrap = h('div', { class: 'nav-wrap' }, el,
    hasPrev && h('button', { class: 'nav-arrow prev', type: 'button', 'aria-label': t('nav.prev'), onclick: (e) => { e.stopPropagation(); go(-1); } }, '‹'),
    hasNext && h('button', { class: 'nav-arrow next', type: 'button', 'aria-label': t('nav.next'), onclick: (e) => { e.stopPropagation(); go(1); } }, '›'));
  // Arrasto: só quando a foto não está ampliada (aí o arrasto move a foto).
  let x0 = null, y0 = 0;
  wrap.addEventListener('touchstart', (e) => {
    x0 = e.touches.length === 1 && !el.classList.contains('zoomed') && !el.querySelector('.zoomed') ? e.touches[0].clientX : null;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0 && hasNext) go(1); else if (dx > 0 && hasPrev) go(-1); }
  });
  return wrap;
}

/** Enquanto o detector procura agarras: foto acinzentada com uma faixa de luz descendo. */
const scanning = (on, el) => { if (on) el.classList.add('detecting'); return el; };

/** Foto de um boulder com as agarras da via marcadas. */
const climbStage = (url, c, onOpen) => url && stage([
  photoImg(url, c.thumbUrl),
  holdsOverlay(c.holds)], onOpen ? () => onOpen() : undefined);

// ---------- social: perfil, amigos, ranking ----------
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
/** Foto de perfil, ou iniciais num círculo colorido (cor estável pelo @). */
function avatar(p, size = 40) {
  if (p?.avatarUrl) return h('img', { class: 'avatar', src: p.avatarUrl, alt: '', width: size, height: size, loading: 'lazy', style: { '--s': `${size}px` } });
  const hue = [...(p?.handle ?? '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % HOLD_COLORS.length;
  return h('span', { class: 'avatar', style: { '--s': `${size}px`, background: HOLD_COLORS[hue] } }, initials(p?.name));
}
const mondayIso = () => new Date(`${S.weekStart(new Date().toISOString())}T00:00:00`).toISOString();

/** Criar ou editar o perfil (nome, @, foto). Resolve com o perfil salvo, ou null se cancelar. */
/** Dados do login (id token): e-mail e, no Google, o nome. */
function claims() {
  try { return JSON.parse(atob(loadTokens().id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
/** Sugestão de nome e @ para quem ainda não tem perfil. */
function profileSuggestion() {
  const c = claims();
  const local = (c.email ?? '').split('@')[0];
  const handle = local.toLowerCase().normalize('NFD').replace(/[^a-z0-9_.]/g, '').slice(0, 20).padEnd(3, '0');
  const name = c.name || local.replace(/[._\d]+/g, ' ').trim().replace(/\w/g, (x) => x.toUpperCase()) || '';
  return { name: name.slice(0, 40), handle };
}

function profileSheet({ welcome = false } = {}) {
  return new Promise((resolve) => {
    const cur = state.profile;
    const sug = cur ? {} : profileSuggestion();
    const f = { name: cur?.name ?? sug.name ?? '', handle: cur?.handle ?? sug.handle ?? '', file: null, preview: cur?.avatarUrl ?? null, error: '' };
    const box = h('form', { class: 'stack' });
    const save = async (e) => {
      e.preventDefault();
      const btn = box.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        let blob = null;
        if (f.file) blob = await compress(await toCanvas(f.file, 400), 0.85);
        const res = await api('/profile', { method: 'PUT', body: { name: f.name, handle: f.handle, ...(blob ? { avatarType: blob.type } : {}) } });
        if (res.upload) { await upload(res.upload, blob); res.avatarUrl = URL.createObjectURL(blob); }
        delete res.upload;
        state.profile = res;
        $('#sheet').close();
        resolve(res);
      } catch (err) {
        f.error = err.code === 'HANDLE_TAKEN' ? t('profile.taken') : err.code === 'INVALID_HANDLE' ? t('profile.handleRule') : '';
        if (!f.error) fail(err);
        btn.disabled = false;
        draw();
      }
    };
    const draw = () => fill(box,
      h('h2', {}, cur ? t('profile.edit') : welcome ? t('profile.welcome') : t('profile.create')),
      !cur && h('p', { class: 'muted' }, welcome ? t('profile.welcomeLead') : t('profile.lead')),
      h('label', { class: 'row avatar-pick' },
        avatar({ ...cur, name: f.name, handle: f.handle, avatarUrl: f.preview }, 64),
        h('span', { class: 'link' }, t('profile.photo')),
        h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { f.file = e.target.files[0]; if (f.file) { f.preview = URL.createObjectURL(f.file); draw(); } } })),
      h('label', { class: 'field' }, h('span', {}, t('profile.name')),
        h('input', { type: 'text', required: true, maxlength: 40, value: f.name, autocomplete: 'name', oninput: (e) => (f.name = e.target.value) })),
      h('label', { class: 'field' }, h('span', {}, t('profile.handle')),
        h('div', { class: 'handle-input' }, h('span', {}, '@'),
          h('input', {
            type: 'text', required: true, minlength: 3, maxlength: 20, pattern: '[a-z0-9_.]{3,20}', value: f.handle,
            autocapitalize: 'none', autocomplete: 'username', spellcheck: false,
            oninput: (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''); f.handle = e.target.value; },
          })),
        h('span', { class: `small ${f.error ? 'error' : 'muted'}` }, f.error || t('profile.handleRule'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost grow', type: 'button', onclick: () => { $('#sheet').close(); resolve(null); } }, t('settings.close')),
        h('button', { class: 'btn primary grow', type: 'submit' }, t('settings.save'))));
    box.addEventListener('submit', save);
    draw();
    openSheet(box);
  });
}
/** Garante perfil antes de uma ação social. */
const needProfile = async () => state.profile ?? profileSheet();

async function pinClimb(c) {
  if (!(await needProfile())) return;
  const pinned = state.profile.pinned === c.id ? null : c.id;
  try {
    Object.assign(state.profile, { pinned: (await api('/profile', { method: 'PUT', body: { pinned } })).pinned });
    toast(pinned ? t('pin.added') : t('pin.removed'));
    if (pinned) playTick();
    render();
  } catch (err) { fail(err); }
}

/** Botão Seguir / Seguindo, com resposta na hora. */
function followButton(p, onChange) {
  const btn = h('button', { class: `btn small-btn ${p.following ? '' : 'primary'}`, type: 'button' }, p.following ? t('follow.following') : p.followsMe ? t('follow.back') : t('follow.follow'));
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (guestMode) { needAccount(); return; }
    if (!(await needProfile())) return;
    const on = !p.following;
    p.following = on;
    btn.textContent = on ? t('follow.following') : t('follow.follow');
    btn.classList.toggle('primary', !on);
    if (on) playTick();
    try {
      Object.assign(p, await api(`/users/${p.handle}/follow`, { method: on ? 'POST' : 'DELETE' }));
      onChange?.(p);
    } catch (err) { p.following = !on; fail(err); onChange?.(p); }
  });
  return btn;
}

const reasonText = (s) => (s.reason === 'followsYou' ? t('suggest.followsYou')
  : s.reason === 'sharedWithYou' ? t('suggest.shared')
    : s.reason === 'via' ? t('suggest.via', { h: s.arg ?? '' })
      : s.reason === 'gym' ? t('suggest.gym', { g: s.arg ?? '' }) : '');

const social = { data: null, q: '', results: null };
function viewFriends() {
  const box = h('div', { class: 'stack' });
  const me = state.profile;
  const search = debounce(async (q) => {
    social.results = q.length >= 2 ? await api(`/users?q=${encodeURIComponent(q)}`).catch(() => []) : null;
    draw();
  }, 300);
  const person = (p, extra) => h('li', {}, h('a', { class: 'person-row', href: `#/u/${p.handle}` },
    avatar(p), h('div', { class: 'grow' }, h('strong', {}, p.name), h('div', { class: 'muted small' }, extra ?? `@${p.handle}`)),
    !p.me && p.following !== undefined && followButton(p)));
  const draw = () => {
    const d = social.data;
    fill(box,
      h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/me')) }, `‹ ${t('back')}`)),
      h('h1', {}, t('tab.friends')),
      me
        ? null
        : h('section', { class: 'card stack' }, h('h2', {}, t('profile.create')), h('p', { class: 'muted' }, t('profile.lead')),
          h('button', { class: 'btn primary big block', type: 'button', onclick: async () => { if (await profileSheet()) { social.data = null; render(); } } }, t('profile.create'))),

      h('label', { class: 'field' }, h('span', {}, t('friends.search')),
        h('input', { type: 'search', value: social.q, placeholder: t('friends.searchHint'), autocapitalize: 'none', oninput: (e) => { social.q = e.target.value.trim(); search(social.q); } })),
      social.results && (social.results.length
        ? h('ul', { class: 'list card' }, social.results.map((p) => person(p)))
        : h('p', { class: 'muted small' }, t('friends.none'))),

      me && h('section', { class: 'card' },
        h('h2', {}, t('rank.title')),
        h('p', { class: 'muted small' }, t('rank.lead')),
        !d ? h('p', { class: 'small detect-status loading' }, t('friends.loading'))
          : d.ranking.length > 1
            ? h('ol', { class: 'list rank' }, d.ranking.map((p, i) => h('li', { class: p.me ? 'me' : '' },
              h('a', { class: 'person-row', href: `#/u/${p.handle}` },
                h('span', { class: `pos num ${i < 3 ? `top${i + 1}` : ''}` }, String(i + 1)),
                avatar(p), h('strong', { class: 'grow' }, p.me ? t('rank.you') : p.name),
                h('span', { class: 'num xp-pill' }, `${p.weekXp} XP`)))))
            : h('p', { class: 'muted' }, t('rank.empty'))),

      me && d?.suggestions.length > 0 && h('section', {},
        h('h2', {}, t('suggest.title')),
        h('ul', { class: 'suggest' }, d.suggestions.map((s) => h('li', { class: 'card' },
          h('a', { href: `#/u/${s.handle}` }, avatar(s, 56), h('strong', {}, s.name), h('span', { class: 'muted small' }, reasonText(s))),
          followButton(s, () => { social.data = null; }))))),
    );
  };
  draw();
  if (me && !social.data) {
    api(`/social?since=${encodeURIComponent(mondayIso())}`).then((x) => { social.data = x; if (location.hash === '#/friends' || location.hash === '#/me') draw(); }, fail);
  }
  return box;
}

/** Aba Perfil: o seu perfil (com Amigos dentro), ou o convite para criar um. */
function viewMe() {
  if (guestMode) {
    return h('div', { class: 'stack' }, h('h1', {}, t('tab.profile')),
      h('section', { class: 'card stack' }, h('h2', {}, t('guest.profileTitle')), h('p', { class: 'muted' }, t('guest.profileLead')),
        h('button', { class: 'btn primary big block', type: 'button', onclick: () => showAuth({ mode: 'signup' }) }, t('auth.signup')),
        h('button', { class: 'btn block', type: 'button', onclick: () => showAuth({ mode: 'login' }) }, t('guest.haveAccount'))));
  }
  if (state.profile) return viewUser(state.profile.handle, true);
  return h('div', { class: 'stack' },
    h('h1', {}, t('tab.profile')),
    h('section', { class: 'card stack' }, h('h2', {}, t('profile.create')), h('p', { class: 'muted' }, t('profile.lead')),
      h('button', { class: 'btn primary big block', type: 'button', onclick: async () => { if (await profileSheet()) render(); } }, t('profile.create'))));
}

/** Atalho do meu perfil para Amigos: ranking da semana resumido, busca e sugestões. */
function friendsCard() {
  const box = h('a', { class: 'card friends-card', href: '#/friends' });
  const draw = (d) => fill(box,
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, t('tab.friends')), h('span', { class: 'link' }, `${t('friends.open')} ›`)),
    d
      ? (d.ranking.length > 1
        ? h('ol', { class: 'list rank mini' }, d.ranking.slice(0, 3).map((p, i) => h('li', { class: p.me ? 'me' : '' },
          h('div', { class: 'person-row' }, h('span', { class: `pos num top${i + 1}` }, String(i + 1)), avatar(p, 32),
            h('strong', { class: 'grow' }, p.me ? t('rank.you') : p.name), h('span', { class: 'num xp-pill' }, `${p.weekXp} XP`)))))
        : h('p', { class: 'muted small' }, t('friends.cta')))
      : h('p', { class: 'muted small' }, t('friends.cta')));
  draw(social.data);
  if (!social.data) api(`/social?since=${encodeURIComponent(mondayIso())}`).then((x) => { social.data = x; draw(x); }, () => {});
  return box;
}

const STATUS_FILTERS = ['all', 'sent', 'project', 'dropped'];
let profileFilter = 'all';
const userCache = new Map(); // perfis já abertos (as URLs das fotos valem 1 h; a volta recarrega por trás)

function viewUser(handle, isTab = false) {
  const box = h('div', { class: 'stack' }, h('p', { class: 'small detect-status loading' }, t('friends.loading')));
  const draw = (u) => fill(box,
    !isTab && h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => history.back() }, `‹ ${t('back')}`)),
    h('section', { class: 'profile-head' },
      avatar(u, 88),
      h('div', { class: 'grow' },
        h('h1', {}, u.name), h('div', { class: 'muted' }, `@${u.handle}`),
        h('div', { class: 'row small num profile-counts' },
          h('span', { class: 'level-pill num' }, t('xp.level', { n: u.level })),
          t('profile.counts', { a: u.followers, b: u.follows })))),
    u.me
      ? h('div', { class: 'row' },
        h('button', { class: 'btn grow', type: 'button', onclick: async () => { if (await profileSheet()) load(); } }, t('profile.edit')),
        shareProfileButton(u))
      : h('div', { class: 'row' }, followButton(u, () => load()), u.friends && h('span', { class: 'badge friends' }, t('follow.friends')),
        h('span', { class: 'grow' }), shareProfileButton(u)),
    u.me && friendsCard(),

    h('section', { class: 'card stack pinned' },
      h('h2', {}, t('pin.title')),
      u.pinned
        ? [
          h('button', { class: 'row pinned-head', type: 'button', onclick: () => openPinned(u) }, swatch(u.pinned.color), h('strong', {}, colorName(u.pinned.color)), h('span', { class: 'grade-pill' }, grade(u.pinned.grade)),
            h('span', { class: 'grow' }), h('span', { class: `badge ${u.pinned.sent ? 'sent' : 'project'}` }, u.pinned.sent ? t('pin.sent') : t('result.project')), h('span', { class: 'muted' }, '›')),
          climbStage(u.pinned.photoUrl, u.pinned, () => openPinned(u)),
          u.pinned.tries > 1 && h('p', { class: 'muted small' }, t('pin.tries', { n: u.pinned.tries })),
          !u.me && u.friends && tryButton(u, u.pinned),
        ]
        : h('p', { class: 'muted' }, u.me ? t('pin.emptyMe') : t('pin.empty'))),

    u.stats
      ? [
        h('div', { class: 'kpis' },
          [[u.stats.sessions, t('profile.sessions')], [u.stats.sends, t('profile.sends')],
            [u.stats.maxGrade == null ? '—' : grade(u.stats.maxGrade), t('profile.max')], [u.stats.streak, t('streak.weeks')]]
            .map(([v, l]) => h('div', { class: 'kpi' }, h('b', {}, String(v)), h('span', {}, l)))),
        h('h2', {}, t('profile.history')),
        u.climbs.length > 0 && seg(STATUS_FILTERS.map((f) => [f, t(`status.filter.${f}`)]), profileFilter, (f) => { profileFilter = f; draw(u); }),
        (() => {
          const list = u.climbs.filter((c) => profileFilter === 'all' || (profileFilter === 'sent' ? ['sent', 'flash'].includes(c.status) : c.status === profileFilter));
          return list.length
            ? h('div', { class: 'gallery' }, list.map((c) => h('button', { type: 'button', onclick: () => { setNav(list.map((x) => x.id)); if (u.me) location.hash = `#/climb/${c.id}`; else friendClimbSheet(u, c, list); } },
              h('img', { src: c.thumbUrl, alt: `${colorName(c.color)} ${grade(c.grade)}`, loading: 'lazy', decoding: 'async', width: 200, height: 200, onerror: (e) => e.target.remove() }),
              c.status && h('span', { class: `status-tag s-${c.status}` }, t(`status.${c.status}`)),
              h('span', { class: 'tag' }, swatch(c.color), grade(c.grade)))))
            : h('p', { class: 'muted' }, t('history.empty'));
        })(),
      ]
      : h('section', { class: 'card locked' }, icon('lock'), h('p', {}, u.following ? t('profile.lockedBack') : t('profile.locked'))),
  );
  let asked = false;
  const load = () => (guestMode ? publicApi : api)(`/users/${handle}`).then((u) => {
    userCache.set(handle, u); draw(u); restoreScroll();
    if (guestMode && !asked) { asked = true; setTimeout(needAccount, 1200); }
  },
    (err) => { if (!userCache.has(handle)) fill(box, h('p', { class: 'muted' }, err.status === 404 ? t('profile.notFound') : t('error.generic'))); });
  if (userCache.has(handle)) { draw(userCache.get(handle)); }
  load();
  return box;
}

/** Link do perfil (abre o perfil depois do login, se preciso). */
function shareProfileButton(u) {
  return h('button', {
    class: 'btn share-btn', type: 'button', 'aria-label': t('profile.share'),
    onclick: async () => {
      const url = `${location.origin}/#/u/${u.handle}`;
      const text = u.me ? t('profile.shareMine', { h: u.handle }) : t('profile.shareOther', { n: u.name });
      if (navigator.share) { navigator.share({ title: 'Chalkmark', text, url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(url); toast(t('share.copied')); } catch { toast(url); }
    },
  }, lineIcon(SHARE_ICON), h('span', {}, t('profile.share')));
}

/** Abre o boulder fixado: o meu na tela completa; o de outra pessoa na janela (com "Quero tentar"). */
function openPinned(u) {
  if (u.me) { setNav([u.pinned.id]); location.hash = `#/climb/${u.pinned.id}`; } else friendClimbSheet(u, u.pinned);
}

/** "Quero tentar": copia o boulder do amigo para os seus projetos. */
function tryButton(u, c) {
  return h('button', {
    class: 'btn go block', type: 'button',
    onclick: async (e) => {
      if (guestMode) { needAccount(); return; }
      e.currentTarget.disabled = true;
      try {
        const climb = await api(`/users/${u.handle}/climbs/${c.id}/copy`, { method: 'POST' });
        state.climbs.push(climb);
        playTick();
        toast(t('share.added'));
        $('#sheet').open && $('#sheet').close();
        location.hash = `#/climb/${climb.id}`;
      } catch (err) { fail(err); e.target.disabled = false; }
    },
  }, t('friends.try'));
}

function friendClimbSheet(u, c, list = [c]) {
  const i = list.indexOf(c);
  const go = (d) => list[i + d] && friendClimbSheet(u, list[i + d], list);
  openSheet(h('div', { class: 'stack' },
    h('h2', { class: 'row' }, swatch(c.color), colorName(c.color), h('span', { class: 'grade-pill' }, grade(c.grade)),
      h('span', { class: 'grow' }), h('span', { class: `badge ${c.result}` }, t(`result.${c.result}`))),
    withNav(climbStage(c.photoUrl, c), i > 0, i < list.length - 1, go),
    h('p', { class: 'muted small' }, fmtDate(c.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })),
    !u.me && tryButton(u, c),
    h('button', { class: 'btn ghost block', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close'))));
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
            h('ul', { class: 'list', onclick: () => setNav(summaries.flatMap((x) => state.climbs.filter((c) => c.sessionId === x.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => c.id))) },
              state.climbs.filter((c) => c.sessionId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(climbRow))))))
          : h('p', { class: 'muted' }, t('history.empty')))
        : h('section', {},
          h('div', { class: 'row' },
            h('select', { class: 'grow', 'aria-label': t('climb.color'), onchange: (e) => { historyUi.color = e.target.value; draw(); } },
              h('option', { value: '' }, `${t('climb.color')}: ${t('history.all')}`),
              COLORS.map((c) => h('option', { value: c, selected: historyUi.color === c }, colorName(c)))),
            h('select', { class: 'grow', 'aria-label': t('climb.result'), onchange: (e) => { historyUi.result = e.target.value; draw(); } },
              h('option', { value: '' }, `${t('climb.result')}: ${t('history.all')}`),
              RESULTS.map((r) => h('option', { value: r, selected: historyUi.result === r }, t(`result.${r}`))))),
          h('div', { class: 'gallery' }, gallery.map((c) => h('a', { href: `#/climb/${c.id}`, onclick: () => setNav(gallery.map((x) => x.id)) },
            h('img', { src: c.thumbUrl, alt: `${colorName(c.color)} ${grade(c.grade)}`, loading: 'lazy', decoding: 'async', width: 200, height: 200, onerror: (e) => e.target.remove() }),
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
      S.analyzedCount(state.climbs) < S.STYLE_MIN && h('p', { class: 'small style-early' }, t('progress.stylesEarly', { n: S.analyzedCount(state.climbs), m: S.STYLE_MIN })),
      h('div', { class: 'bars-h styles' }, styles.slice(0, 10).map((s) => h('div', {},
        h('span', {}, styleLabel(s.key)),
        h('div', { class: 'track' },
          h('span', { class: 'fill', style: { '--w': `${(s.sends / maxStyle) * 100}%` } }),
          h('span', { class: 'fill soft', style: { '--w': `${(s.projects / maxStyle) * 100}%` } })),
        h('span', { class: 'num muted' }, s.maxSent == null ? `0/${s.projects}` : `${s.sends}/${s.sends + s.projects} · ${grade(s.maxSent)}`)))),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'sent-i' }), t('progress.sends')), h('span', {}, h('i', { class: 'soft-i' }), t('progress.open')))),
  );
}

function climbRowProject(p) {
  const row = climbRow(p.root);
  row.querySelector('.meta').textContent = p.sessions ? t('climb.projectProgress', { s: sessionsText(p.sessions) }) : t('project.notYet');
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
    h('div', {}, h('div', { class: 'small muted' }, t('settings.lang')),
      seg([['auto', t('settings.langAuto')], ['pt', 'Português'], ['en', 'English']], langChoice(), (v) => setLang(v))),
    h('div', {}, h('div', { class: 'small muted' }, t('settings.theme')),
      seg([['auto', t('settings.themeAuto')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')]], getTheme(), (v) => { setTheme(v); draw(); })),
    h('div', {}, h('div', { class: 'small muted' }, t('settings.sound')),
      seg([['on', t('settings.soundOn')], ['off', t('settings.soundOff')]], soundOn() ? 'on' : 'off', (v) => { setSound(v === 'on'); if (v === 'on') playSent(); draw(); })),
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
    !guestMode && h('button', { class: 'btn block', type: 'button', onclick: () => feedbackSheet() }, t('fb.menu')),
    guestMode
      ? [h('button', { class: 'btn primary block', type: 'button', onclick: () => { $('#sheet').close(); showAuth({ mode: 'signup' }); } }, t('auth.signup')),
        h('button', { class: 'btn block', type: 'button', onclick: () => { $('#sheet').close(); showAuth({ mode: 'login' }); } }, t('guest.haveAccount'))]
      : h('button', { class: 'btn ghost danger block', type: 'button', onclick: logout }, t('settings.logout')),
    h('p', { class: 'small legal-links' }, h('a', { href: '/termos.html', target: '_blank' }, t('legal.terms')), ' · ', h('a', { href: '/privacidade.html', target: '_blank' }, t('legal.privacy'))),
    !guestMode && h('button', { class: 'link small danger-link', type: 'button', onclick: deleteAccountSheet }, t('account.delete')),
  );
  draw();
  openSheet(box);
}

// ---------- avaliação ("está gostando?") ----------
const FB_KEY = 'cm:fb';
const DAY_MS = 86400_000;
const fbNext = () => { try { return Number(localStorage.getItem(FB_KEY)) || 0; } catch { return 0; } };
const fbLater = (days) => { try { localStorage.setItem(FB_KEY, String(Date.now() + days * DAY_MS)); } catch {} };
/** Pergunta de tempos em tempos: só para quem já usou o app (2+ sessões), nunca por cima de outra janela.
 *  Fechou sem avaliar: volta em 7 dias. Avaliou: só em 60. */
function maybeAskFeedback() {
  if (guestMode || state.sessions.length < 2 || $('#sheet').open || activeSession()) return;
  if (!fbNext()) { fbLater(3); return; } // primeira vez: dá uns dias de uso antes
  if (Date.now() >= fbNext()) feedbackSheet(true);
}
function feedbackSheet(auto = false) {
  let stars = 0;
  const box = h('div', { class: 'stack' });
  const close = () => { if (auto && !stars) fbLater(7); $('#sheet').close(); };
  const draw = () => fill(box,
    h('h2', {}, t('fb.title')),
    h('p', { class: 'muted' }, t('fb.lead')),
    h('div', { class: 'stars', role: 'radiogroup', 'aria-label': t('fb.title') }, [1, 2, 3, 4, 5].map((n) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(stars === n), 'aria-label': t('fb.star', { n }),
      class: n <= stars ? 'on' : '', onclick: () => { stars = n; playTick(); draw(); box.querySelector('textarea')?.focus(); },
    }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9Z' }))))),
    stars > 0 && [
      h('label', { class: 'field' }, h('span', {}, stars >= 4 ? t('fb.good') : t('fb.bad')),
        h('textarea', { maxlength: 1000, rows: 4, placeholder: t('fb.placeholder') })),
      h('button', {
        class: 'btn primary big block', type: 'button',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api('/feedback', { method: 'POST', body: { stars, comment: box.querySelector('textarea').value.trim(), lang } });
            fbLater(60);
            $('#sheet').close();
            playSent();
            toast(t('fb.thanks'));
          } catch (err) { fail(err); e.target.disabled = false; }
        },
      }, t('fb.send')),
    ],
    h('button', { class: 'btn ghost block', type: 'button', onclick: close }, auto ? t('fb.later') : t('settings.close')));
  draw();
  openSheet(box);
  // Fechar tocando fora também conta como "agora não".
  if (auto) $('#sheet').addEventListener('close', () => { if (!stars) fbLater(7); }, { once: true });
}

/** Excluir a conta: some tudo (boulders, fotos, perfil, quem segue, links) e o login. */
function deleteAccountSheet() {
  const word = t('account.word');
  const btn = h('button', { class: 'btn primary block danger-fill', type: 'button', disabled: true }, t('account.confirmBtn'));
  const input = h('input', { type: 'text', autocapitalize: 'characters', autocomplete: 'off', oninput: (e) => (btn.disabled = e.target.value.trim().toUpperCase() !== word) });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = t('account.deleting');
    try {
      await api('/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
      try { Object.keys(localStorage).filter((k) => k.startsWith('cm:') || k.startsWith('bl:')).forEach((k) => localStorage.removeItem(k)); } catch {}
      logout();
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = t('account.confirmBtn'); }
  });
  openSheet(h('div', { class: 'stack' },
    h('h2', {}, t('account.title')),
    h('p', {}, t('account.lead')),
    h('ul', { class: 'terms' }, ['climbs', 'social', 'shares', 'login'].map((k) => h('li', {}, t(`account.${k}`)))),
    h('label', { class: 'field' }, h('span', {}, t('account.type', { w: word })), input),
    btn,
    h('button', { class: 'btn ghost block', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close'))));
}

// ---------- roteamento ----------
const ROUTES = [
  [/^#?\/?$/, viewSession, 'session'],
  [/^#\/new$/, viewNew, 'session'],
  [/^#\/climb\/([a-z0-9]{19})$/, viewClimb, null],
  [/^#\/history$/, viewHistory, 'history'],
  [/^#\/s\/([A-Za-z0-9_-]{22})$/, viewShare, null],
  [/^#\/progress$/, viewProgress, 'progress'],
  [/^#\/me$/, viewMe, 'profile'],
  [/^#\/friends$/, viewFriends, 'profile'],
  [/^#\/u\/([a-z0-9_.]{3,20})$/, viewUser, 'profile'],
];

// Rolagem: a posição fica guardada na própria entrada do histórico (history.state), então "voltar"
// devolve a tela onde estava e um link novo começa do topo.
let wantScroll = 0;
const restoreScroll = () => { if (wantScroll) window.scrollTo(0, wantScroll); };
window.addEventListener('scroll', debounce(() => {
  try { history.replaceState({ ...(history.state ?? {}), y: window.scrollY }, ''); } catch {}
}, 120), { passive: true });

function render() {
  timers.forEach(clearInterval);
  timers = [];
  const hash = location.hash || '#/';
  const [re, fn, tab] = ROUTES.find(([r]) => r.test(hash)) ?? ROUTES[0];
  wantScroll = history.state?.y ?? 0;
  view.replaceChildren(fn(...(hash.match(re)?.slice(1) ?? [])));
  window.scrollTo(0, wantScroll);
  streakPill();
  document.querySelectorAll('#tabbar a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

/** Olho aberto (senha escondida, toque para mostrar) ou riscado (senha à mostra). */
const eyeIcon = (open) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  svg('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z' }), svg('circle', { cx: 12, cy: 12, r: 3 }),
  open && svg('path', { d: 'M4 4l16 16' }));

const GOOGLE_G = [['#4285F4', 'M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z'],
  ['#34A853', 'M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z'],
  ['#FBBC05', 'M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z'],
  ['#EA4335', 'M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6Z']];

/** Entrar, criar conta, confirmar e-mail e trocar a senha, tudo na tela do app. */
/** Pede conta para quem usa sem login: a 1ª vez dá para dispensar; depois, trava na tela de criar conta. */
function needAccount() {
  if (!guestMode) return;
  if (guestNags() < 1) {
    bumpNags();
    openSheet(h('div', { class: 'stack' },
      h('h2', {}, t('guest.title')),
      h('p', { class: 'muted' }, t('guest.lead')),
      h('button', { class: 'btn primary big block', type: 'button', onclick: () => { $('#sheet').close(); showAuth({ mode: 'signup' }); } }, t('auth.signup')),
      h('button', { class: 'btn block', type: 'button', onclick: () => { $('#sheet').close(); showAuth({ mode: 'login' }); } }, t('guest.haveAccount')),
      h('button', { class: 'btn ghost block', type: 'button', onclick: () => $('#sheet').close() }, t('guest.notNow'))));
    return;
  }
  bumpNags();
  if ($('#sheet').open) $('#sheet').close();
  showAuth({ mode: 'signup', blocked: true });
}

/** Leva o que foi feito sem conta para a conta: ginásios, sessões, boulders (com fotos e agarras). */
async function migrateGuest(g) {
  const byTime = (l, k) => [...l].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
  if (g.settings.photoTermsVersion) await api('/settings', { method: 'PUT', body: { acceptPhotoTerms: PHOTO_TERMS_VERSION } });
  const gyms = await api('/gyms');
  const gymMap = {};
  for (const gy of g.gyms) {
    const same = gyms.find((x) => x.name.trim().toLowerCase() === gy.name.trim().toLowerCase());
    gymMap[gy.id] = same?.id ?? (await api('/gyms', { method: 'POST', body: { name: gy.name, ...(gy.loc ? { loc: gy.loc } : {}) } })).id;
  }
  const sesMap = {};
  for (const s of byTime(g.sessions, 'startedAt')) {
    if (!gymMap[s.gymId]) continue;
    const n = await api('/sessions', { method: 'POST', body: { gymId: gymMap[s.gymId], startedAt: s.startedAt } });
    sesMap[s.id] = n.id;
    if (s.endedAt) await api(`/sessions/${n.id}`, { method: 'PATCH', body: { end: true, endedAt: s.endedAt, ...(s.feeling ? { feeling: s.feeling } : {}), ...(s.note ? { note: s.note } : {}) } });
  }
  const climbMap = {};
  for (const c of byTime(g.climbs, 'createdAt')) {
    const { id, sessionId, projectId, thumbUrl: _t, dropped, droppedAt: _d, ...rest } = c;
    if (!sesMap[sessionId]) continue;
    const full = c.photoType ? await getPhoto(`${id}/full`) : null;
    const thumb = c.photoType ? await getPhoto(`${id}/thumb`) : null;
    const body = { ...rest, sessionId: sesMap[sessionId], ...(projectId && climbMap[projectId] ? { projectId: climbMap[projectId] } : {}) };
    if (!full) delete body.photoType;
    const { climb, uploads } = await api('/climbs', { method: 'POST', body });
    climbMap[id] = climb.id;
    if (uploads && full) await Promise.all([upload(uploads.full, full), thumb ? upload(uploads.thumb, thumb) : null]);
    if (dropped) await api(`/climbs/${climb.id}`, { method: 'PATCH', body: { dropped: true } });
  }
  clearGuest();
}

function showAuth({ mode = 'login', blocked = false } = {}) {
  $('#tabbar').hidden = true;
  $('#open-settings').hidden = true;
  const f = { mode, email: '', password: '', code: '', error: '', info: '', busy: false };
  const box = h('form', { class: 'auth', novalidate: true });
  const go = (mode, info = '') => { Object.assign(f, { mode, error: '', info, code: '' }); draw(); };
  const msg = (err) => ({
    NotAuthorizedException: t('auth.err.wrong'), UsernameExistsException: t('auth.err.exists'),
    InvalidPasswordException: t('auth.err.password'), CodeMismatchException: t('auth.err.code'),
    ExpiredCodeException: t('auth.err.expired'), LimitExceededException: t('auth.err.limit'),
    TooManyRequestsException: t('auth.err.limit'), TooManyFailedAttemptsException: t('auth.err.limit'),
    InvalidParameterException: t('auth.err.email'), UserNotFoundException: t('auth.err.wrong'),
    UserLambdaValidationException: /USE_GOOGLE/.test(err.message) ? t('auth.err.useGoogle') : t('error.generic'),
  }[err.code] ?? (navigator.onLine ? t('error.generic') : t('error.offline')));
  const signedIn = (r) => {
    saveTokens(fromAuthResult(r.AuthenticationResult));
    let after = '';
    try { after = sessionStorage.getItem('cm:after') || ''; sessionStorage.removeItem('cm:after'); } catch {}
    location.replace(`/${after}`);
    location.reload();
  };
  const doLogin = () => cognitoApi('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: f.email, PASSWORD: f.password } }).then(signedIn);
  const actions = {
    login: () => doLogin().catch(async (err) => {
      if (err.code !== 'UserNotConfirmedException') throw err;
      await cognitoApi('ResendConfirmationCode', { Username: f.email }).catch(() => {});
      go('confirm', t('auth.codeSent', { e: f.email }));
    }),
    signup: async () => {
      await cognitoApi('SignUp', { Username: f.email, Password: f.password, UserAttributes: [{ Name: 'email', Value: f.email }] });
      go('confirm', t('auth.codeSent', { e: f.email }));
    },
    confirm: async () => {
      await cognitoApi('ConfirmSignUp', { Username: f.email, ConfirmationCode: f.code });
      if (f.password) await doLogin(); else go('login', t('auth.confirmed'));
    },
    forgot: async () => {
      await cognitoApi('ForgotPassword', { Username: f.email });
      go('reset', t('auth.codeSent', { e: f.email }));
    },
    reset: async () => {
      await cognitoApi('ConfirmForgotPassword', { Username: f.email, ConfirmationCode: f.code, Password: f.password });
      await doLogin();
    },
  };
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.busy) return;
    f.email = f.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { f.error = t('auth.err.email'); draw(); return; }
    Object.assign(f, { busy: true, error: '' });
    draw();
    try { await actions[f.mode](); } catch (err) { f.error = msg(err); }
    f.busy = false;
    draw();
  });
  const field = (key, label, attrs) => h('label', { class: 'field' }, h('span', {}, label),
    h('input', { ...attrs, value: f[key], oninput: (e) => (f[key] = e.target.value) }));
  const pw = (label, autocomplete) => h('label', { class: 'field' }, h('span', {}, label),
    h('div', { class: 'pw' },
      h('input', { type: 'password', required: true, autocomplete, value: f.password, oninput: (e) => (f.password = e.target.value) }),
      // Olho dentro do campo: mostra/esconde a senha.
      h('button', {
        class: 'pw-eye', type: 'button', 'aria-label': t('auth.show'), 'aria-pressed': 'false',
        onclick: (e) => {
          const b = e.currentTarget, i = b.previousSibling, show = i.type === 'password';
          i.type = show ? 'text' : 'password';
          b.setAttribute('aria-pressed', String(show));
          b.setAttribute('aria-label', show ? t('auth.hide') : t('auth.show'));
          b.replaceChildren(eyeIcon(show));
        },
      }, eyeIcon(false))),
    autocomplete === 'new-password' && h('span', { class: 'small muted' }, t('auth.pwRule')));
  const email = () => field('email', t('auth.email'), { type: 'email', required: true, autocomplete: 'username', inputmode: 'email', autocapitalize: 'none' });
  const code = () => field('code', t('auth.code'), { type: 'text', required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8 });
  const submit = (label) => h('button', { class: 'btn primary big block', type: 'submit', disabled: f.busy }, f.busy ? t('auth.wait') : label);
  const draw = () => fill(box,
    h('img', { class: 'auth-logo', src: '/icon.svg', alt: '', width: 88, height: 88 }),
    h('h1', {}, t('auth.title')),
    h('p', { class: 'auth-lead' }, t('auth.lead')),
    guestMode && h('p', { class: 'auth-info' }, blocked ? t('guest.blocked') : t('guest.keep')),
    (f.mode === 'login' || f.mode === 'signup') && seg([['login', t('auth.login')], ['signup', t('auth.signup')]], f.mode, (m) => go(m)),
    f.info && h('p', { class: 'auth-info' }, f.info),
    f.mode === 'login' && [email(), pw(t('auth.password'), 'current-password'), submit(t('auth.login')),
      h('button', { class: 'link small', type: 'button', onclick: () => go('forgot') }, t('auth.forgot'))],
    f.mode === 'signup' && [email(), pw(t('auth.password'), 'new-password'), submit(t('auth.signup')),
      h('p', { class: 'small muted' }, t('auth.legal'), ' ', h('a', { href: '/termos.html', target: '_blank' }, t('legal.terms')), ' · ', h('a', { href: '/privacidade.html', target: '_blank' }, t('legal.privacy')))],
    f.mode === 'confirm' && [code(), submit(t('auth.confirm')),
      h('button', { class: 'link small', type: 'button', onclick: () => cognitoApi('ResendConfirmationCode', { Username: f.email }).then(() => go('confirm', t('auth.codeSent', { e: f.email })), (err) => { f.error = msg(err); draw(); }) }, t('auth.resend'))],
    f.mode === 'forgot' && [h('h2', {}, t('auth.forgotTitle')), email(), submit(t('auth.sendCode'))],
    f.mode === 'reset' && [code(), pw(t('auth.newPassword'), 'new-password'), submit(t('auth.savePassword'))],
    f.error && h('p', { class: 'auth-error', role: 'alert' }, f.error),
    f.mode !== 'login' && f.mode !== 'signup' && h('button', { class: 'link small', type: 'button', onclick: () => go('login') }, `‹ ${t('back')}`),
    cfg.google && (f.mode === 'login' || f.mode === 'signup') && [
      h('div', { class: 'auth-or' }, h('span', {}, t('auth.or'))),
      h('button', { class: 'btn block google-btn', type: 'button', onclick: () => login('oauth2/authorize', { identity_provider: 'Google' }) },
        svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, GOOGLE_G.map(([c, d]) => svg('path', { d, fill: c }))), t('auth.google')),
    ],
    guestMode && !blocked && h('button', { class: 'link small', type: 'button', onclick: () => { $('#tabbar').hidden = false; $('#open-settings').hidden = false; render(); } }, t('guest.continue')));
  draw();
  view.replaceChildren(box);
}

async function boot() {
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  $('#open-settings').setAttribute('aria-label', t('settings.title'));
  $('#open-settings').addEventListener('click', settingsSheet);
  $('#streak-pill').addEventListener('click', streakSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  // Service worker: abre sem sinal e recebe notificações.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw', e));
  try { cfg = await (await fetch('/config.json', { cache: 'no-store' })).json(); } catch { cfg = JSON.parse(localStorage.getItem('cm:cfg') || '{}'); }
  try { localStorage.setItem('cm:cfg', JSON.stringify(cfg)); } catch {}
  const pending = guestPending();
  if (!(await idToken())) {
    // Sem conta: usa normalmente; os dados ficam no navegador. Depois de 1 dia, só com conta.
    guestMode = true;
    startGuest();
    if (guestLocked()) { await loadAll(); return showAuth({ mode: 'signup', blocked: true }); }
    const cta = h('button', { class: 'btn small-btn primary', type: 'button', onclick: () => showAuth({ mode: 'signup' }) }, t('guest.cta'));
    $('#open-settings').before(cta);
  } else if (pending) {
    try { await migrateGuest(pending); toast(t('guest.migrated')); } catch (e) { console.error(e); toast(t('guest.migrateFailed')); }
  }
  try {
    await loadAll();
  } catch (e) {
    if (e.message === 'auth') return;
    // Sem sinal: segue com a última cópia e um aviso; volta sozinho quando a conexão voltar.
    if (!navigator.onLine || e instanceof TypeError) {
      if (!loadSnapshot()) { fail(e); return; }
      document.body.classList.add('offline');
      window.addEventListener('online', () => location.reload(), { once: true });
    } else { fail(e); return; }
  }
  $('#tabbar').hidden = false;
  $('#open-settings').hidden = false;
  window.addEventListener('hashchange', render);
  try {
    const after = sessionStorage.getItem('cm:after');
    if (after) { sessionStorage.removeItem('cm:after'); history.replaceState({}, '', `/${after}`); }
  } catch {}
  // URLs assinadas das miniaturas valem 1 h: recarrega ao voltar ao app depois de um tempo.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 45 * 60_000) {
      try { await loadAll(); render(); } catch {}
    }
    checkAutoEnd();
  });
  render();
  checkAutoEnd();
  // Primeira vez (sem perfil): boas-vindas com nome e @ já sugeridos; "agora não" pergunta de novo amanhã.
  try {
    if (!guestMode && !state.profile && Date.now() - Number(localStorage.getItem('cm:onb') || 0) > 86400_000) {
      localStorage.setItem('cm:onb', String(Date.now()));
      setTimeout(() => { if (!$('#sheet').open) profileSheet({ welcome: true }).then((p) => p && render()); }, 600);
    }
  } catch {}
  setTimeout(maybeAskFeedback, 4000);
  setInterval(checkAutoEnd, 5 * 60_000);
}

boot().catch(fail);
