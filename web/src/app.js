// Chalkmark: app em React. Este arquivo inicia tudo: configuração, login, dados e a casca (ui/shell.jsx).
import { startAnalytics } from './analytics.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { t } from './i18n.js';
import { clearGuest, getPhoto, guestLocked, guestPending, startGuest } from './guest.js';
import { PHOTO_TERMS_VERSION, cfg, state, toast, fail, idToken, guestMode, api, loadAll, loadSnapshot, upload, setCfg, setGuestMode, debounce } from './core.js';
import { checkAutoEnd, sheetSwipe } from './session.js';
import { backfillPreviews } from './ui/climb.jsx';
import { profileSheet, claims } from './ui/social.jsx';
import { loadInbox } from './ui/inbox.jsx';
import { tourRunning, appTour, maybeAskInstall, maybeAskPush, maybeAskFeedback } from './ui/settings.jsx';
import { firstClimbSheet } from './ui/session.jsx';
import { App, shell, setShell, restoreScroll, needAccount, showAuth } from './ui/shell.jsx';

export { restoreScroll, needAccount, showAuth };
/** Redesenha a tela atual do zero (depois de mudar dados que a tela leu ao abrir). */
export const render = () => setShell({ nonce: shell.nonce + 1 });

window.addEventListener('scroll', debounce(() => {
  try { history.replaceState({ ...(history.state ?? {}), y: window.scrollY }, ''); } catch {}
}, 120), { passive: true });

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

async function boot() {
  createRoot(document.getElementById('root')).render(createElement(App));
  const sheet = document.getElementById('sheet');
  sheet.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  sheetSwipe(sheet);
  // Service worker: abre sem sinal e recebe notificações.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw', e));
  try { setCfg(await (await fetch('/config.json', { cache: 'no-store' })).json()); } catch { setCfg(JSON.parse(localStorage.getItem('cm:cfg') || '{}')); }
  try { localStorage.setItem('cm:cfg', JSON.stringify(cfg)); } catch {}
  const pending = guestPending();
  if (!(await idToken())) {
    // Sem conta: usa normalmente; os dados ficam no navegador. Depois de 1 dia, só com conta.
    setGuestMode(true);
    startGuest();
    if (guestLocked()) { await loadAll(); return showAuth({ mode: 'signup', blocked: true }); }
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
      setShell({ offline: true });
      window.addEventListener('online', () => location.reload(), { once: true });
    } else { fail(e); return; }
  }
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
    if (document.visibilityState === 'visible') loadInbox();
  });
  setShell({ ready: true });
  loadInbox();
  startAnalytics({ userId: guestMode ? null : claims().sub, guest: guestMode }).catch((e) => console.warn('stats', e));
  checkAutoEnd();
  // Primeira vez (sem perfil): boas-vindas com nome e @ já sugeridos; "agora não" pergunta de novo amanhã.
  try {
    if (!guestMode && !state.profile && Date.now() - Number(localStorage.getItem('cm:onb') || 0) > 86400_000) {
      localStorage.setItem('cm:onb', String(Date.now()));
      const welcome = () => { if (!document.getElementById('sheet').open) profileSheet({ welcome: true }).then((p) => { if (p) { render(); if (!state.climbs.length) setTimeout(firstClimbSheet, 400); } }); };
      setTimeout(() => (tourRunning ? setTimeout(welcome, 15000) : welcome()), 600);
    }
  } catch {}
  setTimeout(() => {
    const afterTour = () => setTimeout(() => { if (!maybeAskInstall()) maybeAskPush(); }, 600);
    if (!appTour(afterTour)) afterTour();
  }, 900);
  setTimeout(() => { if (!tourRunning) maybeAskFeedback(); }, 8000);
  setTimeout(backfillPreviews, 5000);
  setInterval(checkAutoEnd, 5 * 60_000);
}

boot().catch(fail);
