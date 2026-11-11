// API do Boulder Log. Toda rota passa pelo autorizador JWT do Cognito; o dono
// dos dados é sempre o `sub` do token (pk = USER#sub), nunca algo do corpo.
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { analyzePhoto, COLORS, sanitizeAi } from './ai.ts';
import {
  AI_DAILY_LIMIT, ALLOWED_ORIGIN, ddb, HttpError, ID_RE, json, log, newId, nowIso, parseBody, PHOTO_BUCKET, s3, TABLE,
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
      const item = { pk, sk: `GYM#${newId()}`, name: str(b.name, 40, 'name') || bad('name'), palette: b.palette ? cleanPalette(b.palette) : {}, loc: b.loc ? cleanLoc(b.loc) : undefined, createdAt: nowIso() };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return json(201, pub(item));
    }
    case 'PATCH /api/gyms/{id}': {
      const b = body();
      const f: Record<string, unknown> = {};
      if (b.name !== undefined) f.name = str(b.name, 40, 'name') || bad('name');
      if (b.palette !== undefined) f.palette = cleanPalette(b.palette);
      if (b.loc !== undefined) f.loc = cleanLoc(b.loc);
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
      if (b.end === true) f.endedAt = nowIso();
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
      return json(200, { color, grade, holds, tap, ai, createdAt, photoUrl, mine: sh.ownerSub === sub });
    }
    case 'POST /api/shares/{id}/accept': {
      const sh = await getShare(pid);
      const climbId = newId();
      // Entra como projeto ainda não tentado (sem sessão); a foto é copiada para a conta de quem aceitou.
      const item = {
        pk, sk: `CLIMB#${climbId}`,
        color: sh.color, grade: sh.grade, holds: sh.holds, tap: sh.tap, ai: sh.ai, photoType: sh.photoType,
        result: 'project', attempts: 0, sharedFrom: pid, createdAt: nowIso(),
      };
      if (sh.photoType) {
        for (const size of ['full', 'thumb'] as const) {
          await s3.send(new CopyObjectCommand({
            Bucket: PHOTO_BUCKET,
            CopySource: `${PHOTO_BUCKET}/${photoKey(sh.ownerSub as string, sh.climbId as string, size)}`,
            Key: photoKey(sub, climbId, size),
            TaggingDirective: 'REPLACE', // não exige permissão de ler as tags da origem
          })).catch((e) => { if (size === 'full') throw e; }); // sem miniatura: segue com a foto grande
        }
      }
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      log('share.accepted', { share: String(pid).slice(0, 4) });
      return json(201, await withThumb(sub, item));
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
    if (event.requestContext.http.method !== 'GET' && event.headers.origin !== ALLOWED_ORIGIN) throw new HttpError(403, 'ORIGIN');
    const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
    if (!sub) throw new HttpError(401, 'UNAUTHORIZED');
    return await route(event, sub);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, requestId: rid });
    log('api.error', { requestId: rid, route: event.routeKey, error: (e as Error).name, message: (e as Error).message });
    return json(500, { error: 'INTERNAL', requestId: rid });
  }
}
