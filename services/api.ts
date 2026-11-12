// API do Boulder Log. Toda rota passa pelo autorizador JWT do Cognito; o dono
// dos dados é sempre o `sub` do token (pk = USER#sub), nunca algo do corpo.
import { BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { analyzePhoto, COLORS, sanitizeAi } from './ai.ts';
// Mesmas contas de XP/nível/sequência do app (uma fonte só).
import { distanceKm, isSend, level, streakWeeks, totalXp } from '../web/src/stats.js';
import {
  AI_DAILY_LIMIT, ALLOWED_ORIGINS, ddb, HttpError, ID_RE, json, log, newId, nowIso, parseBody, PHOTO_BUCKET, s3, TABLE,
  type HttpEvent, type HttpResult,
} from './common.ts';

const RESULTS = ['flash', 'sent', 'project'] as const;
const PHOTO_TYPES = ['image/webp', 'image/jpeg'] as const;
const MAX_FULL = 4 * 1024 * 1024;
const MAX_THUMB = 400 * 1024;
const MAX_GRADE = 17;
// Compartilhamento: link com código aleatório (128 bits), válido por 90 dias.
const SHARE_RE = /^[A-Za-z0-9_-]{22}$/;
const SHARE_DAYS = 90;
/** Versão do termo de uso das fotos (web/src/i18n.js, chaves terms.*). Mudou o texto → nova versão → novo aceite. */
export const PHOTO_TERMS_VERSION = '2026-11-11';
const URL_SECONDS = 3600;
// @usuário: minúsculas, números, ponto e sublinhado.
const HANDLE_RE = /^[a-z0-9_.]{3,20}$/;
const MAX_AVATAR = 300 * 1024;
// Tetos contra abuso (cadastro é aberto): ginásios por conta, pessoas seguidas, páginas de Scan.
const MAX_GYMS = 20;
const MAX_FOLLOWING = 500;
const MAX_SCAN_PAGES = 10;

// ---------- validação (fronteira de confiança: só passa o que está na lista) ----------
const bad = (field: string): never => { throw new HttpError(400, `INVALID_${field.toUpperCase()}`); };
const int = (v: unknown, min: number, max: number, field: string) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : bad(field);
const str = (v: unknown, max: number, field: string) => (typeof v === 'string' && v.length <= max ? v.trim() : bad(field));
const oneOf = <T extends readonly string[]>(list: T, v: unknown, field: string) => (list.includes(v as string) ? (v as T[number]) : bad(field));
const id = (v: unknown, field: string) => (typeof v === 'string' && ID_RE.test(v) ? v : bad(field));
const unit = (v: unknown, field: string) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : bad(field));

/** Campos editáveis de um boulder. `partial` = PATCH (só valida o que veio). */
export function cleanClimb(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => b[k] !== undefined;
  if (!partial || has('color')) out.color = oneOf(COLORS, b.color, 'color');
  if (!partial || has('grade')) out.grade = int(b.grade, 0, MAX_GRADE, 'grade');
  if (!partial || has('attempts')) out.attempts = int(b.attempts, 1, 999, 'attempts');
  if (!partial || has('result')) out.result = oneOf(RESULTS, b.result, 'result');
  if (has('note')) out.note = str(b.note, 500, 'note');
  if (has('tap')) {
    const t = (b.tap ?? {}) as Record<string, unknown>;
    out.tap = { x: unit(t.x, 'tap'), y: unit(t.y, 'tap') };
  }
  if (has('projectId')) out.projectId = id(b.projectId, 'projectId');
  if (has('holds')) out.holds = cleanHolds(b.holds);
  // Projeto encerrado sem mandar (a via saiu / desistiu); a data vem do servidor.
  if (partial && has('dropped')) {
    if (typeof b.dropped !== 'boolean') bad('dropped');
    out.dropped = b.dropped;
    out.droppedAt = b.dropped ? nowIso() : null;
  }
  if (partial && has('ai')) {
    // Correções manuais do resultado da IA: mesmo saneamento da saída do modelo.
    const a = b.ai as Record<string, unknown>;
    if (!a || typeof a !== 'object') bad('ai');
    out.ai = sanitizeAi(a);
  }
  return out;
}

