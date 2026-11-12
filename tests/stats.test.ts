import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flashRate, gradeLabel, projects, pyramid, sessionSummaries, streakWeeks, weeklyGrades, weekStart } from '../web/src/stats.js';

const c = (id: string, at: string, grade: number, result: string, extra: object = {}) =>
  ({ id, createdAt: `${at}T15:00:00`, grade, result, attempts: 2, sessionId: at, ...extra });

const climbs = [
  c('a', '2026-11-02', 3, 'flash'),
  c('b', '2026-11-02', 5, 'sent'),
  c('c', '2026-11-04', 4, 'sent'),
  c('d', '2026-11-04', 6, 'project'),
  c('e', '2026-11-10', 6, 'project', { projectId: 'd' }),
  c('f', '2026-11-11', 6, 'sent', { projectId: 'd' }),
];

test('semana começa na segunda', () => {
  assert.equal(weekStart('2026-11-08T15:00:00'), '2026-11-02'); // domingo
  assert.equal(weekStart('2026-11-09T15:00:00'), '2026-11-09'); // segunda
});

test('grau por semana usa só vias mandadas', () => {
  assert.deepEqual(weeklyGrades(climbs), [
    { week: '2026-11-02', max: 5, median: 4, count: 3 },
    { week: '2026-11-09', max: 6, median: 6, count: 1 },
  ]);
});

test('pirâmide, flash e rótulos de grau', () => {
  assert.deepEqual(pyramid(climbs).map((p) => [p.grade, p.sends, p.flashes]), [[6, 1, 0], [5, 1, 0], [4, 1, 0], [3, 1, 1]]);
  assert.equal(flashRate(climbs), 0.25);
  assert.equal(gradeLabel(4), 'V4');
  assert.equal(gradeLabel(4, 'font'), '6B+');
});

test('projeto acumula tentativas entre sessões até mandar', () => {
  const [p] = projects(climbs);
  assert.equal(p.root.id, 'd');
  assert.equal(p.attempts, 6);
  assert.equal(p.sessions, 3);
  assert.equal(p.sentAt, '2026-11-11T15:00:00');
});

test('sequência de semanas e resumo de sessão', () => {
  const sessions = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'].map((d) => ({ id: d, startedAt: `${d}T15:00:00` }));
  assert.equal(streakWeeks(sessions, new Date('2026-11-12T12:00:00')), 4);
  assert.equal(streakWeeks(sessions, new Date('2026-11-18T12:00:00')), 4); // semana atual ainda vazia
  assert.equal(streakWeeks(sessions, new Date('2026-11-25T12:00:00')), 0);
  const [s] = sessionSummaries([{ id: '2026-11-02', startedAt: '2026-11-02T14:00:00' }], climbs);
  assert.deepEqual([s.climbs, s.attempts, s.sends, s.maxGrade], [2, 4, 2, 5]);
});

test('metas e calendário', async () => {
  const { sessionsThisWeek, goalReachedAt, climbingDays } = await import('../web/src/stats.js');
  const sessions = ['2026-11-09', '2026-11-11', '2026-11-11', '2026-10-30'].map((d, i) => ({ id: String(i), startedAt: `${d}T15:00:00` }));
  assert.equal(sessionsThisWeek(sessions, new Date('2026-11-12T12:00:00')), 3);
  assert.equal(goalReachedAt(climbs, 5), '2026-11-02T15:00:00');
  assert.equal(goalReachedAt(climbs, 7), null);
  const days = climbingDays(sessions, 2026, 10);
  assert.deepEqual([...days.keys()], [9, 11]);
  assert.equal(days.get(11).length, 2);
});

test('conquistas: recorde de grau, flash, projeto e sequência', async () => {
  const { achievements, newAchievements, weekDots } = await import('../web/src/stats.js');
  const sessions = ['2026-10-26', '2026-11-02', '2026-11-04', '2026-11-10', '2026-11-11'].map((d) => ({ id: d, startedAt: `${d}T15:00:00` }));
  const ids = achievements(sessions, climbs).map((a: { id: string }) => a.id);
  for (const id of ['sessions:1', 'flash:1', 'grade:3', 'grade:6', 'projects:1', 'streak:2']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('streak:4'));
  const before = achievements(sessions, climbs.slice(0, 5));
  assert.deepEqual(newAchievements(before, achievements(sessions, climbs)).map((a: { id: string }) => a.id), ['grade:6', 'projects:1']);
  assert.deepEqual(weekDots(sessions, new Date('2026-11-12T12:00:00')), [false, true, true, false, false, false, false]);
});

