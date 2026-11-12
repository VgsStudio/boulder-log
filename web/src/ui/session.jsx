// Tela da sessão em React: começar (escolher ginásio) e sessão aberta (registrar, encerrar).
import { track } from '../analytics.js';
import { useEffect, useRef, useState } from 'react';
import { fmtDuration, t } from '../i18n.js';
import * as S from '../stats.js';
import { $, state, fail, grade, api, activeSession, gymOf, upsert } from '../core.js';
import { render } from '../app.js';
import { getPos, geoGranted, openSheet } from '../session.js';
import { quickLogSheet } from './climb.jsx';
import { useStore, Seg, ClimbRow } from './base.jsx';
import { Hero, Icon, recapSheet } from './game.jsx';
import { GoalsCard, SessionHeader } from './history.jsx';

export function Session() {
  useStore();
  const s = activeSession();
  return s ? <ActiveSession s={s} /> : <StartSession />;
}

function StartSession() {
  const last = S.sessionSummaries(state.sessions, state.climbs)[0];
  const saved = localStorage.getItem('bl:gym');
  const [gymId, setGymId] = useState(gymOf(saved) ? saved : state.gyms[0]?.id ?? '__new');
  const [detected, setDetected] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);

  // Com permissão já dada, escolhe sozinho o ginásio onde você está.
  useEffect(() => {
    let alive = true;
    geoGranted().then(async (ok) => {
      if (!ok || !state.gyms.some((g) => g.loc)) return;
      const pos = await getPos();
      const near = pos && S.nearestGym(state.gyms, pos);
      if (near && alive) { setGymId(near.id); setDetected(true); }
    });
    return () => { alive = false; };
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      let id = gymId;
      if (id === '__new') {
        const name = nameRef.current.value.trim();
        if (!name) { nameRef.current.focus(); setBusy(false); return; }
        const loc = await getPos(); // pede permissão só aqui, ao cadastrar o ginásio
        const gym = await api('/gyms', { method: 'POST', body: { name, ...(loc ? { loc } : {}) } });
        state.gyms.push(gym);
        id = gym.id;
      }
      localStorage.setItem('bl:gym', id);
      state.sessions.push(await api('/sessions', { method: 'POST', body: { gymId: id } }));
      track('session_started', { new_gym: gymId === '__new', detected: detected });
      render();
    } catch (err) { fail(err); setBusy(false); }
  };

  return (
    <div className="stack">
      <h1>{t('session.ready')}</h1>
      <Hero />
      <GoalsCard />
      <div className="card stack">
        {state.gyms.length > 0 && (
          <label className="field"><span>{t('session.gym')}</span>
            <select value={gymId} onChange={(e) => setGymId(e.target.value)}>
              {state.gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="__new">+ {t('session.newGym')}</option>
            </select>
          </label>
        )}
        {detected && <p className="small muted"><Icon kind="gyms" />{t('session.detected')}</p>}
        {gymId === '__new' && (
          <div><label className="field"><span>{t('session.newGym')}</span>
            <input ref={nameRef} type="text" maxLength={40} placeholder={t('session.gymName')} autoComplete="off" />
          </label></div>
        )}
        <button className="btn primary big block" type="button" disabled={busy} onClick={start}>{t('session.start')}</button>
      </div>
      {last && (
        <section>
          <h2 className="muted small">{t('session.last')}</h2>
          <div className="card"><SessionHeader s={last} /></div>
        </section>
      )}
    </div>
  );
}

/** Tempo desde o início, atualizado a cada 30 s. */
function Elapsed({ since }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);
  return <span className="num">{fmtDuration(Date.now() - Date.parse(since))}</span>;
}

function ActiveSession({ s }) {
  const summary = S.sessionSummaries([s], state.climbs)[0];
  const climbs = state.climbs.filter((c) => c.sessionId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="stack">
      <div>
        <h1>{gymOf(s.gymId)?.name ?? '—'}</h1>
        <div className="stat-line num">
          <Elapsed since={s.startedAt} />
          <span>{t('stat.boulders', { n: summary.climbs })}</span><span>{t('stat.sends', { n: summary.sends })}</span>
          {summary.maxGrade != null && <span>max {grade(summary.maxGrade)}</span>}
          <span className="xp-chip">{t('xp.gain', { n: S.totalXp(climbs) })}</span>
        </div>
      </div>
      <a className="btn go big block" href="#/new">+ {t('session.add')}</a>
      <button className="btn block" type="button" onClick={() => quickLogSheet(s)}>{t('quick.button')}</button>
      {climbs.length
        ? <ul className="list card">{climbs.map((c) => <ClimbRow key={c.id} c={c} />)}</ul>
        : <p className="muted">{t('session.empty')}</p>}
      <button className="btn block" type="button" onClick={() => openSheet(<EndSession s={s} />)}>{t('session.end')}</button>
    </div>
  );
}

/** Encerrar: sensação (1-5) e nota; depois mostra o resumo da sessão. */
function EndSession({ s }) {
  const [feeling, setFeeling] = useState(3);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    const body = { end: true, feeling, ...(note.trim() ? { note: note.trim() } : {}) };
    track('session_ended', { feeling, climbs: state.climbs.filter((c) => c.sessionId === s.id).length, minutes: Math.round((Date.now() - Date.parse(s.startedAt)) / 60000) });
    const prev = { ...s };
    upsert(state.sessions, { id: s.id, endedAt: new Date().toISOString(), feeling, ...(body.note ? { note: body.note } : {}) });
    $('#sheet').close();
    render();
    const ended = state.sessions.find((x) => x.id === s.id);
    // Conquistas desta sessão: as que caíram desde o início dela.
    recapSheet(ended, S.achievements(state.sessions, state.climbs).filter((a) => a.at >= ended.startedAt));
    api(`/sessions/${s.id}`, { method: 'PATCH', body })
      .then((x) => upsert(state.sessions, x), (err) => { upsert(state.sessions, { ...prev, endedAt: undefined }); render(); fail(err); });
  };
  return (
    <div className="stack">
      <h2>{t('session.feeling')}</h2>
      <div><Seg options={[1, 2, 3, 4, 5].map((n) => [n, String(n)])} value={feeling} onPick={setFeeling} /></div>
      <textarea maxLength={500} placeholder={t('climb.note')} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button className="btn ghost grow" type="button" onClick={() => $('#sheet').close()}>{t('cancel')}</button>
        <button className="btn primary grow" type="button" disabled={busy} onClick={save}>{t('session.save')}</button>
      </div>
    </div>
  );
}