/** Agarras da via vindas do detector no navegador: caixas normalizadas 0-1, no máximo 80. */
export function cleanHolds(v: unknown) {
  if (!Array.isArray(v) || v.length > 80) bad('holds');
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return (v as Record<string, unknown>[]).map((b) => {
    const [x, y, w, h] = [b?.x, b?.y, b?.w, b?.h].map((n) => unit(n, 'holds'));
    if (w === 0 || h === 0) bad('holds');
    return { x: r3(x), y: r3(y), w: r3(w), h: r3(h) };
  });
}

/** Localização do ginásio (para reconhecer o ginásio na próxima sessão). ~10 m de precisão. */
export function cleanLoc(v: unknown) {
  const l = (v ?? {}) as Record<string, unknown>;
  const ok = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
  if (!ok(l.lat, 90) || !ok(l.lon, 180)) bad('loc');
  return { lat: Math.round((l.lat as number) * 1e4) / 1e4, lon: Math.round((l.lon as number) * 1e4) / 1e4 };
}

export function cleanPalette(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('palette');
  const out: Record<string, number[]> = {};
  for (const [k, lab] of Object.entries(v as object)) {
    oneOf(COLORS, k, 'palette');
    if (!Array.isArray(lab) || lab.length !== 3 || !lab.every((n) => typeof n === 'number' && Math.abs(n) <= 200)) bad('palette');
    out[k] = lab.map((n: number) => Math.round(n * 10) / 10);
  }
  return out;
}

// ---------- DynamoDB ----------
const pkOf = (sub: string) => `USER#${sub}`;

async function queryAll(pk: string, prefix: string) {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':pk': pk, ':p': prefix },
      ExclusiveStartKey,
    }));
    items.push(...(out.Items ?? []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function getItem(pk: string, sk: string) {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }));
  if (!Item) throw new HttpError(404, 'NOT_FOUND');
  return Item;
}

/** UPDATE só dos campos dados, e só se o item existir (senão 404). */
async function patch(pk: string, sk: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) throw new HttpError(400, 'EMPTY_PATCH');
  try {
    const { Attributes } = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk, sk },
      UpdateExpression: 'SET ' + keys.map((k, i) => `#k${i} = :v${i}`).join(', '),
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
      ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, fields[k]])),
      ReturnValues: 'ALL_NEW',
    }));
    return Attributes!;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw new HttpError(404, 'NOT_FOUND');
    throw e;
  }
}

/** Remove pk/sk e devolve o id público. */
const pub = ({ pk: _pk, sk, ...rest }: Record<string, unknown>) => ({ id: String(sk).split('#')[1], ...rest });

// ---------- fotos ----------
const photoKey = (sub: string, climbId: string, size: 'full' | 'thumb') => `photos/${sub}/${climbId}/${size}`;
const signGet = (Key: string) => getSignedUrl(s3, new GetObjectCommand({ Bucket: PHOTO_BUCKET, Key }), { expiresIn: URL_SECONDS });
const signPost = (Key: string, type: string, max: number) =>
  createPresignedPost(s3, {
    Bucket: PHOTO_BUCKET,
    Key,
    Conditions: [['content-length-range', 1, max], ['eq', '$Content-Type', type]],
    Fields: { 'Content-Type': type },
    Expires: 600,
  });

async function withThumb(sub: string, c: Record<string, unknown>) {
  const p = pub(c);
  return c.photoType ? { ...p, thumbUrl: await signGet(photoKey(sub, p.id, 'thumb')) } : p;
}

async function getShare(token: string | undefined) {
  if (!token || !SHARE_RE.test(token)) throw new HttpError(404, 'NOT_FOUND');
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `SHARE#${token}`, sk: 'SHARE' } }));
  if (!Item || (Item.ttl as number) * 1000 < Date.now()) throw new HttpError(404, 'NOT_FOUND');
  return Item;
}

/** Cria um projeto "ainda não tentado" na conta de `sub` a partir do boulder de outra pessoa,
 *  copiando a foto (usado pelo link compartilhado e pelo perfil de um amigo). */