test('XP, nível e trilha de graus', async () => {
  const { xpFor, totalXp, level, gradePath } = await import('../web/src/stats.js');
  assert.equal(xpFor({ grade: 4, result: 'sent', attempts: 3 }), 30);
  assert.equal(xpFor({ grade: 4, result: 'flash', attempts: 1 }), 45);
  assert.equal(xpFor({ grade: 4, result: 'project', attempts: 4 }), 8);
  assert.equal(totalXp(climbs), 38 + 35 + 30 + 4 + 4 + 40); // flash V3 arredonda 37,5 → 38
  assert.deepEqual(level(0), { level: 1, into: 0, need: 100 });
  assert.deepEqual(level(350), { level: 3, into: 50, need: 300 });
  const path = gradePath(climbs);
  assert.equal(path.length, 9); // V0..V8 (melhor V6 + 2)
  assert.deepEqual(path[6], { grade: 6, sends: 1, mastered: false, unlocked: true });
  assert.equal(path[8].unlocked, false);
});

test('ginásio mais próximo e conquista de ginásios', async () => {
  const { nearestGym, distanceKm, achievements } = await import('../web/src/stats.js');
  const gyms = [{ id: 'a', loc: { lat: -23.5617, lon: -46.6560 } }, { id: 'b', loc: { lat: -23.6000, lon: -46.7000 } }, { id: 'c' }];
  assert.ok(Math.abs(distanceKm(gyms[0].loc, gyms[1].loc) - 6.2) < 0.3);
  assert.equal(nearestGym(gyms, { lat: -23.5620, lon: -46.6562 })?.id, 'a');
  assert.equal(nearestGym(gyms, { lat: -23.58, lon: -46.68 }), null);
  const sessions = [['a', '2026-11-02'], ['a', '2026-11-04'], ['b', '2026-11-09']].map(([gymId, d], i) => ({ id: String(i), gymId, startedAt: `${d}T15:00:00` }));
  const g2 = achievements(sessions, []).find((x: { id: string }) => x.id === 'gyms:2');
  assert.equal(g2?.at, '2026-11-09T15:00:00');
});

test('projeto editado para "mandou" continua projeto (concluído)', async () => {
  const { projects } = await import('../web/src/stats.js');
  const cs = [
    c('r', '2026-11-02', 6, 'sent'), // raiz editada depois para "mandou"
    c('t', '2026-11-04', 6, 'project', { projectId: 'r' }),
  ];
  const [p] = projects(cs);
  assert.equal(p.root.id, 'r');
  assert.equal(p.attempts, 4);
  assert.ok(p.sentAt);
});

test('projeto aberto: some ao desistir ou depois de 45 dias parado', async () => {
  const { projects, isOpenProject } = await import('../web/src/stats.js');
  const now = Date.parse('2026-11-12T12:00:00');
  const [p] = projects([c('a', '2026-11-02', 5, 'project')]);
  assert.equal(isOpenProject(p, now), true);
  const [gone] = projects([c('a', '2026-11-02', 5, 'project', { dropped: true })]);
  assert.equal(isOpenProject(gone, now), false);
  const [old] = projects([c('a', '2026-09-01', 5, 'project')]);
  assert.equal(isOpenProject(old, now), false);
});

test('styleStats: projeto mandado depois conta como mandado; cópia nunca tentada fica fora', async () => {
  const { styleStats } = await import('../web/src/stats.js');
  const ai = { holdTypes: ['sloper'], wallAngle: 'overhang' };
  const climbs = [
    { id: 'r', result: 'project', attempts: 1, grade: 3, ai },
    { id: 't', result: 'sent', attempts: 1, grade: 3, projectId: 'r' },
    { id: 'c', result: 'project', attempts: 0, grade: 5, ai },
  ];
  const s = styleStats(climbs).find((x) => x.key === 'hold:sloper');
  assert.equal(s.sends, 1);
  assert.equal(s.projects, 0);
  assert.equal(s.maxSent, 3);
});
