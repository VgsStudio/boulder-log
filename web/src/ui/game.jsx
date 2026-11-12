// Gamificação em React: ícones, agarras, cartão da sequência, trilha de graus, conquistas.
import { useId } from 'react';
import { fmtDate, fmtDuration, lang, t } from '../i18n.js';
import { playResult } from '../sound.js';
import { sessionCard, shareCard } from '../storycard.js';
/** Miniatura da foto do boulder (ou da raiz do projeto). */
const rootPhoto = (c) => rootOf(c).thumbUrl;
import * as S from '../stats.js';
import { state, grade, gymOf, toast, myXp, rootOf } from '../core.js';
import { openSheet } from '../session.js';
import { ICONS, HOLD_SHAPES, HOLD_COLORS, KIND_COLOR, TICK, achLabel, achValue, achCatalog } from '../game.js';
import { Bar } from './base.jsx';

export const Icon = ({ kind }) => <svg viewBox="0 0 24 24" className="ico" aria-hidden="true"><path d={ICONS[kind]} /></svg>;
/** Ícone de traço (pin, compartilhar, lápis), na cor do texto. */
export const LineIcon = ({ d }) => <svg className="line-ico" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/** Agarra em SVG. fill = cor; fillPct (0-1) enche de baixo para cima sobre a cor de fundo. */
export function Hold({ i, fill, fillPct = 1, track = 'var(--surface-2)' }) {
  const id = useId();
  const d = HOLD_SHAPES[i % HOLD_SHAPES.length];
  if (fillPct >= 1) return <svg className="hold" viewBox="0 0 100 100" aria-hidden="true"><path d={d} fill={fill} /><circle className="bolt" cx={50} cy={50} r={5} /></svg>;
  const at = `${Math.round(fillPct * 100)}%`;
  return (
    <svg className="hold" viewBox="0 0 100 100" aria-hidden="true">
      <defs><linearGradient id={id} x1={0} y1={1} x2={0} y2={0}><stop offset={at} stopColor={fill} /><stop offset={at} stopColor={track} /></linearGradient></defs>
      <path d={d} fill={`url(#${id})`} /><circle className="bolt" cx={50} cy={50} r={5} />
    </svg>
  );
}

/** Risco de giz desenhado à mão (filtro #chalk no index.html). */
export const ChalkTick = ({ cls = '' }) => <svg className={`tick ${cls}`} viewBox="0 0 100 100" aria-hidden="true"><path className="chalk-stroke" filter="url(#chalk)" d={TICK} /></svg>;

/** Pó de giz subindo (comemorações). */
export const ChalkPuff = () => (
  <div className="puff" aria-hidden="true">
    {[...Array(14)].map((_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const r = 60 + (i % 3) * 22;
      return <i key={i} style={{ '--dx': `${Math.round(Math.cos(a) * r)}px`, '--dy': `${Math.round(Math.sin(a) * r * 0.7 - 20)}px`, '--s': `${6 + (i % 4) * 3}px`, '--d': `${(i % 5) * 40}ms` }} />;
    })}
  </div>
);

export function AchBadge({ a, locked = false }) {
  const kind = a.id.split(':')[0];
  return (
    <li className={`ach ${locked ? 'locked' : ''}`} title={locked ? t('ach.locked') : fmtDate(a.at)}>
      <span className="medal"><Hold i={kind.length + (a.id.length % 4)} fill={locked ? 'var(--surface-2)' : KIND_COLOR[kind]} /><Icon kind={kind} /><b className="num">{achValue(a.id)}</b></span>
      <span className="label">{achLabel(a.id)}</span>
    </li>
  );
}

const weekdayNames = () => [...Array(7)].map((_, i) => new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : 'en', { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));