async function copyClimb(sub: string, ownerSub: string, srcId: string, src: Record<string, unknown>, extra: Record<string, unknown>) {
  const climbId = newId();
  const item = {
    pk: pkOf(sub), sk: `CLIMB#${climbId}`,
    color: src.color, grade: src.grade, holds: src.holds, tap: src.tap, ai: src.ai, photoType: src.photoType,
    result: 'project', attempts: 0, sharedBy: ownerSub, ...extra, createdAt: nowIso(),
  };
  if (src.photoType) {
    for (const size of ['full', 'thumb'] as const) {
      await s3.send(new CopyObjectCommand({
        Bucket: PHOTO_BUCKET,
        CopySource: `${PHOTO_BUCKET}/${photoKey(ownerSub, srcId, size)}`,
        Key: photoKey(sub, climbId, size),
        TaggingDirective: 'REPLACE', // não exige permissão de ler as tags da origem
      })).catch((e) => { if (size === 'full') throw e; }); // sem miniatura: segue com a foto grande
    }
  }
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return withThumb(sub, item);
}

// ---------- social: perfil, seguir, ranking ----------
const avatarKey = (sub: string) => `photos/${sub}/avatar`;
const subOfPk = (pk: unknown) => String(pk).slice(5);
/** Texto de busca: minúsculas e sem acento. */
const fold = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function profileOf(sub: string) {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: pkOf(sub), sk: 'PROFILE' } }));
  return Item;
}
async function subOfHandle(handle: string | undefined) {
  if (!handle || !HANDLE_RE.test(handle)) throw new HttpError(404, 'NOT_FOUND');
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `HANDLE#${handle}`, sk: 'HANDLE' } }));
  if (!Item) throw new HttpError(404, 'NOT_FOUND');
  return Item.sub as string;
}
/** Cartão público: o que qualquer pessoa logada vê. */
async function card(p: Record<string, unknown>) {
  const sub = subOfPk(p.pk);
  return { handle: p.handle, name: p.name, avatarUrl: p.avatarType ? await signGet(avatarKey(sub)) : null };
}
/** Perfis de vários usuários (só quem já criou perfil). */
async function profilesOf(subs: string[]) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < subs.length; i += 100) {
    const { Responses } = await ddb.send(new BatchGetCommand({
      RequestItems: { [TABLE]: { Keys: subs.slice(i, i + 100).map((x) => ({ pk: pkOf(x), sk: 'PROFILE' })) } },
    }));
    out.push(...(Responses?.[TABLE] ?? []));
  }
  return out;
}
const followsOf = async (sub: string, kind: 'FOLLOWS#' | 'FOLLOWER#') =>
  (await queryAll(pkOf(sub), kind)).map((x) => String(x.sk).slice(kind.length));
async function isFollowing(a: string, b: string) {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: pkOf(a), sk: `FOLLOWS#${b}` } }));
  return !!Item;
}
/** Boulders a partir de uma data: o id é ordenável pelo tempo (base36 dos ms), então dá para
 *  consultar só o intervalo. */
async function climbsSince(sub: string, since: number) {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :a AND :b',
      ExpressionAttributeValues: { ':pk': pkOf(sub), ':a': `CLIMB#${since.toString(36).padStart(9, '0')}`, ':b': 'CLIMB#~' },
      ExclusiveStartKey,
    }));
    items.push(...(out.Items ?? []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// ---------- cota diária de IA (contador atômico) ----------
async function takeAiQuota(pk: string) {
  const day = nowIso().slice(0, 10);
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk, sk: `AIQUOTA#${day}` },
      UpdateExpression: 'ADD n :one SET #ttl = :ttl',
      ConditionExpression: 'attribute_not_exists(n) OR n < :max',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':max': AI_DAILY_LIMIT, ':ttl': Math.floor(Date.now() / 1000) + 2 * 86400 },
    }));
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw new HttpError(429, 'AI_DAILY_LIMIT');
    throw e;
  }
}

