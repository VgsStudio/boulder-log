import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanClimb, cleanHolds } from '../services/api.ts';

test('validação do boulder: aceita o esperado, recusa o resto', () => {
  const ok = cleanClimb({ color: 'blue', grade: 4, attempts: 3, result: 'sent', holds: [{ x: 0.1, y: 0.2, w: 0.05, h: 0.04 }], evil: 'x' }, false);
  assert.deepEqual(ok, { color: 'blue', grade: 4, attempts: 3, result: 'sent', holds: [{ x: 0.1, y: 0.2, w: 0.05, h: 0.04 }] });
  assert.throws(() => cleanClimb({ color: 'neon', grade: 4, attempts: 1, result: 'sent' }, false), /INVALID_COLOR/);
  assert.throws(() => cleanClimb({ grade: 99 }, true), /INVALID_GRADE/);
  assert.throws(() => cleanHolds([{ x: 2, y: 0, w: 0.1, h: 0.1 }]), /INVALID_HOLDS/);
  assert.throws(() => cleanHolds(Array(81).fill({ x: 0, y: 0, w: 0.1, h: 0.1 })), /INVALID_HOLDS/);
});

test('desistir do projeto: só boolean e só em edição', () => {
  const out = cleanClimb({ dropped: true }, true);
  assert.equal(out.dropped, true);
  assert.ok(typeof out.droppedAt === 'string');
  assert.equal(cleanClimb({ dropped: false }, true).droppedAt, null);
  assert.throws(() => cleanClimb({ dropped: 'sim' }, true), /INVALID_DROPPED/);
});

test('cleanHolds: guarda início/topo e recusa papel inventado', () => {
  assert.deepEqual(cleanHolds([{ x: 0.1, y: 0.2, w: 0.05, h: 0.05, role: 'start' }, { x: 0.3, y: 0.1, w: 0.05, h: 0.05 }]),
    [{ x: 0.1, y: 0.2, w: 0.05, h: 0.05, role: 'start' }, { x: 0.3, y: 0.1, w: 0.05, h: 0.05 }]);
  assert.throws(() => cleanHolds([{ x: 0.1, y: 0.2, w: 0.05, h: 0.05, role: 'admin' }]));
  assert.throws(() => cleanHolds(Array(81).fill({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 })));
  assert.equal(cleanHolds(Array(300).fill({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }), 300).length, 300);
});

test('cleanClimb: via sugerida e detector entram validados', () => {
  const out = cleanClimb({ autoHolds: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1, role: 'start' }], detector: 'yolov8n-freeclimbs-2' }, true);
  assert.deepEqual(out.autoHolds, [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }]);
  assert.equal(out.detector, 'yolov8n-freeclimbs-2');
  assert.throws(() => cleanClimb({ detector: 'outro' }, true));
});

test('prévia minúscula (lqip): só data URL de imagem pequena', () => {
  const lqip = 'data:image/webp;base64,UklGRkAAAABXRUJQ';
  assert.equal(cleanClimb({ lqip }, true).lqip, lqip);
  assert.throws(() => cleanClimb({ lqip: 'javascript:alert(1)' }, true), /INVALID_LQIP/);
  assert.throws(() => cleanClimb({ lqip: 'data:image/svg+xml;base64,PHN2Zz4=' }, true), /INVALID_LQIP/);
  assert.throws(() => cleanClimb({ lqip: `data:image/webp;base64,${'A'.repeat(3000)}` }, true), /INVALID_LQIP/);
});

test('formato da foto (aspect): número entre 0,2 e 5', () => {
  assert.equal(cleanClimb({ aspect: 0.75 }, true).aspect, 0.75);
  assert.equal(cleanClimb({ aspect: 1.33333 }, true).aspect, 1.333);
  assert.throws(() => cleanClimb({ aspect: 9 }, true), /INVALID_ASPECT/);
  assert.throws(() => cleanClimb({ aspect: 'x' }, true), /INVALID_ASPECT/);
});
