import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, rgbToLab, sampleLab, suggest } from '../web/src/color.js';

/** Bloco RGBA uniforme com alguns pixels de ruído (magnésio, sombra). */
const patch = (rgb: number[], noise: number[][] = []) => {
  const px = [...Array(600 - noise.length).fill(rgb), ...noise];
  return Uint8ClampedArray.from(px.flatMap(([r, g, b]) => [r, g, b, 255]));
};
const color = (rgb: number[], noise?: number[][]) => suggest(sampleLab(patch(rgb, noise))).best;

test('cores comuns de agarra, inclusive com luz ruim', () => {
  assert.equal(color([46, 158, 79]), 'green');
  assert.equal(color([30, 110, 55]), 'green'); // verde na sombra
  assert.equal(color([150, 128, 20]), 'yellow'); // amarela na sombra
  assert.equal(color([175, 135, 95]), 'wood');
  assert.equal(color([95, 55, 145]), 'purple');
  assert.equal(color([35, 35, 38]), 'black');
  assert.equal(color([200, 40, 45]), 'red');
});

test('mediana ignora magnésio e sombra em volta', () => {
  const chalk = Array(200).fill([250, 250, 250]);
  const shade = Array(80).fill([10, 10, 10]);
  assert.equal(color([46, 158, 79], [...chalk, ...shade]), 'green');
});

test('azul coberta de magnésio continua azul', () => {
  const chalk = Array(330).fill([205, 208, 212]); // mais da metade da agarra acinzentada
  assert.equal(color([47, 111, 208], chalk), 'blue');
});

test('branca com magnésio continua branca', () => {
  assert.equal(color([238, 238, 232], Array(300).fill([255, 255, 255])), 'white');
});

test('cor longe de tudo vira "other"', () => {
  assert.equal(suggest(rgbToLab([0, 200, 200])).best, 'other');
});

test('calibração aproxima a referência do que o ginásio realmente tem', () => {
  const teal = rgbToLab([0, 170, 160]);
  let palette = calibrate({}, 'green', teal, 1);
  assert.equal(suggest(rgbToLab([5, 165, 155]), palette).best, 'green');
  palette = calibrate(palette, 'other', teal);
  assert.equal(Object.keys(palette).length, 1);
});
