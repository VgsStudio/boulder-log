// Histórico (calendário, sessões, galeria) e Evolução.
import { fmtDate, fmtPct, lang, t } from './i18n.js';
import { COLORS } from './color.js';
import * as S from './stats.js';
import { RESULTS, $, state, h, fill, svg, sessionsText, colorName, grade, swatch, seg, climbRow } from './core.js';
import { hold, hero, gradePathCard, achievementsCard } from './game.js';
import { sessionHeader } from './session.js';
import { capitalize, lqipStyle, setNav } from './climb.js';
import { settingsSheet } from './settings.js';

// ---------- tela: histórico (calendário + sessões + galeria) ----------
export const historyUi = { month: null, day: null, tab: 'sessions', color: '', result: '' };

export function viewHistory() {
  const box = h('div', { class: 'stack' });
  const now = new Date();
  historyUi.month ??= new Date(now.getFullYear(), now.getMonth(), 1);

  const draw = () => {
    const m = historyUi.month;
    const days = S.climbingDays(state.sessions, m.getFullYear(), m.getMonth());
    const first = (m.getDay() + 6) % 7; // segunda = 0
    const total = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const isThisMonth = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth();
    const wd = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));
    const shift = (n) => { historyUi.month = new Date(m.getFullYear(), m.getMonth() + n, 1); historyUi.day = null; draw(); };

    let summaries = S.sessionSummaries(state.sessions, state.climbs);
    if (historyUi.day) summaries = summaries.filter((s) => {
      const d = new Date(s.startedAt);
      return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth() && d.getDate() === historyUi.day;
    });
    const gallery = state.climbs
      .filter((c) => c.thumbUrl && (!historyUi.color || c.color === historyUi.color) && (!historyUi.result || c.result === historyUi.result))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    fill(box, 
      h('h1', {}, t('tab.history')),
      h('section', { class: 'card' },
        h('div', { class: 'cal-head' },
          h('button', { type: 'button', 'aria-label': '‹', onclick: () => shift(-1) }, '‹'),
          h('div', { class: 'center' },
            h('strong', {}, capitalize(fmtDate(m, { month: 'long', year: 'numeric' }))),
            h('div', { class: 'muted small' }, t('calendar.days', { n: days.size }))),
          h('button', { type: 'button', 'aria-label': '›', onclick: () => shift(1), disabled: isThisMonth }, '›')),
        h('div', { class: 'cal', role: 'grid', 'aria-label': t('calendar.title') },
          wd.map((w) => h('span', { class: 'wd' }, w)),
          [...Array(first)].map(() => h('span')),
          [...Array(total)].map((_, i) => {
            const day = i + 1;
            const on = days.get(day);
            const cls = [on && 'on', on?.length > 1 && 'multi', historyUi.day === day && 'sel', isThisMonth && day === now.getDate() && 'today'].filter(Boolean).join(' ');
            return h('button', {
              type: 'button', class: cls, disabled: !on, 'aria-pressed': on ? String(historyUi.day === day) : null,
              onclick: () => { historyUi.day = historyUi.day === day ? null : day; historyUi.tab = 'sessions'; draw(); },
            }, String(day));
          }))),

      seg([['sessions', t('history.sessions')], ['gallery', t('history.gallery')]], historyUi.tab, (v) => { historyUi.tab = v; draw(); }),

      historyUi.tab === 'sessions'
        ? (summaries.length
          ? h('ul', { class: 'list card' }, summaries.map((s) => h('li', {}, h('details', { class: 'session', open: summaries.length === 1 },
            h('summary', {}, h('div', { class: 'grow' }, sessionHeader(s))),
            h('ul', { class: 'list', onclick: () => setNav(summaries.flatMap((x) => state.climbs.filter((c) => c.sessionId === x.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => c.id))) },
              state.climbs.filter((c) => c.sessionId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(climbRow))))))
          : h('p', { class: 'muted' }, t('history.empty')))
        : h('section', {},
          h('div', { class: 'row' },
            h('select', { class: 'grow', 'aria-label': t('climb.color'), onchange: (e) => { historyUi.color = e.target.value; draw(); } },
              h('option', { value: '' }, `${t('climb.color')}: ${t('history.all')}`),
              COLORS.map((c) => h('option', { value: c, selected: historyUi.color === c }, colorName(c)))),
            h('select', { class: 'grow', 'aria-label': t('climb.result'), onchange: (e) => { historyUi.result = e.target.value; draw(); } },
              h('option', { value: '' }, `${t('climb.result')}: ${t('history.all')}`),
              RESULTS.map((r) => h('option', { value: r, selected: historyUi.result === r }, t(`result.${r}`))))),
          h('div', { class: 'gallery' }, gallery.map((c) => h('a', { href: `#/climb/${c.id}`, style: lqipStyle(c), onclick: () => setNav(gallery.map((x) => x.id)) },
            h('img', { src: c.thumbUrl, alt: `${colorName(c.color)} ${grade(c.grade)}`, loading: 'lazy', decoding: 'async', width: 200, height: 200, class: 'fade', onload: (e) => e.target.classList.add('in'), onerror: (e) => e.target.remove() }),
            h('span', { class: 'tag' }, swatch(c.color), grade(c.grade)))))),
    );
  };
  draw();
  return box;
}

