// Social: perfil, amigos, ranking, seguidores e a Home (feed).
import { restoreScroll, render, needAccount, showAuth } from './app.js';
import { fmtDate, lang, t } from './i18n.js';
import { suggest, SWATCH } from './color.js';
import { playTick } from './sound.js';
import * as S from './stats.js';
import { $, state, h, fill, toast, fail, colorName, grade, swatch, seg, loadTokens, login, guestMode, api, publicApi, toCanvas, compress, upload } from './core.js';
import { SHARE_ICON, lineIcon, HOLD_COLORS, icon } from './game.js';
import { openSheet } from './session.js';
import { debounce, lqipStyle, peopleSheet, setNav, withNav, climbStage } from './climb.js';

// ---------- social: perfil, amigos, ranking ----------
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
/** Foto de perfil, ou iniciais num círculo colorido (cor estável pelo @). */
export function avatar(p, size = 40) {
  if (p?.avatarUrl) return h('img', { class: 'avatar', src: p.avatarUrl, alt: '', width: size, height: size, loading: 'lazy', style: { '--s': `${size}px` } });
  const hue = [...(p?.handle ?? '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % HOLD_COLORS.length;
  return h('span', { class: 'avatar', style: { '--s': `${size}px`, background: HOLD_COLORS[hue] } }, initials(p?.name));
}
export const mondayIso = () => new Date(`${S.weekStart(new Date().toISOString())}T00:00:00`).toISOString();

/** Criar ou editar o perfil (nome, @, foto). Resolve com o perfil salvo, ou null se cancelar. */
/** Dados do login (id token): e-mail e, no Google, o nome. */
export function claims() {
  try { return JSON.parse(atob(loadTokens().id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
/** Sugestão de nome e @ para quem ainda não tem perfil. */
export function profileSuggestion() {
  const c = claims();
  const local = (c.email ?? '').split('@')[0];
  const handle = local.toLowerCase().normalize('NFD').replace(/[^a-z0-9_.]/g, '').slice(0, 20).padEnd(3, '0');
  const name = c.name || local.replace(/[._\d]+/g, ' ').trim().replace(/\w/g, (x) => x.toUpperCase()) || '';
  return { name: name.slice(0, 40), handle };
}

export function profileSheet({ welcome = false } = {}) {
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
export const needProfile = async () => state.profile ?? profileSheet();

export async function pinClimb(c) {
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
export function followButton(p, onChange) {
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

export const reasonText = (s) => (s.reason === 'followsYou' ? t('suggest.followsYou')
  : s.reason === 'sharedWithYou' ? t('suggest.shared')
    : s.reason === 'via' ? t('suggest.via', { h: s.arg ?? '' })
      : s.reason === 'gym' ? t('suggest.gym', { g: s.arg ?? '' }) : '');

export const social = { data: null, q: '', results: null };
export function viewFriends() {
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
        h('input', { type: 'search', value: social.q, placeholder: t('friends.searchHint'), autocapitalize: 'none', oninput: (e) => {
          const link = e.target.value.match(/(?:chalkmark|boulder)\.vsoller\.com\.br\/?(#\/(?:s|u)\/[A-Za-z0-9_.-]+)/);
          if (link) { e.target.value = ''; social.q = ''; location.hash = link[1]; return; }
          social.q = e.target.value.trim(); search(social.q);
        } })),
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
export function viewMe() {
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
export function friendsCard() {
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

export const STATUS_FILTERS = ['all', 'sent', 'project', 'dropped'];
export let profileFilter = 'all';
export const userCache = new Map(); // perfis já abertos (as URLs das fotos valem 1 h; a volta recarrega por trás)

export function viewUser(handle, isTab = false) {
  const box = h('div', { class: 'stack' }, h('p', { class: 'small detect-status loading' }, t('friends.loading')));
  const draw = (u) => fill(box,
    !isTab && h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => history.back() }, `‹ ${t('back')}`)),
    h('section', { class: 'profile-head' },
      avatar(u, 88),
      h('div', { class: 'grow' },
        h('h1', {}, u.name), h('div', { class: 'muted' }, `@${u.handle}`),
        h('div', { class: 'row small num profile-counts' },
          h('span', { class: 'level-pill num' }, t('xp.level', { n: u.level })),
          h('button', { class: 'link-plain', type: 'button', onclick: () => peopleSheet(u, 'followers') }, t('profile.followers', { n: u.followers })), ' · ',
          h('button', { class: 'link-plain', type: 'button', onclick: () => peopleSheet(u, 'following') }, t('profile.following', { n: u.follows }))))),
    u.me
      ? h('div', { class: 'row' },
        h('button', { class: 'btn grow', type: 'button', onclick: async () => { if (await profileSheet()) load(); } }, t('profile.edit')),
        shareProfileButton(u))
      : u.blocked
        ? h('p', { class: 'muted' }, t('block.youBlocked'))
        : h('div', { class: 'row' }, followButton(u, () => load()), u.friends && h('span', { class: 'badge friends' }, t('follow.friends')),
          h('span', { class: 'grow' }), shareProfileButton(u)),
    u.me && friendsCard(),
    u.me && h('a', { class: 'card row progress-link', href: '#/progress' }, h('span', { class: 'ico-wrap' }, lineIcon('M4 19h16M6 16l4-5 3 3 5-7')),
      h('div', { class: 'grow' }, h('strong', {}, t('tab.progress')), h('div', { class: 'muted small' }, t('profile.progressLead'))), h('span', { class: 'muted' }, '›')),

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
            ? h('div', { class: 'gallery' }, list.map((c) => h('button', { type: 'button', style: lqipStyle(c), onclick: () => { setNav(list.map((x) => x.id)); if (u.me) location.hash = `#/climb/${c.id}`; else friendClimbSheet(u, c, list); } },
              h('img', { src: c.thumbUrl, alt: `${colorName(c.color)} ${grade(c.grade)}`, loading: 'lazy', decoding: 'async', width: 200, height: 200, class: 'fade', onload: (e) => e.target.classList.add('in'), onerror: (e) => e.target.remove() }),
              c.status && h('span', { class: `status-tag s-${c.status}` }, t(`status.${c.status}`)),
              h('span', { class: 'tag' }, swatch(c.color), grade(c.grade)))))
            : h('p', { class: 'muted' }, t('history.empty'));
        })(),
      ]
      : h('section', { class: 'card locked' }, icon('lock'), h('p', {}, u.following ? t('profile.lockedBack') : t('profile.locked'))),
    !u.me && !guestMode && h('button', {
      class: 'link small danger-link block-link', type: 'button',
      onclick: async (e) => {
        const b = e.currentTarget;
        if (!u.blocked && !b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = t('block.confirm', { h: u.handle }); return; }
        b.disabled = true;
        try {
          await api(`/users/${u.handle}/block`, { method: u.blocked ? 'DELETE' : 'POST' });
          toast(u.blocked ? t('block.undone') : t('block.done', { h: u.handle }));
          social.data = null; userCache.delete(u.handle); load();
        } catch (err) { fail(err); b.disabled = false; }
      },
    }, u.blocked ? t('block.undo', { h: u.handle }) : t('block.button', { h: u.handle })),
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
export function shareProfileButton(u) {
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
export function openPinned(u) {
  if (u.me) { setNav([u.pinned.id]); location.hash = `#/climb/${u.pinned.id}`; } else friendClimbSheet(u, u.pinned);
}

/** "Quero tentar": copia o boulder do amigo para os seus projetos. */
export function tryButton(u, c) {
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

export function friendClimbSheet(u, c, list = [c]) {
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

// ---------- tela: feed ----------
export const relTime = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), 'day');
  return fmtDate(iso, { day: 'numeric', month: 'short' });
};
export const feed = { items: [], next: undefined, loading: false, friends: null };
export const feedLine = (c) => t(c.result === 'project' ? 'feed.project' : c.projectSend ? 'feed.projectSend' : c.result === 'flash' ? 'feed.flash' : 'feed.sent',
  { c: colorName(c.color).toLowerCase(), g: grade(c.grade) });

export function feedCard(c) {
  const fireBtn = h('button', {
    class: `btn small-btn fire-btn ${c.fired ? 'on' : ''}`, type: 'button', 'aria-pressed': String(!!c.fired),
    onclick: async (e) => {
      const b = e.currentTarget;
      const on = !c.fired;
      Object.assign(c, { fired: on, fire: c.fire + (on ? 1 : -1) });
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.lastChild.textContent = c.fire ? ` ${c.fire}` : '';
      if (on) playTick();
      try { Object.assign(c, await api(`/feed/${c.owner.handle}/${c.id}/fire`, { method: on ? 'POST' : 'DELETE' })); } catch (err) { fail(err); }
    },
  }, '🔥', h('span', {}, c.fire ? ` ${c.fire}` : ''));
  return h('article', { class: 'card feed-card' },
    h('div', { class: 'row feed-head' },
      h('a', { href: `#/u/${c.owner.handle}` }, avatar(c.owner, 40)),
      h('div', { class: 'grow' },
        h('div', {}, h('a', { href: `#/u/${c.owner.handle}`, class: 'name-link' }, h('strong', {}, c.owner.name)), ' ', h('span', {}, feedLine(c))),
        h('div', { class: 'muted small' }, relTime(c.createdAt))),
      h('span', { class: `badge ${c.result}` }, t(`result.${c.result}`))),
    c.photoUrl
      ? climbStage(c.photoUrl, c, () => friendClimbSheet({ handle: c.owner.handle, name: c.owner.name, me: false, friends: true }, { ...c, id: c.rootId }))
      : h('div', { class: 'feed-color', style: { background: SWATCH[c.color] ?? 'var(--surface-2)' } }, h('span', {}, grade(c.grade))),
    h('div', { class: 'row feed-actions' }, fireBtn, h('span', { class: 'grow' }),
      h('button', { class: 'link small', type: 'button', onclick: () => friendClimbSheet({ handle: c.owner.handle, name: c.owner.name, me: false, friends: true }, { ...c, id: c.rootId }) }, t('friends.try'))));
}

/** Pessoas para seguir, intercaladas no feed (sugestões do /social). */
export function followCard() {
  const s = social.data?.suggestions ?? [];
  if (!s.length) return null;
  return h('section', { class: 'card stack' }, h('h2', {}, t('suggest.title')),
    h('ul', { class: 'suggest' }, s.slice(0, 8).map((p) => h('li', { class: 'card' },
      h('a', { href: `#/u/${p.handle}` }, avatar(p, 56), h('strong', {}, p.name), h('span', { class: 'muted small' }, reasonText(p))),
      followButton(p, () => { social.data = null; feed.items = []; feed.next = undefined; })))));
}

/** Fim da Home (ou Home vazia): achar amigos ou registrar um boulder. */
export const lookingCard = () => h('section', { class: 'card stack' },
  h('h2', {}, t('feed.lookingTitle')),
  h('a', { class: 'btn block', href: '#/friends' }, '🔎 ', t('feed.find')),
  h('button', { class: 'btn block', type: 'button', onclick: () => $('#cam-input').click() }, '📷 ', t('feed.log')));

export function viewFeed() {
  const box = h('div', { class: 'stack' });
  const list = h('div', { class: 'stack' });
  const sentinel = h('div', { class: 'feed-sentinel' });
  const draw = () => {
    const empty = feed.next === null && !feed.items.length;
    fill(list,
      feed.items.flatMap((c, i) => [feedCard(c), i === 4 && followCard()]),
      empty && [
        h('section', { class: 'card stack' }, h('h2', {}, t('feed.emptyTitle')), h('p', { class: 'muted' }, feed.friends ? t('feed.emptyFriends') : t('feed.emptyLead')),
          h('a', { class: 'btn primary block', href: '#/friends' }, t('feed.find'))),
        followCard(),
      ],
      feed.next === null && lookingCard(),
      feed.items.length > 0 && feed.items.length < 5 && followCard(),
      feed.loading && h('p', { class: 'small detect-status loading' }, t('friends.loading')),
      feed.next === null && feed.items.length > 0 && h('p', { class: 'muted small center' }, t('feed.end')));
  };
  const load = async () => {
    if (feed.loading || feed.next === null) return;
    feed.loading = true; draw();
    try {
      const qs = feed.next ? `?before=${encodeURIComponent(feed.next)}` : '';
      const r = await api(`/feed${qs}`);
      feed.items.push(...r.items); feed.next = r.next; feed.friends = r.friends;
    } catch (err) { fail(err); feed.next = null; }
    feed.loading = false; draw();
  };
  if (guestMode) {
    fill(box, h('h1', {}, 'Chalkmark'),
      h('section', { class: 'card stack' }, h('h2', {}, t('feed.guestTitle')), h('p', { class: 'muted' }, t('feed.guestLead')),
        h('button', { class: 'btn primary block', type: 'button', onclick: () => showAuth({ mode: 'signup' }) }, t('auth.signup'))),
      lookingCard());
    return box;
  }
  fill(box, h('h1', {}, 'Chalkmark'), list, sentinel);
  // Rolagem infinita: carrega a próxima página quando o fim aparece.
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) load(); }, { rootMargin: '600px' });
  io.observe(sentinel);
  if (!social.data) api(`/social?since=${encodeURIComponent(mondayIso())}`).then((x) => { social.data = x; draw(); }, () => {});
  // Ao voltar para a aba, recomeça do topo com o que for novo.
  feed.items = []; feed.next = undefined;
  draw(); load();
  return box;
}
