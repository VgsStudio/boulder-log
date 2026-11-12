// Base: tema, DOM (h/svg/fill), login/Cognito, dados e API, fotos, componentes.
import { needAccount, showAuth } from './app.js';
import { fmtDate, lang, t } from './i18n.js';
import { SWATCH } from './color.js';
import { guestApi, putPhoto } from './guest.js';
import * as S from './stats.js';

// Chalkmark: SPA sem framework. Rotas por hash, dados em memória, API em /api.

// Endereço principal: chalkmark.vsoller.com.br. O boulder.* continua respondendo e manda para lá,
// mantendo o caminho e o # (links de boulder compartilhado e de perfil continuam valendo).
if (location.hostname.startsWith('boulder.')) {
  location.replace(`https://chalkmark.${location.hostname.slice('boulder.'.length)}${location.pathname}${location.search}${location.hash}`);
}
// detect.js é leve; o onnxruntime-web e o modelo (~10 MB) só baixam na primeira foto.

export const PHOTO_TERMS_VERSION = '2026-11-12'; // igual a services/api.ts

export const HOLD_TYPES = ['crimp', 'sloper', 'jug', 'pinch', 'pocket', 'volume', 'edge'];
export const WALL_ANGLES = ['slab', 'vertical', 'overhang', 'roof'];
export const STYLE_TAGS = ['dynamic', 'static', 'compression', 'balance', 'power', 'technical', 'coordination', 'heel_hook', 'toe_hook', 'mantle'];
export const RESULTS = ['flash', 'sent', 'project'];

export const $ = (s) => document.querySelector(s);

// ---------- tema: automático (segue o aparelho), claro ou escuro ----------
export const THEME_COLORS = { light: '#eef1f6', dark: '#0f1226' };
export const getTheme = () => { try { return localStorage.getItem('cm:theme') || 'auto'; } catch { return 'auto'; } };
export function applyTheme(theme = getTheme()) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  // Barra do navegador acompanha a escolha.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = theme === 'auto' ? THEME_COLORS[m.media.includes('dark') ? 'dark' : 'light'] : THEME_COLORS[theme];
  });
}
export function setTheme(theme) {
  try { if (theme === 'auto') localStorage.removeItem('cm:theme'); else localStorage.setItem('cm:theme', theme); } catch {}
  applyTheme(theme);
}
applyTheme();
// Sem zoom de pinça na página (só na foto, que tem zoom próprio). O Safari ignora user-scalable=no.
document.addEventListener('gesturestart', (e) => e.preventDefault());
export const view = $('#view');
export let cfg;
/** Volta do login para o mesmo endereço em que a pessoa está (o app responde em mais de um domínio). */
export const redirectUri = () => `${location.origin}/`;
export const state = { gyms: [], sessions: [], climbs: [], settings: { scale: 'v', weeklySessions: 0, gradeGoal: null }, profile: null, loadedAt: 0 };
export let timers = [];
// Quem desenha com React escuta estas mudanças (emit depois de alterar `state`).
const listeners = new Set();
let version = 0;
export const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const getVersion = () => version;
export const emit = () => { version++; listeners.forEach((f) => f()); };

// ---------- DOM ----------
/** Cria elemento. on* = evento; style = objeto de propriedades (CSP proíbe atributo style). */
export function h(tag, attrs, ...kids) {
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
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
export const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null) el.setAttribute(k, v);
  el.append(...kids.flat().filter(Boolean));
  return el;
}

export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2800);
}
export const fail = (e) => {
  if (e?.code === 'NEED_ACCOUNT') { needAccount(); return; }
  console.error(e);
  toast(e?.code === 'AI_DAILY_LIMIT' ? t('ai.limit') : e?.code === 'AI_UNAVAILABLE' || e?.code === 'AI_FAILED' ? t('ai.unavailable') : navigator.onLine ? t('error.generic') : t('error.offline'));
};

export const sessionsText = (n) => (n === 1 ? t('unit.session1') : t('unit.sessions', { n }));
export const colorName = (c) => t(`color.${c}`);
export const grade = (g) => S.gradeLabel(g, state.settings.scale);
export const swatch = (c) => h('span', { class: `swatch ${c === 'other' ? 'other' : ''}`, style: c === 'other' ? null : { background: SWATCH[c] } });