// ---------- tela: evolução ----------
export function goalsCard() {
  const { weeklySessions, gradeGoal } = state.settings;
  if (!weeklySessions && gradeGoal == null) {
    return h('button', { class: 'link', type: 'button', onclick: settingsSheet }, `+ ${t('goal.set')}`);
  }
  const n = S.sessionsThisWeek(state.sessions);
  const reached = S.goalReachedAt(state.climbs, gradeGoal);
  const best = Math.max(-1, ...state.climbs.filter(S.isSend).map((c) => c.grade));
  return h('section', { class: 'card stack' },
    weeklySessions > 0 && h('div', {},
      h('div', { class: 'session-head' }, h('strong', {}, t('goal.week')), h('span', { class: 'num muted' }, t('goal.weekProgress', { n, g: weeklySessions }))),
      h('div', { class: 'progress' }, h('span', { style: { '--w': `${Math.min(100, (n / weeklySessions) * 100)}%` } }))),
    gradeGoal != null && h('div', {},
      h('div', { class: 'session-head' }, h('strong', {}, `${t('goal.grade')}: ${grade(gradeGoal)}`),
        h('span', { class: 'num muted' }, reached ? t('goal.gradeDone', { d: fmtDate(reached) }) : best >= 0 ? t('goal.gradeBest', { g: grade(best) }) : '')),
      h('div', { class: 'progress' }, h('span', { style: { '--w': `${reached ? 100 : Math.max(0, ((best + 1) / (gradeGoal + 1)) * 100)}%` } }))));
}

