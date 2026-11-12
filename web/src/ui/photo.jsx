// Foto do boulder em React: quadro com pinça/arrasto/toque longo/pincel, caixas das agarras e navegação ‹ ›.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n.js';
import { holdAt } from '../detect.js';
import { NS } from '../core.js';

/** Quadro da foto com pinça para ampliar só a foto (não a página) e arrastar quando ampliada.
 *  Toque curto sem mexer = onTap(x, y) em coordenadas 0-1 da foto, já descontando o zoom.
 *  `z` ({k,x,y}) é guardado por quem usa, para o zoom sobreviver ao redesenho.
 *  `paint` (pincel): arrastar um dedo marca/desmarca as agarras por onde passa (a página não rola). */
export function Stage({ children, onTap, z: zIn, onLong, paint, detecting = false, lqip }) {
  const zRef = useRef(zIn ?? { k: 1, x: 0, y: 0 });
  const z = zIn ?? zRef.current;
  const box = useRef(null);
  const inner = useRef(null);
  const reset = useRef(null);
  // Os gestos leem sempre a versão mais nova das funções (mudam a cada redesenho).
  const cb = useRef({});
  cb.current = { onTap, onLong, paint, z };

  useEffect(() => {
    const el = box.current, inn = inner.current, rst = reset.current;
    const zz = () => cb.current.z;
    const apply = () => {
      const zv = zz();
      const w = el.clientWidth, hh = el.clientHeight;
      // Não deixa a foto sair do quadro.
      zv.x = Math.min(0, Math.max(w - w * zv.k, zv.x));
      zv.y = Math.min(0, Math.max(hh - hh * zv.k, zv.y));
      inn.style.transform = `translate(${zv.x}px, ${zv.y}px) scale(${zv.k})`;
      el.classList.toggle('zoomed', zv.k > 1.01);
      rst.hidden = zv.k <= 1.01;
    };
    const pts = new Map();
    let start = null; // gesto atual: posição, zoom e distância iniciais
    let longTimer;
    const snapshot = () => {
      const zv = zz();
      const [a, b] = [...pts.values()];
      const r = el.getBoundingClientRect();
      const mid = b ? { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } : { x: a.x - r.left, y: a.y - r.top };
      return { mid, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, k: zv.k, x: zv.x, y: zv.y, n: pts.size };
    };
    const at = (cx, cy) => {
      const r = inn.getBoundingClientRect(); // já com o zoom aplicado
      return [Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height))];
    };
    const down = (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t0: Date.now(), x0: e.clientX, y0: e.clientY });
      start = snapshot();
      clearTimeout(longTimer);
      if (pts.size > 1) start.multi = true;
      else if (cb.current.onLong) {
        // Segurar ~0,5 s parado = toque longo (marca início/topo).
        const g = start;
        longTimer = setTimeout(() => {
          if (g !== start || g.moved || g.multi || pts.size !== 1) return;
          g.long = true;
          try { navigator.vibrate?.(25); } catch {}
          cb.current.onLong?.(...at(e.clientX, e.clientY));
        }, 500);
      }
    };
    const move = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) start.moved = true;
      const paintNow = cb.current.paint;
      if (paintNow && pts.size === 1 && start.n === 1 && !start.multi) {
        start.painted = true;
        paintNow.stroke(...at(e.clientX, e.clientY), inn);
        return;
      }
      const zv = zz();
      const now = snapshot();
      if (pts.size === 2 && start.dist) {
        const k = Math.min(5, Math.max(1, start.k * (now.dist / start.dist)));
        // Mantém o ponto entre os dedos parado enquanto amplia.
        zv.x = now.mid.x - ((start.mid.x - start.x) / start.k) * k;
        zv.y = now.mid.y - ((start.mid.y - start.y) / start.k) * k;
        zv.k = k;
        apply();
      } else if (pts.size === 1 && zv.k > 1.01 && start.n === 1) {
        zv.x = start.x + (now.mid.x - start.mid.x);
        zv.y = start.y + (now.mid.y - start.mid.y);
        apply();
      }
    };
    const end = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      pts.delete(e.pointerId);
      clearTimeout(longTimer);
      if (cb.current.paint && start.painted && !pts.size) { cb.current.paint.end(inn); return; }
      if (e.type === 'pointerup' && cb.current.onTap && !pts.size && !start.multi && !start.moved && !start.long && Date.now() - p.t0 < 600) {
        cb.current.onTap(...at(e.clientX, e.clientY));
      }
      if (pts.size) start = { ...snapshot(), multi: true };
    };
    const noMenu = (e) => e.preventDefault();
    const resetZoom = (e) => { e.stopPropagation(); const zv = zz(); zv.k = 1; zv.x = zv.y = 0; apply(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', noMenu);
    rst.addEventListener('click', resetZoom);
    // Redesenho com zoom já aplicado: reaplica assim que o quadro tiver tamanho.
    const raf = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(longTimer);
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end);
      el.removeEventListener('contextmenu', noMenu); rst.removeEventListener('click', resetZoom);
    };
  }, []);

  const zoomed = z.k > 1.01;
  return (
    <div ref={box} className={['stage', paint && 'painting', zoomed && 'zoomed', detecting && 'detecting'].filter(Boolean).join(' ')}
      style={lqip ? { '--lqip': `url("${lqip}")` } : undefined}>
      <div className="zoom" ref={inner}>{children}</div>
      <button ref={reset} className="zoom-reset" type="button" hidden={!zoomed}>{t('zoom.reset')}</button>
    </div>
  );
}

