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

test('toque perto da caixa conta; região cresce onde o detector não viu nada', async () => {
  const { growRegion } = await import('../web/src/detect.js');
  const b = box(0.4, 0.4, [200, 40, 40], 'red');
  assert.equal(holdAt([b], 0.455, 0.42), b); // 1,5% fora da caixa
  assert.equal(holdAt([b], 0.6, 0.6), undefined);
  // Imagem 100x100 cinza com um "volume" vermelho de 30x20 em (50,40).
  const W = 100, H = 100, rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, red = x >= 50 && x < 80 && y >= 40 && y < 60;
    rgba.set(red ? [190, 45, 40, 255] : [120, 120, 120, 255], i);
  }
  const g = growRegion(rgba, W, H, 0.6, 0.5);
  assert.ok(g && Math.abs(g.x - 0.5) < 0.02 && Math.abs(g.w - 0.3) < 0.03 && Math.abs(g.h - 0.2) < 0.03, JSON.stringify(g));
  assert.equal(growRegion(rgba, W, H, 0.1, 0.1), null); // parede: vaza → null
});

test('routeHolds ignora pedaço de parede lisa (sem contraste)', () => {
  const lab: [number, number, number] = [50, 0, -40];
  const seed = { x: 0.1, y: 0.5, w: 0.05, h: 0.05, lab };
  const wall = { x: 0.1, y: 0.4, w: 0.05, h: 0.05, lab, plain: true };
  const hold = { x: 0.1, y: 0.3, w: 0.05, h: 0.05, lab };
  assert.deepEqual(routeHolds([seed, wall, hold], seed, 1000, 1000), [seed, hold]);
});
