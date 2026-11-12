// Boulder: termo das fotos, novo boulder (detector), detalhe, compartilhar, foto com zoom e navegação.
import { render, needAccount } from './app.js';
import { fmtDate, t } from './i18n.js';
import { boxLab, calibrate, COLORS, sampleLab, suggest } from './color.js';
import { detectHolds, growRegion, holdAt, routeHolds } from './detect.js';
import { playSent, playTick } from './sound.js';
import * as S from './stats.js';
import { PHOTO_TERMS_VERSION, HOLD_TYPES, WALL_ANGLES, STYLE_TAGS, RESULTS, $, state, h, fill, svg, toast, fail, sessionsText, colorName, grade, swatch, seg, guestMode, api, publicApi, loadAll, activeSession, gymOf, climbOf, rootOf, upsert, toCanvas, encode, compress, upload, climbRow } from './core.js';
import { PIN_ICON, PENCIL_ICON, CHECK_ICON, SHARE_ICON, lineIcon, hold, icon } from './game.js';
import { celebrate } from './ui/game.jsx';
import { openSheet } from './session.js';
import { avatar, followButton } from './social.js';
import { pinClimb } from './ui/social.jsx';
import { runTour, standalone, isIOS } from './settings.js';

// ---------- termo de uso das fotos ----------
export function termsBody() {
  return h('ul', { class: 'terms' }, ['private', 'rights', 'people', 'training', 'delete', 'remove'].map((k) => h('li', {}, t(`terms.${k}`))));
}

/** Pede o aceite do termo antes da primeira foto. Resolve true se aceito (agora ou antes). */
export function ensurePhotoTerms() {
  if (state.settings.photoTermsVersion === PHOTO_TERMS_VERSION) return Promise.resolve(true);
  return new Promise((resolve) => {
    let accepted = false;
    const btn = h('button', { class: 'btn primary big block', type: 'button', disabled: true }, t('terms.accept'));
    const check = h('input', { type: 'checkbox', onchange: (e) => (btn.disabled = !e.target.checked) });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        state.settings = { ...state.settings, ...(await api('/settings', { method: 'PUT', body: { acceptPhotoTerms: PHOTO_TERMS_VERSION } })) };
        accepted = true;
        $('#sheet').close();
      } catch (err) { fail(err); btn.disabled = false; }
    });
    openSheet(h('div', { class: 'stack' },
      h('h2', {}, t('terms.title')),
      h('p', { class: 'muted' }, t('terms.lead')),
      termsBody(),
      h('label', { class: 'check' }, check, h('span', {}, t('terms.check'))),
      btn));
    $('#sheet').addEventListener('close', () => resolve(accepted), { once: true });
  });
}

// ---------- tela: novo boulder ----------
/** Foto escolhida pelo botão de câmera da barra, à espera da tela de novo boulder. */
export let pendingPhoto = null;

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