/** Caixas das agarras sobre a foto (coordenadas 0-1): da via (com início/topo) e as demais candidatas. */
export function Overlay({ holds, all }) {
  if (!holds?.length && !all?.length) return null;
  const others = (all ?? []).filter((b) => !holds?.includes(b));
  return (
    <svg className="overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      {others.map((b, i) => <rect key={`c${i}`} className="cand" x={b.x} y={b.y} width={b.w} height={b.h} />)}
      {(holds ?? []).flatMap((b, i) => [
        <rect key={`u${i}`} className="under" x={b.x} y={b.y} width={b.w} height={b.h} />,
        <rect key={`h${i}`} className={b.role ?? undefined} x={b.x} y={b.y} width={b.w} height={b.h} />,
      ])}
    </svg>
  );
}

/** Mostra um canvas já desenhado (a foto recém tirada). */
export function CanvasView({ canvas }) {
  const ref = useRef(null);
  useLayoutEffect(() => { ref.current.replaceChildren(canvas); }, [canvas]);
  return <span className="rx" ref={ref} />;
}

/** Foto que aparece na hora: começa pela miniatura (leve) e troca pela grande quando ela chega;
 *  se a grande falhar (upload que não terminou), a miniatura fica. */
export function PhotoImg({ full, thumb }) {
  const [src, setSrc] = useState(thumb || full);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setSrc(thumb || full);
    if (!(thumb && full && full !== thumb)) return undefined;
    const pre = new Image();
    pre.onload = () => setSrc(full);
    pre.src = full;
    return () => { pre.onload = null; };
  }, [full, thumb]);
  return <img src={src} alt="" decoding="async" className={`fade ${loaded ? 'in' : ''}`} onLoad={() => setLoaded(true)} onError={() => { if (src !== full && full) setSrc(full); }} />;
}

/** Foto de um boulder com as agarras da via marcadas. */
export const ClimbStage = ({ url, c, onOpen }) => (url
  ? <Stage onTap={onOpen ? () => onOpen() : undefined} lqip={c?.lqip}><PhotoImg full={url} thumb={c.thumbUrl} /><Overlay holds={c.holds} /></Stage>
  : null);

/** Setas nas laterais da foto e arrasto horizontal; `go(+1|-1)` troca de boulder. */
export function WithNav({ hasPrev, hasNext, go, children }) {
  const g = useRef(null);
  if (!hasPrev && !hasNext) return children;
  // Arrasto: só quando a foto não está ampliada (aí o arrasto move a foto).
  const startT = (e) => {
    g.current = e.touches.length === 1 && !e.currentTarget.querySelector('.zoomed') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  };
  const endT = (e) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0 && hasNext) go(1); else if (dx > 0 && hasPrev) go(-1); }
  };
  return (
    <div className="nav-wrap" onTouchStart={startT} onTouchEnd={endT}>
      {children}
      {hasPrev && <button className="nav-arrow prev" type="button" aria-label={t('nav.prev')} onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>}
      {hasNext && <button className="nav-arrow next" type="button" aria-label={t('nav.next')} onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>}
    </div>
  );
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
      const r = document.createElementNS(NS, 'rect');
      Object.entries({ class: mode === 'add' ? 'painted' : 'unpainted', x: b.x, y: b.y, width: b.w, height: b.h }).forEach(([k, v]) => r.setAttribute(k, v));
      inner.querySelector('.overlay')?.append(r);
    },
    end(inner) {
      mode = null; touched.clear();
      // Tira as marcas provisórias: o redesenho mostra a via já atualizada.
      inner?.querySelectorAll('.overlay .painted, .overlay .unpainted').forEach((n) => n.remove());
      done();
    },
  };
}

/** Toque longo numa agarra marcada: início (verde) → topo (vermelha) → normal. */
export function cycleRole(holds, x, y) {
  const b = holds.filter((hh) => x >= hh.x && x <= hh.x + hh.w && y >= hh.y && y <= hh.y + hh.h).sort((a, c) => a.w * a.h - c.w * c.h)[0];
  if (!b) return false;
  b.role = b.role === 'start' ? 'top' : b.role === 'top' ? undefined : 'start';
  if (!b.role) delete b.role;
  return true;
}
