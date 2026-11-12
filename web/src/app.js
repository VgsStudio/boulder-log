// Chalkmark: SPA sem framework. Rotas por hash e inicialização.
import './style.css';
import { t } from './i18n.js';
import { bumpNags, clearGuest, getPhoto, guestLocked, guestNags, guestPending, startGuest } from './guest.js';
import { PHOTO_TERMS_VERSION, $, view, cfg, state, timers, h, fill, svg, toast, fail, seg, saveTokens, cognitoApi, fromAuthResult, login, idToken, guestMode, api, loadAll, loadSnapshot, activeSession, upload, setCfg, setGuestMode, clearTimers } from './core.js';
import { icon, streakSheet, streakPill } from './game.js';
import { checkAutoEnd, viewSession, openSheet, sheetSwipe } from './session.js';
import { onCameraPhoto, viewNew, viewClimb, debounce, viewShare, backfillPreviews } from './climb.js';
import { profileSheet, viewFriends, viewMe, viewUser, feed, viewFeed } from './social.js';
import { viewHistory, viewProgress } from './history.js';
import { settingsSheet, tourRunning, appTour, maybeAskInstall, maybeAskPush, maybeAskFeedback } from './settings.js';

// ---------- roteamento ----------
const ROUTES = [
  [/^#?\/?$/, viewSession, 'session'],
  [/^#\/new$/, viewNew, 'session'],
  [/^#\/climb\/([a-z0-9]{19})$/, viewClimb, null],
  [/^#\/history$/, viewHistory, 'history'],
  [/^#\/s\/([A-Za-z0-9_-]{22})$/, viewShare, null],
  [/^#\/progress$/, viewProgress, 'profile'],
  [/^#\/feed$/, viewFeed, 'feed'],
  [/^#\/me$/, viewMe, 'profile'],
  [/^#\/friends$/, viewFriends, 'profile'],
  [/^#\/u\/([a-z0-9_.]{3,20})$/, viewUser, 'profile'],
];

// Rolagem: a posição fica guardada na própria entrada do histórico (history.state), então "voltar"
// devolve a tela onde estava e um link novo começa do topo.
let wantScroll = 0;
export const restoreScroll = () => { if (wantScroll) window.scrollTo(0, wantScroll); };
window.addEventListener('scroll', debounce(() => {
  try { history.replaceState({ ...(history.state ?? {}), y: window.scrollY }, ''); } catch {}
}, 120), { passive: true });

export function render() {
  clearTimers();
  // Abre na Home; com sessão aberta (ou sem conta), na Sessão.
  const hash = location.hash || (guestMode || activeSession() ? '#/' : '#/feed');
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
export function needAccount() {
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

export function showAuth({ mode = 'login', blocked = false } = {}) {
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
  document.querySelectorAll('[data-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.aria)));
  $('#open-settings').setAttribute('aria-label', t('settings.title'));
  $('#open-settings').addEventListener('click', settingsSheet);
  $('#streak-pill').addEventListener('click', streakSheet);
  $('#tab-cam').setAttribute('aria-label', t('cam.label'));
  $('#cam-input').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; onCameraPhoto(f); });
  $('#sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  sheetSwipe($('#sheet'));
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
      const welcome = () => { if (!$('#sheet').open) profileSheet({ welcome: true }).then((p) => p && render()); };
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