/** Registro rápido: cor, grau e resultado numa janela, sem foto. */
export function quickLogSheet(s) {
  const lastGrade = [...state.climbs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.grade ?? 3;
  const q = { color: null, grade: lastGrade, result: 'sent' };
  const box = h('div', { class: 'stack' });
  const draw = () => fill(box,
    h('h2', {}, t('quick.title')),
    h('div', { class: 'chips', role: 'group', 'aria-label': t('climb.color') }, COLORS.map((c) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(q.color === c), onclick: () => { q.color = c; draw(); } }, swatch(c), colorName(c)))),
    h('div', { class: 'chips scroll', role: 'group', 'aria-label': t('climb.grade') }, S.GRADES.map((g) =>
      h('button', { class: 'chip grade', type: 'button', 'aria-pressed': String(q.grade === g), onclick: () => { q.grade = g; draw(); } }, grade(g)))),
    seg(RESULTS.map((r) => [r, t(`result.${r}`)]), q.result, (r) => { q.result = r; draw(); }),
    h('button', {
      class: 'btn primary big block', type: 'button', disabled: !q.color,
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        const before = S.achievements(state.sessions, state.climbs);
        const lvBefore = S.level(S.totalXp(state.climbs)).level;
        try {
          const { climb } = await api('/climbs', { method: 'POST', body: { sessionId: s.id, color: q.color, grade: q.grade, attempts: 1, result: q.result } });
          state.climbs.push(climb);
          $('#sheet').close();
          const lvAfter = S.level(S.totalXp(state.climbs)).level;
          celebrate({ unlocked: S.newAchievements(before, S.achievements(state.sessions, state.climbs)), xp: S.xpFor(climb), levelUp: lvAfter > lvBefore ? lvAfter : 0, sent: S.isSend(climb) });
          render();
          if (guestMode) setTimeout(needAccount, 1600);
        } catch (err) { fail(err); e.target.disabled = false; }
      },
    }, q.color ? t('quick.save', { c: colorName(q.color).toLowerCase(), g: grade(q.grade) }) : t('quick.pickColor')),
    h('button', { class: 'btn ghost block', type: 'button', onclick: () => $('#sheet').close() }, t('settings.close')));
  draw();
  openSheet(box);
  requestAnimationFrame(() => box.querySelector('.chip.grade[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
}

export function viewNew() {
  const s = activeSession();
  if (!s) { location.hash = '#/'; return h('div'); }
  const gym = gymOf(s.gymId);
  const lastGrade = [...state.climbs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.grade ?? 3;
  const d = { color: null, grade: lastGrade, attempts: 1, result: 'sent', note: '', tap: null, projectId: null, canvas: null, lab: null, suggestion: null,
    boxes: null, rgba: null, seed: null, route: null, detect: null };
  const palette = gym?.palette ?? {};
  const openProjects = S.projects(state.climbs).filter(S.isOpenProject);

  const root = h('div', { class: 'stack' });
  const draw = () => fill(root, parts());

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !(await ensurePhotoTerms())) return;
    d.preparing = true;
    draw();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // deixa o aviso aparecer antes do trabalho pesado
    try {
      const canvas = await toCanvas(file, 1568);
      d.preparing = false;
      Object.assign(d, { canvas, tap: null, lab: null, suggestion: null, boxes: null, seed: null, route: null, detect: 'loading', zoom: { k: 1, x: 0, y: 0 } });
      d.rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      draw();
      // Detecta as agarras em segundo plano enquanto você preenche o resto.
      detectHolds(canvas, palette).then((boxes) => {
        if (d.canvas !== canvas) return;
        Object.assign(d, { boxes, detect: 'done' });
        if (d.tap) applyTap(d.tap.x, d.tap.y);
        draw();
        setTimeout(() => runTour('cm:tourPhoto', [{ el: 'main .stage', text: t('tour.photo') }]), 300);
      }, (err) => {
        console.error(err);
        if (d.canvas === canvas) { d.detect = 'failed'; draw(); }
      });
    } catch (err) { d.preparing = false; draw(); fail(err); }
  };
  const fileInput = () => h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: pickPhoto });

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
      const palette = calibrate(gym.palette ?? {}, d.color, d.lab);
      upsert(state.gyms, await api(`/gyms/${gym.id}`, { method: 'PATCH', body: { palette } }));
      toast(t('climb.calibrated'));
    } catch (err) { fail(err); }
  };

  const save = async (e) => {
    if (!d.color) { toast(t('climb.color')); return; }
    if (!d.result) { toast(t('climb.pickResult')); document.querySelector('.seg')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('climb.saving');
    try {
      let full, thumb, lqip;
      if (d.canvas) {
        full = await compress(d.canvas, 0.82);
        const small = h('canvas', { width: 400, height: Math.round((400 * d.canvas.height) / d.canvas.width) });
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
      const lvBefore = S.level(S.totalXp(state.climbs)).level;
      const { climb, uploads } = await api('/climbs', { method: 'POST', body });
      if (uploads) climb.thumbUrl = URL.createObjectURL(thumb); // mostra a foto local já
      state.climbs.push(climb);
      const unlocked = S.newAchievements(before, S.achievements(state.sessions, state.climbs));
      const lvAfter = S.level(S.totalXp(state.climbs)).level;
      setTimeout(() => celebrate({ unlocked, xp: S.xpFor(climb), levelUp: lvAfter > lvBefore ? lvAfter : 0, sent: S.isSend(climb) }), 50);
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
      btn.disabled = false;
      btn.textContent = t('climb.save');
    }
  };

  const parts = () => {
    const project = d.projectId && climbOf(d.projectId);
    return [
      h('div', { class: 'row' }, h('a', { class: 'link', href: '#/' }, `‹ ${t('back')}`)),
      h('h1', {}, t('climb.new')),

      openProjects.length > 0 && h('section', {},
        h('h2', { class: 'muted small' }, t('climb.continue')),
        h('div', { class: 'chips scroll' }, openProjects.map((p) =>
          h('button', {
            class: 'chip', type: 'button', 'aria-pressed': String(d.projectId === p.root.id),
            onclick: () => {
              if (d.projectId === p.root.id) Object.assign(d, { projectId: null });
              else Object.assign(d, { projectId: p.root.id, color: p.root.color, grade: p.root.grade, result: null, canvas: null, tap: null }); // escolha explícita: mandou ou não
              draw();
            },
          }, swatch(p.root.color), h('strong', {}, grade(p.root.grade)), h('span', { class: 'muted' }, sessionsText(p.sessions)))))),

      // Foto + toque na agarra (não quando continua um projeto: usa a foto dele).
      project
        ? (project.thumbUrl && h('img', { class: 'thumb', src: project.thumbUrl, alt: '', style: { width: '96px', height: '96px' } }))
        : d.canvas
          ? h('section', {},
            scanning(d.detect === 'loading', stage([d.canvas,
              holdsOverlay(d.route, d.boxes),
              // A bolinha do toque só enquanto não há via marcada (depois as caixas mostram tudo).
              d.tap && !d.route?.length && h('span', { class: 'marker', style: { '--x': `${d.tap.x * 100}%`, '--y': `${d.tap.y * 100}%` } })], onTap, d.zoom,
              (x, y) => { if (d.route && cycleRole(d.route, x, y)) { playTick(); draw(); } },
              d.paint && d.route ? holdBrush({
                boxes: () => d.boxes ?? [], aspect: () => d.canvas.width / d.canvas.height,
                isIn: (b) => d.route.includes(b), add: (b) => d.route.push(b),
                remove: (b) => { if (b !== d.seed) d.route = d.route.filter((x) => x !== b); },
                done: () => draw(),
              }) : null)),
            d.route && h('button', { class: `btn small-btn brush-btn ${d.paint ? 'primary' : ''}`, type: 'button', 'aria-pressed': String(!!d.paint), onclick: () => { d.paint = !d.paint; draw(); } },
              '🖌 ', d.paint ? t('brush.on') : t('brush.off')),
            h('p', { class: `small detect-status ${d.detect ?? ''}` },
              d.detect === 'loading' ? t('detect.loading')
                : d.detect === 'failed' ? t('detect.failed')
                  : d.route ? [t('detect.route', { n: d.route.length }), ' ', h('button', { class: 'link small', type: 'button', onclick: resetRoute }, t('detect.reset'))]
                    : d.boxes ? t('detect.found', { n: d.boxes.length }) : ''),
            d.suggestion
              ? h('div', { class: 'suggestion small' },
                h('strong', {}, t('climb.suggest', { c: colorName(d.suggestion.best).toLowerCase() })),
                h('span', { class: 'muted' }, t('climb.or', { c: colorName(d.suggestion.second).toLowerCase() })),
                d.color && d.color !== 'other' && h('button', { class: 'link small', type: 'button', onclick: doCalibrate }, t('climb.calibrate', { c: colorName(d.color).toLowerCase() })))
              : h('p', { class: 'muted small' }, t('climb.tapHint')),
            h('label', { class: 'link small' }, t('climb.retake'), fileInput()))
          : d.preparing
            ? h('div', { class: 'photo-pick' }, h('p', { class: 'small detect-status loading' }, t('detect.preparing')))
            : h('label', { class: 'photo-pick' },
              h('div', {}, svgCamera(), t('climb.photo')), fileInput()),

      // Cor: o toque escolhe sozinho; a lista só aparece sem toque ou se pedir para trocar.
      h('section', {}, h('h2', {}, t('climb.color')),
        d.color && d.tap && !d.pickColor
          ? h('div', { class: 'color-auto' }, swatch(d.color), h('strong', {}, colorName(d.color)),
            h('span', { class: 'muted small grow' }, t('climb.colorAuto')),
            h('button', { class: 'link', type: 'button', onclick: () => { d.pickColor = true; draw(); } }, t('climb.change')))
          : h('div', { class: 'chips', role: 'group' }, COLORS.map((c) =>
            h('button', { class: 'chip', type: 'button', 'aria-pressed': String(d.color === c), onclick: () => { setColor(c); d.pickColor = false; draw(); } }, swatch(c), colorName(c))))),

      h('section', {}, h('h2', {}, t('climb.grade')),
        h('div', { class: 'chips scroll', role: 'group' }, S.GRADES.map((g) =>
          h('button', { class: 'chip grade', type: 'button', 'aria-pressed': String(d.grade === g), onclick: () => { d.grade = g; draw(); } }, grade(g))))),

      h('section', {}, h('h2', {}, t('climb.result')),
        seg(RESULTS.map((r) => [r, t(`result.${r}`)]), d.result, (r) => { d.result = r; draw(); })),


      h('label', { class: 'field' }, h('span', {}, t('climb.note')),
        h('textarea', { maxlength: 500, value: d.note, oninput: (e) => (d.note = e.target.value) })),

      h('div', { class: 'sticky-save' },
        h('button', { class: 'btn primary big block', type: 'button', onclick: save }, t('climb.save'))),
    ];
  };
  draw();
  // Grau atual visível na faixa rolável.
  requestAnimationFrame(() => root.querySelector('.chip.grade[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  // Veio do botão de câmera: já processa a foto.
  if (pendingPhoto) { const file = pendingPhoto; pendingPhoto = null; setTimeout(() => pickPhoto({ target: { files: [file], value: '' } }), 0); }
  return root;
}

/** Pincel de agarras: `boxes()` candidatas, `isIn(b)`/`add(b)`/`remove(b)` mexem na via, `done()` redesenha.
 *  O 1º toque do traço decide se o traço inclui ou tira; cada agarra conta uma vez por traço. */
export function holdBrush({ boxes, aspect, isIn, add, remove, done }) {
  let mode = null;
  const touched = new Set();
  return {
    stroke(x, y, inner) {
      const b = holdAt(boxes(), x, y, 0.012, aspect());
      if (!b || touched.has(b)) return;
      mode ??= isIn(b) ? 'remove' : 'add';
      touched.add(b);
      if (mode === 'add') { if (!isIn(b)) add(b); } else if (isIn(b)) remove(b);
      try { navigator.vibrate?.(8); } catch {}
      // Retorno na hora sem redesenhar (redesenhar no meio do gesto quebraria o arrasto).
      inner.querySelector('.overlay')?.append(svg('rect', { class: mode === 'add' ? 'painted' : 'unpainted', x: b.x, y: b.y, width: b.w, height: b.h }));
    },
    end() { mode = null; touched.clear(); done(); },
  };
}

/** Toque longo numa agarra marcada: início (verde) → topo (vermelha) → normal. */
export function cycleRole(holds, x, y) {
  const b = holds.filter((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h).sort((a, c) => a.w * a.h - c.w * c.h)[0];
  if (!b) return false;
  b.role = b.role === 'start' ? 'top' : b.role === 'top' ? undefined : 'start';
  if (!b.role) delete b.role;
  return true;
}
/** Modelo que achou as candidatas (muda quando o detector for trocado ou retreinado). */
export const DETECTOR_ID = 'yolov8n-freeclimbs-2';
export const holdOut = ({ x, y, w, h: hh, role }) => ({ x, y, w, h: hh, ...(role ? { role } : {}) });
export const boxOut = ({ x, y, w, h: hh }) => ({ x, y, w, h: hh });

/** Caixas das agarras da via sobre a foto (coordenadas 0-1). */
export function holdsOverlay(holds, all = []) {
  if (!holds?.length && !all?.length) return null;
  const others = (all ?? []).filter((b) => !holds?.includes(b));
  return svg('svg', { class: 'overlay', viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    others.map((b) => svg('rect', { class: 'cand', x: b.x, y: b.y, width: b.w, height: b.h })),
    (holds ?? []).flatMap((b) => [
      svg('rect', { class: 'under', x: b.x, y: b.y, width: b.w, height: b.h }),
      svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: b.role ?? null }),
    ]));
}

export const svgCamera = () => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  svg('path', { d: 'M4 8h3l2-3h6l2 3h3v11H4Z', 'stroke-linejoin': 'round' }), svg('circle', { cx: 12, cy: 13, r: 3.5 }));

// ---------- tela: detalhe do boulder ----------
export function viewClimb(id) {
  const c = climbOf(id);
  if (!c) return h('p', { class: 'muted' }, '—');
  const root = rootOf(c);
  const box = h('div', { class: 'stack' });
  let confirmDelete = false;
  let editing = false; // cor e grau abertos para edição
  let photo = null; // { url }

  const patchClimb = (fields) => {
    const prev = { ...climbOf(c.id) };
    upsert(state.climbs, { id: c.id, ...fields });
    if (fields.result && S.isSend({ result: fields.result }) && !S.isSend(prev)) playSent();
    draw();
    api(`/climbs/${c.id}`, { method: 'PATCH', body: fields })
      .then((x) => upsert(state.climbs, x), (err) => { upsert(state.climbs, prev); draw(); fail(err); });
  };
  const analyze = async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = t('ai.analyzing');
    try {
      upsert(state.climbs, await api(`/climbs/${root.id}/analyze`, { method: 'POST' }));
    } catch (err) { fail(err); }
    draw();
  };
  /** Nova tentativa de um projeto (mandou ou ainda não), ligada à raiz, na sessão ativa. */
  let lastTry = 0;
  const logTry = async (rootClimb, result, btn) => {
    // Toques repetidos em sequência criavam vários registros: ignora por 1,5 s depois de registrar.
    if (Date.now() - lastTry < 1500) return;
    lastTry = Date.now();
    const s = activeSession();
    if (!s) { toast(t('project.needSession')); return; }
    btn.disabled = true;
    const body = { sessionId: s.id, color: rootClimb.color, grade: rootClimb.grade, attempts: 1, result, projectId: rootClimb.id };
    const before = S.achievements(state.sessions, state.climbs);
    const lvBefore = S.level(S.totalXp(state.climbs)).level;
    // Registro provisório para a tela reagir já; troca pelo do servidor quando ele responder.
    const temp = { ...body, id: `tmp${Date.now()}`, createdAt: new Date().toISOString() };
    state.climbs.push(temp);
    const lvAfter = S.level(S.totalXp(state.climbs)).level;
    celebrate({ unlocked: S.newAchievements(before, S.achievements(state.sessions, state.climbs)), xp: S.xpFor(temp), levelUp: lvAfter > lvBefore ? lvAfter : 0, sent: result === 'sent' });
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
  const tryIds = () => state.climbs.filter((x) => x.projectId === c.id).map((x) => x.id);
  const del = async (e) => {
    if (!confirmDelete) { confirmDelete = true; e.currentTarget.textContent = t('climb.confirmDelete'); return; }
    e.currentTarget.disabled = true;
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
  let holdEdit = null; // { canvas, rgba, boxes, holds, status }
  const startHoldEdit = async () => {
    const r = rootOf(climbOf(id));
    holdEdit = { holds: (r.holds ?? []).map((b) => ({ ...b })), status: 'loading', zoom: { k: 1, x: 0, y: 0 } };
    draw();
    try {
      const url = photo?.url ?? (await api(`/climbs/${r.id}/media`)).photoUrl;
      const blob = await (await fetch(url, { cache: 'no-store' })).blob();
      const canvas = await toCanvas(blob, 1568);
      if (!holdEdit) return;
      Object.assign(holdEdit, { canvas, rgba: canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data });
      draw();
      const gym = gymOf(state.sessions.find((s) => s.id === r.sessionId)?.gymId);
      const boxes = await detectHolds(canvas, gym?.palette ?? {});
      if (holdEdit) { Object.assign(holdEdit, { boxes, status: 'done' }); draw(); }
    } catch (err) {
      console.error(err);
      if (holdEdit) { holdEdit.status = holdEdit.canvas ? 'failed' : 'done'; if (!holdEdit.canvas) { holdEdit = null; fail(err); } draw(); }
    }
  };
  const tapHold = (x, y) => {
    const e = holdEdit;
    const c = e.canvas;
    const inside = (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    const had = e.holds.findIndex(inside);
    if (had >= 0) { e.holds.splice(had, 1); draw(); return; }
    let b = e.boxes && holdAt(e.boxes, x, y, 0.03, c.width / c.height);
    if (!b) { b = growRegion(e.rgba, c.width, c.height, x, y); if (b) e.boxes?.push(b); }
    if (!b) return;
    if (!e.holds.includes(b)) e.holds.push(b);
    playTick();
    draw();
  };
  const saveHolds = async (ev) => {
    ev.currentTarget.disabled = true;
    const r = rootOf(climbOf(id));
    const holds = holdEdit.holds.slice(0, 80).map(holdOut);
    const cands = holdEdit.boxes?.length ? { cands: holdEdit.boxes.slice(0, 300).map(boxOut), detector: DETECTOR_ID } : {};
    try {
      upsert(state.climbs, await api(`/climbs/${r.id}`, { method: 'PATCH', body: { holds, ...cands } }));
      holdEdit = null;
      toast(t('holds.saved'));
      draw();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };

  const draw = () => {
    const cur = climbOf(id);
    const r = rootOf(cur);
    const ai = r.ai;
    const proj = S.projects(state.climbs).find((p) => p.root.id === r.id);
    const tries = proj ? [r, ...state.climbs.filter((x) => x.projectId === r.id)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
    const patchAi = (fields) => api(`/climbs/${r.id}`, { method: 'PATCH', body: { ai: { ...ai, ...fields } } })
      .then((x) => { upsert(state.climbs, x); draw(); }, fail);
    const toggle = (list, v, max) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].slice(-max));

    const ni = navList.indexOf(id);
    const goNav = (d) => { const nid = navList[ni + d]; if (nid) location.replace(`#/climb/${nid}`); };
    fill(box, 
      h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => history.back() }, `‹ ${t('back')}`),
        ni >= 0 && navList.length > 1 && h('span', { class: 'grow' }),
        ni >= 0 && navList.length > 1 && h('div', { class: 'row nav-top' },
          h('button', { class: 'icon-btn', type: 'button', disabled: ni <= 0, 'aria-label': t('nav.prev'), onclick: () => goNav(-1) }, '‹'),
          h('span', { class: 'small muted num' }, `${ni + 1}/${navList.length}`),
          h('button', { class: 'icon-btn', type: 'button', disabled: ni >= navList.length - 1, 'aria-label': t('nav.next'), onclick: () => goNav(1) }, '›'))),
      h('div', { class: 'row title-row' },
        h('h1', { class: 'row grow title-main' }, swatch(cur.color), h('span', { class: 'title-name' }, colorName(cur.color)), h('span', { class: 'grade-pill' }, grade(cur.grade))),
        // Ações do boulder: mesma cor e tamanho; o alfinete fica preenchido quando fixado, o lápis quando editando.
        h('div', { class: 'title-actions' },
          h('button', {
            class: 'icon-btn act-btn', type: 'button', onclick: () => pinClimb(r),
            'aria-pressed': String(state.profile?.pinned === r.id), 'aria-label': state.profile?.pinned === r.id ? t('pin.remove') : t('pin.add'),
          }, lineIcon(PIN_ICON)),
          h('button', { class: 'icon-btn act-btn', type: 'button', 'aria-label': t('share.button'), onclick: (e) => shareClimb(r, e.currentTarget) }, lineIcon(SHARE_ICON)),
          h('button', { class: 'icon-btn act-btn', type: 'button', 'aria-pressed': String(editing), 'aria-label': editing ? t('climb.done') : t('climb.edit'), onclick: () => { editing = !editing; draw(); } }, lineIcon(editing ? CHECK_ICON : PENCIL_ICON)))),
      // Edição de cor e grau (num projeto, as tentativas seguintes usam a cor/grau da raiz).
      editing && h('section', { class: 'card stack' },
        h('div', {}, h('h2', {}, t('climb.color')),
          h('div', { class: 'chips', role: 'group' }, COLORS.map((col) =>
            h('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur.color === col), onclick: () => patchClimb({ color: col }) }, swatch(col), colorName(col))))),
        h('div', {}, h('h2', {}, t('climb.grade')),
          h('div', { class: 'chips scroll', role: 'group' }, S.GRADES.map((g) =>
            h('button', { class: 'chip grade', type: 'button', 'aria-pressed': String(cur.grade === g), onclick: () => patchClimb({ grade: g }) }, grade(g)))))),

      r.photoType && (holdEdit
        ? h('section', { class: 'stack' },
          holdEdit.canvas
            ? scanning(holdEdit.status === 'loading', stage([holdEdit.canvas, holdsOverlay(holdEdit.holds, holdEdit.boxes ?? [])], tapHold, holdEdit.zoom,
              (x, y) => { if (cycleRole(holdEdit.holds, x, y)) { playTick(); draw(); } },
              holdEdit.paint ? holdBrush({
                boxes: () => holdEdit.boxes ?? [], aspect: () => holdEdit.canvas.width / holdEdit.canvas.height,
                isIn: (b) => holdEdit.holds.some((x) => x === b || (b.x + b.w / 2 >= x.x && b.x + b.w / 2 <= x.x + x.w && b.y + b.h / 2 >= x.y && b.y + b.h / 2 <= x.y + x.h)),
                add: (b) => holdEdit.holds.push(b),
                remove: (b) => { holdEdit.holds = holdEdit.holds.filter((x) => !(x === b || (b.x + b.w / 2 >= x.x && b.x + b.w / 2 <= x.x + x.w && b.y + b.h / 2 >= x.y && b.y + b.h / 2 <= x.y + x.h))); },
                done: () => draw(),
              }) : null))
            : null,
          h('p', { class: `small detect-status ${holdEdit.status}` },
            holdEdit.status === 'loading' ? t('detect.loading') : holdEdit.status === 'failed' ? t('detect.failed') : t('holds.hint', { n: holdEdit.holds.length })),
          holdEdit.boxes && h('button', { class: `btn small-btn brush-btn ${holdEdit.paint ? 'primary' : ''}`, type: 'button', 'aria-pressed': String(!!holdEdit.paint), onclick: () => { holdEdit.paint = !holdEdit.paint; draw(); } },
            '🖌 ', holdEdit.paint ? t('brush.on') : t('brush.off')),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost grow', type: 'button', onclick: () => { holdEdit = null; draw(); } }, t('holds.cancel')),
            h('button', { class: 'btn primary grow', type: 'button', onclick: saveHolds }, t('holds.save'))))
        : [(() => {
          const i = navList.indexOf(id);
          const go = (d) => { const nid = navList[i + d]; if (nid) location.replace(`#/climb/${nid}`); };
          return withNav(climbStage(photo?.url ?? r.thumbUrl, r), i > 0, i >= 0 && i < navList.length - 1, go);
        })(),
          h('button', { class: 'link small', type: 'button', onclick: startHoldEdit }, t('holds.edit'))]),

      h('section', { class: 'card stack' },
        seg(RESULTS.map((x) => [x, t(`result.${x}`)]), cur.result, (x) => patchClimb({ result: x })),
        cur.note && h('p', { class: 'muted' }, cur.note),
        h('p', { class: 'muted small' }, fmtDate(cur.createdAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }), ', ', gymOf(state.sessions.find((s) => s.id === cur.sessionId)?.gymId)?.name ?? r.gymName ?? '')),

      proj && h('section', { class: 'card' },
        h('h2', {}, t('climb.project')),
        h('p', { class: 'num' }, proj.sentAt
          ? t('climb.projectSent', { d: fmtDate(proj.sentAt, { day: 'numeric', month: 'long' }) })
          : proj.dropped ? t('project.droppedOn', { d: fmtDate(r.droppedAt ?? r.createdAt, { day: 'numeric', month: 'long' }) })
            : proj.sessions ? t('climb.projectProgress', { s: sessionsText(proj.sessions) }) : t('project.notYet')),
        // Projeto aberto: registrar a nova tentativa direto daqui, na sessão de hoje.
        !proj.sentAt && !proj.dropped && h('div', { class: 'row project-actions' },
          h('button', { class: 'btn go big grow', type: 'button', onclick: (e) => logTry(r, 'sent', e.currentTarget) }, t('project.sent')),
          h('button', { class: 'btn big grow', type: 'button', onclick: (e) => logTry(r, 'project', e.currentTarget) }, t('project.again'))),
        !proj.sentAt && h('button', {
          class: 'btn ghost block', type: 'button',
          onclick: () => api(`/climbs/${r.id}`, { method: 'PATCH', body: { dropped: !proj.dropped } }).then((x) => { upsert(state.climbs, x); draw(); }, fail),
        }, proj.dropped ? t('project.reopen') : t('project.drop')),
        h('ul', { class: 'list' }, tries.map(climbRow))),

      r.photoType && h('section', { class: 'card stack' },
        h('h2', {}, t('ai.title')),
        ai
          ? [
            h('p', { class: 'muted small' }, t('ai.disclaimer')),
            h('div', {}, h('div', { class: 'small muted' }, t('ai.angle')),
              seg(WALL_ANGLES.map((a) => [a, t(`angle.${a}`)]), ai.wallAngle, (a) => patchAi({ wallAngle: a }))),
            h('div', {}, h('div', { class: 'small muted' }, t('ai.holds')),
              h('div', { class: 'chips' }, HOLD_TYPES.map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ai.holdTypes.includes(x)), onclick: () => patchAi({ holdTypes: toggle(ai.holdTypes, x, 7) }) }, t(`hold.${x}`))))),
            h('div', {}, h('div', { class: 'small muted' }, t('ai.style')),
              h('div', { class: 'chips' }, STYLE_TAGS.map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ai.styleTags.includes(x)), onclick: () => patchAi({ styleTags: toggle(ai.styleTags, x, 3) }) }, t(`style.${x}`))))),
          ]
          : h('button', { class: 'btn block', type: 'button', onclick: analyze }, t('ai.analyze'))),

      h('button', { class: 'btn ghost danger block', type: 'button', onclick: del },
        cur.id === r.id && tryIds().length ? t('climb.deleteProject', { n: tryIds().length + 1 }) : t('climb.delete')),
    );
  };

  draw();
  if (root.photoType) api(`/climbs/${root.id}/media`).then((m) => { photo = { url: m.photoUrl }; draw(); }, () => {});
  return box;
}

