// Modo sem conta: dá para usar o app antes de criar conta. Tudo fica só neste navegador
// (registros no localStorage, fotos no IndexedDB). Depois de 1 dia de uso o app trava pedindo conta;
// os dados ficam guardados por 30 dias e vão junto ao criar conta ou entrar (migrateGuest em app.js).
// Responde às mesmas rotas da API que o app usa.
const KEY = 'cm:guest';
const DAY = 86400_000;
const KEEP = 30 * DAY; // depois disso, apagado
const FREE = DAY; // depois disso, só com conta
const DB = 'cm-guest';

const randomId = () => Date.now().toString(36).padStart(9, '0') + [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('');
const nowIso = () => new Date().toISOString();

let data = null;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
const fresh = (d) => d && Date.now() - d.createdAt <= KEEP;

// ---------- fotos (IndexedDB) ----------
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('photos', mode);
    const r = fn(t.objectStore('photos'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
export const putPhoto = (key, blob) => tx('readwrite', (s) => s.put(blob, key));
export const getPhoto = (key) => tx('readonly', (s) => s.get(key)).catch(() => null);
const urls = new Map();
async function photoUrl(key) {
  if (!urls.has(key)) { const b = await getPhoto(key); if (b) urls.set(key, URL.createObjectURL(b)); }
  return urls.get(key) ?? null;
}

// ---------- estado ----------
/** Começa (ou continua) o modo sem conta; dados com mais de 30 dias são apagados. */
export function startGuest() {
  data = load();
  if (!fresh(data)) { clearGuest(); data = { createdAt: Date.now(), gyms: [], sessions: [], climbs: [], settings: {}, nags: 0 }; save(); }
  return data;
}
export function clearGuest() {
  data = null;
  try { localStorage.removeItem(KEY); } catch {}
  try { indexedDB.deleteDatabase(DB); } catch {}
}
/** Tem algo feito sem conta para levar para a conta? */
export const guestPending = () => { const d = load(); return fresh(d) && (d.sessions.length > 0 || d.climbs.length > 0) ? d : null; };
/** Quantas vezes já pedimos para criar conta (a 1ª dá para dispensar; da 2ª em diante, trava). */
export const guestNags = () => data?.nags ?? 0;
/** Passou 1 dia usando sem conta (ou já recusou criar conta uma vez e seguiu): só com conta. */
export const guestLocked = () => !!data && (Date.now() - data.createdAt > FREE || data.nags >= 2);
export const bumpNags = () => { if (data) { data.nags++; save(); } };

export class NeedAccount extends Error { constructor() { super('NEED_ACCOUNT'); this.code = 'NEED_ACCOUNT'; } }

/** As rotas da API que o app usa, respondidas localmente. O resto exige conta. */
export async function guestApi(path, { method = 'GET', body = {} } = {}) {
  const [, kind, id, sub] = path.split('?')[0].split('/');
  const list = data[kind];
  const find = () => list.find((x) => x.id === id);
  const route = `${method} ${kind}${id ? '/:id' : ''}${sub ? `/${sub}` : ''}`;
  switch (route) {
    case 'GET gyms': case 'GET sessions': return structuredClone(list);
    case 'GET climbs':
      return Promise.all(data.climbs.map(async (c) => ({ ...c, thumbUrl: c.photoType ? await photoUrl(`${c.id}/thumb`) : undefined })));
    case 'GET profile': return {};
    case 'GET settings': return { ...data.settings };
    case 'PUT settings':
      if (body.acceptPhotoTerms) Object.assign(data.settings, { photoTermsVersion: body.acceptPhotoTerms, photoTermsAt: nowIso() });
      for (const k of ['scale', 'weeklySessions', 'gradeGoal']) if (body[k] !== undefined) data.settings[k] = body[k];
      save();
      return { ...data.settings };
    case 'POST gyms': {
      const g = { id: randomId(), name: body.name, palette: body.palette ?? {}, loc: body.loc, createdAt: nowIso() };
      data.gyms.push(g); save(); return g;
    }
    case 'PATCH gyms/:id': { const g = find(); Object.assign(g, body); save(); return g; }
    case 'POST sessions': {
      const s = { id: randomId(), gymId: body.gymId, startedAt: nowIso() };
      data.sessions.push(s); save(); return s;
    }
    case 'PATCH sessions/:id': {
      const s = find();
      if (body.end) s.endedAt = body.endedAt ?? nowIso();
      for (const k of ['feeling', 'note']) if (body[k] !== undefined) s[k] = body[k];
      if (body.auto) s.autoEnded = body.auto;
      save(); return s;
    }
    case 'DELETE sessions/:id': data.sessions = data.sessions.filter((x) => x.id !== id); save(); return { ok: true };
    case 'POST climbs': {
      const c = { ...body, id: randomId(), createdAt: nowIso() };
      data.climbs.push(c); save();
      // "Envio" da foto: em vez do S3, guarda no IndexedDB (upload() em app.js reconhece { guest }).
      const uploads = c.photoType ? { full: { guest: `${c.id}/full` }, thumb: { guest: `${c.id}/thumb` } } : undefined;
      return { climb: structuredClone(c), uploads };
    }
    case 'PATCH climbs/:id': {
      const c = find();
      Object.assign(c, body);
      if (body.dropped !== undefined) c.droppedAt = body.dropped ? nowIso() : null;
      save(); return { ...c, thumbUrl: c.photoType ? await photoUrl(`${c.id}/thumb`) : undefined };
    }
    case 'DELETE climbs/:id': data.climbs = data.climbs.filter((x) => x.id !== id); save(); return { ok: true };
    case 'GET climbs/:id/media': return { photoUrl: await photoUrl(`${id}/full`) };
    default: throw new NeedAccount();
  }
}
