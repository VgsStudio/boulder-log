// Sessão: localização, encerramento automático e a tela da sessão.
import { render } from './app.js';
import { fmtDate, fmtDuration, t } from './i18n.js';
import * as S from './stats.js';
import { $, view, state, timers, h, toast, fail, grade, seg, api, activeSession, gymOf, upsert, climbRow } from './core.js';
import { icon, hero, recapSheet } from './game.js';
import { quickLogSheet } from './climb.js';
import { goalsCard } from './history.js';

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
  } catch (err) { upsert(state.sessions, { ...prev, endedAt: undefined, autoEnded: undefined }); render(); fail(err); }
}

// ---------- tela: sessão ----------
export function viewSession() {
  const s = activeSession();
  return s ? activeSessionView(s) : startView();
}

export function startView() {
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

export function sessionHeader(s) {
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

export function activeSessionView(s) {
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
    h('button', { class: 'btn block', type: 'button', onclick: () => quickLogSheet(s) }, t('quick.button')),
    climbs.length
      ? h('ul', { class: 'list card' }, climbs.map(climbRow))
      : h('p', { class: 'muted' }, t('session.empty')),
    h('button', { class: 'btn block', type: 'button', onclick: () => endSessionSheet(s) }, t('session.end')));
}

export function endSessionSheet(s) {
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

export function openSheet(content) {
  const d = $('#sheet');
  d.style.transform = '';
  d.replaceChildren(content);
  d.showModal();
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