export function viewProgress() {
  if (!state.climbs.length) return h('div', { class: 'stack' }, h('h1', {}, t('tab.progress')), hero(), gradePathCard(), goalsCard(), h('p', { class: 'muted' }, t('progress.empty')));
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const recent = state.climbs.filter((c) => c.createdAt >= since);
  const recentSends = recent.filter(S.isSend);
  const weekly = S.weeklyGrades(state.climbs).slice(-12);
  const volume = S.sessionSummaries(state.sessions, state.climbs).slice(0, 12).reverse();
  const pyr = S.pyramid(state.climbs);
  const open = S.projects(state.climbs).filter(S.isOpenProject);
  const styles = S.styleStats(state.climbs);

  const kpi = (value, label) => h('div', { class: 'kpi' }, h('b', {}, value), h('span', {}, label));
  const maxVol = Math.max(1, ...volume.map((s) => s.climbs));
  const maxPyr = Math.max(1, ...pyr.map((p) => p.sends));
  const maxStyle = Math.max(1, ...styles.map((s) => s.sends + s.projects));
  const styleLabel = (key) => { const [kind, v] = key.split(':'); return t(`${kind === 'hold' ? 'hold' : 'angle'}.${v}`); };

  return h('div', { class: 'stack' },
    h('h1', {}, t('tab.progress')),
    hero(),
    gradePathCard(),
    achievementsCard(),
    goalsCard(),
    h('div', { class: 'kpis' },
      kpi(recentSends.length ? grade(Math.max(...recentSends.map((c) => c.grade))) : '—', t('progress.max')),
      kpi(String(state.sessions.filter((s) => s.startedAt >= since).length), t('progress.sessions')),
      kpi(fmtPct(S.flashRate(state.climbs)), t('progress.flash')),
      kpi(String(S.streakWeeks(state.sessions)), t('progress.streak'))),

    weekly.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.weekly')), lineChart(weekly),
      h('div', { class: 'legend' }, h('span', {}, h('i'), t('progress.weeklyMax')), h('span', {}, h('i', { class: 'med' }), t('progress.weeklyMedian')))),

    volume.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.volume')),
      h('div', { class: 'bars-v', role: 'img', 'aria-label': t('progress.volume') }, volume.map((s) =>
        h('div', {}, h('span', { class: 'num' }, String(s.climbs)), h('span', { class: 'fill', style: { '--h': `${(s.climbs / maxVol) * 100}%` } }),
          h('span', {}, fmtDate(s.startedAt, { day: 'numeric', month: 'numeric' })))))),

    pyr.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.pyramid')),
      h('div', { class: 'bars-h' }, pyr.map((p) => h('div', {},
        h('strong', { class: 'num' }, grade(p.grade)),
        h('div', { class: 'track', title: `${p.flashes} flash` },
          h('span', { class: 'fill accent', style: { '--w': `${(p.flashes / maxPyr) * 100}%` } }),
          h('span', { class: 'fill', style: { '--w': `${((p.sends - p.flashes) / maxPyr) * 100}%` } })),
        h('span', { class: 'num muted' }, String(p.sends))))),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'flash-i' }), t('result.flash')), h('span', {}, h('i', { class: 'sent-i' }), t('result.sent')))),

    h('section', { class: 'card' }, h('h2', {}, t('progress.projects')),
      open.length
        ? h('ul', { class: 'list' }, open.map((p) => climbRowProject(p)))
        : h('p', { class: 'muted' }, t('progress.noProjects'))),

    styles.length > 0 && h('section', { class: 'card' }, h('h2', {}, t('progress.styles')),
      h('p', { class: 'muted small' }, t('progress.stylesHint')),
      S.analyzedCount(state.climbs) < S.STYLE_MIN && h('p', { class: 'small style-early' }, t('progress.stylesEarly', { n: S.analyzedCount(state.climbs), m: S.STYLE_MIN })),
      h('div', { class: 'bars-h styles' }, styles.slice(0, 10).map((s) => h('div', {},
        h('span', {}, styleLabel(s.key)),
        h('div', { class: 'track' },
          h('span', { class: 'fill', style: { '--w': `${(s.sends / maxStyle) * 100}%` } }),
          h('span', { class: 'fill soft', style: { '--w': `${(s.projects / maxStyle) * 100}%` } })),
        h('span', { class: 'num muted' }, s.maxSent == null ? `0/${s.projects}` : `${s.sends}/${s.sends + s.projects} · ${grade(s.maxSent)}`)))),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'sent-i' }), t('progress.sends')), h('span', {}, h('i', { class: 'soft-i' }), t('progress.open')))),
  );
}

export function climbRowProject(p) {
  const row = climbRow(p.root);
  row.querySelector('.meta').textContent = p.sessions ? t('climb.projectProgress', { s: sessionsText(p.sessions) }) : t('project.notYet');
  return row;
}

/** Linha do grau máximo (cheia) e mediano (tracejada) por semana, em SVG. */
export function lineChart(weeks) {
  const W = 320, H = 150, L = 30, R = 8, T = 10, B = 22;
  const lo = Math.max(0, Math.min(...weeks.map((w) => w.median)) - 1);
  const hi = Math.max(...weeks.map((w) => w.max)) + 1;
  const x = (i) => L + (weeks.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (weeks.length - 1));
  const y = (g) => T + ((hi - g) * (H - T - B)) / (hi - lo || 1);
  const ticks = [...new Set([lo, Math.round((lo + hi) / 2), hi])];
  const pts = (k) => weeks.map((w, i) => `${x(i)},${y(w[k])}`).join(' ');
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('progress.weekly') },
    ticks.map((g) => [
      svg('line', { class: 'grid', x1: L, x2: W - R, y1: y(g), y2: y(g) }),
      svg('text', { class: 'axis', x: L - 6, y: y(g) + 3, 'text-anchor': 'end' }, document.createTextNode(grade(g))),
    ]).flat(),
    svg('polyline', { class: 'med', points: pts('median') }),
    svg('polyline', { class: 'max', points: pts('max') }),
    weeks.map((w, i) => svg('circle', { class: 'dot', cx: x(i), cy: y(w.max), r: 3.5 })),
    [0, weeks.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) =>
      svg('text', { class: 'axis', x: x(i), y: H - 4, 'text-anchor': i === 0 && weeks.length > 1 ? 'start' : 'end' },
        document.createTextNode(fmtDate(`${weeks[i].week}T12:00:00`)))));
}