// ---------- rotas ----------
async function route(event: HttpEvent, sub: string): Promise<HttpResult> {
  const pk = pkOf(sub);
  const pid = event.pathParameters?.id;
  const body = () => parseBody(event);

  switch (event.routeKey) {
    case 'GET /api/settings': {
      const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk: 'SETTINGS' } }));
      return json(200, Item ? pub(Item) : {});
    }
    case 'PUT /api/settings': {
      // Atualiza só o que veio (escala, metas, aceite do termo de fotos).
      const b = body();
      const f: Record<string, unknown> = {};
      if (b.scale !== undefined) f.scale = oneOf(['v', 'font'] as const, b.scale, 'scale');
      // Metas: sessões por semana (0 = sem meta) e grau que quer mandar.
      if (b.weeklySessions !== undefined) f.weeklySessions = int(b.weeklySessions, 0, 14, 'weeklySessions');
      if (b.gradeGoal !== undefined) f.gradeGoal = b.gradeGoal === null ? null : int(b.gradeGoal, 0, MAX_GRADE, 'gradeGoal');
      // Aceite do termo: só a versão vigente; data e hora vêm do servidor (registro do consentimento).
      if (b.acceptPhotoTerms !== undefined) {
        if (b.acceptPhotoTerms !== PHOTO_TERMS_VERSION) bad('acceptPhotoTerms');
        f.photoTermsVersion = PHOTO_TERMS_VERSION;
        f.photoTermsAt = nowIso();
      }
      const keys = Object.keys(f);
      if (!keys.length) throw new HttpError(400, 'EMPTY_PATCH');
      const { Attributes } = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk, sk: 'SETTINGS' },
        UpdateExpression: 'SET ' + keys.map((k, i) => `#k${i} = :v${i}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
        ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, f[k]])),
        ReturnValues: 'ALL_NEW',
      }));
      return json(200, pub(Attributes!));
    }
    case 'GET /api/gyms':
      return json(200, (await queryAll(pk, 'GYM#')).map(pub));
    case 'POST /api/gyms': {
      const b = body();
      if ((await queryAll(pk, 'GYM#')).length >= MAX_GYMS) throw new HttpError(409, 'TOO_MANY_GYMS');
      const item = { pk, sk: `GYM#${newId()}`, name: str(b.name, 40, 'name') || bad('name'), palette: b.palette ? cleanPalette(b.palette) : {}, loc: b.loc ? cleanLoc(b.loc) : undefined, createdAt: nowIso() };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return json(201, pub(item));
    }
    case 'PATCH /api/gyms/{id}': {
      const b = body();
      const f: Record<string, unknown> = {};
      if (b.name !== undefined) f.name = str(b.name, 40, 'name') || bad('name');
      if (b.palette !== undefined) f.palette = cleanPalette(b.palette);
      if (b.loc !== undefined) {
        // Local do ginásio só é gravado uma vez (o app nunca move): impede usar o ginásio como sonda de localização.
        if ((await getItem(pk, `GYM#${id(pid, 'id')}`)).loc) bad('loc');
        f.loc = cleanLoc(b.loc);
      }
      return json(200, pub(await patch(pk, `GYM#${id(pid, 'id')}`, f)));
    }

    case 'GET /api/sessions':
      return json(200, (await queryAll(pk, 'SESSION#')).map(pub));
    case 'POST /api/sessions': {
      const b = body();
      const item = { pk, sk: `SESSION#${newId()}`, gymId: id(b.gymId, 'gymId'), startedAt: nowIso() };
      await getItem(pk, `GYM#${item.gymId}`);
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return json(201, pub(item));
    }
    case 'PATCH /api/sessions/{id}': {
      const b = body();
      const f: Record<string, unknown> = {};
      if (b.end === true) {
        // Encerramento automático (saiu do ginásio / esqueceu aberta) informa a hora da última atividade.
        const at = typeof b.endedAt === 'string' ? Date.parse(b.endedAt) : NaN;
        f.endedAt = Number.isFinite(at) && at <= Date.now() && Date.now() - at < 2 * 86400_000 ? new Date(at).toISOString() : nowIso();
        if (b.auto !== undefined) f.autoEnded = oneOf(['left', 'idle'] as const, b.auto, 'auto');
      }
      if (b.feeling !== undefined) f.feeling = int(b.feeling, 1, 5, 'feeling');
      if (b.note !== undefined) f.note = str(b.note, 500, 'note');
      return json(200, pub(await patch(pk, `SESSION#${id(pid, 'id')}`, f)));
    }

    case 'GET /api/climbs': {
      const items = await queryAll(pk, 'CLIMB#');
      return json(200, await Promise.all(items.map((c) => withThumb(sub, c))));
    }
    case 'POST /api/climbs': {
      const b = body();
      const climbId = newId();
      const sessionId = id(b.sessionId, 'sessionId');
      await getItem(pk, `SESSION#${sessionId}`);
      const photoType = b.photoType === undefined ? undefined : oneOf(PHOTO_TYPES, b.photoType, 'photoType');
      if (photoType) {
        const { Item: st } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk: 'SETTINGS' } }));
        if (st?.photoTermsVersion !== PHOTO_TERMS_VERSION) throw new HttpError(403, 'PHOTO_TERMS');
      }
      const item = { pk, sk: `CLIMB#${climbId}`, sessionId, ...cleanClimb(b, false), photoType, createdAt: nowIso() };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      const uploads = photoType && {
        full: await signPost(photoKey(sub, climbId, 'full'), photoType, MAX_FULL),
        thumb: await signPost(photoKey(sub, climbId, 'thumb'), photoType, MAX_THUMB),
      };
      return json(201, { climb: pub(item), uploads });
    }
    case 'PATCH /api/climbs/{id}':
      return json(200, await withThumb(sub, await patch(pk, `CLIMB#${id(pid, 'id')}`, cleanClimb(body(), true))));
    case 'DELETE /api/climbs/{id}': {
      const cid = id(pid, 'id');
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk: `CLIMB#${cid}` } }));
      await s3.send(new DeleteObjectsCommand({
        Bucket: PHOTO_BUCKET,
        Delete: { Objects: (['full', 'thumb'] as const).map((k) => ({ Key: photoKey(sub, cid, k) })), Quiet: true },
      }));
      // Era o boulder fixado no perfil: sai do perfil junto.
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk, sk: 'PROFILE' }, UpdateExpression: 'REMOVE pinned',
        ConditionExpression: 'pinned = :c', ExpressionAttributeValues: { ':c': cid },
      })).catch((e) => { if ((e as Error).name !== 'ConditionalCheckFailedException') throw e; });
      return json(200, { ok: true });
    }
    // ---------- compartilhar um boulder ----------
    case 'POST /api/climbs/{id}/share': {
      const cid = id(pid, 'id');
      const c = await getItem(pk, `CLIMB#${cid}`);
      const token = randomBytes(16).toString('base64url');
      // Fotografia do boulder no momento do compartilhamento; nada da conta de quem compartilha
      // (e-mail, sessões, anotação) vai junto.
      const share = {
        pk: `SHARE#${token}`, sk: 'SHARE',
        ownerSub: sub, climbId: cid,
        color: c.color, grade: c.grade, holds: c.holds, tap: c.tap, ai: c.ai, photoType: c.photoType,
        createdAt: nowIso(),
        ttl: Math.floor(Date.now() / 1000) + SHARE_DAYS * 86400,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: share }));
      log('share.created', { climbId: cid });
      return json(201, { token });
    }
    case 'GET /api/shares/{id}': {
      const sh = await getShare(pid);
      const photoUrl = sh.photoType ? await signGet(photoKey(sh.ownerSub as string, sh.climbId as string, 'full')) : null;
      const { color, grade, holds, tap, ai, createdAt } = sh;
      const owner = await profileOf(sh.ownerSub as string);
      return json(200, { color, grade, holds, tap, ai, createdAt, photoUrl, mine: sh.ownerSub === sub, owner: owner ? await card(owner) : null });
    }
    case 'POST /api/shares/{id}/accept': {
      const sh = await getShare(pid);
      const already = (await queryAll(pk, 'CLIMB#')).find((c) => c.sharedFrom === pid);
      if (already) return json(200, await withThumb(sub, already));
      // Entra como projeto ainda não tentado (sem sessão); a foto é copiada para a conta de quem aceitou.
      const climb = await copyClimb(sub, sh.ownerSub as string, sh.climbId as string, sh, { sharedFrom: pid });
      log('share.accepted', { share: String(pid).slice(0, 4) });
      return json(201, climb);
    }
    // ---------- perfil ----------
    case 'GET /api/profile': {
      const p = await profileOf(sub);
      return json(200, p ? { ...(await card(p)), pinned: p.pinned ?? null } : {});
    }
    case 'PUT /api/profile': {
      const b = body();
      const old = await profileOf(sub);
      const f: Record<string, unknown> = {};
      if (b.name !== undefined) f.name = str(b.name, 40, 'name') || bad('name');
      if (b.handle !== undefined) {
        f.handle = typeof b.handle === 'string' && HANDLE_RE.test(b.handle.trim().toLowerCase()) ? b.handle.trim().toLowerCase() : bad('handle');
      }
      if (!old && (!f.name || !f.handle)) bad('profile');
      if (b.pinned !== undefined) {
        f.pinned = b.pinned === null ? null : id(b.pinned, 'pinned');
        if (f.pinned) await getItem(pk, `CLIMB#${f.pinned}`);
      }
      const avatarType = b.avatarType === undefined ? undefined : oneOf(PHOTO_TYPES, b.avatarType, 'avatarType');
      if (avatarType) f.avatarType = avatarType;
      const p: Record<string, unknown> = { ...old, ...f, pk, sk: 'PROFILE', createdAt: old?.createdAt ?? nowIso() };
      p.search = fold(`${p.name} ${p.handle}`);
      // @ novo: reserva com condição (único) e libera o antigo, tudo junto.
      const tx: Record<string, unknown>[] = [{ Put: { TableName: TABLE, Item: p } }];
      if (p.handle !== old?.handle) {
        tx.push({ Put: { TableName: TABLE, Item: { pk: `HANDLE#${p.handle}`, sk: 'HANDLE', sub }, ConditionExpression: 'attribute_not_exists(pk)' } });
        if (old?.handle) tx.push({ Delete: { TableName: TABLE, Key: { pk: `HANDLE#${old.handle}`, sk: 'HANDLE' } } });
      }
      try {
        await ddb.send(new TransactWriteCommand({ TransactItems: tx as never }));
      } catch (e) {
        if ((e as Error).name === 'TransactionCanceledException') throw new HttpError(409, 'HANDLE_TAKEN');
        throw e;
      }
      return json(200, {
        ...(await card(p)), pinned: p.pinned ?? null,
        upload: avatarType ? await signPost(avatarKey(sub), avatarType, MAX_AVATAR) : undefined,
      });
    }

    // ---------- pessoas ----------
    case 'GET /api/users': {
      // ponytail: Scan nos perfis; com milhares de usuários, índice (GSI) por @.
      const q = fold(str(event.queryStringParameters?.q ?? '', 40, 'q')).replace(/^@/, '');
      if (q.length < 2) return json(200, []);
      const found: Record<string, unknown>[] = [];
      let ExclusiveStartKey: Record<string, unknown> | undefined;
      let pages = 0;
      do {
        const out = await ddb.send(new ScanCommand({
          TableName: TABLE, FilterExpression: 'sk = :p AND contains(#s, :q)',
          ProjectionExpression: 'pk, #h, #n, avatarType',
          ExpressionAttributeNames: { '#s': 'search', '#h': 'handle', '#n': 'name' }, ExpressionAttributeValues: { ':p': 'PROFILE', ':q': q }, ExclusiveStartKey,
        }));
        found.push(...(out.Items ?? []));
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey && found.length < 20 && ++pages < MAX_SCAN_PAGES);
      const following = new Set(await followsOf(sub, 'FOLLOWS#'));
      return json(200, await Promise.all(found.filter((p) => subOfPk(p.pk) !== sub).slice(0, 20)
        .map(async (p) => ({ ...(await card(p)), following: following.has(subOfPk(p.pk)) }))));
    }
    case 'GET /api/users/{handle}': {
      const them = await subOfHandle(event.pathParameters?.handle);
      const p = await profileOf(them);
      if (!p) throw new HttpError(404, 'NOT_FOUND');
      const me = them === sub;
      const [following, followsMe, followers, follows, climbs, sessions] = await Promise.all([
        me ? false : isFollowing(sub, them), me ? false : isFollowing(them, sub),
        followsOf(them, 'FOLLOWER#'), followsOf(them, 'FOLLOWS#'),
        queryAll(pkOf(them), 'CLIMB#'), queryAll(pkOf(them), 'SESSION#'),
      ]);
      const friends = me || (following && followsMe);
      const photo = async (c: Record<string, unknown>) => {
        const cid = String(c.sk).split('#')[1];
        return {
          id: cid, color: c.color, grade: c.grade, result: c.result, createdAt: c.createdAt, holds: c.holds, tap: c.tap,
          thumbUrl: c.photoType ? await signGet(photoKey(them, cid, 'thumb')) : null,
          photoUrl: c.photoType ? await signGet(photoKey(them, cid, 'full')) : null,
        };
      };
      const pinned = p.pinned ? climbs.find((c) => c.sk === `CLIMB#${p.pinned}`) : undefined;
      const sends = climbs.filter(isSend);
      // Tentativas no boulder fixado (raiz + continuações): a "luta" que ele conta.
      const pinnedTries = pinned ? climbs.filter((c) => c.sk === pinned.sk || c.projectId === p.pinned).length : 0;
      const pinnedSent = pinned ? climbs.some((c) => (c.sk === pinned.sk || c.projectId === p.pinned) && isSend(c)) : false;
      return json(200, {
        ...(await card(p)), me, following, followsMe, friends,
        followers: followers.length, follows: follows.length,
        level: level(totalXp(climbs)).level,
        pinned: pinned ? { ...(await photo(pinned)), tries: pinnedTries, sent: pinnedSent } : null,
        // Histórico só para amigos (os dois se seguem).
        stats: friends ? {
          sessions: sessions.length, sends: sends.length,
          maxGrade: sends.length ? Math.max(...sends.map((c) => c.grade as number)) : null,
          streak: streakWeeks(sessions),
        } : null,
        climbs: friends
          ? await Promise.all(climbs.filter((c) => c.photoType && !c.projectId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 60).map(photo))
          : null,
      });
    }
    case 'POST /api/users/{handle}/follow':
    case 'DELETE /api/users/{handle}/follow': {
      const them = await subOfHandle(event.pathParameters?.handle);
      if (them === sub) bad('handle');
      if (!(await profileOf(sub))) throw new HttpError(409, 'NO_PROFILE');
      const keys = [{ pk, sk: `FOLLOWS#${them}` }, { pk: pkOf(them), sk: `FOLLOWER#${sub}` }];
      const on = event.routeKey.startsWith('POST');
      if (on && (await followsOf(sub, 'FOLLOWS#')).length >= MAX_FOLLOWING) throw new HttpError(409, 'TOO_MANY_FOLLOWING');
      const at = nowIso();
      await ddb.send(new TransactWriteCommand({
        TransactItems: on
          ? keys.map((k) => ({ Put: { TableName: TABLE, Item: { ...k, at } } }))
          : keys.map((k) => ({ Delete: { TableName: TABLE, Key: k } })),
      }));
      return json(200, { following: on, followsMe: await isFollowing(them, sub) });
    }
    case 'POST /api/users/{handle}/climbs/{id}/copy': {
      // "Quero tentar": copia um boulder de um amigo para os próprios projetos.
      const them = await subOfHandle(event.pathParameters?.handle);
      if (them === sub || !(await isFollowing(sub, them)) || !(await isFollowing(them, sub))) throw new HttpError(403, 'NOT_FRIENDS');
      const cid = id(pid, 'id');
      const src = await getItem(pkOf(them), `CLIMB#${cid}`);
      return json(201, await copyClimb(sub, them, cid, src, {}));
    }
    case 'GET /api/social': {
      // Ranking da semana (você + quem você segue) e "talvez você conheça".
      const since = Date.parse(str(event.queryStringParameters?.since ?? '', 40, 'since'));
      if (!Number.isFinite(since) || Math.abs(Date.now() - since) > 8 * 86400_000) bad('since');
      const [following, followers, myClimbs, myGyms] = await Promise.all([
        followsOf(sub, 'FOLLOWS#'), followsOf(sub, 'FOLLOWER#'), queryAll(pk, 'CLIMB#'), queryAll(pk, 'GYM#'),
      ]);
      const followerSet = new Set(followers);
      const friends = following.filter((u) => followerSet.has(u));
      const ranked = await Promise.all([sub, ...friends].map(async (u) => ({ u, xp: totalXp(await climbsSince(u, since)) })));
      const people = new Map((await profilesOf([sub, ...friends])).map((p) => [subOfPk(p.pk), p]));
      const ranking = await Promise.all(ranked.filter((r) => people.has(r.u)).sort((a, b) => b.xp - a.xp)
        .map(async (r) => ({ ...(await card(people.get(r.u)!)), weekXp: r.xp, me: r.u === sub })));

      // Talvez você conheça: segue você, te mandou boulder, seguido por quem você segue, mesmo ginásio.
      const skip = new Set([sub, ...following]);
      const why = new Map<string, string>();
      const add = (u: string, reason: string) => { if (!skip.has(u) && !why.has(u)) why.set(u, reason); };
      followers.forEach((u) => add(u, 'followsYou'));
      myClimbs.forEach((c) => { if (c.sharedBy) add(c.sharedBy as string, 'sharedWithYou'); });
      for (const f of friends.slice(0, 20)) (await followsOf(f, 'FOLLOWS#')).forEach((u) => add(u, `via:${f}`));
      const locs = myGyms.filter((g) => g.loc).map((g) => g.loc as { lat: number; lon: number });
      if (locs.length && why.size < 12) {
        // ponytail: Scan nos ginásios de todo mundo; com muitos usuários, geohash num índice.
        let ExclusiveStartKey: Record<string, unknown> | undefined;
        let pages = 0;
        do {
          const out = await ddb.send(new ScanCommand({
            TableName: TABLE, FilterExpression: 'begins_with(sk, :g) AND attribute_exists(loc)',
            ExpressionAttributeValues: { ':g': 'GYM#' }, ProjectionExpression: 'pk, loc', ExclusiveStartKey,
          }));
          // Só "treina perto de você": o nome e o ponto do ginásio da outra pessoa não saem daqui.
          for (const g of out.Items ?? []) if (locs.some((l) => distanceKm(l, g.loc) <= 0.5)) add(subOfPk(g.pk), 'gym');
          ExclusiveStartKey = out.LastEvaluatedKey;
        } while (ExclusiveStartKey && ++pages < MAX_SCAN_PAGES);
      }
      const cand = [...why.keys()].slice(0, 30);
      const profs = new Map((await profilesOf(cand)).map((p) => [subOfPk(p.pk), p]));
      const viaHandles = new Map((await profilesOf(friends.slice(0, 20))).map((p) => [subOfPk(p.pk), p.handle]));
      const suggestions = await Promise.all(cand.filter((u) => profs.has(u)).slice(0, 12).map(async (u) => {
        const [kind, arg] = why.get(u)!.split(/:(.*)/);
        return { ...(await card(profs.get(u)!)), reason: kind, arg: kind === 'via' ? viaHandles.get(arg) ?? null : arg ?? null };
      }));
      return json(200, { ranking, suggestions, following: following.length, followers: followers.length });
    }
    case 'GET /api/climbs/{id}/media': {
      const cid = id(pid, 'id');
      const c = await getItem(pk, `CLIMB#${cid}`);
      return json(200, {
        photoUrl: c.photoType ? await signGet(photoKey(sub, cid, 'full')) : null,
      });
    }
    case 'POST /api/climbs/{id}/analyze': {
      const cid = id(pid, 'id');
      const c = await getItem(pk, `CLIMB#${cid}`);
      if (!c.photoType) throw new HttpError(409, 'NO_PHOTO');
      await takeAiQuota(pk);
      const obj = await s3.send(new GetObjectCommand({ Bucket: PHOTO_BUCKET, Key: photoKey(sub, cid, 'full') }));
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      let ai;
      try {
        ai = await analyzePhoto(bytes, c.photoType as 'image/webp' | 'image/jpeg', { color: c.color as string, tap: c.tap as { x: number; y: number } | undefined });
      } catch (e) {
        // Falha não conta na cota do dia.
        await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk, sk: `AIQUOTA#${nowIso().slice(0, 10)}` }, UpdateExpression: 'ADD n :m', ExpressionAttributeValues: { ':m': -1 } }));
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? (e as { status?: number }).status;
        log('ai.failed', { status, error: (e as Error).message.slice(0, 300) });
        throw new HttpError(503, status === 403 || status === 404 ? 'AI_UNAVAILABLE' : 'AI_FAILED');
      }
      log('ai.analyzed', { holds: ai.holds.length, color: ai.color });
      return json(200, await withThumb(sub, await patch(pk, `CLIMB#${cid}`, { ai, aiAt: nowIso() })));
    }
  }
  throw new HttpError(404, 'ROUTE');
}

export async function handler(event: HttpEvent): Promise<HttpResult> {
  const rid = event.requestContext.requestId;
  try {
    // CSRF: escrita só a partir do próprio site (o JWT já exige login; isto é defesa extra).
    if (event.requestContext.http.method !== 'GET' && !ALLOWED_ORIGINS.includes(event.headers.origin ?? '')) throw new HttpError(403, 'ORIGIN');
    const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
    if (!sub) throw new HttpError(401, 'UNAUTHORIZED');
    return await route(event, sub);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, requestId: rid });
    log('api.error', { requestId: rid, route: event.routeKey, error: (e as Error).name, message: (e as Error).message });
    return json(500, { error: 'INTERNAL', requestId: rid });
  }
}
