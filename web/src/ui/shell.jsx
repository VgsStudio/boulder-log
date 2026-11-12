// Casca do app em React: topo, barra de abas, rotas por hash e a tela de login.
import { track, pageview } from '../analytics.js';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { t } from '../i18n.js';
import * as S from '../stats.js';
import { $, state, cfg, guestMode, cognitoApi, saveTokens, fromAuthResult, login, subscribe, getVersion, emit } from '../core.js';
import { bumpNags, guestNags } from '../guest.js';
import { openSheet } from '../session.js';
import { Seg } from './base.jsx';
import { Icon, streakSheet } from './game.jsx';
import { Session } from './session.jsx';
import { NewClimb, ClimbView, ShareView, onCameraPhoto } from './climb.jsx';
import { History, Progress } from './history.jsx';
import { Feed, Me, Friends, User } from './social.jsx';
import { settingsSheet } from './settings.jsx';

// ---------- estado da casca ----------
/** ready: dados carregados; auth: tela de login aberta ({ mode, blocked }); nonce: força remontar a tela. */
export const shell = { ready: false, auth: null, nonce: 0, offline: false };
export const setShell = (patch) => { Object.assign(shell, patch); emit(); };
const useShell = () => { useSyncExternalStore(subscribe, getVersion); return shell; };

