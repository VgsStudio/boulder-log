// Boulder em React: novo boulder (foto + detector), detalhe, projeto, compartilhar e link recebido.
import { track } from '../analytics.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDate, t } from '../i18n.js';
import { boxLab, calibrate, COLORS, sampleLab, suggest } from '../color.js';
import { detectHolds, growRegion, holdAt, routeHolds } from '../detect.js';
import { playResult } from '../sound.js';
import * as S from '../stats.js';
import {
  PHOTO_TERMS_VERSION, HOLD_TYPES, WALL_ANGLES, STYLE_TAGS, RESULTS, $, state, toast, fail, sessionsText, colorName, grade,
  guestMode, api, publicApi, loadAll, activeSession, gymOf, climbOf, rootOf, upsert, toCanvas, encode, compress, upload, myXp } from '../core.js';
import { render, needAccount } from '../app.js';
import { PIN_ICON, PENCIL_ICON, CHECK_ICON, SHARE_ICON } from '../game.js';
import { openSheet } from '../session.js';
import { useStore, useRedraw, Seg, Swatch, ClimbRow } from './base.jsx';
import { LineIcon, celebrate } from './game.jsx';
import { Avatar, FollowButton, pinClimb } from './social.jsx';
import { runTour, standalone, isIOS, Terms } from './settings.jsx';
import { Stage, Overlay, CanvasView, ClimbStage, WithNav, holdBrush, cycleRole } from './photo.jsx';

const closeSheet = () => $('#sheet').close();
const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);
const lastGrade = () => [...state.climbs].sort(byNewest)[0]?.grade ?? 3;

// ---------- termo de uso das fotos ----------
/** Pede o aceite do termo antes da primeira foto. Resolve true se aceito (agora ou antes). */
export function ensurePhotoTerms() {
  if (state.settings.photoTermsVersion === PHOTO_TERMS_VERSION) return Promise.resolve(true);
  return new Promise((resolve) => {
    const res = { accepted: false };
    openSheet(<PhotoTerms res={res} />);
    $('#sheet').addEventListener('close', () => resolve(res.accepted), { once: true });
  });
}
function PhotoTerms({ res }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      state.settings = { ...state.settings, ...(await api('/settings', { method: 'PUT', body: { acceptPhotoTerms: PHOTO_TERMS_VERSION } })) };
      res.accepted = true;
      closeSheet();
    } catch (err) { fail(err); setBusy(false); }
  };
  return (
    <div className="stack">
      <h2>{t('terms.title')}</h2>
      <p className="muted">{t('terms.lead')}</p>
      <Terms />
      <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>{t('terms.check')}</span></label>
      <button className="btn primary big block" type="button" disabled={!checked || busy} onClick={accept}>{t('terms.accept')}</button>
    </div>
  );
}

// ---------- câmera e registro rápido ----------
/** Foto escolhida pelo botão de câmera da barra, à espera da tela de novo boulder. */
let pendingPhoto = null;

/** Botão de câmera (centro da barra): foto → novo boulder; sem sessão, abre uma no último ginásio. */
export async function onCameraPhoto(file) {
  if (!file) return;
  let s = activeSession();
  if (!s) {
    const gymId = (() => { try { return localStorage.getItem('bl:gym'); } catch { return null; } })();
    const gym = gymOf(gymId) ?? state.gyms[0];
    if (!gym) { toast(t('cam.needGym')); location.hash = '#/'; return; }
    try {
      s = await api('/sessions', { method: 'POST', body: { gymId: gym.id } });
      state.sessions.push(s);
      toast(t('cam.sessionStarted', { g: gym.name }));
    } catch (err) { fail(err); return; }
  }
  pendingPhoto = file;
  if (location.hash === '#/new') render(); else location.hash = '#/new';
}

