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