export const capitalize = (x) => x.charAt(0).toUpperCase() + x.slice(1);

export function debounce(fn, ms) {
  let tm;
  return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); };
}

// ---------- compartilhar ----------
/** Gera o link e abre a folha com "Enviar" (compartilhamento nativo, chamado direto do toque,
 *  como o iOS exige) e "Copiar link". */
export async function shareClimb(c, btn) {
  btn.disabled = true;
  try {
    const { token } = await api(`/climbs/${c.id}/share`, { method: 'POST' });
    const url = `${location.origin}/#/s/${token}`;
    const gym = gymOf(state.sessions.find((s) => s.id === c.sessionId)?.gymId)?.name ?? c.gymName;
    // "essa via vermelha V3" (cor "outra" fica só "essa via V3")
    const cn = c.color === 'other' ? '' : colorName(c.color).toLowerCase();
    const text = (gym ? t('share.textGym', { c: cn, g: grade(c.grade), gym }) : t('share.text', { c: cn, g: grade(c.grade) })).replace(/ {2,}/g, ' ');
    const copy = async () => {
      try { await navigator.clipboard.writeText(url); toast(t('share.copied')); } catch { toast(url); }
    };
    openSheet(h('div', { class: 'stack' },
      h('h2', {}, t('share.title')),
      h('p', { class: 'muted' }, t('share.lead')),
      h('input', { type: 'text', value: url, readonly: true, onfocus: (e) => e.target.select() }),
      navigator.share && h('button', { class: 'btn primary big block', type: 'button', onclick: () => navigator.share({ title: 'Chalkmark', text, url }).catch(() => {}) }, t('share.send')),
      h('button', { class: 'btn block', type: 'button', onclick: copy }, t('share.copy')),
      h('button', {
        class: 'link small danger-link', type: 'button',
        onclick: async (e) => {
          const b = e.currentTarget;
          if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = t('share.revokeConfirm'); return; }
          b.disabled = true;
          try { await api(`/climbs/${c.id}/share`, { method: 'DELETE' }); $('#sheet').close(); toast(t('share.revoked')); } catch (err) { fail(err); }
        },
      }, t('share.revoke'))));
  } catch (err) { fail(err); }
  btn.disabled = false;
}

