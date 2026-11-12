// Sininho: o que aconteceu (novos seguidores, 🔥 nos seus boulders) e as novidades do app.
import { useState } from 'react';
import { lang, t } from '../i18n.js';
import { $, api, guestMode, colorName, grade, emit } from '../core.js';
import { openSheet } from '../session.js';
import { useStore } from './base.jsx';
import { Avatar, relTime } from './social.jsx';
import { track } from '../analytics.js';

/** Novidades do app (mais nova em cima). Ao lançar algo, acrescente aqui. */
const NEWS = [
  { at: '2026-11-12T12:00:00Z', pt: 'Sininho de avisos: veja quem te seguiu e quem deu 🔥 nos seus boulders.', en: 'Notification bell: see who followed you and who gave 🔥 to your boulders.' },
  { at: '2026-11-12T11:00:00Z', pt: 'Sessão e histórico agora ficam na mesma aba. Toque nos números do perfil para ir direto.', en: 'Session and history now share a tab. Tap the numbers on your profile to jump there.' },
  { at: '2026-11-12T10:00:00Z', pt: 'Apagar uma sessão: no histórico, arraste a sessão para a esquerda (ou segure).', en: 'Delete a session: in history, swipe it left (or press and hold).' },
  { at: '2026-11-12T09:00:00Z', pt: 'A primeira avaliação do app vale +50 XP (Ajustes → Avaliar o Chalkmark).', en: 'Your first app rating is worth +50 XP (Settings → Rate Chalkmark).' },
];

const LOCAL_SEEN = 'cm:newsSeen'; // sem conta: guarda no aparelho
const inbox = { items: [], seenAt: null, loaded: false };

/** Busca os avisos (ao abrir o app e ao voltar para ele). */
export async function loadInbox() {
  if (guestMode) { try { inbox.seenAt = localStorage.getItem(LOCAL_SEEN); } catch {} inbox.loaded = true; emit(); return; }
  try { Object.assign(inbox, await api('/inbox'), { loaded: true }); emit(); } catch { /* sem sinal: tenta na próxima */ }
}
const unread = () => {
  const since = inbox.seenAt ?? '';
  return [...inbox.items, ...NEWS].filter((x) => x.at > since).length;
};

export function Bell() {
  useStore();
  if (!inbox.loaded) return null;
  const n = unread();
  return (
    <button className="icon-btn bell" id="open-inbox" type="button" aria-label={n ? t('inbox.titleN', { n }) : t('inbox.title')} onClick={openInbox}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
      {n > 0 && <span className="bell-dot num">{n > 9 ? '9+' : n}</span>}
    </button>
  );
}

function openInbox() {
  const before = inbox.seenAt ?? '';
  track('inbox_opened', { unread: unread() });
  openSheet(<Inbox before={before} />);
  // Marca como visto (o destaque de "novo" continua nesta abertura).
  const now = new Date().toISOString();
  inbox.seenAt = now;
  emit();
  if (guestMode) { try { localStorage.setItem(LOCAL_SEEN, now); } catch {} } else api('/inbox/seen', { method: 'POST' }).catch(() => {});
}

function Inbox({ before }) {
  const [tab, setTab] = useState('all');
  const close = () => $('#sheet').close();
  const events = inbox.items.map((x) => ({ ...x, type: 'event' }));
  const news = NEWS.map((x) => ({ ...x, type: 'news' }));
  const list = (tab === 'news' ? news : tab === 'events' ? events : [...events, ...news]).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="stack">
      <h2>{t('inbox.title')}</h2>
      {!guestMode && <div className="seg-wrap"><SegTabs tab={tab} setTab={setTab} /></div>}
      {list.length
        ? (
          <ul className="list inbox">
            {list.map((x) => (
              <li key={`${x.type}${x.at}${x.from?.handle ?? ''}${x.climbId ?? ''}`} className={x.at > before ? 'new' : undefined}>
                {x.type === 'news'
                  ? <div className="person-row"><span className="inbox-ico" aria-hidden="true">✨</span><div className="grow"><div>{lang === 'pt' ? x.pt : x.en}</div><div className="muted small">{relTime(x.at)}</div></div></div>
                  : (
                    <a className="person-row" href={x.kind === 'fire' ? `#/climb/${x.climbId}` : `#/u/${x.from.handle}`} onClick={close}>
                      <Avatar p={x.from} />
                      <div className="grow">
                        <div><strong>{x.from.name}</strong> {x.kind === 'fire' ? t('inbox.fire', { c: colorName(x.color).toLowerCase(), g: grade(x.grade) }) : t('inbox.follow')}</div>
                        <div className="muted small">{relTime(x.at)}</div>
                      </div>
                      <span aria-hidden="true">{x.kind === 'fire' ? '🔥' : '👋'}</span>
                    </a>
                  )}
              </li>
            ))}
          </ul>
        )
        : <p className="muted">{t('inbox.empty')}</p>}
      <button className="btn ghost block" type="button" onClick={close}>{t('settings.close')}</button>
    </div>
  );
}

const SegTabs = ({ tab, setTab }) => (
  <div className="seg" role="group">
    {[['all', t('inbox.all')], ['events', t('inbox.events')], ['news', t('inbox.news')]].map(([v, l]) => (
      <button key={v} type="button" aria-pressed={String(tab === v)} onClick={() => setTab(v)}>{l}</button>
    ))}
  </div>
);
