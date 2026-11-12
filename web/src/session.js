// Sessão (sem tela): localização, encerramento automático e a janela que sobe de baixo.
import { track } from './analytics.js';
import { isReact, mount, sweep } from './ui/base.jsx';
import { render } from './app.js';
import { t } from './i18n.js';
import * as S from './stats.js';
import { $, state, toast, fail, api, activeSession, gymOf, upsert } from './core.js';

// ---------- localização (opcional) ----------
export const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
    () => resolve(null),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
  );
});
export const geoGranted = async () => {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch { return false; }
};

// ---------- encerramento automático da sessão ----------
// Site não acompanha a localização com o app fechado: a conferência roda ao abrir o app, ao voltar
// para ele e a cada 5 min enquanto está aberto.
export const LEFT_KM = 1; // GPS dentro de ginásio erra centenas de metros
export const IDLE_MS = 4 * 3600_000; // sem registrar boulder por 4 h = sessão esquecida aberta
export let autoEndBusy = false;
export async function checkAutoEnd() {
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
export async function autoEnd(s, reason, endedAt) {
  const prev = { ...s };
  upsert(state.sessions, { id: s.id, endedAt, autoEnded: reason });
  render();
  try {
    upsert(state.sessions, await api(`/sessions/${s.id}`, { method: 'PATCH', body: { end: true, endedAt, auto: reason } }));
    toast(t(reason === 'left' ? 'session.autoLeft' : 'session.autoIdle'));
    track('session_auto_ended', { reason });
  } catch (err) { upsert(state.sessions, { ...prev, endedAt: undefined, autoEnded: undefined }); render(); fail(err); }
}

export function openSheet(content) {
  const d = $('#sheet');
  d.style.transform = '';
  d.replaceChildren(isReact(content) ? mount(content) : content);
  sweep();
  if (!d.open) d.showModal();
}

/** Janela de baixo: arrastar para baixo (com ela no topo da rolagem) fecha. Fora de fotos, campos e listas roláveis. */
export function sheetSwipe(d) {
  let y0 = null, dy = 0, t0 = 0;
  d.addEventListener('touchstart', (e) => {
    const el = e.target;
    if (e.touches.length > 1 || d.scrollTop > 0 || el.closest('.stage, input, select, textarea')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
  }, { passive: true });
  d.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { d.style.transform = ''; return; }
    e.preventDefault(); // não rola a página por trás enquanto arrasta
    d.style.transition = 'none';
    d.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  d.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    const fast = dy > 40 && dy / (Date.now() - t0) > 0.6;
    d.style.transition = 'transform .2s ease-out';
    if (dy > Math.min(140, d.offsetHeight / 4) || fast) {
      d.style.transform = `translateY(${d.offsetHeight}px)`;
      setTimeout(() => { d.close(); d.style.transition = ''; d.style.transform = ''; }, 180);
    } else d.style.transform = '';
  });
}