// ---------- rotas ----------
const ROUTES = [
  [/^#?\/?$/, () => <Session />, 'session', 'session'],
  [/^#\/new$/, () => <NewClimb />, 'session', 'new_climb'],
  [/^#\/climb\/([a-z0-9]{19})$/, (id) => <ClimbView id={id} />, null, 'climb'],
  [/^#\/history$/, () => <History />, 'history', 'history'],
  [/^#\/s\/([A-Za-z0-9_-]{22})$/, (token) => <ShareView token={token} />, null, 'shared_climb'],
  [/^#\/progress$/, () => <Progress />, 'profile', 'progress'],
  [/^#\/feed$/, () => <Feed />, 'feed', 'home'],
  [/^#\/me$/, () => <Me />, 'profile', 'my_profile'],
  [/^#\/friends$/, () => <Friends />, 'profile', 'friends'],
  [/^#\/u\/([a-z0-9_.]{3,20})$/, (handle) => <User handle={handle} />, 'profile', 'user_profile'],
];
/** Abre na Home; com sessão aberta (ou sem conta), na Sessão. */
const currentHash = () => location.hash || (guestMode || state.sessions.some((s) => !s.endedAt) ? '#/' : '#/feed');
export const routeOf = (hash) => {
  const [re, fn, tab, name] = ROUTES.find(([r]) => r.test(hash)) ?? ROUTES[0];
  return { el: fn(...(hash.match(re)?.slice(1) ?? [])), tab, name };
};

// Rolagem: a posição fica guardada na própria entrada do histórico (history.state), então "voltar"
// devolve a tela onde estava e um link novo começa do topo.
let wantScroll = 0;
export const restoreScroll = () => { if (wantScroll) window.scrollTo(0, wantScroll); };

// ---------- componentes ----------
export function App() {
  const sh = useShell();
  // Troca de endereço: só redesenha (a rota é lida de location.hash na hora).
  const [, onHash] = useState(0);
  useEffect(() => {
    const on = () => onHash((n) => n + 1);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const route = routeOf(currentHash());
  const key = `${currentHash()}|${sh.nonce}`;
  useLayoutEffect(() => {
    wantScroll = history.state?.y ?? 0;
    window.scrollTo(0, wantScroll);
  }, [key]);
  useEffect(() => { document.body.classList.toggle('offline', sh.offline); }, [sh.offline]);
  useEffect(() => { if (sh.ready && !sh.auth) pageview(route.name); }, [currentHash(), sh.ready, sh.auth]); // eslint-disable-line react-hooks/exhaustive-deps
  const showChrome = sh.ready && !sh.auth;
  return (
    <>
      <header className="top">
        <a className="brand" href="#/"><img className="brand-mark" src="/icon.svg" alt="" width={30} height={30} />Chalkmark</a>
        <div className="row">
          {showChrome && <StreakPill />}
          {guestMode && !sh.auth && sh.ready && <button className="btn small-btn primary" type="button" onClick={() => showAuth({ mode: 'signup' })}>{t('guest.cta')}</button>}
          {showChrome && (
            <button className="icon-btn" id="open-settings" type="button" aria-label={t('settings.title')} onClick={settingsSheet}>
              <svg className="gear" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx={12} cy={12} r={3} /></svg>
            </button>
          )}
        </div>
      </header>
      <p className="offline-bar" role="status">{t('offline.bar')}</p>
      <main id="view" tabIndex={-1}>
        {sh.auth ? <AuthScreen key={sh.auth.mode + sh.auth.blocked} {...sh.auth} /> : sh.ready && <Screen key={key}>{route.el}</Screen>}
      </main>
      <TabBar hidden={!showChrome} tab={route.tab} />
    </>
  );
}
const Screen = ({ children }) => children;

function StreakPill() {
  const n = S.streakWeeks(state.sessions);
  if (!n) return null;
  return <button className="streak-pill num" id="streak-pill" type="button" aria-label={`${n} ${t('streak.weeks')}`} onClick={streakSheet}><Icon kind="streak" />{n}</button>;
}

const TABS = [
  ['#/feed', 'feed', 'tab.home', <path key="p" d="M4 11 12 4l8 7v9h-5v-6H9v6H4Z" />],
  ['#/', 'session', 'tab.session', <path key="p" d="M4 20 10 6l4 7 2-3 4 10Z" />],
  null, // câmera
  ['#/history', 'history', 'tab.history', [<rect key="r" x={4} y={5} width={16} height={15} rx={2} />, <path key="p" d="M4 10h16M9 3v4M15 3v4" />]],
  ['#/me', 'profile', 'tab.profile', [<circle key="c" cx={12} cy={8} r={4} />, <path key="p" d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7Z" />]],
];
function TabBar({ hidden, tab }) {
  return (
    <nav className="tabbar" id="tabbar" hidden={hidden}>
      {TABS.map((x) => (x
        ? <a key={x[1]} href={x[0]} data-tab={x[1]} aria-label={t(x[2])} aria-current={tab === x[1] ? 'page' : undefined}><svg viewBox="0 0 24 24" aria-hidden="true">{x[3]}</svg></a>
        : (
          <label key="cam" className="tab-cam" id="tab-cam" aria-label={t('cam.label')}>
            <span className="cam-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4Z" /><circle cx={12} cy={13} r={3.5} /></svg></span>
            <input type="file" accept="image/*" capture="environment" id="cam-input" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onCameraPhoto(f); }} />
          </label>
        )))}
    </nav>
  );
}

// ---------- sem conta e login ----------
/** Pede conta para quem usa sem login: a 1ª vez dá para dispensar; depois, trava na tela de criar conta. */
export function needAccount() {
  if (!guestMode) return;
  const close = () => $('#sheet').close();
  if (guestNags() < 1) {
    bumpNags();
    track('guest_prompt');
    openSheet(
      <div className="stack">
        <h2>{t('guest.title')}</h2>
        <p className="muted">{t('guest.lead')}</p>
        <button className="btn primary big block" type="button" onClick={() => { close(); showAuth({ mode: 'signup' }); }}>{t('auth.signup')}</button>
        <button className="btn block" type="button" onClick={() => { close(); showAuth({ mode: 'login' }); }}>{t('guest.haveAccount')}</button>
        <button className="btn ghost block" type="button" onClick={close}>{t('guest.notNow')}</button>
      </div>,
    );
    return;
  }
  bumpNags();
  track('guest_blocked');
  if ($('#sheet').open) close();
  showAuth({ mode: 'signup', blocked: true });
}

export const showAuth = ({ mode = 'login', blocked = false } = {}) => setShell({ auth: { mode, blocked } });

/** Olho aberto (senha escondida, toque para mostrar) ou riscado (senha à mostra). */
const Eye = ({ open }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx={12} cy={12} r={3} />{open && <path d="M4 4l16 16" />}
  </svg>
);
const GOOGLE_G = [['#4285F4', 'M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z'],
  ['#34A853', 'M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z'],
  ['#FBBC05', 'M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z'],
  ['#EA4335', 'M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6Z']];

const authMsg = (err) => ({
  NotAuthorizedException: t('auth.err.wrong'), UsernameExistsException: t('auth.err.exists'),
  InvalidPasswordException: t('auth.err.password'), CodeMismatchException: t('auth.err.code'),
  ExpiredCodeException: t('auth.err.expired'), LimitExceededException: t('auth.err.limit'),
  TooManyRequestsException: t('auth.err.limit'), TooManyFailedAttemptsException: t('auth.err.limit'),
  InvalidParameterException: t('auth.err.email'), UserNotFoundException: t('auth.err.wrong'),
  UserLambdaValidationException: /USE_GOOGLE/.test(err.message) ? t('auth.err.useGoogle') : t('error.generic'),
}[err.code] ?? (navigator.onLine ? t('error.generic') : t('error.offline')));

/** Senha com o olho dentro do campo (mostra/esconde). */
function Password({ label, autoComplete, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field"><span>{label}</span>
      <div className="pw">
        <input type={show ? 'text' : 'password'} required autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="pw-eye" type="button" aria-label={show ? t('auth.hide') : t('auth.show')} aria-pressed={String(show)} onClick={() => setShow(!show)}><Eye open={show} /></button>
      </div>
      {autoComplete === 'new-password' && <span className="small muted">{t('auth.pwRule')}</span>}
    </label>
  );
}

/** Entrar, criar conta, confirmar e-mail e trocar a senha, tudo na tela do app. */
function AuthScreen({ mode: startMode, blocked }) {
  const [mode, setMode] = useState(startMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const go = (m, msg = '') => { setMode(m); setError(''); setInfo(msg); setCode(''); };
  const mail = () => email.trim().toLowerCase();
  const signedIn = (r) => {
    saveTokens(fromAuthResult(r.AuthenticationResult));
    track(mode === 'signup' || mode === 'confirm' ? 'auth_signup' : 'auth_login', { method: 'email' });
    let after = '';
    try { after = sessionStorage.getItem('cm:after') || ''; sessionStorage.removeItem('cm:after'); } catch {}
    location.replace(`/${after}`);
    location.reload();
  };
  const doLogin = () => cognitoApi('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: mail(), PASSWORD: password } }).then(signedIn);
  const actions = {
    login: () => doLogin().catch(async (err) => {
      if (err.code !== 'UserNotConfirmedException') throw err;
      await cognitoApi('ResendConfirmationCode', { Username: mail() }).catch(() => {});
      go('confirm', t('auth.codeSent', { e: mail() }));
    }),
    signup: async () => {
      await cognitoApi('SignUp', { Username: mail(), Password: password, UserAttributes: [{ Name: 'email', Value: mail() }] });
      go('confirm', t('auth.codeSent', { e: mail() }));
    },
    confirm: async () => {
      await cognitoApi('ConfirmSignUp', { Username: mail(), ConfirmationCode: code });
      if (password) await doLogin(); else go('login', t('auth.confirmed'));
    },
    forgot: async () => {
      await cognitoApi('ForgotPassword', { Username: mail() });
      go('reset', t('auth.codeSent', { e: mail() }));
    },
    reset: async () => {
      await cognitoApi('ConfirmForgotPassword', { Username: mail(), ConfirmationCode: code, Password: password });
      await doLogin();
    },
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail())) { setError(t('auth.err.email')); return; }
    setBusy(true); setError('');
    try { await actions[mode](); } catch (err) { setError(authMsg(err)); }
    setBusy(false);
  };
  const resend = () => cognitoApi('ResendConfirmationCode', { Username: mail() }).then(() => go('confirm', t('auth.codeSent', { e: mail() })), (err) => setError(authMsg(err)));
  const Email = () => (
    <label className="field"><span>{t('auth.email')}</span>
      <input type="email" required autoComplete="username" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
    </label>
  );
  const Code = () => (
    <label className="field"><span>{t('auth.code')}</span>
      <input type="text" required inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
    </label>
  );
  const Submit = ({ label }) => <button className="btn primary big block" type="submit" disabled={busy}>{busy ? t('auth.wait') : label}</button>;
  const entry = mode === 'login' || mode === 'signup';
  return (
    <form className="auth" noValidate onSubmit={submit}>
      <img className="auth-logo" src="/icon.svg" alt="" width={88} height={88} />
      <h1>{t('auth.title')}</h1>
      <p className="auth-lead">{t('auth.lead')}</p>
      {guestMode && <p className="auth-info">{blocked ? t('guest.blocked') : t('guest.keep')}</p>}
      {entry && <Seg options={[['login', t('auth.login')], ['signup', t('auth.signup')]]} value={mode} onPick={(m) => go(m)} />}
      {info && <p className="auth-info">{info}</p>}
      {mode === 'login' && <>{Email()}<Password label={t('auth.password')} autoComplete="current-password" value={password} onChange={setPassword} /><Submit label={t('auth.login')} />
        <button className="link small" type="button" onClick={() => go('forgot')}>{t('auth.forgot')}</button></>}
      {mode === 'signup' && <>{Email()}<Password label={t('auth.password')} autoComplete="new-password" value={password} onChange={setPassword} /><Submit label={t('auth.signup')} />
        <p className="small muted">{t('auth.legal')} <a href="/termos.html" target="_blank">{t('legal.terms')}</a> · <a href="/privacidade.html" target="_blank">{t('legal.privacy')}</a></p></>}
      {mode === 'confirm' && <>{Code()}<Submit label={t('auth.confirm')} /><button className="link small" type="button" onClick={resend}>{t('auth.resend')}</button></>}
      {mode === 'forgot' && <><h2>{t('auth.forgotTitle')}</h2>{Email()}<Submit label={t('auth.sendCode')} /></>}
      {mode === 'reset' && <>{Code()}<Password label={t('auth.newPassword')} autoComplete="new-password" value={password} onChange={setPassword} /><Submit label={t('auth.savePassword')} /></>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!entry && <button className="link small" type="button" onClick={() => go('login')}>‹ {t('back')}</button>}
      {cfg.google && entry && <>
        <div className="auth-or"><span>{t('auth.or')}</span></div>
        <button className="btn block google-btn" type="button" onClick={() => { track('auth_google_click'); login('oauth2/authorize', { identity_provider: 'Google' }); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{GOOGLE_G.map(([c, d]) => <path key={c} d={d} fill={c} />)}</svg>{t('auth.google')}
        </button>
      </>}
      {guestMode && !blocked && <button className="link small" type="button" onClick={() => setShell({ auth: null })}>{t('guest.continue')}</button>}
    </form>
  );
}
