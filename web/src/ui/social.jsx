// Social em React: perfil (meu e de outros), amigos, ranking, seguidores, Home (feed).
import { track } from '../analytics.js';
import { useEffect, useRef, useState } from 'react';
import { fmtDate, lang, t } from '../i18n.js';
import { SWATCH } from '../color.js';
import * as S from '../stats.js';
import { $, state, toast, fail, colorName, grade, loadTokens, guestMode, api, publicApi, toCanvas, compress, upload, debounce } from '../core.js';
import { restoreScroll, render, needAccount, showAuth } from '../app.js';
import { SHARE_ICON, HOLD_COLORS } from '../game.js';
import { openSheet } from '../session.js';
import { setNav } from './climb.jsx';
import { ClimbStage, WithNav } from './photo.jsx';
import { useStore, useRedraw, Seg, Swatch, FadeImg, lqipBg } from './base.jsx';
import { Icon, LineIcon, streakSheet } from './game.jsx';
import { SettingsButton } from './shell.jsx';
import { historyUi } from './history.jsx';

const closeSheet = () => $('#sheet').close();

// ---------- pessoas ----------
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
/** Foto de perfil, ou iniciais num círculo colorido (cor estável pelo @). */
export function Avatar({ p, size = 40 }) {
  if (p?.avatarUrl) return <img className="avatar" src={p.avatarUrl} alt="" width={size} height={size} loading="lazy" style={{ '--s': `${size}px` }} />;
  const hue = [...(p?.handle ?? '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % HOLD_COLORS.length;
  return <span className="avatar" style={{ '--s': `${size}px`, background: HOLD_COLORS[hue] }}>{initials(p?.name)}</span>;
}
export const mondayIso = () => new Date(`${S.weekStart(new Date().toISOString())}T00:00:00`).toISOString();

/** Dados do login (id token): e-mail e, no Google, o nome. */
export function claims() {
  try { return JSON.parse(atob(loadTokens().id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
/** Sugestão de nome e @ para quem ainda não tem perfil. */
export function profileSuggestion() {
  const c = claims();
  const local = (c.email ?? '').split('@')[0];
  const handle = local.toLowerCase().normalize('NFD').replace(/[^a-z0-9_.]/g, '').slice(0, 20).padEnd(3, '0');
  const name = c.name || local.replace(/[._\d]+/g, ' ').trim().replace(/\w/g, (x) => x.toUpperCase()) || '';
  return { name: name.slice(0, 40), handle };
}

/** Criar ou editar o perfil (nome, @, foto). Resolve com o perfil salvo, ou null se cancelar. */
export const profileSheet = ({ welcome = false } = {}) => new Promise((resolve) => {
  const d = $('#sheet');
  // Fechar arrastando ou tocando fora também conta como cancelar.
  const onClose = () => resolve(null);
  d.addEventListener('close', onClose, { once: true });
  openSheet(<ProfileForm welcome={welcome} done={(res) => { d.removeEventListener('close', onClose); closeSheet(); resolve(res); }} />);
});

function ProfileForm({ welcome, done }) {
  const cur = state.profile;
  const sug = cur ? {} : profileSuggestion();
  const [name, setName] = useState(cur?.name ?? sug.name ?? '');
  const [handle, setHandle] = useState(cur?.handle ?? sug.handle ?? '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(cur?.avatarUrl ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const blob = file ? await compress(await toCanvas(file, 400), 0.85) : null;
      const res = await api('/profile', { method: 'PUT', body: { name, handle, ...(blob ? { avatarType: blob.type } : {}) } });
      if (res.upload) { await upload(res.upload, blob); res.avatarUrl = URL.createObjectURL(blob); }
      delete res.upload;
      track(cur ? 'profile_edited' : 'profile_created');
      state.profile = res;
      done(res);
    } catch (err) {
      const msg = err.code === 'HANDLE_TAKEN' ? t('profile.taken') : err.code === 'INVALID_HANDLE' ? t('profile.handleRule') : '';
      if (!msg) fail(err);
      setError(msg);
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={save}>
      <h2>{cur ? t('profile.edit') : welcome ? t('profile.welcome') : t('profile.create')}</h2>
      {!cur && <p className="muted">{welcome ? t('profile.welcomeLead') : t('profile.lead')}</p>}
      <label className="row avatar-pick">
        <Avatar p={{ ...cur, name, handle, avatarUrl: preview }} size={64} />
        <span className="link">{t('profile.photo')}</span>
        <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files[0]; if (f) { setFile(f); setPreview(URL.createObjectURL(f)); } }} />
      </label>
      <label className="field"><span>{t('profile.name')}</span>
        <input type="text" required maxLength={40} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field"><span>{t('profile.handle')}</span>
        <div className="handle-input"><span>@</span>
          <input type="text" required minLength={3} maxLength={20} pattern="[a-z0-9_.]{3,20}" value={handle} autoCapitalize="none" autoComplete="username" spellCheck={false}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} />
        </div>
        <span className={`small ${error ? 'error' : 'muted'}`}>{error || t('profile.handleRule')}</span>
      </label>
      <div className="row">
        <button className="btn ghost grow" type="button" onClick={() => done(null)}>{t('settings.close')}</button>
        <button className="btn primary grow" type="submit" disabled={busy}>{t('settings.save')}</button>
      </div>
    </form>
  );
}
/** Garante perfil antes de uma ação social. */
export const needProfile = async () => state.profile ?? profileSheet();

export async function pinClimb(c) {
  if (!(await needProfile())) return;
  const pinned = state.profile.pinned === c.id ? null : c.id;
  try {
    Object.assign(state.profile, { pinned: (await api('/profile', { method: 'PUT', body: { pinned } })).pinned });
    toast(pinned ? t('pin.added') : t('pin.removed'));
    render();
  } catch (err) { fail(err); }
}

/** Seguir / Seguindo (seguir sem conta ou sem perfil pede o que falta). */
export async function toggleFollow(p) {
  if (guestMode) { needAccount(); return false; }
  if (!(await needProfile())) return false;
  const on = !p.following;
  p.following = on;
  track(on ? 'follow' : 'unfollow');
  try { Object.assign(p, await api(`/users/${p.handle}/follow`, { method: on ? 'POST' : 'DELETE' })); } catch (err) { p.following = !on; fail(err); }
  return true;
}
export function FollowButton({ p, onChange, className = '' }) {
  const [, redraw] = useState(0);
  const click = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const run = toggleFollow(p);
    redraw((n) => n + 1);
    if (await run) { redraw((n) => n + 1); onChange?.(p); }
  };
  return (
    <button className={`btn small-btn ${p.following ? '' : 'primary'} ${className}`} type="button" onClick={click}>
      {p.following ? t('follow.following') : p.followsMe ? t('follow.back') : t('follow.follow')}
    </button>
  );
}

export const reasonText = (s) => (s.reason === 'followsYou' ? t('suggest.followsYou')
  : s.reason === 'sharedWithYou' ? t('suggest.shared')
    : s.reason === 'via' ? t('suggest.via', { h: s.arg ?? '' })
      : s.reason === 'gym' ? t('suggest.gym', { g: s.arg ?? '' }) : '');

const PersonRow = ({ p, sub, onOpen }) => (
  <li>
    <a className="person-row" href={`#/u/${p.handle}`} onClick={onOpen}>
      <Avatar p={p} />
      <div className="grow"><strong>{p.name}</strong><div className="muted small">{sub ?? `@${p.handle}`}</div></div>
      {!p.me && p.following !== undefined && <FollowButton p={p} />}
    </a>
  </li>
);

/** Ranking da semana e sugestões (carregado uma vez e guardado). */
export const social = { data: null, q: '', results: null };
function useSocial() {
  const redraw = useRedraw();
  useEffect(() => {
    if (state.profile && !social.data) api(`/social?since=${encodeURIComponent(mondayIso())}`).then((x) => { social.data = x; redraw(); }, () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return social.data;
}

const RankList = ({ ranking, mini = false }) => (
  <ol className={`list rank ${mini ? 'mini' : ''}`}>
    {ranking.map((p, i) => {
      const row = <>
        <span className={`pos num ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>
        <Avatar p={p} size={mini ? 32 : 40} /><strong className="grow">{p.me ? t('rank.you') : p.name}</strong>
        <span className="num xp-pill">{p.weekXp} XP</span>
      </>;
      return <li key={p.handle} className={p.me ? 'me' : undefined}>{mini ? <div className="person-row">{row}</div> : <a className="person-row" href={`#/u/${p.handle}`}>{row}</a>}</li>;
    })}
  </ol>
);

export function Friends() {
  useStore();
  const d = useSocial();
  const redraw = useRedraw();
  const me = state.profile;
  const [q, setQ] = useState(social.q);
  const search = useRef(debounce(async (v) => {
    social.results = v.length >= 2 ? await api(`/users?q=${encodeURIComponent(v)}`).catch(() => []) : null;
    redraw();
  }, 300)).current;
  const onSearch = (e) => {
    const v = e.target.value;
    const link = v.match(/(?:chalkmark|boulder)\.vsoller\.com\.br\/?(#\/(?:s|u)\/[A-Za-z0-9_.-]+)/);
    if (link) { setQ(''); social.q = ''; location.hash = link[1]; return; }
    setQ(v); social.q = v.trim(); search(social.q);
  };
  return (
    <div className="stack">
      <h1>{t('tab.ranking')}</h1>
      {!me && (
        <section className="card stack">
          <h2>{t('profile.create')}</h2><p className="muted">{t('profile.lead')}</p>
          <button className="btn primary big block" type="button" onClick={async () => { if (await profileSheet()) { social.data = null; render(); } }}>{t('profile.create')}</button>
        </section>
      )}
      <label className="field"><span>{t('friends.search')}</span>
        <input type="search" value={q} placeholder={t('friends.searchHint')} autoCapitalize="none" onChange={onSearch} />
      </label>
      {social.results && (social.results.length
        ? <ul className="list card">{social.results.map((p) => <PersonRow key={p.handle} p={p} />)}</ul>
        : <p className="muted small">{t('friends.none')}</p>)}
      {me && (
        <section className="card">
          <h2>{t('rank.title')}</h2>
          <p className="muted small">{t('rank.lead')}</p>
          {!d ? <p className="small detect-status loading">{t('friends.loading')}</p>
            : d.ranking.length > 1 ? <RankList ranking={d.ranking} /> : <p className="muted">{t('rank.empty')}</p>}
        </section>
      )}
      {me && d?.suggestions.length > 0 && (
        <section>
          <h2>{t('suggest.title')}</h2>
          <Suggestions list={d.suggestions} onFollow={() => { social.data = null; }} />
        </section>
      )}
    </div>
  );
}

/** Sugestões que a pessoa dispensou no X (não voltam a aparecer na Home). */
const HIDE = 'cm:hideSug';
const hidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDE) || '[]')); } catch { return new Set(); } };
const hide = (handle) => { try { localStorage.setItem(HIDE, JSON.stringify([...hidden(), handle].slice(-200))); } catch {} };

/** Cartões de "talvez você conheça" lado a lado (rola para o lado). `dismiss` mostra o X. */
function Suggestions({ list, onFollow, big = false, dismiss = false }) {
  const [gone, setGone] = useState(() => (dismiss ? hidden() : new Set()));
  const shown = list.filter((s) => !gone.has(s.handle));
  if (!shown.length) return null;
  return (
    <ul className={`suggest ${big ? 'big' : ''}`}>
      {shown.map((s) => (
        <li key={s.handle} className="card">
          {dismiss && <button className="sug-x" type="button" aria-label={t('suggest.hide')} onClick={() => { hide(s.handle); setGone(new Set([...gone, s.handle])); track('suggestion_hidden'); }}>×</button>}
          <a href={`#/u/${s.handle}`}><Avatar p={s} size={big ? 88 : 56} /><strong>{s.name}</strong><span className="muted small">{reasonText(s)}</span></a>
          <FollowButton p={s} onChange={onFollow} className="block" />
        </li>
      ))}
    </ul>
  );
}

/** Aba Perfil: o seu perfil (com Amigos dentro), ou o convite para criar um. */
export function Me() {
  useStore();
  if (guestMode) {
    return (
      <div className="stack">
        <h1>{t('tab.profile')}</h1>
        <section className="card stack">
          <h2>{t('guest.profileTitle')}</h2><p className="muted">{t('guest.profileLead')}</p>
          <button className="btn primary big block" type="button" onClick={() => showAuth({ mode: 'signup' })}>{t('auth.signup')}</button>
          <button className="btn block" type="button" onClick={() => showAuth({ mode: 'login' })}>{t('guest.haveAccount')}</button>
          <div className="row"><span className="grow muted small">{t('settings.title')}</span><SettingsButton /></div>
        </section>
      </div>
    );
  }
  if (state.profile) return <User handle={state.profile.handle} isTab />;
  return (
    <div className="stack">
      <h1>{t('tab.profile')}</h1>
      <section className="card stack">
        <h2>{t('profile.create')}</h2><p className="muted">{t('profile.lead')}</p>
        <button className="btn primary big block" type="button" onClick={async () => { if (await profileSheet()) render(); }}>{t('profile.create')}</button>
        <div className="row"><span className="grow muted small">{t('settings.title')}</span><SettingsButton /></div>
      </section>
    </div>
  );
}

export const STATUS_FILTERS = ['all', 'sent', 'project', 'dropped'];
const profileUi = { filter: 'all' };
export const userCache = new Map(); // perfis já abertos (as URLs das fotos valem 1 h; a volta recarrega por trás)


export function User({ handle, isTab = false }) {
  const [u, setU] = useState(() => userCache.get(handle) ?? null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState(profileUi.filter);
  const [blockConfirm, setBlockConfirm] = useState(false);
  const asked = useRef(false);
  const load = () => (guestMode ? publicApi : api)(`/users/${handle}`).then((x) => {
    userCache.set(handle, x); setU({ ...x });
    if (guestMode && !asked.current) { asked.current = true; setTimeout(needAccount, 1200); }
  }, (e) => { if (!userCache.has(handle)) setErr(e); });
  useEffect(() => { load(); }, [handle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (u) restoreScroll(); }, [u]);

  if (!u) return <div className="stack">{err ? <p className="muted">{err.status === 404 ? t('profile.notFound') : t('error.generic')}</p> : <p className="small detect-status loading">{t('friends.loading')}</p>}</div>;

  const pick = (f) => { profileUi.filter = f; setFilter(f); };
  const list = u.climbs ? u.climbs.filter((c) => filter === 'all' || (filter === 'sent' ? ['sent', 'flash'].includes(c.status) : c.status === filter)) : [];
  const block = async () => {
    if (!u.blocked && !blockConfirm) { setBlockConfirm(true); return; }
    try {
      await api(`/users/${u.handle}/block`, { method: u.blocked ? 'DELETE' : 'POST' });
      toast(u.blocked ? t('block.undone') : t('block.done', { h: u.handle }));
      social.data = null; userCache.delete(u.handle); setBlockConfirm(false); load();
    } catch (e) { fail(e); }
  };
  return (
    <div className="stack">
      {!isTab && <div className="row"><button className="link" type="button" onClick={() => history.back()}>‹ {t('back')}</button></div>}
      <section className="profile-head">
        <Avatar p={u} size={88} />
        <div className="grow">
          <h1>{u.name}</h1><div className="muted">@{u.handle}</div>
          <div className="row small num profile-counts">
            <span className="level-pill num">{t('xp.level', { n: u.level })}</span>
            <button className="link-plain" type="button" onClick={() => peopleSheet(u, 'followers')}>{t('profile.followers', { n: u.followers })}</button>{' · '}
            <button className="link-plain" type="button" onClick={() => peopleSheet(u, 'following')}>{t('profile.following', { n: u.follows })}</button>
          </div>
        </div>
      </section>
      {u.me
        ? <div className="row profile-actions"><button className="btn grow" type="button" onClick={async () => { if (await profileSheet()) load(); }}>{t('profile.edit')}</button><ShareProfileButton u={u} /><SettingsButton /></div>
        : u.blocked
          ? <p className="muted">{t('block.youBlocked')}</p>
          : (
            <div className="row">
              <FollowButton p={u} onChange={() => load()} />
              {u.friends && <span className="badge friends">{t('follow.friends')}</span>}
              <span className="grow" /><ShareProfileButton u={u} />
            </div>
          )}
      {u.me && (
        <a className="card row progress-link" href="#/progress">
          <span className="ico-wrap"><LineIcon d="M4 19h16M6 16l4-5 3 3 5-7" /></span>
          <div className="grow"><strong>{t('tab.progress')}</strong><div className="muted small">{t('profile.progressLead')}</div></div>
          <span className="muted">›</span>
        </a>
      )}

      <section className="card stack pinned">
        <h2>{t('pin.title')}</h2>
        {u.pinned
          ? <>
            <button className="row pinned-head" type="button" onClick={() => openPinned(u)}>
              <Swatch c={u.pinned.color} /><strong>{colorName(u.pinned.color)}</strong><span className="grade-pill">{grade(u.pinned.grade)}</span>
              <span className="grow" /><span className={`badge ${u.pinned.sent ? 'sent' : 'project'}`}>{u.pinned.sent ? t('pin.sent') : t('result.project')}</span><span className="muted">›</span>
            </button>
            {u.pinned.photoUrl && <ClimbStage c={u.pinned} url={u.pinned.photoUrl} onOpen={() => openPinned(u)} />}
            {u.pinned.tries > 1 && <p className="muted small">{t('pin.tries', { n: u.pinned.tries })}</p>}
            {!u.me && u.friends && <TryButton u={u} c={u.pinned} />}
          </>
          : <p className="muted">{u.me ? t('pin.emptyMe') : t('pin.empty')}</p>}
      </section>

      {u.stats
        ? <>
          <div className="kpis">
            {[[u.stats.sessions, t('profile.sessions'), () => { Object.assign(historyUi, { tab: 'sessions', day: null }); location.hash = '#/history'; }],
              [u.stats.sends, t('profile.sends'), () => { Object.assign(historyUi, { tab: 'gallery', result: '', color: '' }); location.hash = '#/history'; }],
              [u.stats.maxGrade == null ? '—' : grade(u.stats.maxGrade), t('profile.max'), () => { location.hash = '#/progress'; }],
              [u.stats.streak, t('streak.weeks'), streakSheet]]
              .map(([v, l, go]) => (u.me
                ? <button key={l} type="button" className="kpi kpi-link" onClick={go}><b>{v}</b><span>{l} ›</span></button>
                : <div key={l} className="kpi"><b>{v}</b><span>{l}</span></div>))}
          </div>
          <h2>{t('profile.history')}</h2>
          {u.climbs.length > 0 && <Seg options={STATUS_FILTERS.map((f) => [f, t(`status.filter.${f}`)])} value={filter} onPick={pick} />}
          {list.length
            ? (
              <div className="gallery">
                {list.map((c) => (
                  <button key={c.id} type="button" style={lqipBg(c)} onClick={() => { setNav(list.map((x) => x.id)); if (u.me) location.hash = `#/climb/${c.id}`; else friendClimbSheet(u, c, list); }}>
                    <FadeImg src={c.thumbUrl} alt={`${colorName(c.color)} ${grade(c.grade)}`} width={200} height={200} />
                    {c.status && <span className={`status-tag s-${c.status}`}>{t(`status.${c.status}`)}</span>}
                    <span className="tag"><Swatch c={c.color} />{grade(c.grade)}</span>
                  </button>
                ))}
              </div>
            )
            : <p className="muted">{t('history.empty')}</p>}
        </>
        : <section className="card locked"><Icon kind="lock" /><p>{u.following ? t('profile.lockedBack') : t('profile.locked')}</p></section>}
      {!u.me && !guestMode && (
        <button className="link small danger-link block-link" type="button" onClick={block}>
          {u.blocked ? t('block.undo', { h: u.handle }) : blockConfirm ? t('block.confirm', { h: u.handle }) : t('block.button', { h: u.handle })}
        </button>
      )}
    </div>
  );
}

/** Link do perfil (abre o perfil depois do login, se preciso). */
export function ShareProfileButton({ u }) {
  const share = async () => {
    const url = `${location.origin}/#/u/${u.handle}`;
    const text = u.me ? t('profile.shareMine', { h: u.handle }) : t('profile.shareOther', { n: u.name });
    if (navigator.share) { navigator.share({ title: 'Chalkmark', text, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(url); toast(t('share.copied')); } catch { toast(url); }
  };
  return <button className="btn share-btn" type="button" aria-label={t('profile.share')} onClick={share}><LineIcon d={SHARE_ICON} /><span>{t('profile.share')}</span></button>;
}

/** Abre o boulder fixado: o meu na tela completa; o de outra pessoa na janela (com "Quero tentar"). */
export function openPinned(u) {
  if (u.me) { setNav([u.pinned.id]); location.hash = `#/climb/${u.pinned.id}`; } else friendClimbSheet(u, u.pinned);
}

/** "Quero tentar": copia o boulder do amigo para os seus projetos. */
export function TryButton({ u, c }) {
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    if (guestMode) { needAccount(); return; }
    setBusy(true);
    try {
      const climb = await api(`/users/${u.handle}/climbs/${c.id}/copy`, { method: 'POST' });
      track('friend_climb_copied');
      state.climbs.push(climb);
      toast(t('share.added'));
      if ($('#sheet').open) closeSheet();
      location.hash = `#/climb/${climb.id}`;
    } catch (err) { fail(err); setBusy(false); }
  };
  return <button className="btn go block" type="button" disabled={busy} onClick={copy}>{t('friends.try')}</button>;
}

/** Boulder de outra pessoa numa janela, com ‹ › para passar pelos outros da lista. */
export function friendClimbSheet(u, c, list = [c]) {
  const i = list.indexOf(c);
  const go = (d) => list[i + d] && friendClimbSheet(u, list[i + d], list);
  openSheet(
    <div className="stack">
      <h2 className="row"><Swatch c={c.color} />{colorName(c.color)}<span className="grade-pill">{grade(c.grade)}</span><span className="grow" /><span className={`badge ${c.result}`}>{t(`result.${c.result}`)}</span></h2>
      {c.photoUrl && <WithNav hasPrev={i > 0} hasNext={i < list.length - 1} go={go}><ClimbStage key={c.id} url={c.photoUrl} c={c} /></WithNav>}
      <p className="muted small">{fmtDate(c.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      {!u.me && <TryButton u={u} c={c} />}
      <button className="btn ghost block" type="button" onClick={closeSheet}>{t('settings.close')}</button>
    </div>,
  );
}

/** Lista de seguidores / seguindo (como no Instagram). */
export function peopleSheet(u, type) {
  openSheet(<People u={u} type={type} />);
}
function People({ u, type }) {
  const [kind, setKind] = useState(type);
  const [people, setPeople] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setPeople(null); setErr(null);
    api(`/users/${u.handle}/people?type=${kind}`).then(setPeople, setErr);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <Seg options={[['followers', t('profile.followers', { n: u.followers })], ['following', t('profile.following', { n: u.follows })]]} value={kind} onPick={setKind} />
      {err
        ? <p className="muted">{err.status === 403 ? t('people.private') : t('error.generic')}</p>
        : !people
          ? <p className="small detect-status loading">{t('friends.loading')}</p>
          : people.length
            ? <ul className="list">{people.map((p) => <PersonRow key={p.handle} p={p} onOpen={closeSheet} />)}</ul>
            : <p className="muted">{kind === 'followers' ? t('people.noFollowers') : t('people.noFollowing')}</p>}
      <button className="btn ghost block" type="button" onClick={closeSheet}>{t('settings.close')}</button>
    </div>
  );
}

// ---------- Home (feed) ----------
export const relTime = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), 'day');
  return fmtDate(iso, { day: 'numeric', month: 'short' });
};
export const feed = { items: [], next: undefined, loading: false, friends: null };
const feedLine = (c) => t(c.result === 'project' ? 'feed.project' : c.projectSend ? 'feed.projectSend' : c.result === 'flash' ? 'feed.flash' : 'feed.sent',
  { c: colorName(c.color).toLowerCase(), g: grade(c.grade) });

function FireButton({ c }) {
  const [, redraw] = useState(0);
  const click = async () => {
    const on = !c.fired;
    Object.assign(c, { fired: on, fire: c.fire + (on ? 1 : -1) });
    track(on ? 'fire' : 'unfire');
    redraw((n) => n + 1);
      try { Object.assign(c, await api(`/feed/${c.owner.handle}/${c.id}/fire`, { method: on ? 'POST' : 'DELETE' })); } catch (err) { fail(err); }
    redraw((n) => n + 1);
  };
  return <button className={`btn small-btn fire-btn ${c.fired ? 'on' : ''}`} type="button" aria-pressed={String(!!c.fired)} onClick={click}>🔥<span>{c.fire ? ` ${c.fire}` : ''}</span></button>;
}

function FeedCard({ c }) {
  const owner = { handle: c.owner.handle, name: c.owner.name, me: false, friends: true };
  const open = () => friendClimbSheet(owner, { ...c, id: c.rootId });
  return (
    <article className="card feed-card">
      <div className="row feed-head">
        <a href={`#/u/${c.owner.handle}`}><Avatar p={c.owner} /></a>
        <div className="grow">
          <div><a href={`#/u/${c.owner.handle}`} className="name-link"><strong>{c.owner.name}</strong></a> <span>{feedLine(c)}</span></div>
          <div className="muted small">{relTime(c.createdAt)}</div>
        </div>
        <span className={`badge ${c.result}`}>{t(`result.${c.result}`)}</span>
      </div>
      {c.photoUrl
        ? <ClimbStage c={c} url={c.photoUrl} onOpen={open} />
        : <div className="feed-color" style={{ background: SWATCH[c.color] ?? 'var(--surface-2)' }}><span>{grade(c.grade)}</span></div>}
      <div className="row feed-actions">
        <FireButton c={c} /><span className="grow" />
        <button className="link small" type="button" onClick={open}>{t('friends.try')}</button>
      </div>
    </article>
  );
}

/** Pessoas para seguir, intercaladas na Home. */
/** Retângulo "Talvez você conheça" entre os posts (como no Instagram). `n` gira a lista a cada vez que aparece. */
function FollowCard({ n = 0 }) {
  const all = (social.data?.suggestions ?? []).filter((s) => !hidden().has(s.handle));
  if (!all.length) return null;
  const k = (n * 4) % all.length;
  const list = [...all.slice(k), ...all.slice(0, k)].slice(0, 8);
  return (
    <section className="card stack suggest-card">
      <div className="row"><h2 className="grow">{t('suggest.title')}</h2><a className="link small" href="#/friends">{t('suggest.all')}</a></div>
      <Suggestions list={list} big dismiss />
    </section>
  );
}

/** Fim da Home (ou Home vazia): achar amigos ou registrar um boulder. */
const LookingCard = () => (
  <section className="card stack">
    <h2>{t('feed.lookingTitle')}</h2>
    <a className="btn block" href="#/friends">🔎 {t('feed.find')}</a>
    <button className="btn block" type="button" onClick={() => $('#cam-input').click()}>📷 {t('feed.log')}</button>
  </section>
);

export function Feed() {
  useStore();
  if (guestMode) {
    return (
      <div className="stack">
        <h1>Chalkmark</h1>
        <section className="card stack">
          <h2>{t('feed.guestTitle')}</h2><p className="muted">{t('feed.guestLead')}</p>
          <button className="btn primary block" type="button" onClick={() => showAuth({ mode: 'signup' })}>{t('auth.signup')}</button>
        </section>
        <LookingCard />
      </div>
    );
  }
  return <FeedList />;
}

function FeedList() {
  const redraw = useRedraw();
  useSocial();
  const sentinel = useRef(null);
  const load = async () => {
    if (feed.loading || feed.next === null) return;
    feed.loading = true; redraw();
    try {
      const qs = feed.next ? `?before=${encodeURIComponent(feed.next)}` : '';
      const r = await api(`/feed${qs}`);
      feed.items.push(...r.items); feed.next = r.next; feed.friends = r.friends;
    } catch (err) { fail(err); feed.next = null; }
    feed.loading = false; redraw();
  };
  useEffect(() => {
    // Ao voltar para a aba, recomeça do topo com o que for novo.
    feed.items = []; feed.next = undefined; feed.loading = false;
    load();
    // Rolagem infinita: carrega a próxima página quando o fim aparece.
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) load(); }, { rootMargin: '600px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = feed.next === null && !feed.items.length;
  return (
    <div className="stack">
      <h1>Chalkmark</h1>
      <div className="stack">
        {/* "Talvez você conheça" a cada 8 posts (depois do 4º, 12º, 20º…). */}
        {feed.items.map((c, i) => [<FeedCard key={c.id} c={c} />, i % 8 === 3 && <FollowCard key={`fc${i}`} n={Math.floor(i / 8)} />])}
        {empty && <>
          <section className="card stack">
            <h2>{t('feed.emptyTitle')}</h2><p className="muted">{feed.friends ? t('feed.emptyFriends') : t('feed.emptyLead')}</p>
            <a className="btn primary block" href="#/friends">{t('feed.find')}</a>
          </section>
          <FollowCard />
        </>}
        {feed.next === null && <LookingCard />}
        {feed.items.length > 0 && feed.items.length < 5 && <FollowCard />}
        {feed.loading && <p className="small detect-status loading">{t('friends.loading')}</p>}
        {feed.next === null && feed.items.length > 0 && <p className="muted small center">{t('feed.end')}</p>}
      </div>
      <div className="feed-sentinel" ref={sentinel} />
    </div>
  );
}
