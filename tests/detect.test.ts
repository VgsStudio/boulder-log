import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab } from '../web/src/color.js';
import { holdAt, routeHolds } from '../web/src/detect.js';

const box = (x: number, y: number, rgb: [number, number, number], color: string) => ({ x, y, w: 0.04, h: 0.04, lab: rgbToLab(rgb), color });

test('via: mesma cor medida, encadeada pela proximidade', () => {
  const purple: [number, number, number] = [107, 63, 160];
  const chalkyPurple: [number, number, number] = [140, 110, 180];
  const white: [number, number, number] = [236, 236, 230];
  const seed = box(0.40, 0.80, purple, 'purple');
  const boxes = [
    seed,
    box(0.45, 0.70, chalkyPurple, 'white'), // roxa com magnésio que a paleta chamou de branca: entra
    box(0.50, 0.60, purple, 'purple'),      // encadeada pela anterior: entra
    box(0.42, 0.75, white, 'white'),        // branca de verdade, colada: fica de fora
    box(0.95, 0.10, purple, 'purple'),      // roxa de outra via, longe: fica de fora
  ];
  const route = routeHolds(boxes, seed, 1000, 750);
  assert.deepEqual(route.map((b) => boxes.indexOf(b)).sort(), [0, 1, 2]);
  assert.equal(holdAt(boxes, 0.415, 0.815), seed);
});
