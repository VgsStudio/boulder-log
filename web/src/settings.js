// Ajustes, tutorial, instalar na tela inicial, notificações e avaliação.
import { render, showAuth } from './app.js';
import { fmtDate, lang, langChoice, setLang, t } from './i18n.js';
import { playSent, playTick, setSound, soundOn } from './sound.js';
import * as S from './stats.js';
import { $, getTheme, setTheme, state, h, fill, svg, toast, fail, seg, stepper, login, logout, guestMode, api, activeSession } from './core.js';
import { SHARE_ICON, lineIcon, icon } from './game.js';
import { openSheet } from './session.js';
import { termsBody, debounce } from './climb.js';
import { social, feed } from './social.js';

// ---------- ajustes ----------
export function settingsSheet() {
  const st = { ...state.settings };
  const box = h('div', { class: 'stack settings' });
  // Preferências salvam sozinhas (sem botão de salvar).
  const save = debounce(async () => {
    try {
      state.settings = { ...state.settings, ...(await api('/settings', { method: 'PUT', body: { scale: st.scale, weeklySessions: st.weeklySessions, gradeGoal: st.gradeGoal } })) };
      render();
    } catch (err) { fail(err); }
  }, 600);
  const field = (label, control) => h('div', {}, h('div', { class: 'small muted' }, label), control);
  const draw = () => fill(box,
    h('h2', {}, t('settings.title')),

    h('section', { class: 'settings-group' },
      h('h3', {}, t('settings.prefs')),
      field(t('settings.scale'), seg([['v', 'V (Hueco)'], ['font', 'Font']], st.scale, (v) => { st.scale = v; save(); draw(); })),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, t('settings.weekly')),
        stepper(st.weeklySessions, 0, 7, (n) => { st.weeklySessions = n; save(); }, t('settings.weekly'))),
      h('label', { class: 'field' }, h('span', {}, t('settings.gradeGoal')),
        h('select', { onchange: (e) => { st.gradeGoal = e.target.value === '' ? null : Number(e.target.value); save(); } },
          h('option', { value: '' }, t('settings.none')),
          S.GRADES.map((g) => h('option', { value: String(g), selected: st.gradeGoal === g }, S.gradeLabel(g, st.scale))))),
      field(t('settings.lang'), seg([['auto', t('settings.langAuto')], ['pt', 'Português'], ['en', 'English']], langChoice(), (v) => setLang(v))),
      field(t('settings.theme'), seg([['auto', t('settings.themeAuto')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')]], getTheme(), (v) => { setTheme(v); draw(); })),
      field(t('settings.sound'), seg([['on', t('settings.soundOn')], ['off', t('settings.soundOff')]], soundOn() ? 'on' : 'off', (v) => { setSound(v === 'on'); if (v === 'on') playSent(); draw(); }))),

    !guestMode && h('section', { class: 'settings-group' }, h('h3', {}, t('push.settings')), pushSettings()),

    h('section', { class: 'settings-group' },
      h('h3', {}, t('settings.account')),
      guestMode
        ? [h('button', { class: 'btn primary block', type: 'button', onclick: () => { $('#sheet').close(); showAuth({ mode: 'signup' }); } }, t('auth.signup')),
          h('button', { class: 'btn block', type: 'button', onclick: () => { $('#sheet').close(); showAuth({ mode: 'login' }); } }, t('guest.haveAccount'))]
        : [canInstall() && h('button', { class: 'btn primary block', type: 'button', onclick: installSheet }, t('install.button')),
          h('button', { class: 'btn block', type: 'button', onclick: () => feedbackSheet() }, t('fb.menu')),
          h('button', { class: 'btn block', type: 'button', onclick: logout }, t('settings.logout'))],
      h('p', { class: 'small legal-links' },
        h('button', { class: 'link small', type: 'button', onclick: () => openSheet(h('div', { class: 'stack' }, h('h2', {}, t('terms.view')), termsBody(),
          state.settings.photoTermsAt && h('p', { class: 'muted small' }, t('terms.accepted', { d: fmtDate(state.settings.photoTermsAt, { day: 'numeric', month: 'long', year: 'numeric' }) })),
          h('button', { class: 'btn block', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close')))) }, t('terms.view')),
        ' · ', h('a', { href: '/termos.html', target: '_blank' }, t('legal.terms')), ' · ', h('a', { href: '/privacidade.html', target: '_blank' }, t('legal.privacy')))),

    !guestMode && h('section', { class: 'danger-zone' },
      h('h3', {}, t('danger.title')),
      h('p', { class: 'small' }, t('danger.lead')),
      h('button', { class: 'btn danger-fill block', type: 'button', onclick: deleteAccountSheet }, t('account.delete'))),

    h('button', { class: 'btn ghost block', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close')),
  );
  draw();
  openSheet(box);
}

// ---------- mini tutorial (tela escura com destaque) ----------
export let tourRunning = false;
export const seen = (k) => { try { return !!localStorage.getItem(k); } catch { return true; } };
export const markSeen = (k) => { try { localStorage.setItem(k, '1'); } catch {} };
/** Passos { el: seletor | () => elemento, text }: escurece a tela, recorta o elemento e mostra o balão.
 *  Passo sem elemento visível é pulado. Roda uma vez por `key`. */
export function runTour(key, steps, onDone = () => {}) {
  if (tourRunning || seen(key)) return false;
  const find = (s) => { const el = typeof s.el === 'function' ? s.el() : document.querySelector(s.el); return el && el.getClientRects().length ? el : null; };
  const list = steps.filter(find);
  if (!list.length) return false;
  tourRunning = true;
  markSeen(key);
  const hole = h('div', { class: 'tour-hole' });
  const bubble = h('div', { class: 'tour-bubble', role: 'dialog', 'aria-live': 'polite' });
  const layer = h('div', { class: 'tour' }, hole, bubble);
  document.body.append(layer);
  let i = 0;
  const end = () => { layer.remove(); window.removeEventListener('resize', place); tourRunning = false; onDone(); };
  const place = () => {
    const el = find(list[i]);
    if (!el) { next(); return; }
    const r = el.getBoundingClientRect(), pad = 8;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // Balão abaixo do elemento, ou acima se não couber.
    const below = r.bottom + 16 + 140 < innerHeight;
    bubble.style.top = below ? `${r.bottom + 16}px` : 'auto';
    bubble.style.bottom = below ? 'auto' : `${innerHeight - r.top + 16}px`;
  };
  const next = () => { i++; if (i >= list.length) end(); else show(); };
  const show = () => {
    const el = find(list[i]);
    el?.scrollIntoView({ block: 'center', behavior: 'instant' });
    fill(bubble,
      h('p', {}, list[i].text),
      h('div', { class: 'row' },
        h('span', { class: 'small muted grow num' }, `${i + 1}/${list.length}`),
        list.length > 1 && i < list.length - 1 && h('button', { class: 'link small', type: 'button', onclick: end }, t('tour.skip')),
        h('button', { class: 'btn primary small-btn', type: 'button', onclick: next }, i < list.length - 1 ? t('tour.next') : t('tour.done'))));
    requestAnimationFrame(place);
  };
  layer.addEventListener('click', (e) => { if (e.target === layer || e.target === hole) next(); });
  window.addEventListener('resize', place);
  show();
  return true;
}

/** Tutorial da primeira abertura: câmera, sessão, sequência, evolução, perfil e ajustes. */
export function appTour(onDone) {
  return runTour('cm:tour', [
    { el: '#tab-cam', text: t('tour.cam') },
    { el: () => [...document.querySelectorAll('main .btn.primary.big, main .btn.go.big')][0], text: t('tour.session') },
    { el: '#streak-pill:not([hidden])', text: t('tour.streak') },
    { el: '#tabbar a[data-tab="feed"]', text: t('tour.feed') },
    { el: '#tabbar a[data-tab="profile"]', text: t('tour.profile') },
    { el: '#open-settings', text: t('tour.settings') },
  ], onDone);
}

// ---------- instalar na tela inicial ----------
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
export let installEvent = null; // Android/Chrome: o navegador entrega um "prompt" de instalação
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
/** Convite para instalar (uma vez por semana, até instalar). Devolve true se mostrou. */
export const isAndroid = () => /Android/.test(navigator.userAgent);
export const canInstall = () => !standalone() && (isIOS() || isAndroid() || !!installEvent);
export function maybeAskInstall() {
  if (!canInstall() || $('#sheet').open || tourRunning) return false;
  if (Date.now() - Number(localStorage.getItem('cm:installAsk') || 0) < 7 * 86400_000) return false;
  try { localStorage.setItem('cm:installAsk', String(Date.now())); } catch {}
  installSheet();
  return true;
}
export function installSheet() {
  openSheet(h('div', { class: 'stack' },
    h('img', { class: 'auth-logo', src: '/icon.svg', alt: '', width: 72, height: 72 }),
    h('h2', {}, t('install.title')),
    h('p', { class: 'muted' }, t('install.lead')),
    isIOS()
      ? h('ol', { class: 'install-steps' },
        h('li', {}, t('install.ios1'), ' ', h('span', { class: 'ios-share', 'aria-hidden': 'true' }, lineIcon(SHARE_ICON))),
        h('li', {}, t('install.ios2')),
        h('li', {}, t('install.ios3')))
      : installEvent
        ? h('button', {
          class: 'btn primary big block', type: 'button',
          onclick: async () => { $('#sheet').close(); installEvent?.prompt(); installEvent = null; },
        }, t('install.button'))
        : h('ol', { class: 'install-steps' }, h('li', {}, t('install.android1')), h('li', {}, t('install.android2'))),
    h('button', { class: 'btn ghost block', type: 'button', onclick: () => $('#sheet').close() }, t('guest.notNow'))));
}

// ---------- notificações (Web Push) ----------
// iPhone: só com o app instalado na tela inicial (iOS 16.4+). O pedido de permissão precisa de um toque.
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/Sao_Paulo'; } };
export const b64ToBytes = (b64) => Uint8Array.from(atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Pede permissão (se preciso), assina neste aparelho e avisa o servidor. Devolve as preferências ou null. */
export async function enablePush() {
  if (!pushSupported()) return null;
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  // Chave mudou (ou primeira vez): assina de novo.
  if (sub && b64ToBytes(publicKey).toString() !== new Uint8Array(sub.options?.applicationServerKey ?? []).toString()) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const prefs = await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), tz: tzName(), lang } });
  try { localStorage.setItem('cm:pushSync', String(Date.now())); } catch {}
  return prefs;
}

/** Na abertura: com permissão dada, mantém a assinatura em dia (1x por dia); sem, pede com um convite. */
export function maybeAskPush() {
  if (guestMode || !pushSupported() || $('#sheet').open || tourRunning) return;
  if (Notification.permission === 'granted') {
    if (Date.now() - Number(localStorage.getItem('cm:pushSync') || 0) > 86400_000) enablePush().catch((e) => console.warn('push', e));
    return;
  }
  if (Notification.permission === 'denied') return;
  if (Date.now() - Number(localStorage.getItem('cm:pushAsk') || 0) < 3 * 86400_000) return; // "agora não": de novo em 3 dias
  pushSheet();
}

export function pushSheet() {
  try { localStorage.setItem('cm:pushAsk', String(Date.now())); } catch {}
  const name = state.profile?.name?.split(' ')[0];
  openSheet(h('div', { class: 'stack push-ask' },
    h('div', { class: 'push-bell', 'aria-hidden': 'true' }, '🔔'),
    h('h2', {}, name ? t('push.titleName', { n: name }) : t('push.title')),
    h('p', { class: 'muted' }, t('push.lead')),
    h('ul', { class: 'terms' }, ['streak', 'project', 'friends'].map((k) => h('li', {}, t(`push.why.${k}`)))),
    h('button', {
      class: 'btn primary big block', type: 'button',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const p = await enablePush();
          $('#sheet').close();
          if (p) { playTick(); toast(t('push.on', { h: `${p.effectiveHour}h` })); } else toast(t('push.blocked'));
        } catch (err) { fail(err); e.target.disabled = false; }
      },
    }, t('push.enable')),
    h('button', { class: 'btn ghost block', type: 'button', onclick: () => $('#sheet').close() }, t('guest.notNow'))));
}

/** Bloco dos Ajustes: liga/desliga e horário (automático ou fixo). */
export function pushSettings() {
  const box = h('div', { class: 'stack push-settings' });
  const st = state.settings;
  const draw = (msg = '') => {
    const on = pushSupported() && Notification.permission === 'granted' && st.pushOn !== false;
    fill(box,
      h('div', { class: 'small muted' }, t('push.daily')),
      !pushSupported()
        ? h('p', { class: 'small muted' }, /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone ? t('push.needInstall') : t('push.unsupported'))
        : [
          seg([['on', t('settings.soundOn')], ['off', t('settings.soundOff')]], on ? 'on' : 'off', async (v) => {
            try {
              if (v === 'on') { const p = await enablePush(); if (!p) { toast(t('push.blocked')); return; } Object.assign(st, { pushOn: true, pushHour: p.pushHour }); }
              else { await api('/push/prefs', { method: 'PUT', body: { on: false } }); st.pushOn = false; }
              draw();
            } catch (err) { fail(err); }
          }),
          on && h('label', { class: 'field' }, h('span', {}, t('push.hour')),
            h('select', {
              onchange: async (e) => {
                const hour = e.target.value === '' ? null : Number(e.target.value);
                try { const p = await api('/push/prefs', { method: 'PUT', body: { hour, tz: tzName() } }); st.pushHour = p.pushHour; draw(t('push.hourSaved', { h: `${p.effectiveHour}h` })); } catch (err) { fail(err); }
              },
            },
            h('option', { value: '', selected: st.pushHour == null }, t('push.auto')),
            [...Array(16)].map((_, i) => i + 7).map((hh) => h('option', { value: String(hh), selected: st.pushHour === hh }, `${hh}h`)))),
          msg && h('p', { class: 'small muted' }, msg),
        ]);
  };
  draw();
  return box;
}

// ---------- avaliação ("está gostando?") ----------
export const FB_KEY = 'cm:fb';
export const DAY_MS = 86400_000;
export const fbNext = () => { try { return Number(localStorage.getItem(FB_KEY)) || 0; } catch { return 0; } };
export const fbLater = (days) => { try { localStorage.setItem(FB_KEY, String(Date.now() + days * DAY_MS)); } catch {} };
/** Pergunta de tempos em tempos: só para quem já usou o app (2+ sessões), nunca por cima de outra janela.
 *  Fechou sem avaliar: volta em 7 dias. Avaliou: só em 60. */
export function maybeAskFeedback() {
  if (guestMode || state.sessions.length < 2 || $('#sheet').open || activeSession()) return;
  if (!fbNext()) { fbLater(3); return; } // primeira vez: dá uns dias de uso antes
  if (Date.now() >= fbNext()) feedbackSheet(true);
}
export function feedbackSheet(auto = false) {
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
export function deleteAccountSheet() {
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
