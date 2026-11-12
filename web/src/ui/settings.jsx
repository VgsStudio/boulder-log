// Ajustes, tutorial, instalar na tela inicial, notificações e avaliação, em React.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDate, lang, langChoice, setLang, t } from '../i18n.js';
import { playSent, playTick, setSound, soundOn } from '../sound.js';
import * as S from '../stats.js';
import { $, getTheme, setTheme, state, toast, fail, logout, guestMode, api, activeSession, debounce } from '../core.js';
import { render, showAuth } from '../app.js';
import { SHARE_ICON } from '../game.js';
import { openSheet } from '../session.js';
import { mount, Seg, Stepper } from './base.jsx';
import { LineIcon } from './game.jsx';

const closeSheet = () => $('#sheet').close();
const Field = ({ label, children }) => <div><div className="small muted">{label}</div>{children}</div>;

/** Termo de uso das fotos (lista). */
export const Terms = () => <ul className="terms">{['private', 'rights', 'people', 'training', 'delete', 'remove'].map((k) => <li key={k}>{t(`terms.${k}`)}</li>)}</ul>;

// ---------- ajustes ----------
export const settingsSheet = () => openSheet(<Settings />);

function Settings() {
  const [st, setSt] = useState(() => ({ ...state.settings }));
  const [, redraw] = useState(0);
  // Preferências salvam sozinhas (sem botão de salvar).
  const save = useRef(debounce(async (v) => {
    try {
      state.settings = { ...state.settings, ...(await api('/settings', { method: 'PUT', body: { scale: v.scale, weeklySessions: v.weeklySessions, gradeGoal: v.gradeGoal } })) };
      render();
    } catch (err) { fail(err); }
  }, 600)).current;
  const change = (patch) => { const v = { ...st, ...patch }; setSt(v); save(v); };
  const terms = () => openSheet(
    <div className="stack">
      <h2>{t('terms.view')}</h2><Terms />
      {state.settings.photoTermsAt && <p className="muted small">{t('terms.accepted', { d: fmtDate(state.settings.photoTermsAt, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>}
      <button className="btn block" type="button" onClick={closeSheet}>{t('settings.close')}</button>
    </div>,
  );
  return (
    <div className="stack settings">
      <h2>{t('settings.title')}</h2>

      <section className="settings-group">
        <h3>{t('settings.prefs')}</h3>
        <Field label={t('settings.scale')}><Seg options={[['v', 'V (Hueco)'], ['font', 'Font']]} value={st.scale} onPick={(v) => change({ scale: v })} /></Field>
        <div className="row"><span className="grow">{t('settings.weekly')}</span>
          <Stepper value={st.weeklySessions} min={0} max={7} onChange={(n) => change({ weeklySessions: n })} label={t('settings.weekly')} />
        </div>
        <label className="field"><span>{t('settings.gradeGoal')}</span>
          <select value={st.gradeGoal ?? ''} onChange={(e) => change({ gradeGoal: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">{t('settings.none')}</option>
            {S.GRADES.map((g) => <option key={g} value={String(g)}>{S.gradeLabel(g, st.scale)}</option>)}
          </select>
        </label>
        <Field label={t('settings.lang')}><Seg options={[['auto', t('settings.langAuto')], ['pt', 'Português'], ['en', 'English']]} value={langChoice()} onPick={(v) => setLang(v)} /></Field>
        <Field label={t('settings.theme')}><Seg options={[['auto', t('settings.themeAuto')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')]]} value={getTheme()} onPick={(v) => { setTheme(v); redraw((n) => n + 1); }} /></Field>
        <Field label={t('settings.sound')}><Seg options={[['on', t('settings.soundOn')], ['off', t('settings.soundOff')]]} value={soundOn() ? 'on' : 'off'} onPick={(v) => { setSound(v === 'on'); if (v === 'on') playSent(); redraw((n) => n + 1); }} /></Field>
      </section>

      {!guestMode && <section className="settings-group"><h3>{t('push.settings')}</h3><PushSettings /></section>}

      <section className="settings-group">
        <h3>{t('settings.account')}</h3>
        {guestMode
          ? <>
            <button className="btn primary block" type="button" onClick={() => { closeSheet(); showAuth({ mode: 'signup' }); }}>{t('auth.signup')}</button>
            <button className="btn block" type="button" onClick={() => { closeSheet(); showAuth({ mode: 'login' }); }}>{t('guest.haveAccount')}</button>
          </>
          : <>
            {canInstall() && <button className="btn primary block" type="button" onClick={installSheet}>{t('install.button')}</button>}
            <button className="btn block" type="button" onClick={() => feedbackSheet()}>{t('fb.menu')}</button>
            <button className="btn block" type="button" onClick={logout}>{t('settings.logout')}</button>
          </>}
        <p className="small legal-links">
          <button className="link small" type="button" onClick={terms}>{t('terms.view')}</button>
          {' · '}<a href="/termos.html" target="_blank">{t('legal.terms')}</a>{' · '}<a href="/privacidade.html" target="_blank">{t('legal.privacy')}</a>
        </p>
      </section>

      {!guestMode && (
        <section className="danger-zone">
          <h3>{t('danger.title')}</h3>
          <p className="small">{t('danger.lead')}</p>
          <button className="btn danger-fill block" type="button" onClick={deleteAccountSheet}>{t('account.delete')}</button>
        </section>
      )}

      <button className="btn ghost block" type="button" onClick={closeSheet}>{t('settings.close')}</button>
    </div>
  );
}

// ---------- mini tutorial (tela escura com destaque) ----------
export let tourRunning = false;
export const seen = (k) => { try { return !!localStorage.getItem(k); } catch { return true; } };
export const markSeen = (k) => { try { localStorage.setItem(k, '1'); } catch {} };
const findEl = (s) => { const el = typeof s.el === 'function' ? s.el() : document.querySelector(s.el); return el && el.getClientRects().length ? el : null; };

/** Passos { el: seletor | () => elemento, text }: escurece a tela, recorta o elemento e mostra o balão.
 *  Passo sem elemento visível é pulado. Roda uma vez por `key`. */
export function runTour(key, steps, onDone = () => {}) {
  if (tourRunning || seen(key)) return false;
  const list = steps.filter(findEl);
  if (!list.length) return false;
  tourRunning = true;
  markSeen(key);
  const layer = mount(<Tour steps={list} end={() => { layer.remove(); tourRunning = false; onDone(); }} />);
  document.body.append(layer);
  return true;
}

function Tour({ steps, end }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState(null);
  const next = () => (i + 1 >= steps.length ? end() : setI(i + 1));
  useLayoutEffect(() => {
    const el = findEl(steps[i]);
    if (!el) { next(); return undefined; }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const place = () => setBox(el.getBoundingClientRect());
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const pad = 8;
  // Balão abaixo do elemento, ou acima se não couber.
  const below = box && box.bottom + 16 + 140 < innerHeight;
  return (
    <div className="tour" onClick={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('tour-hole')) next(); }}>
      <div className="tour-hole" style={box ? { left: `${box.left - pad}px`, top: `${box.top - pad}px`, width: `${box.width + pad * 2}px`, height: `${box.height + pad * 2}px` } : undefined} />
      <div className="tour-bubble" role="dialog" aria-live="polite" style={box ? { top: below ? `${box.bottom + 16}px` : 'auto', bottom: below ? 'auto' : `${innerHeight - box.top + 16}px` } : undefined}>
        <p>{steps[i].text}</p>
        <div className="row">
          <span className="small muted grow num">{`${i + 1}/${steps.length}`}</span>
          {steps.length > 1 && i < steps.length - 1 && <button className="link small" type="button" onClick={end}>{t('tour.skip')}</button>}
          <button className="btn primary small-btn" type="button" onClick={next}>{i < steps.length - 1 ? t('tour.next') : t('tour.done')}</button>
        </div>
      </div>
    </div>
  );
}

/** Tutorial da primeira abertura: câmera, sessão, sequência, Home, perfil e ajustes. */
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
export const isAndroid = () => /Android/.test(navigator.userAgent);
let installEvent = null; // Android/Chrome: o navegador entrega um "prompt" de instalação
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
export const canInstall = () => !standalone() && (isIOS() || isAndroid() || !!installEvent);
/** Convite para instalar (uma vez por semana, até instalar). Devolve true se mostrou. */
export function maybeAskInstall() {
  if (!canInstall() || $('#sheet').open || tourRunning) return false;
  if (Date.now() - Number(localStorage.getItem('cm:installAsk') || 0) < 7 * 86400_000) return false;
  try { localStorage.setItem('cm:installAsk', String(Date.now())); } catch {}
  installSheet();
  return true;
}
export function installSheet() {
  openSheet(
    <div className="stack">
      <img className="auth-logo" src="/icon.svg" alt="" width={72} height={72} />
      <h2>{t('install.title')}</h2>
      <p className="muted">{t('install.lead')}</p>
      {isIOS()
        ? <ol className="install-steps">
          <li>{t('install.ios1')} <span className="ios-share" aria-hidden="true"><LineIcon d={SHARE_ICON} /></span></li>
          <li>{t('install.ios2')}</li><li>{t('install.ios3')}</li>
        </ol>
        : installEvent
          ? <button className="btn primary big block" type="button" onClick={() => { closeSheet(); installEvent?.prompt(); installEvent = null; }}>{t('install.button')}</button>
          : <ol className="install-steps"><li>{t('install.android1')}</li><li>{t('install.android2')}</li></ol>}
      <button className="btn ghost block" type="button" onClick={closeSheet}>{t('guest.notNow')}</button>
    </div>,
  );
}

// ---------- notificações (Web Push) ----------
// iPhone: só com o app instalado na tela inicial (iOS 16.4+). O pedido de permissão precisa de um toque.
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/Sao_Paulo'; } };
const b64ToBytes = (b64) => Uint8Array.from(atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

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
  openSheet(<PushAsk />);
}
function PushAsk() {
  const [busy, setBusy] = useState(false);
  const name = state.profile?.name?.split(' ')[0];
  const enable = async () => {
    setBusy(true);
    try {
      const p = await enablePush();
      closeSheet();
      if (p) { playTick(); toast(t('push.on', { h: `${p.effectiveHour}h` })); } else toast(t('push.blocked'));
    } catch (err) { fail(err); setBusy(false); }
  };
  return (
    <div className="stack push-ask">
      <div className="push-bell" aria-hidden="true">🔔</div>
      <h2>{name ? t('push.titleName', { n: name }) : t('push.title')}</h2>
      <p className="muted">{t('push.lead')}</p>
      <ul className="terms">{['streak', 'project', 'friends'].map((k) => <li key={k}>{t(`push.why.${k}`)}</li>)}</ul>
      <button className="btn primary big block" type="button" disabled={busy} onClick={enable}>{t('push.enable')}</button>
      <button className="btn ghost block" type="button" onClick={closeSheet}>{t('guest.notNow')}</button>
    </div>
  );
}

/** Bloco dos Ajustes: liga/desliga e horário (automático ou fixo). */
function PushSettings() {
  const st = state.settings;
  const [msg, setMsg] = useState('');
  const [, redraw] = useState(0);
  if (!pushSupported()) {
    return <div className="stack push-settings"><div className="small muted">{t('push.daily')}</div>
      <p className="small muted">{/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone ? t('push.needInstall') : t('push.unsupported')}</p></div>;
  }
  const on = Notification.permission === 'granted' && st.pushOn !== false;
  const toggle = async (v) => {
    try {
      if (v === 'on') { const p = await enablePush(); if (!p) { toast(t('push.blocked')); return; } Object.assign(st, { pushOn: true, pushHour: p.pushHour }); }
      else { await api('/push/prefs', { method: 'PUT', body: { on: false } }); st.pushOn = false; }
      redraw((n) => n + 1);
    } catch (err) { fail(err); }
  };
  const setHour = async (e) => {
    const hour = e.target.value === '' ? null : Number(e.target.value);
    try { const p = await api('/push/prefs', { method: 'PUT', body: { hour, tz: tzName() } }); st.pushHour = p.pushHour; setMsg(t('push.hourSaved', { h: `${p.effectiveHour}h` })); } catch (err) { fail(err); }
  };
  return (
    <div className="stack push-settings">
      <div className="small muted">{t('push.daily')}</div>
      <Seg options={[['on', t('settings.soundOn')], ['off', t('settings.soundOff')]]} value={on ? 'on' : 'off'} onPick={toggle} />
      {on && (
        <label className="field"><span>{t('push.hour')}</span>
          <select value={st.pushHour == null ? '' : String(st.pushHour)} onChange={setHour}>
            <option value="">{t('push.auto')}</option>
            {[...Array(16)].map((_, i) => i + 7).map((hh) => <option key={hh} value={String(hh)}>{`${hh}h`}</option>)}
          </select>
        </label>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </div>
  );
}

// ---------- avaliação ("está gostando?") ----------
const FB_KEY = 'cm:fb';
const DAY_MS = 86400_000;
const fbNext = () => { try { return Number(localStorage.getItem(FB_KEY)) || 0; } catch { return 0; } };
const fbLater = (days) => { try { localStorage.setItem(FB_KEY, String(Date.now() + days * DAY_MS)); } catch {} };
/** Pergunta de tempos em tempos: só para quem já usou o app (2+ sessões), nunca por cima de outra janela.
 *  Fechou sem avaliar: volta em 7 dias. Avaliou: só em 60. */
export function maybeAskFeedback() {
  if (guestMode || state.sessions.length < 2 || $('#sheet').open || activeSession()) return;
  if (!fbNext()) { fbLater(3); return; } // primeira vez: dá uns dias de uso antes
  if (Date.now() >= fbNext()) feedbackSheet(true);
}
export function feedbackSheet(auto = false) {
  const rated = { stars: 0 };
  openSheet(<Feedback auto={auto} rated={rated} />);
  // Fechar tocando fora (ou arrastando) também conta como "agora não".
  if (auto) $('#sheet').addEventListener('close', () => { if (!rated.stars) fbLater(7); }, { once: true });
}
const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9Z';
function Feedback({ auto, rated }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const area = useRef(null);
  useEffect(() => { if (stars) area.current?.focus(); }, [stars]);
  const send = async () => {
    setBusy(true);
    try {
      await api('/feedback', { method: 'POST', body: { stars, comment: comment.trim(), lang } });
      fbLater(60);
      closeSheet();
      playSent();
      toast(t('fb.thanks'));
    } catch (err) { fail(err); setBusy(false); }
  };
  return (
    <div className="stack">
      <h2>{t('fb.title')}</h2>
      <p className="muted">{t('fb.lead')}</p>
      <div className="stars" role="radiogroup" aria-label={t('fb.title')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={String(stars === n)} aria-label={t('fb.star', { n })} className={n <= stars ? 'on' : undefined}
            onClick={() => { rated.stars = n; setStars(n); playTick(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={STAR} /></svg>
          </button>
        ))}
      </div>
      {stars > 0 && <>
        <label className="field"><span>{stars >= 4 ? t('fb.good') : t('fb.bad')}</span>
          <textarea ref={area} maxLength={1000} rows={4} placeholder={t('fb.placeholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <button className="btn primary big block" type="button" disabled={busy} onClick={send}>{t('fb.send')}</button>
      </>}
      <button className="btn ghost block" type="button" onClick={closeSheet}>{auto ? t('fb.later') : t('settings.close')}</button>
    </div>
  );
}

/** Excluir a conta: some tudo (boulders, fotos, perfil, quem segue, links) e o login. */
export const deleteAccountSheet = () => openSheet(<DeleteAccount />);
function DeleteAccount() {
  const word = t('account.word');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try {
      await api('/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
      try { Object.keys(localStorage).filter((k) => k.startsWith('cm:') || k.startsWith('bl:')).forEach((k) => localStorage.removeItem(k)); } catch {}
      logout();
    } catch (err) { fail(err); setBusy(false); }
  };
  return (
    <div className="stack">
      <h2>{t('account.title')}</h2>
      <p>{t('account.lead')}</p>
      <ul className="terms">{['climbs', 'social', 'shares', 'login'].map((k) => <li key={k}>{t(`account.${k}`)}</li>)}</ul>
      <label className="field"><span>{t('account.type', { w: word })}</span>
        <input type="text" autoCapitalize="characters" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      <button className="btn primary block danger-fill" type="button" disabled={busy || typed.trim().toUpperCase() !== word} onClick={del}>
        {busy ? t('account.deleting') : t('account.confirmBtn')}
      </button>
      <button className="btn ghost block" type="button" onClick={closeSheet}>{t('settings.close')}</button>
    </div>
  );
}
