// Base do React: montar telas, estado compartilhado e componentes pequenos usados em todo lugar.
import { isValidElement, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { fmtDate, t } from '../i18n.js';
import { SWATCH } from '../color.js';
import { state, subscribe, getVersion, colorName, grade, rootOf, loadAll } from '../core.js';
import { render } from '../app.js';

// ---------- montar ----------
const roots = new Map(); // contêiner -> root
/** Monta um componente React num contêiner novo (que "some" no layout: display contents). */
export function mount(el) {
  const box = document.createElement('div');
  box.className = 'rx';
  const root = createRoot(box);
  roots.set(box, root);
  root.render(el);
  return box;
}
/** Desmonta as telas que saíram da página (chamado depois de trocar a tela ou a janela). */
export function sweep() {
  for (const [box, root] of roots) if (!box.isConnected) { roots.delete(box); queueMicrotask(() => root.unmount()); }
}
export const isReact = (x) => isValidElement(x);

/** Estado do app (state em core.js): o componente redesenha quando alguém chama emit(). */
export const useStore = () => { useSyncExternalStore(subscribe, getVersion); return state; };

/** Força redesenho local (para objetos mutáveis guardados fora do React). */
export const useRedraw = () => { const [, set] = useState(0); return () => set((n) => n + 1); };

// ---------- componentes ----------
export const Swatch = ({ c }) => <span className={`swatch ${c === 'other' ? 'other' : ''}`} style={c === 'other' ? undefined : { background: SWATCH[c] }} />;

/** Botões de escolha única (segmented). */
export const Seg = ({ options, value, onPick }) => (
  <div className="seg" role="group">
    {options.map(([v, label]) => <button key={String(v)} type="button" data-v={String(v)} aria-pressed={String(v === value)} onClick={() => onPick(v)}>{label}</button>)}
  </div>
);

export function Stepper({ value, min, max, onChange, label }) {
  const set = (n) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <div className="stepper">
      <button type="button" aria-label="−" onClick={() => set(value - 1)}>−</button>
      <output aria-live="polite" aria-label={label}>{value}</output>
      <button type="button" aria-label="+" onClick={() => set(value + 1)}>+</button>
    </div>
  );
}

/** Barra de progresso (largura por variável CSS). */
export const Bar = ({ pct }) => <div className="progress"><span style={{ '--w': `${pct}%` }} /></div>;

/** Linha de boulder nas listas (sessão, histórico, projetos). `meta` troca a linha de baixo. */
export function ClimbRow({ c, meta, onClick }) {
  const root = rootOf(c);
  return (
    <li>
      <a className="climb-row" href={`#/climb/${c.id}`} onClick={onClick}>
        {root.thumbUrl
          ? <img className="thumb" src={root.thumbUrl} alt="" loading="lazy" decoding="async" width={52} height={52} />
          : <div className="thumb color"><Swatch c={c.color} /></div>}
        <div className="grow">
          <div className="title">{colorName(c.color)}<span className="grade-pill">{grade(c.grade)}</span></div>
          <div className="meta">
            {meta ?? <><span>{fmtDate(c.createdAt, { hour: '2-digit', minute: '2-digit' })}</span>{c.projectId && <span>{t('climb.project')}</span>}</>}
          </div>
        </div>
        <span className={`badge ${c.result}`}>{t(`result.${c.result}`)}</span>
      </a>
    </li>
  );
}

/** Prévia borrada (lqip) como fundo de um quadro de foto. */
export const lqipBg = (c) => (c?.lqip ? { backgroundImage: `url("${c.lqip}")` } : undefined);

/** Foto que não carregou: o link assinado (vale 1 h) provavelmente venceu. Busca os dados de novo
 *  (links novos) e redesenha; no máximo uma vez por minuto. */
let lastRefresh = 0;
export function refreshPhotos() {
  if (Date.now() - lastRefresh < 60_000 || !navigator.onLine) return;
  lastRefresh = Date.now();
  loadAll().then(() => render(), () => {});
}

/** Miniatura com esmaecer ao carregar; se falhar, renova os links e tenta de novo. */
export function FadeImg({ src, alt = '', ...rest }) {
  const [st, set] = useState('loading');
  useEffect(() => { set('loading'); }, [src]);
  if (st === 'error') return null;
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={`fade ${st === 'in' ? 'in' : ''}`} onLoad={() => set('in')} onError={() => { set('error'); refreshPhotos(); }} {...rest} />;
}
