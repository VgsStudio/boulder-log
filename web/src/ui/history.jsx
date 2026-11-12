// Histórico (calendário, sessões, galeria) e Evolução, em React.
import { fmtDate, fmtDuration, fmtPct, lang, t } from '../i18n.js';
import { COLORS } from '../color.js';
import * as S from '../stats.js';
import { RESULTS, state, gymOf, colorName, grade, sessionsText } from '../core.js';
import { capitalize, setNav } from '../climb.js';
import { settingsSheet } from '../settings.js';
import { useStore, useRedraw, Seg, Swatch, Bar, ClimbRow, FadeImg, lqipBg } from './base.jsx';
import { Hero, GradePathCard, AchievementsCard } from './game.jsx';

/** Cabeçalho de sessão: ginásio, data e números. */
export function SessionHeader({ s }) {
  return (
    <>
      <div className="session-head">
        <strong>{gymOf(s.gymId)?.name ?? '—'}</strong>
        <span className="muted small">{fmtDate(s.startedAt, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      </div>
      <div className="stat-line num">
        <span>{t('stat.boulders', { n: s.climbs })}</span><span>{t('stat.sends', { n: s.sends })}</span>
        {s.maxGrade != null && <span>max {grade(s.maxGrade)}</span>}
        {s.endedAt && <span>{fmtDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}</span>}
      </div>
    </>
  );
}

// ---------- histórico ----------
// Fica fora do componente: voltar para o histórico mantém mês, dia e aba escolhidos.
export const historyUi = { month: null, day: null, tab: 'sessions', color: '', result: '' };
const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);

export function History() {
  useStore();
  const redraw = useRedraw();
  const ui = historyUi;
  const set = (patch) => { Object.assign(ui, patch); redraw(); };
  const now = new Date();
  ui.month ??= new Date(now.getFullYear(), now.getMonth(), 1);
  const m = ui.month;
  const days = S.climbingDays(state.sessions, m.getFullYear(), m.getMonth());
  const first = (m.getDay() + 6) % 7; // segunda = 0
  const total = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const isThisMonth = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth();
  const wd = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));
  const shift = (n) => set({ month: new Date(m.getFullYear(), m.getMonth() + n, 1), day: null });

  let summaries = S.sessionSummaries(state.sessions, state.climbs);
  if (ui.day) summaries = summaries.filter((s) => {
    const d = new Date(s.startedAt);
    return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth() && d.getDate() === ui.day;
  });
  const climbsOf = (s) => state.climbs.filter((c) => c.sessionId === s.id).sort(byNewest);
  const gallery = state.climbs
    .filter((c) => c.thumbUrl && (!ui.color || c.color === ui.color) && (!ui.result || c.result === ui.result))
    .sort(byNewest);

  return (
    <div className="stack">
      <h1>{t('tab.history')}</h1>
      <section className="card">
        <div className="cal-head">
          <button type="button" aria-label="‹" onClick={() => shift(-1)}>‹</button>
          <div className="center">
            <strong>{capitalize(fmtDate(m, { month: 'long', year: 'numeric' }))}</strong>
            <div className="muted small">{t('calendar.days', { n: days.size })}</div>
          </div>
          <button type="button" aria-label="›" onClick={() => shift(1)} disabled={isThisMonth}>›</button>
        </div>
        <div className="cal" role="grid" aria-label={t('calendar.title')}>
          {wd.map((w, i) => <span key={`w${i}`} className="wd">{w}</span>)}
          {[...Array(first)].map((_, i) => <span key={`e${i}`} />)}
          {[...Array(total)].map((_, i) => {
            const day = i + 1;
            const on = days.get(day);
            const cls = [on && 'on', on?.length > 1 && 'multi', ui.day === day && 'sel', isThisMonth && day === now.getDate() && 'today'].filter(Boolean).join(' ');
            return (
              <button key={day} type="button" className={cls || undefined} disabled={!on} aria-pressed={on ? String(ui.day === day) : undefined}
                onClick={() => set({ day: ui.day === day ? null : day, tab: 'sessions' })}>{day}</button>
            );
          })}
        </div>
      </section>

      <Seg options={[['sessions', t('history.sessions')], ['gallery', t('history.gallery')]]} value={ui.tab} onPick={(v) => set({ tab: v })} />

      {ui.tab === 'sessions'
        ? (summaries.length
          ? (
            <ul className="list card">
              {summaries.map((s) => (
                <li key={s.id}>
                  <details className="session" open={summaries.length === 1}>
                    <summary><div className="grow"><SessionHeader s={s} /></div></summary>
                    <ul className="list" onClick={() => setNav(summaries.flatMap((x) => climbsOf(x).map((c) => c.id)))}>
                      {climbsOf(s).map((c) => <ClimbRow key={c.id} c={c} />)}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )
          : <p className="muted">{t('history.empty')}</p>)
        : (
          <section>
            <div className="row">
              <select className="grow" aria-label={t('climb.color')} value={ui.color} onChange={(e) => set({ color: e.target.value })}>
                <option value="">{`${t('climb.color')}: ${t('history.all')}`}</option>
                {COLORS.map((c) => <option key={c} value={c}>{colorName(c)}</option>)}
              </select>
              <select className="grow" aria-label={t('climb.result')} value={ui.result} onChange={(e) => set({ result: e.target.value })}>
                <option value="">{`${t('climb.result')}: ${t('history.all')}`}</option>
                {RESULTS.map((r) => <option key={r} value={r}>{t(`result.${r}`)}</option>)}
              </select>
            </div>
            <div className="gallery">
              {gallery.map((c) => (
                <a key={c.id} href={`#/climb/${c.id}`} style={lqipBg(c)} onClick={() => setNav(gallery.map((x) => x.id))}>
                  <FadeImg src={c.thumbUrl} alt={`${colorName(c.color)} ${grade(c.grade)}`} width={200} height={200} />
                  <span className="tag"><Swatch c={c.color} />{grade(c.grade)}</span>
                </a>
              ))}
            </div>
          </section>
        )}
    </div>
  );
}

// ---------- evolução ----------
export function GoalsCard() {
  const { weeklySessions, gradeGoal } = state.settings;
  if (!weeklySessions && gradeGoal == null) return <button className="link" type="button" onClick={settingsSheet}>+ {t('goal.set')}</button>;
  const n = S.sessionsThisWeek(state.sessions);
  const reached = S.goalReachedAt(state.climbs, gradeGoal);
  const best = Math.max(-1, ...state.climbs.filter(S.isSend).map((c) => c.grade));
  return (
    <section className="card stack">
      {weeklySessions > 0 && (
        <div>
          <div className="session-head"><strong>{t('goal.week')}</strong><span className="num muted">{t('goal.weekProgress', { n, g: weeklySessions })}</span></div>
          <Bar pct={Math.min(100, (n / weeklySessions) * 100)} />
        </div>
      )}
      {gradeGoal != null && (
        <div>
          <div className="session-head">
            <strong>{`${t('goal.grade')}: ${grade(gradeGoal)}`}</strong>
            <span className="num muted">{reached ? t('goal.gradeDone', { d: fmtDate(reached) }) : best >= 0 ? t('goal.gradeBest', { g: grade(best) }) : ''}</span>
          </div>
          <Bar pct={reached ? 100 : Math.max(0, ((best + 1) / (gradeGoal + 1)) * 100)} />
        </div>
      )}
    </section>
  );
}

const Kpi = ({ value, label }) => <div className="kpi"><b>{value}</b><span>{label}</span></div>;
const Legend = ({ items }) => <div className="legend">{items.map(([cls, label]) => <span key={label}><i className={cls || undefined} />{label}</span>)}</div>;

export function Progress() {
  useStore();
  if (!state.climbs.length) {
    return (
      <div className="stack">
        <h1>{t('tab.progress')}</h1><Hero /><GradePathCard /><GoalsCard />
        <p className="muted">{t('progress.empty')}</p>
      </div>
    );
  }
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const recentSends = state.climbs.filter((c) => c.createdAt >= since).filter(S.isSend);
  const weekly = S.weeklyGrades(state.climbs).slice(-12);
  const volume = S.sessionSummaries(state.sessions, state.climbs).slice(0, 12).reverse();
  const pyr = S.pyramid(state.climbs);
  const open = S.projects(state.climbs).filter(S.isOpenProject);
  const styles = S.styleStats(state.climbs);
  const maxVol = Math.max(1, ...volume.map((s) => s.climbs));
  const maxPyr = Math.max(1, ...pyr.map((p) => p.sends));
  const maxStyle = Math.max(1, ...styles.map((s) => s.sends + s.projects));
  const styleLabel = (key) => { const [kind, v] = key.split(':'); return t(`${kind === 'hold' ? 'hold' : 'angle'}.${v}`); };

  return (
    <div className="stack">
      <h1>{t('tab.progress')}</h1>
      <Hero /><GradePathCard /><AchievementsCard /><GoalsCard />
      <div className="kpis">
        <Kpi value={recentSends.length ? grade(Math.max(...recentSends.map((c) => c.grade))) : '—'} label={t('progress.max')} />
        <Kpi value={String(state.sessions.filter((s) => s.startedAt >= since).length)} label={t('progress.sessions')} />
        <Kpi value={fmtPct(S.flashRate(state.climbs))} label={t('progress.flash')} />
        <Kpi value={String(S.streakWeeks(state.sessions))} label={t('progress.streak')} />
      </div>

      {weekly.length > 0 && (
        <section className="card">
          <h2>{t('progress.weekly')}</h2>
          <LineChart weeks={weekly} />
          <Legend items={[['', t('progress.weeklyMax')], ['med', t('progress.weeklyMedian')]]} />
        </section>
      )}

      {volume.length > 0 && (
        <section className="card">
          <h2>{t('progress.volume')}</h2>
          <div className="bars-v" role="img" aria-label={t('progress.volume')}>
            {volume.map((s) => (
              <div key={s.id}>
                <span className="num">{s.climbs}</span>
                <span className="fill" style={{ '--h': `${(s.climbs / maxVol) * 100}%` }} />
                <span>{fmtDate(s.startedAt, { day: 'numeric', month: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {pyr.length > 0 && (
        <section className="card">
          <h2>{t('progress.pyramid')}</h2>
          <div className="bars-h">
            {pyr.map((p) => (
              <div key={p.grade}>
                <strong className="num">{grade(p.grade)}</strong>
                <div className="track" title={`${p.flashes} flash`}>
                  <span className="fill accent" style={{ '--w': `${(p.flashes / maxPyr) * 100}%` }} />
                  <span className="fill" style={{ '--w': `${((p.sends - p.flashes) / maxPyr) * 100}%` }} />
                </div>
                <span className="num muted">{p.sends}</span>
              </div>
            ))}
          </div>
          <Legend items={[['flash-i', t('result.flash')], ['sent-i', t('result.sent')]]} />
        </section>
      )}

      <section className="card">
        <h2>{t('progress.projects')}</h2>
        {open.length
          ? <ul className="list">{open.map((p) => <ClimbRow key={p.root.id} c={p.root} meta={p.sessions ? t('climb.projectProgress', { s: sessionsText(p.sessions) }) : t('project.notYet')} />)}</ul>
          : <p className="muted">{t('progress.noProjects')}</p>}
      </section>

      {styles.length > 0 && (
        <section className="card">
          <h2>{t('progress.styles')}</h2>
          <p className="muted small">{t('progress.stylesHint')}</p>
          {S.analyzedCount(state.climbs) < S.STYLE_MIN && <p className="small style-early">{t('progress.stylesEarly', { n: S.analyzedCount(state.climbs), m: S.STYLE_MIN })}</p>}
          <div className="bars-h styles">
            {styles.slice(0, 10).map((s) => (
              <div key={s.key}>
                <span>{styleLabel(s.key)}</span>
                <div className="track">
                  <span className="fill" style={{ '--w': `${(s.sends / maxStyle) * 100}%` }} />
                  <span className="fill soft" style={{ '--w': `${(s.projects / maxStyle) * 100}%` }} />
                </div>
                <span className="num muted">{s.maxSent == null ? `0/${s.projects}` : `${s.sends}/${s.sends + s.projects} · ${grade(s.maxSent)}`}</span>
              </div>
            ))}
          </div>
          <Legend items={[['sent-i', t('progress.sends')], ['soft-i', t('progress.open')]]} />
        </section>
      )}
    </div>
  );
}

/** Linha do grau máximo (cheia) e mediano (tracejada) por semana. */
export function LineChart({ weeks }) {
  const W = 320, H = 150, L = 30, R = 8, T = 10, B = 22;
  const lo = Math.max(0, Math.min(...weeks.map((w) => w.median)) - 1);
  const hi = Math.max(...weeks.map((w) => w.max)) + 1;
  const x = (i) => L + (weeks.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (weeks.length - 1));
  const y = (g) => T + ((hi - g) * (H - T - B)) / (hi - lo || 1);
  const ticks = [...new Set([lo, Math.round((lo + hi) / 2), hi])];
  const pts = (k) => weeks.map((w, i) => `${x(i)},${y(w[k])}`).join(' ');
  const ends = [0, weeks.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('progress.weekly')}>
      {ticks.map((g) => [
        <line key={`l${g}`} className="grid" x1={L} x2={W - R} y1={y(g)} y2={y(g)} />,
        <text key={`t${g}`} className="axis" x={L - 6} y={y(g) + 3} textAnchor="end">{grade(g)}</text>,
      ])}
      <polyline className="med" points={pts('median')} />
      <polyline className="max" points={pts('max')} />
      {weeks.map((w, i) => <circle key={w.week} className="dot" cx={x(i)} cy={y(w.max)} r={3.5} />)}
      {ends.map((i) => (
        <text key={`d${i}`} className="axis" x={x(i)} y={H - 4} textAnchor={i === 0 && weeks.length > 1 ? 'start' : 'end'}>{fmtDate(`${weeks[i].week}T12:00:00`)}</text>
      ))}
    </svg>
  );
}