/** Cartão principal: sequência semanal, dias da semana e nível/XP. */
export function Hero() {
  const n = S.streakWeeks(state.sessions);
  const dots = S.weekDots(state.sessions);
  const wd = weekdayNames();
  const today = (new Date().getDay() + 6) % 7;
  const lv = S.level(myXp());
  return (
    <section className={`hero ${n ? 'on' : ''}`}>
      <div className="hero-top">
        <span className="flame"><Icon kind="streak" /></span>
        <div className="grow"><b className="num">{n}</b><span>{n === 1 ? t('streak.week') : t('streak.weeks')}</span></div>
        <div className="lv"><span className="lv-badge num">{lv.level}</span><span className="small">{t('xp.level', { n: lv.level })}</span></div>
      </div>
      <ol className="week">
        {dots.map((on, i) => (
          <li key={i} className={[on ? 'on' : 'off', i === today && 'today'].filter(Boolean).join(' ')}>
            <Hold i={i} fill={on ? HOLD_COLORS[i] : 'none'} />{on && <ChalkTick />}<span>{wd[i]}</span>
          </li>
        ))}
      </ol>
      <div className="xp">
        <Bar pct={(lv.into / lv.need) * 100} />
        <span className="small num">{t('xp.toNext', { a: lv.into, b: lv.need })}</span>
      </div>
      <p className="small hero-msg">{dots.some(Boolean) ? t('streak.done') : n ? t('streak.keep') : t('streak.start')}</p>
    </section>
  );
}

/** Trilha de graus no estilo "caminho": cada grau vira um nó que você domina mandando vias. */
export function GradePathCard() {
  const all = S.gradePath(state.climbs);
  const lastMastered = all.map((p) => p.mastered).lastIndexOf(true);
  const path = all.slice(Math.max(0, Math.min(lastMastered - 2, all.length - 5)));
  const offsets = [0, 1, 2, 1, 0, -1, -2, -1];
  const items = path.map((p, i) => {
    const pct = Math.min(1, p.sends / S.MASTERY);
    const st = p.mastered ? 'mastered' : p.unlocked ? 'open' : 'locked';
    const isNext = !p.mastered && p.unlocked && path.slice(0, i).every((q) => q.mastered);
    const color = p.mastered ? HOLD_COLORS[p.grade % HOLD_COLORS.length] : p.unlocked ? '#2f5bff' : 'var(--surface-2)';
    return (
      <li key={p.grade} className={[st, isNext && 'next'].filter(Boolean).join(' ')} style={{ '--off': offsets[i % offsets.length] }}>
        <span className="node" aria-label={`${grade(p.grade)}: ${p.sends}/${S.MASTERY}`}>
          <Hold i={p.grade} fill={color} fillPct={p.mastered ? 1 : p.unlocked ? Math.max(0.12, pct) : 1} track="var(--line)" />
          <b className="num">{grade(p.grade)}</b>{p.mastered && <ChalkTick cls="small" />}
        </span>
        <span className="node-meta small">{p.mastered ? <><Icon kind="check" />{t('path.mastered')}</> : p.unlocked ? `${p.sends}/${S.MASTERY}` : <Icon kind="lock" />}</span>
      </li>
    );
  }).reverse();
  return (
    <section className="card">
      <h2>{t('path.title')}</h2>
      <p className="muted small">{t('path.hint', { m: S.MASTERY })}</p>
      <ol className="path">{items}</ol>
    </section>
  );
}

export function AchievementsCard() {
  const { got, next } = achCatalog();
  return (
    <section className="card">
      <div className="session-head"><h2>{t('ach.title')}</h2><span className="muted small">{t('ach.count', { n: got.length })}</span></div>
      <ul className="achs scroll">
        {got.map((a) => <AchBadge key={a.id} a={a} />)}
        {next.map((a) => <AchBadge key={`n-${a.id}`} a={a} locked />)}
      </ul>
    </section>
  );
}

// ---------- janelas de comemoração ----------
const closeSheet = () => document.querySelector('#sheet').close();

/** O que é o foguinho: a sequência de semanas, com a semana atual. */
export function streakSheet() {
  const n = S.streakWeeks(state.sessions);
  const thisWeek = S.weekDots(state.sessions).some(Boolean);
  openSheet(
    <div className="stack">
      <h2>{t('streak.title', { n })}</h2>
      <p>{t('streak.explain')}</p>
      <Hero />
      <p className="muted">{thisWeek ? t('streak.safe') : t('streak.risk')}</p>
      <button className="btn block" type="button" onClick={closeSheet}>{t('settings.close')}</button>
    </div>,
  );
}