/** Faixa de graus rolável, com o grau escolhido no centro. */
function GradeChips({ value, onPick }) {
  const ref = useRef(null);
  useLayoutEffect(() => { ref.current?.querySelector('.chip.grade[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, []);
  return (
    <div className="chips scroll" role="group" aria-label={t('climb.grade')} ref={ref}>
      {S.GRADES.map((g) => <button key={g} className="chip grade" type="button" aria-pressed={String(value === g)} onClick={() => onPick(g)}>{grade(g)}</button>)}
    </div>
  );
}
const ColorChips = ({ value, onPick }) => (
  <div className="chips" role="group" aria-label={t('climb.color')}>
    {COLORS.map((c) => <button key={c} className="chip" type="button" aria-pressed={String(value === c)} onClick={() => onPick(c)}><Swatch c={c} />{colorName(c)}</button>)}
  </div>
);

/** Registro rápido: cor, grau e resultado numa janela, sem foto. */
export const quickLogSheet = (s) => openSheet(<QuickLog s={s} />);
function QuickLog({ s }) {
  const [color, setColor] = useState(null);
  const [g, setG] = useState(lastGrade);
  const [result, setResult] = useState('sent');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const before = S.achievements(state.sessions, state.climbs);
    const lvBefore = S.level(myXp()).level;
    try {
      const { climb } = await api('/climbs', { method: 'POST', body: { sessionId: s.id, color, grade: g, attempts: 1, result } });
      track('climb_logged', { result, grade: g, color, photo: false, quick: true });
      state.climbs.push(climb);
      closeSheet();
      const lvAfter = S.level(myXp()).level;
      celebrate({ unlocked: S.newAchievements(before, S.achievements(state.sessions, state.climbs)), xp: S.xpFor(climb), levelUp: lvAfter > lvBefore ? lvAfter : 0, result: climb.result });
      render();
      if (guestMode) setTimeout(needAccount, 1600);
    } catch (err) { fail(err); setBusy(false); }
  };
  return (
    <div className="stack">
      <h2>{t('quick.title')}</h2>
      <ColorChips value={color} onPick={setColor} />
      <GradeChips value={g} onPick={setG} />
      <Seg options={RESULTS.map((r) => [r, t(`result.${r}`)])} value={result} onPick={setResult} />
      <button className="btn primary big block" type="button" disabled={!color || busy} onClick={save}>
        {color ? t('quick.save', { c: colorName(color).toLowerCase(), g: grade(g) }) : t('quick.pickColor')}
      </button>
      <button className="btn ghost block" type="button" onClick={closeSheet}>{t('settings.close')}</button>
    </div>
  );
}

// ---------- prévias e ids ----------
/** Prévia minúscula (24 px, borrada pelo CSS) em data URL: ~1 KB, vai junto do boulder e aparece na hora. */
export function tinyPreview(source) {
  const w = 24, hh = Math.max(1, Math.round((24 * source.height) / source.width));
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  c.getContext('2d').drawImage(source, 0, 0, w, hh);
  const url = c.toDataURL('image/webp', 0.5);
  return url.startsWith('data:image/webp') && url.length < 3000 ? url : c.toDataURL('image/jpeg', 0.5);
}
/** Boulders antigos sem prévia: gera de fundo a partir da miniatura (poucos por vez). */
export async function backfillPreviews() {
  if (guestMode) return;
  const todo = state.climbs.filter((c) => c.photoType && !c.lqip && c.thumbUrl).slice(0, 30);
  for (const c of todo) {
    try {
      const bmp = await createImageBitmap(await (await fetch(c.thumbUrl, { cache: 'no-store' })).blob());
      const lqip = tinyPreview(bmp);
      bmp.close?.();
      upsert(state.climbs, await api(`/climbs/${c.id}`, { method: 'PATCH', body: { lqip } }));
    } catch { /* tenta de novo na próxima abertura */ }
    await new Promise((r) => setTimeout(r, 400));
  }
}
/** Modelo que achou as candidatas (muda quando o detector for trocado ou retreinado). */
export const DETECTOR_ID = 'yolov8n-freeclimbs-2';
const holdOut = ({ x, y, w, h: hh, role }) => ({ x, y, w, h: hh, ...(role ? { role } : {}) });
const boxOut = ({ x, y, w, h: hh }) => ({ x, y, w, h: hh });

/** Ids na ordem da lista de onde o boulder foi aberto (perfil, galeria, histórico): ‹ › passa por eles. */
let navList = [];
export const setNav = (ids) => { navList = ids; };

const CameraIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4Z" strokeLinejoin="round" /><circle cx={12} cy={13} r={3.5} /></svg>;

// ---------- novo boulder ----------
export function NewClimb() {
  const s = activeSession();
  useEffect(() => { if (!s) location.hash = '#/'; }, [s]);
  return s ? <NewClimbForm s={s} /> : null;
}

function NewClimbForm({ s }) {
  const draw = useRedraw();
  const gym = gymOf(s.gymId);
  const palette = gym?.palette ?? {};
  // Estado do formulário num objeto só (o detector e os gestos mexem nele fora do ciclo do React).
  const d = useRef({
    color: null, grade: lastGrade(), attempts: 1, result: 'sent', note: '', tap: null, projectId: null, canvas: null, lab: null, suggestion: null,
    boxes: null, rgba: null, seed: null, route: null, detect: null,
  }).current;
  const [saving, setSaving] = useState(false);
  const openProjects = S.projects(state.climbs).filter(S.isOpenProject);

  const pickPhoto = async (file) => {
    if (!file || !(await ensurePhotoTerms())) return;
    d.preparing = true;
    draw();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // deixa o aviso aparecer antes do trabalho pesado
    try {
      const canvas = await toCanvas(file, 1568);
      d.preparing = false;
      Object.assign(d, { canvas, tap: null, lab: null, suggestion: null, boxes: null, seed: null, route: null, detect: 'loading', zoom: { k: 1, x: 0, y: 0 }, t0: performance.now() });
      d.rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      draw();
      // Detecta as agarras em segundo plano enquanto você preenche o resto.
      detectHolds(canvas, palette).then((boxes) => {
        if (d.canvas !== canvas) return;
        Object.assign(d, { boxes, detect: 'done' });
        track('holds_detected', { boxes: boxes.length, ms: Math.round(performance.now() - d.t0) });
        if (d.tap) applyTap(d.tap.x, d.tap.y);
        draw();
        setTimeout(() => runTour('cm:tourPhoto', [{ el: 'main .stage', text: t('tour.photo') }]), 300);
      }, (err) => {
        console.error(err);
        track('holds_detect_failed', { message: String(err?.message ?? err).slice(0, 120) });
        if (d.canvas === canvas) { d.detect = 'failed'; draw(); }
      });
    } catch (err) { d.preparing = false; draw(); fail(err); }
  };
  const onFile = (e) => { const f = e.target.files?.[0]; e.target.value = ''; pickPhoto(f); };

  // Veio do botão de câmera: já processa a foto.
  useEffect(() => {
    if (pendingPhoto) { const file = pendingPhoto; pendingPhoto = null; setTimeout(() => pickPhoto(file), 0); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Toque: com o detector pronto, a cor vem da agarra inteira (descontando a parede) e a via é
   *  o grupo de agarras dessa cor encadeadas a partir dela; sem detector, mede só em volta do toque. */
  const applyTap = (x, y) => {
    const c = d.canvas;
    d.tap = { x: +x.toFixed(4), y: +y.toFixed(4) };
    d.seed = d.boxes && findHold(x, y);
    if (d.seed) {
      d.lab = boxLab(d.rgba, c.width, c.height, d.seed);
    } else {
      const half = Math.max(8, Math.round(c.width / 64)), px = Math.round(x * c.width), py = Math.round(y * c.height);
      d.lab = sampleLab(c.getContext('2d', { willReadFrequently: true }).getImageData(Math.max(0, px - half), Math.max(0, py - half), half * 2 + 1, half * 2 + 1).data);
    }
    d.suggestion = suggest(d.lab, palette);
    setColor(d.suggestion.best);
  };
  /** Muda a cor da via (toque ou chip) e refaz o grupo de agarras. */
  const setColor = (color) => {
    d.color = color;
    if (d.seed) {
      d.seed.color = color;
      d.route = routeHolds(d.boxes, d.seed, d.canvas.width, d.canvas.height);
      d.autoRoute = [...d.route]; // o que o app sugeriu sozinho, antes das correções (medir acerto / treino)
    }
  };
  /** Agarra no ponto: a detectada mais próxima; senão cresce a região pela cor (volume ou agarra
   *  que o detector não viu) e passa a tratá-la como agarra detectada. */
  const findHold = (x, y) => {
    const c = d.canvas;
    const found = holdAt(d.boxes, x, y, 0.03, c.width / c.height);
    if (found) return found;
    const grown = growRegion(d.rgba, c.width, c.height, x, y);
    if (grown) d.boxes.push(grown);
    return grown ?? undefined;
  };
  const onTap = (x, y) => {
    const hit = d.route && d.boxes && findHold(x, y);
    if (hit && hit !== d.seed) {
      // Ajuste manual: toque numa agarra inclui ou tira ela da via.
      d.route = d.route.includes(hit) ? d.route.filter((b) => b !== hit) : [...d.route, hit];
    } else if (!hit || !d.route) {
      applyTap(x, y);
    }
    draw();
  };
  const resetRoute = () => { Object.assign(d, { tap: null, seed: null, route: null, suggestion: null, lab: null }); draw(); };

  const doCalibrate = async () => {
    if (!gym || !d.lab || !d.color || d.color === 'other') return;
    try {
      const pal = calibrate(gym.palette ?? {}, d.color, d.lab);
      upsert(state.gyms, await api(`/gyms/${gym.id}`, { method: 'PATCH', body: { palette: pal } }));
      toast(t('climb.calibrated'));
    } catch (err) { fail(err); }
  };

  const save = async () => {
    if (!d.color) { toast(t('climb.color')); return; }
    if (!d.result) { toast(t('climb.pickResult')); document.querySelector('.seg')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    setSaving(true);
    try {
      let full, thumb, lqip;
      if (d.canvas) {
        full = await compress(d.canvas, 0.82);
        const small = document.createElement('canvas');
        small.width = 400; small.height = Math.round((400 * d.canvas.height) / d.canvas.width);
        small.getContext('2d').drawImage(d.canvas, 0, 0, small.width, small.height);
        thumb = await encode(small, full.type, 0.75);
        lqip = tinyPreview(d.canvas);
      }
      const body = {
        sessionId: s.id, color: d.color, grade: d.grade, attempts: d.attempts, result: d.result,
        ...(d.note.trim() ? { note: d.note.trim() } : {}),
        ...(d.tap ? { tap: d.tap } : {}),
        ...(d.route?.length ? { holds: d.route.slice(0, 80).map(holdOut) } : {}),
        ...(d.boxes?.length ? { cands: d.boxes.slice(0, 300).map(boxOut), detector: DETECTOR_ID } : {}),
        ...(d.autoRoute?.length ? { autoHolds: d.autoRoute.slice(0, 80).map(boxOut) } : {}),
        ...(d.projectId ? { projectId: d.projectId } : {}),
        ...(full ? { photoType: full.type } : {}),
        ...(lqip ? { lqip } : {}),
      };
      const before = S.achievements(state.sessions, state.climbs);
      const lvBefore = S.level(myXp()).level;
      const { climb, uploads } = await api('/climbs', { method: 'POST', body });
      if (uploads) climb.thumbUrl = URL.createObjectURL(thumb); // mostra a foto local já
      track('climb_logged', {
        result: d.result, grade: d.grade, color: d.color, photo: !!d.canvas, project: !!d.projectId, boxes: d.boxes?.length ?? 0,
        holds: d.route?.length ?? 0, auto_holds: d.autoRoute?.length ?? 0,
        // Quanto a pessoa corrigiu a via sugerida: medida de acerto do detector.
        holds_added: d.route && d.autoRoute ? d.route.filter((b) => !d.autoRoute.includes(b)).length : 0,
        holds_removed: d.route && d.autoRoute ? d.autoRoute.filter((b) => !d.route.includes(b)).length : 0,
      });
      state.climbs.push(climb);
      const unlocked = S.newAchievements(before, S.achievements(state.sessions, state.climbs));
      const lvAfter = S.level(myXp()).level;
      setTimeout(() => celebrate({ unlocked, xp: S.xpFor(climb), levelUp: lvAfter > lvBefore ? lvAfter : 0, result: climb.result }), 50);
      location.replace(`#/climb/${climb.id}`); // sem voltar para o formulário
      if (guestMode) setTimeout(needAccount, 1600); // depois da comemoração
      // A foto sobe em segundo plano; depois dela, o estilo da via (IA). Nada disso segura a tela.
      if (uploads) {
        Promise.all([upload(uploads.full, full), upload(uploads.thumb, thumb)])
          .then(() => !guestMode && api(`/climbs/${climb.id}/analyze`, { method: 'POST' }).then((x) => {
            upsert(state.climbs, x);
            if (location.hash === `#/climb/${climb.id}`) render();
          }, (err) => console.warn('analyze', err)))
          .catch(() => toast(t('upload.failed')));
      }
    } catch (err) {
      fail(err);
      setSaving(false);
    }
  };

  const project = d.projectId && climbOf(d.projectId);
  const fileInput = <input type="file" accept="image/*" capture="environment" hidden onChange={onFile} />;
  const brush = d.paint && d.route ? holdBrush({
    boxes: () => d.boxes ?? [], aspect: () => d.canvas.width / d.canvas.height,
    isIn: (b) => d.route.includes(b), add: (b) => d.route.push(b),
    remove: (b) => { if (b !== d.seed) d.route = d.route.filter((x) => x !== b); },
    done: () => draw(),
  }) : null;

  return (
    <div className="stack">
      <div className="row"><a className="link" href="#/">‹ {t('back')}</a></div>
      <h1>{t('climb.new')}</h1>

      {openProjects.length > 0 && (
        <section>
          <h2 className="muted small">{t('climb.continue')}</h2>
          <div className="chips scroll">
            {openProjects.map((p) => (
              <button key={p.root.id} className="chip" type="button" aria-pressed={String(d.projectId === p.root.id)}
                onClick={() => {
                  if (d.projectId === p.root.id) Object.assign(d, { projectId: null });
                  else Object.assign(d, { projectId: p.root.id, color: p.root.color, grade: p.root.grade, result: null, canvas: null, tap: null }); // escolha explícita: mandou ou não
                  draw();
                }}>
                <Swatch c={p.root.color} /><strong>{grade(p.root.grade)}</strong><span className="muted">{sessionsText(p.sessions)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Foto + toque na agarra (não quando continua um projeto: usa a foto dele). */}
      {project
        ? (project.thumbUrl && <img className="thumb" src={project.thumbUrl} alt="" style={{ width: '96px', height: '96px' }} />)
        : d.canvas
          ? (
            <section>
              <Stage z={d.zoom} onTap={onTap} detecting={d.detect === 'loading'} paint={brush}
                onLong={(x, y) => { if (d.route && cycleRole(d.route, x, y)) draw(); }}>
                <CanvasView canvas={d.canvas} />
                <Overlay holds={d.route} all={d.boxes} />
                {/* A bolinha do toque só enquanto não há via marcada (depois as caixas mostram tudo). */}
                {d.tap && !d.route?.length && <span className="marker" style={{ '--x': `${d.tap.x * 100}%`, '--y': `${d.tap.y * 100}%` }} />}
              </Stage>
              {d.route && (
                <button className={`btn small-btn brush-btn ${d.paint ? 'primary' : ''}`} type="button" aria-pressed={String(!!d.paint)} onClick={() => { d.paint = !d.paint; draw(); }}>
                  🖌 {d.paint ? t('brush.on') : t('brush.off')}
                </button>
              )}
              <p className={`small detect-status ${d.detect ?? ''}`}>
                {d.detect === 'loading' ? t('detect.loading')
                  : d.detect === 'failed' ? t('detect.failed')
                    : d.route ? <>{t('detect.route', { n: d.route.length })} <button className="link small" type="button" onClick={resetRoute}>{t('detect.reset')}</button></>
                      : d.boxes ? t('detect.found', { n: d.boxes.length }) : ''}
              </p>
              {d.suggestion
                ? (
                  <div className="suggestion small">
                    <strong>{t('climb.suggest', { c: colorName(d.suggestion.best).toLowerCase() })}</strong>
                    <span className="muted">{t('climb.or', { c: colorName(d.suggestion.second).toLowerCase() })}</span>
                    {d.color && d.color !== 'other' && <button className="link small" type="button" onClick={doCalibrate}>{t('climb.calibrate', { c: colorName(d.color).toLowerCase() })}</button>}
                  </div>
                )
                : <p className="muted small">{t('climb.tapHint')}</p>}
              <label className="link small">{t('climb.retake')}{fileInput}</label>
            </section>
          )
          : d.preparing
            ? <div className="photo-pick"><p className="small detect-status loading">{t('detect.preparing')}</p></div>
            : <label className="photo-pick"><div><CameraIcon />{t('climb.photo')}</div>{fileInput}</label>}

      {/* Cor: o toque escolhe sozinho; a lista só aparece sem toque ou se pedir para trocar. */}
      <section>
        <h2>{t('climb.color')}</h2>
        {d.color && d.tap && !d.pickColor
          ? (
            <div className="color-auto">
              <Swatch c={d.color} /><strong>{colorName(d.color)}</strong>
              <span className="muted small grow">{t('climb.colorAuto')}</span>
              <button className="link" type="button" onClick={() => { d.pickColor = true; draw(); }}>{t('climb.change')}</button>
            </div>
          )
          : <ColorChips value={d.color} onPick={(c) => { setColor(c); d.pickColor = false; draw(); }} />}
      </section>

      <section><h2>{t('climb.grade')}</h2><GradeChips value={d.grade} onPick={(g) => { d.grade = g; draw(); }} /></section>
      <section><h2>{t('climb.result')}</h2><Seg options={RESULTS.map((r) => [r, t(`result.${r}`)])} value={d.result} onPick={(r) => { d.result = r; draw(); }} /></section>

      <label className="field"><span>{t('climb.note')}</span>
        <textarea maxLength={500} defaultValue={d.note} onChange={(e) => (d.note = e.target.value)} />
      </label>

      <div className="sticky-save">
        <button className="btn primary big block" type="button" disabled={saving} onClick={save}>{saving ? t('climb.saving') : t('climb.save')}</button>
      </div>
    </div>
  );
}

// ---------- detalhe do boulder ----------
const toggle = (list, v, max) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].slice(-max));
// Mesma agarra (a caixa candidata cai dentro da marcada).
const sameHold = (b) => (x) => x === b || (b.x + b.w / 2 >= x.x && b.x + b.w / 2 <= x.x + x.w && b.y + b.h / 2 >= x.y && b.y + b.h / 2 <= x.y + x.h);

export function ClimbView({ id }) {
  useStore();
  const draw = useRedraw();
  const [editing, setEditing] = useState(false); // cor e grau abertos para edição
  const [photo, setPhoto] = useState(null); // { url } da foto grande
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState('');
  const lastTry = useRef(0);
  const he = useRef(null); // edição de agarras: { canvas, rgba, boxes, holds, status, zoom, paint }
  const c = climbOf(id);
  const rootId = c && rootOf(c).id;
  const hasPhoto = c && rootOf(c).photoType;
  useEffect(() => {
    if (hasPhoto) api(`/climbs/${rootId}/media`).then((m) => setPhoto({ url: m.photoUrl }), () => {});
  }, [rootId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <p className="muted">—</p>;

  const r = rootOf(c);
  const ai = r.ai;
  const proj = S.projects(state.climbs).find((p) => p.root.id === r.id);
  const tries = proj ? [r, ...state.climbs.filter((x) => x.projectId === r.id)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  const tryIds = () => state.climbs.filter((x) => x.projectId === c.id).map((x) => x.id);

  const patchClimb = (fields) => {
    const prev = { ...climbOf(c.id) };
    upsert(state.climbs, { id: c.id, ...fields });
    if (fields.result && S.isSend({ result: fields.result }) && !S.isSend(prev)) playResult(fields.result);
    draw();
    api(`/climbs/${c.id}`, { method: 'PATCH', body: fields })
      .then((x) => { upsert(state.climbs, x); draw(); }, (err) => { upsert(state.climbs, prev); draw(); fail(err); });
  };
  const patchAi = (fields) => api(`/climbs/${r.id}`, { method: 'PATCH', body: { ai: { ...ai, ...fields } } }).then((x) => { upsert(state.climbs, x); draw(); }, fail);
  const analyze = async () => {
    setBusy('ai');
    try { upsert(state.climbs, await api(`/climbs/${r.id}/analyze`, { method: 'POST' })); } catch (err) { fail(err); }
    setBusy('');
  };
  /** Nova tentativa de um projeto (mandou ou ainda não), ligada à raiz, na sessão ativa. */
  const logTry = async (result) => {
    // Toques repetidos em sequência criavam vários registros: ignora por 1,5 s depois de registrar.
    if (Date.now() - lastTry.current < 1500) return;
    lastTry.current = Date.now();
    const s = activeSession();
    if (!s) { toast(t('project.needSession')); return; }
    const body = { sessionId: s.id, color: r.color, grade: r.grade, attempts: 1, result, projectId: r.id };
    track('project_try', { result, grade: r.grade });
    const before = S.achievements(state.sessions, state.climbs);
    const lvBefore = S.level(myXp()).level;
    // Registro provisório para a tela reagir já; troca pelo do servidor quando ele responder.
    const temp = { ...body, id: `tmp${Date.now()}`, createdAt: new Date().toISOString() };
    state.climbs.push(temp);
    const lvAfter = S.level(myXp()).level;
    celebrate({ unlocked: S.newAchievements(before, S.achievements(state.sessions, state.climbs)), xp: S.xpFor(temp), levelUp: lvAfter > lvBefore ? lvAfter : 0, result });
    draw();
    try {
      const { climb } = await api('/climbs', { method: 'POST', body });
      state.climbs = state.climbs.map((x) => (x === temp ? climb : x));
      draw();
    } catch (err) {
      state.climbs = state.climbs.filter((x) => x !== temp);
      draw();
      fail(err);
    }
  };
  // Excluir: numa raiz de projeto apaga o projeto inteiro (raiz + tentativas); numa tentativa, só ela.
  const del = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy('del');
    const ids = [...tryIds(), c.id];
    try {
      for (const x of ids) await api(`/climbs/${x}`, { method: 'DELETE' });
      state.climbs = state.climbs.filter((x) => !ids.includes(x.id));
      if (state.profile?.pinned && ids.includes(state.profile.pinned)) state.profile.pinned = null;
      toast(t('climb.deleted'));
      history.back();
    } catch (err) {
      // O que já saiu, saiu: recarrega para a tela não mostrar registro apagado.
      fail(err);
      loadAll().then(render, () => {});
    }
  };

  // Edição das agarras da via sobre a foto salva: o detector roda de novo e cada toque inclui ou tira.
  const startHoldEdit = async () => {
    he.current = { holds: (r.holds ?? []).map((b) => ({ ...b })), status: 'loading', zoom: { k: 1, x: 0, y: 0 } };
    const e = he.current;
    draw();
    try {
      const url = photo?.url ?? (await api(`/climbs/${r.id}/media`)).photoUrl;
      const blob = await (await fetch(url, { cache: 'no-store' })).blob();
      const canvas = await toCanvas(blob, 1568);
      if (he.current !== e) return;
      Object.assign(e, { canvas, rgba: canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data });
      draw();
      const g = gymOf(state.sessions.find((x) => x.id === r.sessionId)?.gymId);
      const boxes = await detectHolds(canvas, g?.palette ?? {});
      if (he.current === e) { Object.assign(e, { boxes, status: 'done' }); draw(); }
    } catch (err) {
      console.error(err);
      if (he.current === e) { e.status = e.canvas ? 'failed' : 'done'; if (!e.canvas) { he.current = null; fail(err); } draw(); }
    }
  };
  const tapHold = (x, y) => {
    const e = he.current;
    const cv = e.canvas;
    const inside = (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    const had = e.holds.findIndex(inside);
    if (had >= 0) { e.holds.splice(had, 1); draw(); return; }
    let b = e.boxes && holdAt(e.boxes, x, y, 0.03, cv.width / cv.height);
    if (!b) { b = growRegion(e.rgba, cv.width, cv.height, x, y); if (b) e.boxes?.push(b); }
    if (!b) return;
    if (!e.holds.includes(b)) e.holds.push(b);
    draw();
  };
  const saveHolds = async () => {
    const e = he.current;
    setBusy('holds');
    const holds = e.holds.slice(0, 80).map(holdOut);
    const cands = e.boxes?.length ? { cands: e.boxes.slice(0, 300).map(boxOut), detector: DETECTOR_ID } : {};
    try {
      upsert(state.climbs, await api(`/climbs/${r.id}`, { method: 'PATCH', body: { holds, ...cands } }));
      track('holds_edited', { holds: holds.length });
      he.current = null;
      toast(t('holds.saved'));
    } catch (err) { fail(err); }
    setBusy('');
  };

  const ni = navList.indexOf(id);
  const goNav = (dd) => { const nid = navList[ni + dd]; if (nid) location.replace(`#/climb/${nid}`); };
  const e = he.current;
  const pinned = state.profile?.pinned === r.id;
  const gymName = gymOf(state.sessions.find((x) => x.id === c.sessionId)?.gymId)?.name ?? r.gymName ?? '';

  return (
    <div className="stack">
      <div className="row">
        <button className="link" type="button" onClick={() => history.back()}>‹ {t('back')}</button>
        {ni >= 0 && navList.length > 1 && <>
          <span className="grow" />
          <div className="row nav-top">
            <button className="icon-btn" type="button" disabled={ni <= 0} aria-label={t('nav.prev')} onClick={() => goNav(-1)}>‹</button>
            <span className="small muted num">{`${ni + 1}/${navList.length}`}</span>
            <button className="icon-btn" type="button" disabled={ni >= navList.length - 1} aria-label={t('nav.next')} onClick={() => goNav(1)}>›</button>
          </div>
        </>}
      </div>
      <div className="row title-row">
        <h1 className="row grow title-main"><Swatch c={c.color} /><span className="title-name">{colorName(c.color)}</span><span className="grade-pill">{grade(c.grade)}</span></h1>
        {/* Ações do boulder: mesma cor e tamanho; o alfinete fica preenchido quando fixado, o lápis quando editando. */}
        <div className="title-actions">
          <button className="icon-btn act-btn" type="button" onClick={() => pinClimb(r)} aria-pressed={String(pinned)} aria-label={pinned ? t('pin.remove') : t('pin.add')}><LineIcon d={PIN_ICON} /></button>
          <button className="icon-btn act-btn" type="button" aria-label={t('share.button')} onClick={(ev) => shareClimb(r, ev.currentTarget)}><LineIcon d={SHARE_ICON} /></button>
          <button className="icon-btn act-btn" type="button" aria-pressed={String(editing)} aria-label={editing ? t('climb.done') : t('climb.edit')} onClick={() => setEditing(!editing)}><LineIcon d={editing ? CHECK_ICON : PENCIL_ICON} /></button>
        </div>
      </div>
      {/* Edição de cor e grau (num projeto, as tentativas seguintes usam a cor/grau da raiz). */}
      {editing && (
        <section className="card stack">
          <div><h2>{t('climb.color')}</h2><ColorChips value={c.color} onPick={(col) => patchClimb({ color: col })} /></div>
          <div><h2>{t('climb.grade')}</h2><GradeChips value={c.grade} onPick={(g) => patchClimb({ grade: g })} /></div>
        </section>
      )}

      {r.photoType && (e
        ? (
          <section className="stack">
            {e.canvas && (
              <Stage z={e.zoom} onTap={tapHold} detecting={e.status === 'loading'}
                onLong={(x, y) => { if (cycleRole(e.holds, x, y)) draw(); }}
                paint={e.paint ? holdBrush({
                  boxes: () => e.boxes ?? [], aspect: () => e.canvas.width / e.canvas.height,
                  isIn: (b) => e.holds.some(sameHold(b)),
                  add: (b) => e.holds.push(b),
                  remove: (b) => { e.holds = e.holds.filter((x) => !sameHold(b)(x)); },
                  done: () => draw(),
                }) : null}>
                <CanvasView canvas={e.canvas} />
                <Overlay holds={e.holds} all={e.boxes ?? []} />
              </Stage>
            )}
            <p className={`small detect-status ${e.status}`}>
              {e.status === 'loading' ? t('detect.loading') : e.status === 'failed' ? t('detect.failed') : t('holds.hint', { n: e.holds.length })}
            </p>
            {e.boxes && (
              <button className={`btn small-btn brush-btn ${e.paint ? 'primary' : ''}`} type="button" aria-pressed={String(!!e.paint)} onClick={() => { e.paint = !e.paint; draw(); }}>
                🖌 {e.paint ? t('brush.on') : t('brush.off')}
              </button>
            )}
            <div className="row">
              <button className="btn ghost grow" type="button" onClick={() => { he.current = null; draw(); }}>{t('holds.cancel')}</button>
              <button className="btn primary grow" type="button" disabled={busy === 'holds'} onClick={saveHolds}>{t('holds.save')}</button>
            </div>
          </section>
        )
        : <>
          <WithNav hasPrev={ni > 0} hasNext={ni >= 0 && ni < navList.length - 1} go={goNav}>
            <ClimbStage url={photo?.url ?? r.thumbUrl} c={r} />
          </WithNav>
          <button className="link small" type="button" onClick={startHoldEdit}>{t('holds.edit')}</button>
        </>)}

      <section className="card stack">
        <Seg options={RESULTS.map((x) => [x, t(`result.${x}`)])} value={c.result} onPick={(x) => patchClimb({ result: x })} />
        {c.note && <p className="muted">{c.note}</p>}
        <p className="muted small">{fmtDate(c.createdAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}, {gymName}</p>
      </section>

      {proj && (
        <section className="card">
          <h2>{t('climb.project')}</h2>
          <p className="num">
            {proj.sentAt
              ? t('climb.projectSent', { d: fmtDate(proj.sentAt, { day: 'numeric', month: 'long' }) })
              : proj.dropped ? t('project.droppedOn', { d: fmtDate(r.droppedAt ?? r.createdAt, { day: 'numeric', month: 'long' }) })
                : proj.sessions ? t('climb.projectProgress', { s: sessionsText(proj.sessions) }) : t('project.notYet')}
          </p>
          {/* Projeto aberto: registrar a nova tentativa direto daqui, na sessão de hoje. */}
          {!proj.sentAt && !proj.dropped && (
            <div className="row project-actions">
              <button className="btn go big grow" type="button" onClick={() => logTry('sent')}>{t('project.sent')}</button>
              <button className="btn big grow" type="button" onClick={() => logTry('project')}>{t('project.again')}</button>
            </div>
          )}
          {!proj.sentAt && (
            <button className="btn ghost block" type="button" onClick={() => api(`/climbs/${r.id}`, { method: 'PATCH', body: { dropped: !proj.dropped } }).then((x) => { upsert(state.climbs, x); draw(); }, fail)}>
              {proj.dropped ? t('project.reopen') : t('project.drop')}
            </button>
          )}
          <ul className="list">{tries.map((x) => <ClimbRow key={x.id} c={x} />)}</ul>
        </section>
      )}

      {r.photoType && (
        <section className="card stack">
          <h2>{t('ai.title')}</h2>
          {ai
            ? <>
              <p className="muted small">{t('ai.disclaimer')}</p>
              <div><div className="small muted">{t('ai.angle')}</div><Seg options={WALL_ANGLES.map((a) => [a, t(`angle.${a}`)])} value={ai.wallAngle} onPick={(a) => patchAi({ wallAngle: a })} /></div>
              <div><div className="small muted">{t('ai.holds')}</div>
                <div className="chips">{HOLD_TYPES.map((x) => <button key={x} className="chip" type="button" aria-pressed={String(ai.holdTypes.includes(x))} onClick={() => patchAi({ holdTypes: toggle(ai.holdTypes, x, 7) })}>{t(`hold.${x}`)}</button>)}</div>
              </div>
              <div><div className="small muted">{t('ai.style')}</div>
                <div className="chips">{STYLE_TAGS.map((x) => <button key={x} className="chip" type="button" aria-pressed={String(ai.styleTags.includes(x))} onClick={() => patchAi({ styleTags: toggle(ai.styleTags, x, 3) })}>{t(`style.${x}`)}</button>)}</div>
              </div>
            </>
            : <button className="btn block" type="button" disabled={busy === 'ai'} onClick={analyze}>{busy === 'ai' ? t('ai.analyzing') : t('ai.analyze')}</button>}
        </section>
      )}

      <button className="btn ghost danger block" type="button" disabled={busy === 'del'} onClick={del}>
        {confirmDelete ? t('climb.confirmDelete') : c.id === r.id && tryIds().length ? t('climb.deleteProject', { n: tryIds().length + 1 }) : t('climb.delete')}
      </button>
    </div>
  );
}

// ---------- compartilhar ----------
/** Gera o link e abre a janela com "Enviar" (compartilhamento nativo, chamado direto do toque,
 *  como o iOS exige) e "Copiar link". */
export async function shareClimb(c, btn) {
  btn.disabled = true;
  try {
    const { token } = await api(`/climbs/${c.id}/share`, { method: 'POST' });
    track('share_created');
    const url = `${location.origin}/#/s/${token}`;
    const gym = gymOf(state.sessions.find((s) => s.id === c.sessionId)?.gymId)?.name ?? c.gymName;
    // "essa via vermelha V3" (cor "outra" fica só "essa via V3")
    const cn = c.color === 'other' ? '' : colorName(c.color).toLowerCase();
    const text = (gym ? t('share.textGym', { c: cn, g: grade(c.grade), gym }) : t('share.text', { c: cn, g: grade(c.grade) })).replace(/ {2,}/g, ' ');
    openSheet(<ShareSheet c={c} url={url} text={text} />);
  } catch (err) { fail(err); }
  btn.disabled = false;
}
function ShareSheet({ c, url, text }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast(t('share.copied')); } catch { toast(url); } };
  const revoke = async () => {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try { await api(`/climbs/${c.id}/share`, { method: 'DELETE' }); closeSheet(); toast(t('share.revoked')); } catch (err) { fail(err); }
  };
  return (
    <div className="stack">
      <h2>{t('share.title')}</h2>
      <p className="muted">{t('share.lead')}</p>
      <input type="text" value={url} readOnly onFocus={(e) => e.target.select()} />
      {navigator.share && <button className="btn primary big block" type="button" onClick={() => navigator.share({ title: 'Chalkmark', text, url }).catch(() => {})}>{t('share.send')}</button>}
      <button className="btn block" type="button" onClick={copy}>{t('share.copy')}</button>
      <button className="link small danger-link" type="button" disabled={busy} onClick={revoke}>{confirm ? t('share.revokeConfirm') : t('share.revoke')}</button>
    </div>
  );
}

/** Boulder recebido por link: ver e adicionar aos próprios projetos. */
export function ShareView({ token }) {
  const [sh, setSh] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    (guestMode ? publicApi : api)(`/shares/${token}`).then((x) => { setSh(x); if (guestMode) setTimeout(needAccount, 1200); }, setErr);
  }, [token]);
  if (err) return <div className="stack"><p className="muted">{err.status === 404 ? t('share.gone') : t('error.generic')}</p></div>;
  if (!sh) return <div className="stack"><p className="small detect-status loading">{t('share.loading')}</p></div>;
  const add = async () => {
    if (guestMode) { needAccount(); return; }
    setBusy(true);
    try {
      const climb = await api(`/shares/${token}/accept`, { method: 'POST' });
      track('share_accepted');
      state.climbs.push(climb);
        toast(t('share.added'));
      location.replace(`#/climb/${climb.id}`);
      if (sh.owner && !sh.owner.following) setTimeout(() => followSharer(sh.owner), 900);
    } catch (e) { fail(e); setBusy(false); }
  };
  const copyLink = async () => { try { await navigator.clipboard.writeText(location.href); setCopied(true); } catch { toast(location.href); } };
  return (
    <div className="stack">
      <p className="muted small">{sh.owner ? t('share.receivedFrom', { n: sh.owner.name }) : t('share.received')}</p>
      <h1 className="row"><Swatch c={sh.color} />{colorName(sh.color)}<span className="grade-pill">{grade(sh.grade)}</span></h1>
      {sh.gymName && <p className="muted">{t('share.atGym', { gym: sh.gymName })}</p>}
      {sh.owner && (
        <div className="row">
          <a className="row person grow" href={`#/u/${sh.owner.handle}`}><Avatar p={sh.owner} /><span><strong>{sh.owner.name}</strong><span className="muted small"> @{sh.owner.handle}</span></span></a>
          {!sh.mine && <FollowButton p={sh.owner} />}
        </div>
      )}
      {sh.photoUrl && <ClimbStage url={sh.photoUrl} c={sh} />}
      {sh.ai && (
        <div className="chips">
          {sh.ai.wallAngle && <span className="chip">{t(`angle.${sh.ai.wallAngle}`)}</span>}
          {(sh.ai.holdTypes ?? []).map((x) => <span key={x} className="chip">{t(`hold.${x}`)}</span>)}
        </div>
      )}
      {isIOS() && !standalone() && (
        <section className="card stack small">
          <strong>{t('deeplink.iosTitle')}</strong><p className="muted">{t('deeplink.iosLead')}</p>
          <button className="btn block" type="button" onClick={copyLink}>{copied ? t('share.copied') : t('share.copy')}</button>
        </section>
      )}
      {sh.mine
        ? <p className="muted">{t('share.mine')}</p>
        : <button className="btn go big block" type="button" disabled={busy} onClick={add}>{t('share.add')}</button>}
    </div>
  );
}

/** Depois de adicionar um boulder compartilhado: sugere seguir quem mandou. */
export function followSharer(owner) {
  if (owner.following || $('#sheet').open) return;
  openSheet(
    <div className="stack center">
      <Avatar p={owner} size={72} />
      <h2>{t('share.followTitle', { n: owner.name })}</h2>
      <p className="muted">{t('share.followLead')}</p>
      <div className="row">
        <button className="btn ghost grow" type="button" onClick={closeSheet}>{t('guest.notNow')}</button>
        <FollowButton p={owner} className="grow" onChange={() => setTimeout(closeSheet, 400)} />
      </div>
    </div>,
  );
}
