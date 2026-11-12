import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSubscription, dailyMessage, learnedHour, utcHourFor } from '../services/push.ts';

const TZ = 'America/Sao_Paulo'; // UTC-3, sem horário de verão
const at = (iso: string) => new Date(iso);

test('utcHourFor: 17h em São Paulo = 20h UTC', () => {
  assert.equal(utcHourFor(TZ, 17, at('2026-11-12T12:00:00Z')), 20);
  assert.equal(utcHourFor(TZ, 22, at('2026-11-12T12:00:00Z')), 1);
});

test('learnedHour: 1 h antes da hora em que costuma começar, entre 7 e 21', () => {
  const s = ['2026-11-03T21:10:00Z', '2026-11-05T21:40:00Z', '2026-11-10T22:05:00Z'].map((startedAt) => ({ startedAt })); // 18h-19h local
  assert.equal(learnedHour(s, TZ), 17);
  assert.equal(learnedHour([], TZ), 18);
  assert.equal(learnedHour([{ startedAt: '2026-11-10T09:00:00Z' }], TZ), 7); // 6h local → mínimo 7
});

test('cleanSubscription: só serviços de push conhecidos', () => {
  const keys = { p256dh: 'abc', auth: 'def' };
  assert.ok(cleanSubscription({ endpoint: 'https://web.push.apple.com/QGxyz', keys }));
  assert.ok(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }));
  assert.equal(cleanSubscription({ endpoint: 'https://evil.example.com/x', keys }), null);
  assert.equal(cleanSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: {} }), null);
});

test('dailyMessage: personalizada, pula quem já escalou hoje, prioriza sequência em risco no fim da semana', () => {
  const ctx = { name: 'Vitor', lang: 'pt' as const, tz: TZ, now: at('2026-11-14T20:00:00Z') }; // sábado 17h local
  const lastWeek = [{ startedAt: '2026-11-04T21:00:00Z' }, { startedAt: '2026-10-28T21:00:00Z' }];
  const risk = dailyMessage(lastWeek, [], {}, ctx)!;
  assert.match(risk.title, /Vitor, sua sequência de 2 semanas está em risco/);
  assert.equal(dailyMessage([...lastWeek, { startedAt: '2026-11-14T13:00:00Z' }], [], {}, ctx), null); // escalou hoje
  const project = [{ id: 'p1', color: 'purple', grade: 2, result: 'project', attempts: 1, createdAt: '2026-11-10T22:00:00Z' }];
  const tue = { ...ctx, now: at('2026-11-11T20:00:00Z') }; // quarta
  const msg = dailyMessage([{ startedAt: '2026-11-04T21:00:00Z' }], project, {}, tue)!;
  assert.match(msg.title, /Vitor, aquele roxo V2 ainda te espera/);
  assert.equal(msg.url, '/#/climb/p1');
});

test('dailyMessage: 1 dia em 4 vem uma variada (grau máximo, dias sem parede, marcos, amigo)', () => {
  const ctx = { name: 'Vitor', lang: 'pt' as const, tz: TZ, now: at('2026-11-10T20:00:00Z') }; // terça, dia "variado"
  const sends = [1, 2, 3].map((g, i) => ({ id: `c${i}`, color: 'blue', grade: g, result: 'sent', attempts: 1, createdAt: '2026-11-02T22:00:00Z' }));
  const msg = dailyMessage([{ startedAt: '2026-11-02T21:00:00Z' }], sends, {}, ctx)!;
  assert.match(msg.title, /^(⏳|📈|🏆|🤝) Vitor/);
  assert.doesNotMatch(msg.title + msg.body, /undefined|NaN/);
  const wed = dailyMessage([{ startedAt: '2026-11-02T21:00:00Z' }], sends, {}, { ...ctx, now: at('2026-11-11T20:00:00Z') })!;
  assert.match(wed.title, /^🧗 Vitor, bora manter/);
});