/** Fecha a janela sozinha depois de `ms`, se a pessoa não tocou nela (e se ainda é a mesma janela). */
function autoClose(ms) {
  const d = document.querySelector('#sheet');
  const content = d.firstChild;
  let touched = false;
  d.addEventListener('pointerdown', () => { touched = true; }, { once: true });
  setTimeout(() => { if (!touched && d.open && d.firstChild === content) d.close(); }, ms);
}

/** Comemoração: recorde de grau e subida de nível ganham destaque; conquistas em lista. Fecha sozinha em 3,5 s. */
export function celebrate({ unlocked, xp, levelUp, result }) {
  playResult(result);
  if (!unlocked.length && !levelUp) { toast(t('xp.gain', { n: xp })); return; }
  const pr = unlocked.filter((a) => a.id.startsWith('grade:')).map((a) => Number(a.id.split(':')[1])).sort((a, b) => b - a)[0];
  const best = Math.max(...state.climbs.filter(S.isSend).map((c) => c.grade));
  const isPr = pr != null && pr >= best;
  openSheet(
    <div className="stack celebrate">
      <div className="burst"><ChalkPuff /><ChalkTick cls="draw" /></div>
      {isPr
        ? <><p className="kicker">{t('ach.pr')}</p><div className="big-grade num">{grade(pr)}</div><p className="muted center">{t('ach.prLead', { g: grade(pr) })}</p></>
        : levelUp
          ? <><p className="kicker">{t('xp.levelUp', { n: levelUp })}</p><div className="big-grade num">{levelUp}</div></>
          : <p className="kicker">{unlocked.length === 1 ? t('ach.new') : t('ach.newMany', { n: unlocked.length })}</p>}
      <p className="xp-gain num center">{t('xp.gain', { n: xp })}</p>
      {unlocked.length > 0 && <ul className="achs">{unlocked.map((a) => <AchBadge key={a.id} a={a} />)}</ul>}
      <button className="btn primary big block" type="button" onClick={closeSheet}>{t('nice')}</button>
    </div>,
  );
  autoClose(3500);
}

/** Resumo ao encerrar a sessão. */
export function recapSheet(s, unlocked) {
  const cs = state.climbs.filter((c) => c.sessionId === s.id);
  const sum = S.sessionSummaries([s], state.climbs)[0];
  const flashes = cs.filter((c) => c.result === 'flash').length;
  const Big = ({ v, label }) => <div className="kpi"><b>{v}</b><span>{label}</span></div>;
  openSheet(
    <div className="stack celebrate">
      <div className="burst"><ChalkPuff /><ChalkTick cls="draw" /></div>
      <p className="kicker">{t('recap.title')}</p>
      <p className="muted center num">{`${gymOf(s.gymId)?.name ?? ''}, ${fmtDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}`}</p>
      <p className="xp-gain num center">{t('xp.gain', { n: S.totalXp(cs) })}</p>
      <div className="kpis">
        <Big v={String(sum.climbs)} label={t('recap.climbs')} /><Big v={String(sum.sends)} label={t('recap.sends')} />
        <Big v={String(flashes)} label={t('recap.flash')} /><Big v={sum.maxGrade != null ? grade(sum.maxGrade) : '—'} label={t('recap.max')} />
      </div>
      <Hero />
      {unlocked.length > 0 && <ul className="achs">{unlocked.map((a) => <AchBadge key={a.id} a={a} />)}</ul>}
      <button className="btn story-btn block" type="button" onClick={async (e) => {
        e.currentTarget.disabled = true;
        // Fundo: a foto do melhor boulder mandado da sessão (se tiver foto).
        const best = cs.filter((x) => S.isSend(x) && rootPhoto(x)).sort((a, b) => b.grade - a.grade)[0];
        const cv = await sessionCard({ gymName: gymOf(s.gymId)?.name ?? '', startedAt: s.startedAt, endedAt: s.endedAt, climbs: sum.climbs, sends: sum.sends, flashes, maxGrade: sum.maxGrade, xp: S.totalXp(cs), photoUrl: best && rootPhoto(best), holds: best && rootOf(best).holds });
        await shareCard(cv, 'chalkmark-sessao', 'session');
        e.target.disabled = false;
      }}>📸 {t('story.share')}</button>
      <button className="btn primary big block" type="button" onClick={closeSheet}>{t('recap.close')}</button>
    </div>,
  );
}