/** Boulder recebido por link: ver e adicionar aos próprios projetos. */
export function viewShare(token) {
  const box = h('div', { class: 'stack' }, h('p', { class: 'small detect-status loading' }, t('share.loading')));
  (guestMode ? publicApi : api)(`/shares/${token}`).then((sh) => {
    if (guestMode) setTimeout(needAccount, 1200);
    const add = async (e) => {
      if (guestMode) { needAccount(); return; }
      e.currentTarget.disabled = true;
      try {
        const climb = await api(`/shares/${token}/accept`, { method: 'POST' });
        state.climbs.push(climb);
        playTick();
        toast(t('share.added'));
        location.replace(`#/climb/${climb.id}`);
        if (sh.owner && !sh.owner.following) setTimeout(() => followSharer(sh.owner), 900);
      } catch (err) { fail(err); e.target.disabled = false; }
    };
    fill(box,
      h('p', { class: 'muted small' }, sh.owner ? t('share.receivedFrom', { n: sh.owner.name }) : t('share.received')),
      h('h1', { class: 'row' }, swatch(sh.color), colorName(sh.color), h('span', { class: 'grade-pill' }, grade(sh.grade))),
      sh.gymName && h('p', { class: 'muted' }, t('share.atGym', { gym: sh.gymName })),
      sh.owner && h('div', { class: 'row' },
        h('a', { class: 'row person grow', href: `#/u/${sh.owner.handle}` }, avatar(sh.owner), h('span', {}, h('strong', {}, sh.owner.name), h('span', { class: 'muted small' }, ` @${sh.owner.handle}`))),
        !sh.mine && followButton(sh.owner)),
      sh.photoUrl && climbStage(sh.photoUrl, sh),
      sh.ai && h('div', { class: 'chips' },
        sh.ai.wallAngle && h('span', { class: 'chip' }, t(`angle.${sh.ai.wallAngle}`)),
        (sh.ai.holdTypes ?? []).map((x) => h('span', { class: 'chip' }, t(`hold.${x}`)))),
      isIOS() && !standalone() && h('section', { class: 'card stack small' },
        h('strong', {}, t('deeplink.iosTitle')), h('p', { class: 'muted' }, t('deeplink.iosLead')),
        h('button', { class: 'btn block', type: 'button', onclick: async (e) => {
          try { await navigator.clipboard.writeText(location.href); e.target.textContent = t('share.copied'); } catch { toast(location.href); }
        } }, t('share.copy'))),
      sh.mine
        ? h('p', { class: 'muted' }, t('share.mine'))
        : h('button', { class: 'btn go big block', type: 'button', onclick: add }, t('share.add')));
  }, (err) => fill(box, h('p', { class: 'muted' }, err.status === 404 ? t('share.gone') : t('error.generic'))));
  return box;
}

