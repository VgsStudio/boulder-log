// Estatísticas de evolução, calculadas no navegador a partir dos registros do usuário.
// ponytail: tudo em memória; com dezenas de milhares de registros, agregar no backend.

const FONT = ['4', '5', '5+', '6A+', '6B+', '6C+', '7A', '7A+', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'];
export const GRADES = FONT.map((_, i) => i);
export const gradeLabel = (g, scale = 'v') => (scale === 'font' ? FONT[g] : `V${g}`);

export const isSend = (c) => c.result === 'flash' || c.result === 'sent';

/** Segunda-feira (hora local) da semana da data, como YYYY-MM-DD. */
export function weekStart(iso) {
  const d = new Date(iso);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toLocaleDateString('sv'); // sv = formato ISO local
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Grau máximo e mediano das vias mandadas, por semana (ordem cronológica). */
export function weeklyGrades(climbs) {
  const by = new Map();
  for (const c of climbs.filter(isSend)) {
    const w = weekStart(c.createdAt);
    by.set(w, [...(by.get(w) ?? []), c.grade]);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([week, g]) => ({ week, max: Math.max(...g), median: median(g), count: g.length }));
}

/** Pirâmide: quantas vias mandadas (e quantas de flash) por grau, do maior para o menor. */
export function pyramid(climbs) {
  const by = new Map();
  for (const c of climbs.filter(isSend)) {
    const e = by.get(c.grade) ?? { grade: c.grade, sends: 0, flashes: 0 };
    e.sends++;
    if (c.result === 'flash') e.flashes++;
    by.set(c.grade, e);
  }
  return [...by.values()].sort((a, b) => b.grade - a.grade);
}

export function flashRate(climbs) {
  const sends = climbs.filter(isSend);
  return sends.length ? sends.filter((c) => c.result === 'flash').length / sends.length : 0;
}

/** Semanas seguidas com pelo menos uma sessão, contando até esta semana (ou a anterior). */
export function streakWeeks(sessions, now = new Date()) {
  const weeks = new Set(sessions.map((s) => weekStart(s.startedAt)));
  const d = new Date(weekStart(now.toISOString()) + 'T12:00:00');
  if (!weeks.has(d.toLocaleDateString('sv'))) d.setDate(d.getDate() - 7);
  let n = 0;
  while (weeks.has(d.toLocaleDateString('sv'))) { n++; d.setDate(d.getDate() - 7); }
  return n;
}

/** Resumo de cada sessão (mais recente primeiro). */
export function sessionSummaries(sessions, climbs) {
  return sessions.map((s) => {
    const cs = climbs.filter((c) => c.sessionId === s.id);
    const sent = cs.filter(isSend);
    return {
      ...s,
      climbs: cs.length,
      attempts: cs.reduce((n, c) => n + c.attempts, 0),
      sends: sent.length,
      maxGrade: sent.length ? Math.max(...sent.map((c) => c.grade)) : null,
    };
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Projetos: um registro "project" é a raiz; os seguintes apontam para ela via projectId. */
export function projects(climbs) {
  // Raiz: marcada como projeto, ou já com tentativas ligadas a ela (mesmo que depois
  // tenha sido editada para "mandou" — continua sendo um projeto, agora concluído).
  const roots = climbs.filter((c) => !c.projectId && (c.result === 'project' || climbs.some((x) => x.projectId === c.id)));
  return roots.map((root) => {
    const tries = [root, ...climbs.filter((c) => c.projectId === root.id)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const sent = tries.find(isSend);
    return {
      root,
      attempts: tries.reduce((n, c) => n + c.attempts, 0),
      sessions: new Set(tries.map((c) => c.sessionId)).size,
      sentAt: sent?.createdAt ?? null,
    };
  });
}

/** Estilos (da análise de IA): vias mandadas x em projeto, por tipo de agarra e ângulo. */
export function styleStats(climbs) {
  const out = new Map();
  const add = (key, send) => {
    const e = out.get(key) ?? { key, sends: 0, projects: 0 };
    send ? e.sends++ : e.projects++;
    out.set(key, e);
  };
  for (const c of climbs) {
    if (!c.ai) continue;
    const send = isSend(c);
    for (const h of c.ai.holdTypes ?? []) add(`hold:${h}`, send);
    if (c.ai.wallAngle) add(`angle:${c.ai.wallAngle}`, send);
  }
  return [...out.values()].sort((a, b) => b.sends + b.projects - (a.sends + a.projects));
}

/** Sessões na semana corrente (para a meta semanal). */
export const sessionsThisWeek = (sessions, now = new Date()) =>
  sessions.filter((s) => weekStart(s.startedAt) === weekStart(now.toISOString())).length;

/** Primeira vez que mandou o grau da meta (ou acima); null se ainda não. */
export function goalReachedAt(climbs, goal) {
  if (goal == null) return null;
  const hit = climbs.filter((c) => isSend(c) && c.grade >= goal).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return hit?.createdAt ?? null;
}

/** Dias do mês (hora local) com sessão: Map dia → sessões daquele dia. */
export function climbingDays(sessions, year, month) {
  const days = new Map();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    days.set(d.getDate(), [...(days.get(d.getDate()) ?? []), s]);
  }
  return days;
}

/** Maior sequência de semanas seguidas com sessão e quando cada marca foi atingida. */
function streakMarks(sessions, marks) {
  const weeks = [...new Set(sessions.map((s) => weekStart(s.startedAt)))].sort();
  const hit = {};
  let run = 0, prev = null;
  for (const w of weeks) {
    const expected = prev && new Date(new Date(prev + 'T12:00:00').getTime() + 7 * 86400_000).toLocaleDateString('sv');
    run = w === expected ? run + 1 : 1;
    prev = w;
    for (const m of marks) if (run >= m && !hit[m]) hit[m] = sessions.filter((s) => weekStart(s.startedAt) === w).map((s) => s.startedAt).sort()[0];
  }
  return hit;
}

/** Conquistas desbloqueadas: [{ id, at }]. Ids: tipo:valor (ex.: grade:5, sessions:10). */
export function achievements(sessions, climbs) {
  const out = [];
  const byTime = (a, b) => a.createdAt.localeCompare(b.createdAt);
  const sends = climbs.filter(isSend).sort(byTime);
  const ses = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const nth = (list, n, key = 'createdAt') => list[n - 1]?.[key];
  const add = (id, at) => at && out.push({ id, at });

  for (const n of [1, 10, 25, 50, 100]) add(`sessions:${n}`, nth(ses, n, 'startedAt'));
  for (const n of [10, 50, 100, 250, 500]) add(`sends:${n}`, nth(sends, n));
  const flashes = sends.filter((c) => c.result === 'flash');
  for (const n of [1, 10, 50]) add(`flash:${n}`, nth(flashes, n));
  for (const g of new Set(sends.map((c) => c.grade))) add(`grade:${g}`, sends.find((c) => c.grade === g).createdAt);
  const sent = projects(climbs).filter((p) => p.sentAt).map((p) => p.sentAt).sort();
  for (const n of [1, 5, 10]) add(`projects:${n}`, sent[n - 1]);
  for (const [n, at] of Object.entries(streakMarks(sessions, [2, 4, 8, 12, 26]))) add(`streak:${n}`, at);
  // Ginásios diferentes visitados (momento da 1ª sessão em cada um).
  const firstAt = [...new Map(ses.map((s) => [s.gymId, s.startedAt]).reverse()).values()].sort();
  for (const n of [2, 3, 5, 10]) add(`gyms:${n}`, firstAt[n - 1]);
  const big = ses.find((s) => climbs.filter((c) => c.sessionId === s.id).length >= 10);
  add('big:10', big?.startedAt);
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** O que esta ação desbloqueou (antes x depois). */
export const newAchievements = (before, after) => {
  const had = new Set(before.map((a) => a.id));
  return after.filter((a) => !had.has(a.id));
};

/** Dias (0 = segunda) com sessão na semana corrente. */
export function weekDots(sessions, now = new Date()) {
  const start = weekStart(now.toISOString());
  const days = new Set(sessions.filter((s) => weekStart(s.startedAt) === start).map((s) => (new Date(s.startedAt).getDay() + 6) % 7));
  return [0, 1, 2, 3, 4, 5, 6].map((d) => days.has(d));
}

// ---------- gamificação: XP, nível e trilha de graus ----------
export const MASTERY = 5; // vias mandadas num grau para "dominar" o grau

/** XP de um registro: grau pesa mais; flash rende bônus; projeto rende pelo esforço. */
export function xpFor(c) {
  const base = 10 + c.grade * 5;
  if (c.result === 'flash') return Math.round(base * 1.5);
  if (c.result === 'sent') return base;
  return Math.min(base, 2 * c.attempts); // projeto: 2 XP por tentativa, até o valor da via
}
export const totalXp = (climbs) => climbs.reduce((n, c) => n + xpFor(c), 0);

/** Nível n exige 50·n·(n+1) XP acumulado (100, 300, 600…): sobe rápido no começo, depois desacelera. */
export function level(xp) {
  let n = 0;
  while (50 * (n + 1) * (n + 2) <= xp) n++;
  const floor = 50 * n * (n + 1), ceil = 50 * (n + 1) * (n + 2);
  return { level: n + 1, into: xp - floor, need: ceil - floor };
}

/** Trilha de graus: cada grau até o próximo desafio, com vias mandadas e domínio. */
export function gradePath(climbs) {
  const sends = climbs.filter(isSend);
  const best = Math.max(-1, ...sends.map((c) => c.grade));
  const top = Math.min(17, Math.max(3, best + 2));
  return [...Array(top + 1)].map((_, g) => {
    const n = sends.filter((c) => c.grade === g).length;
    return { grade: g, sends: n, mastered: n >= MASTERY, unlocked: g <= best + 1 };
  });
}

/** Distância em km entre dois pontos {lat, lon} (haversine). */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

/** Ginásio salvo mais perto da posição, se estiver a até `maxKm` (GPS indoor erra bastante). */
export function nearestGym(gyms, pos, maxKm = 0.5) {
  const near = gyms.filter((g) => g.loc).map((g) => ({ g, d: distanceKm(g.loc, pos) })).sort((a, b) => a.d - b.d)[0];
  return near && near.d <= maxKm ? near.g : null;
}
