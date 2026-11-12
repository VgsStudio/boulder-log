// Notificações (Web Push, padrão VAPID): lembrete diário personalizado perto do horário em que a pessoa
// costuma escalar e avisos de eventos (novo seguidor). Barato de propósito:
// - as chaves VAPID são geradas pelo próprio servidor na 1ª vez e ficam na tabela (CONFIG/VAPID);
// - quem recebe às HH (UTC) fica num "balde" NOTIFY#HH: o agendamento de hora em hora faz uma Query, sem Scan;
// - inscrições inválidas (404/410) são apagadas na hora.
import webpush from 'web-push';
import { createHash } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, log, TABLE } from './common.ts';
import { isOpenProject, isSend, projects, sessionsThisWeek, streakWeeks } from '../web/src/stats.js';

const SITE = 'https://chalkmark.vsoller.com.br';
const pkOf = (sub: string) => `USER#${sub}`;

// ---------- chaves VAPID (geradas uma vez, guardadas na tabela) ----------
let vapid: { publicKey: string; privateKey: string } | undefined;
export async function vapidKeys() {
  if (vapid) return vapid;
  const key = { pk: 'CONFIG', sk: 'VAPID' };
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (Item) return (vapid = { publicKey: Item.publicKey, privateKey: Item.privateKey });
  const k = webpush.generateVAPIDKeys();
  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...key, ...k, createdAt: new Date().toISOString() }, ConditionExpression: 'attribute_not_exists(pk)' }));
    return (vapid = k);
  } catch {
    // Outra execução gerou ao mesmo tempo: vale a que ficou gravada.
    vapid = undefined;
    return vapidKeys();
  }
}

// ---------- inscrições ----------
/** Só serviços de push conhecidos (o servidor faz a requisição: nada de URL arbitrária). */
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];
export function cleanSubscription(v: unknown) {
  const s = (v ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  let url: URL;
  try { url = new URL(String(s.endpoint)); } catch { return null; }
  const ok = url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname)) && String(s.endpoint).length < 1024;
  const p256dh = s.keys?.p256dh, auth = s.keys?.auth;
  if (!ok || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint: url.href, keys: { p256dh, auth } };
}
const subKey = (endpoint: string) => `PUSH#${createHash('sha256').update(endpoint).digest('hex').slice(0, 24)}`;
export async function saveSubscription(sub: string, s: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: pkOf(sub), sk: subKey(s.endpoint), ...s, createdAt: new Date().toISOString() } }));
}
export async function removeSubscription(sub: string, endpoint: string) {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: pkOf(sub), sk: subKey(endpoint) } }));
}

/** Envia para todos os aparelhos da pessoa; apaga os que não existem mais. Devolve quantos receberam. */
export async function pushTo(sub: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  const { publicKey, privateKey } = await vapidKeys();
  const { Items = [] } = await ddb.send(new QueryCommand({
    TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': pkOf(sub), ':s': 'PUSH#' },
  }));
  let sent = 0;
  for (const it of Items) {
    try {
      await webpush.sendNotification({ endpoint: it.endpoint, keys: it.keys }, JSON.stringify(payload), {
        vapidDetails: { subject: SITE, publicKey, privateKey }, TTL: 6 * 3600, urgency: 'normal', timeout: 5000,
      });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: it.pk, sk: it.sk } }));
      else log('push.failed', { status, message: (e as Error).message.slice(0, 200) });
    }
  }
  return sent;
}

// ---------- horário e fuso ----------
/** Hora/data local de um fuso (IANA), sem biblioteca. */
export function localParts(tz: string, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: String(p.weekday) };
}
export const validTz = (tz: unknown) => {
  if (typeof tz !== 'string' || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
};
/** Hora UTC em que é `localHour` no fuso `tz` (hoje). */
export function utcHourFor(tz: string, localHour: number, d = new Date()) {
  const off = (localParts(tz, d).hour - d.getUTCHours() + 24) % 24; // fuso em horas inteiras
  return ((localHour - off) % 24 + 24) % 24;
}
/** Horário do lembrete aprendido das sessões: 1 h antes da hora em que a pessoa costuma começar. */
export function learnedHour(sessions: { startedAt: string }[], tz: string) {
  const hours = sessions.slice(-12).map((s) => localParts(tz, new Date(s.startedAt)).hour).sort((a, b) => a - b);
  if (!hours.length) return 18;
  const median = hours[Math.floor(hours.length / 2)];
  return Math.min(21, Math.max(7, median - 1));
}

// ---------- preferências (liga/desliga, fuso, hora) ----------
export async function setPrefs(sub: string, prefs: { on?: boolean; tz?: string; hour?: number | null; lang?: string }) {
  const { Item: st = {} } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: pkOf(sub), sk: 'SETTINGS' } }));
  const next = {
    pushOn: prefs.on ?? st.pushOn ?? true,
    pushTz: prefs.tz ?? st.pushTz ?? 'America/Sao_Paulo',
    pushHour: prefs.hour === undefined ? st.pushHour ?? null : prefs.hour, // null = automático (aprendido)
    pushLang: prefs.lang ?? st.pushLang ?? 'pt',
  };
  const sessions = (await ddb.send(new QueryCommand({
    TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': pkOf(sub), ':s': 'SESSION#' },
  }))).Items ?? [];
  const hour = next.pushHour ?? learnedHour(sessions as { startedAt: string }[], next.pushTz);
  const bucket = next.pushOn ? `NOTIFY#${String(utcHourFor(next.pushTz, hour)).padStart(2, '0')}` : null;
  // Troca de balde: tira do antigo, põe no novo.
  if (st.pushBucket && st.pushBucket !== bucket) await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: st.pushBucket, sk: sub } }));
  if (bucket) await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: bucket, sk: sub } }));
  const { Attributes } = await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: pkOf(sub), sk: 'SETTINGS' },
    UpdateExpression: 'SET pushOn = :on, pushTz = :tz, pushHour = :h, pushLang = :l, pushBucket = :b',
    ExpressionAttributeValues: { ':on': next.pushOn, ':tz': next.pushTz, ':h': next.pushHour, ':l': next.pushLang, ':b': bucket },
    ReturnValues: 'ALL_NEW',
  }));
  return { ...next, effectiveHour: hour, bucket, ...(Attributes ? {} : {}) };
}