/** Depois de adicionar um boulder compartilhado: sugere seguir quem mandou. */
export function followSharer(owner) {
  if (owner.following || $('#sheet').open) return;
  const btn = followButton(owner, () => setTimeout(() => $('#sheet').close(), 400));
  btn.classList.add('grow');
  openSheet(h('div', { class: 'stack center' },
    avatar(owner, 72),
    h('h2', {}, t('share.followTitle', { n: owner.name })),
    h('p', { class: 'muted' }, t('share.followLead')),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', type: 'button', onclick: () => $('#sheet').close() }, t('guest.notNow')), btn)));
}

// ---------- foto com zoom ----------
/** Quadro da foto com pinça para ampliar só a foto (não a página) e arrastar quando ampliada.
 *  Toque curto sem mexer = onTap(x, y) em coordenadas 0-1 da foto, já descontando o zoom. */
export function stage(content, onTap, z = { k: 1, x: 0, y: 0 }, onLong = null, paint = null) {
  const inner = h('div', { class: 'zoom' }, content);
  const reset = h('button', { class: 'zoom-reset', type: 'button', hidden: true, onclick: (e) => { e.stopPropagation(); z.k = 1; z.x = z.y = 0; apply(); } }, t('zoom.reset'));
  // Pintar: com o pincel ligado, arrastar um dedo marca/desmarca as agarras por onde passa (a página não rola).
  const box = h('div', { class: `stage ${paint ? 'painting' : ''}` }, inner, reset);
  const pts = new Map();
  let start = null; // gesto atual: posição, zoom e distância iniciais
  const apply = () => {
    const w = box.clientWidth, hh = box.clientHeight;
    // Não deixa a foto sair do quadro.
    z.x = Math.min(0, Math.max(w - w * z.k, z.x));
    z.y = Math.min(0, Math.max(hh - hh * z.k, z.y));
    inner.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.k})`;
    box.classList.toggle('zoomed', z.k > 1.01);
    reset.hidden = z.k <= 1.01;
  };
  const snapshot = () => {
    const [a, b] = [...pts.values()];
    const r = box.getBoundingClientRect();
    const mid = b ? { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } : { x: a.x - r.left, y: a.y - r.top };
    return { mid, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, k: z.k, x: z.x, y: z.y, n: pts.size };
  };
  let longTimer;
  const at = (cx, cy) => {
    const r = inner.getBoundingClientRect(); // já com o zoom aplicado
    return [Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height))];
  };
  box.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t0: Date.now(), x0: e.clientX, y0: e.clientY });
    start = snapshot();
    clearTimeout(longTimer);
    if (pts.size > 1) start.multi = true;
    else if (onLong) {
      // Segurar ~0,5 s parado = toque longo (marca início/topo).
      const g = start;
      longTimer = setTimeout(() => {
        if (g !== start || g.moved || g.multi || pts.size !== 1) return;
        g.long = true;
        try { navigator.vibrate?.(25); } catch {}
        onLong(...at(e.clientX, e.clientY));
      }, 500);
    }
  });
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  box.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) start.moved = true;
    if (paint && pts.size === 1 && start.n === 1 && !start.multi) {
      start.painted = true;
      paint.stroke(...at(e.clientX, e.clientY), inner);
      return;
    }
    const now = snapshot();
    if (pts.size === 2 && start.dist) {
      const k = Math.min(5, Math.max(1, start.k * (now.dist / start.dist)));
      // Mantém o ponto entre os dedos parado enquanto amplia.
      z.x = now.mid.x - ((start.mid.x - start.x) / start.k) * k;
      z.y = now.mid.y - ((start.mid.y - start.y) / start.k) * k;
      z.k = k;
      apply();
    } else if (pts.size === 1 && z.k > 1.01 && start.n === 1) {
      z.x = start.x + (now.mid.x - start.mid.x);
      z.y = start.y + (now.mid.y - start.mid.y);
      apply();
    }
  });
  const end = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    pts.delete(e.pointerId);
    clearTimeout(longTimer);
    if (paint && start.painted && !pts.size) { paint.end(); return; }
    if (e.type === 'pointerup' && onTap && !pts.size && !start.multi && !start.moved && !start.long && Date.now() - p.t0 < 600) {
      onTap(...at(e.clientX, e.clientY));
    }
    if (pts.size) start = { ...snapshot(), multi: true };
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  // Redesenho com zoom já aplicado: reaplica assim que o quadro tiver tamanho.
  if (z.k > 1.01) requestAnimationFrame(apply);
  return box;
}

/** Foto que aparece na hora: começa pela miniatura (leve) e troca pela grande quando ela chega;
 *  se a grande falhar (upload que não terminou), a miniatura fica. */
export function photoImg(full, thumb) {
  const img = h('img', { src: thumb || full, alt: '', decoding: 'async', class: 'fade', onload: (e) => e.target.classList.add('in'), onerror: () => { if (img.src !== full && full) img.src = full; } });
  if (thumb && full && full !== thumb) {
    const pre = new Image();
    pre.onload = () => { img.src = full; };
    pre.src = full;
  }
  return img;
}

/** Prévia minúscula (24 px, borrada pelo CSS) em data URL: ~1 KB, vai junto do boulder e aparece na hora. */
export function tinyPreview(source) {
  const w = 24, hh = Math.max(1, Math.round((24 * source.height) / source.width));
  const c = h('canvas', { width: w, height: hh });
  c.getContext('2d').drawImage(source, 0, 0, w, hh);
  const url = c.toDataURL('image/webp', 0.5);
  return url.startsWith('data:image/webp') && url.length < 3000 ? url : c.toDataURL('image/jpeg', 0.5);
}
/** Fundo com a prévia borrada para um quadro de foto (some quando a foto chega). */
export const lqipStyle = (c) => (c?.lqip ? { 'background-image': `url("${c.lqip}")` } : null);

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

// ---------- navegar entre boulders (‹ › e arrastar, como no Instagram) ----------
/** Ids na ordem da lista de onde o boulder foi aberto (perfil, galeria, histórico). */
export let navList = [];
export const setNav = (ids) => { navList = ids; };
/** Setas nas laterais da foto e arrasto horizontal; `go(+1|-1)` troca de boulder. */
export function withNav(el, hasPrev, hasNext, go) {
  if (!el || (!hasPrev && !hasNext)) return el;
  const wrap = h('div', { class: 'nav-wrap' }, el,
    hasPrev && h('button', { class: 'nav-arrow prev', type: 'button', 'aria-label': t('nav.prev'), onclick: (e) => { e.stopPropagation(); go(-1); } }, '‹'),
    hasNext && h('button', { class: 'nav-arrow next', type: 'button', 'aria-label': t('nav.next'), onclick: (e) => { e.stopPropagation(); go(1); } }, '›'));
  // Arrasto: só quando a foto não está ampliada (aí o arrasto move a foto).
  let x0 = null, y0 = 0;
  wrap.addEventListener('touchstart', (e) => {
    x0 = e.touches.length === 1 && !el.classList.contains('zoomed') && !el.querySelector('.zoomed') ? e.touches[0].clientX : null;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0 && hasNext) go(1); else if (dx > 0 && hasPrev) go(-1); }
  });
  return wrap;
}

/** Enquanto o detector procura agarras: foto acinzentada com uma faixa de luz descendo. */
export const scanning = (on, el) => { if (on) el.classList.add('detecting'); return el; };

/** Foto de um boulder com as agarras da via marcadas. */
export const climbStage = (url, c, onOpen) => url && withLqip(c, stage([
  photoImg(url, c.thumbUrl),
  holdsOverlay(c.holds)], onOpen ? () => onOpen() : undefined));
export const withLqip = (c, el) => { if (c?.lqip) el.style.setProperty('--lqip', `url("${c.lqip}")`); return el; };