/** Botões de escolha única (segmented). */
export function seg(options, value, onPick) {
  return h('div', { class: 'seg', role: 'group' }, options.map(([v, label]) =>
    h('button', { type: 'button', 'data-v': String(v), 'aria-pressed': String(v === value), onclick: () => onPick(v) }, label)));
}
export function stepper(value, min, max, onChange, label) {
  const out = h('output', { 'aria-live': 'polite', 'aria-label': label }, String(value));
  const set = (n) => { value = Math.min(max, Math.max(min, n)); out.textContent = value; onChange(value); };
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': '−', onclick: () => set(value - 1) }, '−'), out,
    h('button', { type: 'button', 'aria-label': '+', onclick: () => set(value + 1) }, '+'));
}

// ---------- autenticação (Cognito Managed Login, Authorization Code + PKCE) ----------
export const TOKENS = 'bl:tokens';
export const VERIFIER = 'bl:verifier';
export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const loadTokens = () => { try { return JSON.parse(localStorage.getItem(TOKENS)); } catch { return null; } };
export const saveTokens = (tk) => { try { localStorage.setItem(TOKENS, JSON.stringify({ ...tk, obtainedAt: Date.now() })); } catch {} };

// ---------- login no próprio app (API do Cognito: e-mail e senha) ----------
/** Chama a API pública do Cognito (sem credencial AWS; só o id do cliente do app). */
export async function cognitoApi(action, body) {
  const res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify({ ClientId: cfg.clientId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || action), { code: String(data.__type || '').split('#').pop() });
  return data;
}
export const fromAuthResult = (r) => ({ id_token: r.IdToken, access_token: r.AccessToken, refresh_token: r.RefreshToken, expires_in: r.ExpiresIn, via: 'api' });

export async function login(path = 'oauth2/authorize', extra = {}) {
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

export function logout() {
  try { localStorage.removeItem(TOKENS); } catch {}
  const url = new URL(`${cfg.cognitoDomain}/logout`);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('logout_uri', redirectUri());
  location.assign(url);
}

export async function tokenCall(body) {
  const res = await fetch(`${cfg.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...body }),
  });
  return res.ok ? res.json() : null;
}

export let refreshing;
export async function idToken() {
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
export let guestMode = false;
// Variáveis do app que a inicialização (app.js) troca: módulo ES só deixa quem declara reatribuir.
export const setGuestMode = (v) => { guestMode = v; };
export const setCfg = (v) => { cfg = v; };
export const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

export async function api(path, { method = 'GET', body } = {}) {
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
export async function publicApi(path) {
  const res = await fetch(`/api/public${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.error, status: res.status });
  return data;
}

// ---------- dados ----------
export async function loadAll() {
  const [gyms, sessions, climbs, settings, profile] = await Promise.all([api('/gyms'), api('/sessions'), api('/climbs'), api('/settings'), api('/profile')]);
  Object.assign(state, { gyms, sessions, climbs, profile: profile.handle ? profile : null, loadedAt: Date.now() });
  state.settings = { ...state.settings, ...settings };
  // Cópia para abrir sem sinal (ginásio). Fotos não vão (URLs assinadas expiram).
  if (!guestMode) {
    try { localStorage.setItem('cm:snap', JSON.stringify({ gyms, sessions, climbs: climbs.map(({ thumbUrl: _t, ...c }) => c), settings, profile })); } catch {}
  }
}
/** Sem sinal: abre com a última cópia dos dados (só leitura de verdade; gravar pede conexão). */
export function loadSnapshot() {
  try {
    const s = JSON.parse(localStorage.getItem('cm:snap'));
    if (!s) return false;
    Object.assign(state, { gyms: s.gyms, sessions: s.sessions, climbs: s.climbs, profile: s.profile?.handle ? s.profile : null, loadedAt: 0 });
    state.settings = { ...state.settings, ...s.settings };
    return true;
  } catch { return false; }
}
export const activeSession = () => state.sessions.find((s) => !s.endedAt);
export const gymOf = (id) => state.gyms.find((g) => g.id === id);
export const climbOf = (id) => state.climbs.find((c) => c.id === id);
export const rootOf = (c) => (c.projectId ? climbOf(c.projectId) ?? c : c);
export const upsert = (list, item) => { const i = list.findIndex((x) => x.id === item.id); i < 0 ? list.push(item) : (list[i] = { ...list[i], ...item }); };

// ---------- fotos ----------
export async function toCanvas(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}
export const encode = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));
/** WebP quando o navegador codifica; senão JPEG (Safari antigo devolve PNG para webp). */
export async function compress(canvas, q) {
  const webp = await encode(canvas, 'image/webp', q);
  return webp?.type === 'image/webp' ? webp : encode(canvas, 'image/jpeg', q);
}
/** Envia a foto direto ao S3; tenta 3 vezes (sinal ruim no ginásio é comum). */
export async function upload({ url, fields, guest }, blob) {
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
export function climbRow(c) {
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