// ---------- mensagem do dia ----------
const COLOR = {
  pt: { green: 'verde', purple: 'roxo', yellow: 'amarelo', white: 'branco', wood: 'madeira', red: 'vermelho', blue: 'azul', black: 'preto', orange: 'laranja', pink: 'rosa', other: '' },
  en: { green: 'green', purple: 'purple', yellow: 'yellow', white: 'white', wood: 'wood', red: 'red', blue: 'blue', black: 'black', orange: 'orange', pink: 'pink', other: '' },
} as const;
type Ctx = { name: string; lang: 'pt' | 'en'; tz: string; now: Date };
type Msg = { title: string; body: string; url: string };

/** Escolhe a mensagem pela situação da pessoa (sequência, semana, projeto, meta). Null = hoje não precisa. */
export function dailyMessage(sessions: Record<string, any>[], climbs: Record<string, any>[], settings: Record<string, any>, ctx: Ctx): Msg | null {
  const { name, lang, tz, now } = ctx;
  // As contas de semana do stats.js usam o fuso do processo: aqui, o da pessoa.
  const prevTz = process.env.TZ;
  process.env.TZ = tz;
  try {
    const today = localParts(tz, now).ymd;
    if (sessions.some((s) => localParts(tz, new Date(s.startedAt)).ymd === today)) return null; // já escalou hoje
    const streak = streakWeeks(sessions as any, now);
    const week = sessionsThisWeek(sessions as any, now);
    const goal = Number(settings.weeklySessions ?? 0);
    const weekday = localParts(tz, now).weekday; // Mon..Sun
    const lateWeek = ['Fri', 'Sat', 'Sun'].includes(weekday);
    const open = projects(climbs as any).filter((p: any) => isOpenProject(p, now.getTime())).sort((a: any, b: any) => String(b.lastAt).localeCompare(String(a.lastAt)));
    const g = (n: number) => (settings.scale === 'font' ? ['4', '5', '5+', '6A+', '6B+', '6C+', '7A', '7A+', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'][n] : `V${n}`);
    const pt = lang === 'pt';
    const n = name ? `${name}, ` : '';
    const N = name || (pt ? 'Ei' : 'Hey');
    const day = Math.floor(now.getTime() / 86400_000);
    const options: Msg[] = [];
    if (week === 0 && streak > 0 && lateWeek) {
      options.push(pt
        ? { title: `🔥 ${n}sua sequência de ${streak} ${streak === 1 ? 'semana' : 'semanas'} está em risco`, body: 'Uma sessão até domingo e ela continua viva. Bora pra parede?', url: '/#/' }
        : { title: `🔥 ${n}your ${streak}-week streak is at risk`, body: 'One session by Sunday keeps it alive. Wall time?', url: '/#/' });
    }
    const p = open[0];
    if (p) {
      const c = COLOR[lang][p.root.color as keyof typeof COLOR.pt] ?? '';
      options.push(pt
        ? { title: `👀 ${N}, aquele ${c} ${g(p.root.grade)} ainda te espera`, body: p.sessions > 1 ? `Você já tentou em ${p.sessions} sessões. Hoje ele sai!` : 'Projeto aberto é projeto pra mandar. Hoje é o dia?', url: `/#/climb/${p.root.id}` }
        : { title: `👀 ${N}, that ${c} ${g(p.root.grade)} is still waiting`, body: p.sessions > 1 ? `You've tried it in ${p.sessions} sessions. Today's the day!` : 'An open project is a project to send. Today?', url: `/#/climb/${p.root.id}` });
    }
    if (goal > 0 && week < goal) {
      const left = goal - week;
      options.push(pt
        ? { title: `🎯 ${n}${left === 1 ? 'falta 1 sessão' : `faltam ${left} sessões`} pra sua meta da semana`, body: 'Cada sessão vale XP e mantém o foguinho aceso.', url: '/#/' }
        : { title: `🎯 ${n}${left} ${left === 1 ? 'session' : 'sessions'} to hit this week's goal`, body: 'Every session earns XP and keeps the flame alive.', url: '/#/' });
    }
    if (week === 0 && streak > 0 && !lateWeek) {
      options.push(pt
        ? { title: `🧗 ${N}, bora manter as ${streak} ${streak === 1 ? 'semana' : 'semanas'}?`, body: 'Sua semana ainda está em branco. Hoje é um ótimo dia pra parede.', url: '/#/' }
        : { title: `🧗 ${N}, keep the ${streak}-week streak going?`, body: "Your week is still empty. Today's a great wall day.", url: '/#/' });
    }
    if (streak === 0) {
      options.push(pt
        ? { title: `💪 ${N}, que tal acender o foguinho hoje?`, body: 'Uma sessão e sua sequência começa. A parede não vai se escalar sozinha.', url: '/#/' }
        : { title: `💪 ${N}, light the flame today?`, body: "One session starts your streak. The wall won't climb itself.", url: '/#/' });
    }
    const sends = climbs.filter(isSend).length;
    if (!options.length) {
      options.push(pt
        ? { title: `✅ ${N}, semana garantida!`, body: sends ? `Já são ${sends} vias mandadas. Mais uma sessão rende XP extra.` : 'Mais uma sessão rende XP extra.', url: '/#/' }
        : { title: `✅ ${N}, week secured!`, body: sends ? `${sends} sends so far. One more session earns extra XP.` : 'One more session earns extra XP.', url: '/#/' });
    }
    // A mais urgente quase sempre; às vezes a segunda, para não repetir todo dia.
    return options[day % 3 === 2 && options.length > 1 ? 1 : 0];
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
}

/** Monta e envia a mensagem do dia de uma pessoa (o agendamento e o "testar" usam isto). */
export async function sendDaily(sub: string, { force = false } = {}) {
  const q = (prefix: string) => ddb.send(new QueryCommand({
    TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': pkOf(sub), ':s': prefix },
  })).then((r) => r.Items ?? []);
  const [{ Item: st = {} }, { Item: prof }, sessions, climbs] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: pkOf(sub), sk: 'SETTINGS' } })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: pkOf(sub), sk: 'PROFILE' } })),
    q('SESSION#'), q('CLIMB#'),
  ]);
  const tz = st.pushTz ?? 'America/Sao_Paulo';
  const today = localParts(tz).ymd;
  if (!force && (st.pushOn === false || st.lastPushDay === today)) return { sent: 0, reason: 'skip' };
  const name = String(prof?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const sorted = [...sessions].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const msg = dailyMessage(sorted, climbs.map((c) => ({ ...c, id: String(c.sk).split('#')[1] })), st, { name, lang: st.pushLang === 'en' ? 'en' : 'pt', tz, now: new Date() })
    ?? (force ? { title: st.pushLang === 'en' ? `🧗 ${name || 'Hey'}, notifications are on!` : `🧗 ${name || 'Ei'}, as notificações estão ligadas!`, body: st.pushLang === 'en' ? "You'll get one reminder a day, close to when you usually climb." : 'Você vai receber um lembrete por dia, perto do horário em que costuma escalar.', url: '/#/' } : null);
  if (!msg) return { sent: 0, reason: 'climbed-today' };
  const sent = await pushTo(sub, { ...msg, tag: 'daily' });
  if (!force) await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: pkOf(sub), sk: 'SETTINGS' }, UpdateExpression: 'SET lastPushDay = :d', ExpressionAttributeValues: { ':d': today } }));
  return { sent, title: msg.title };
}

/** Agendamento de hora em hora: quem está no balde desta hora UTC recebe a mensagem do dia. */
export async function notifyHandler() {
  const hour = String(new Date().getUTCHours()).padStart(2, '0');
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  let people = 0, sent = 0;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `NOTIFY#${hour}` }, ExclusiveStartKey }));
    for (const it of r.Items ?? []) {
      people++;
      try {
        // Reaprende o horário (sessões novas, horário de verão): se mudou de balde, recebe no novo amanhã.
        const p = await setPrefs(String(it.sk), {});
        if (p.bucket !== `NOTIFY#${hour}`) continue;
        sent += (await sendDaily(String(it.sk))).sent;
      } catch (e) { log('notify.failed', { message: (e as Error).message.slice(0, 200) }); }
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  log('notify.hour', { hour, people, sent });
  return { hour, people, sent };
}
