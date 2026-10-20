// MotionTrail Spiral (render/trailSpiral.ts): strands wound around a trail's centre line, closed at the head when
// Radius over trail ends at 0 (Force Lance: "closed at the start, circles toward the middle/end"), 2026-10-21.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleByLength, spiralPoints, SPIRAL_SAMPLES } from '../src/render/trailSpiral.ts';
import type { Vec3 } from '../src/model/types.ts';

const straight: Vec3[] = [[0, 1, 0], [1, 1, 0], [3, 1, 0]];   // tail → head along +X, uneven spacing
const curve = (keys: [number, number][]) => ({ domain: 'normalized' as const, interpolation: 'linear' as const, keys: keys.map(([x, y]) => ({ x, y })) });
const dist = (p: Vec3) => Math.hypot(p[1] - 1, p[2]);           // distance from the centre line y=1, z=0

test('resampleByLength spaces points evenly by arc length', () => {
  const r = resampleByLength(straight, 7)!;
  assert.equal(r.length, 7);
  r.forEach((p, i) => assert.ok(Math.abs(p[0] - i * 0.5) < 1e-9, `x ${p[0]}`));
  assert.equal(resampleByLength([[1, 1, 1], [1, 1, 1]], 4), undefined);
});

test('constant radius: every sample sits at that distance from the centre line', () => {
  const pts = spiralPoints(straight, { radius: 0.2, turns: 2, spin: 0, phase: 0 }, 0);
  assert.equal(pts.length, SPIRAL_SAMPLES);
  for (const p of pts) assert.ok(Math.abs(dist(p) - 0.2) < 1e-9);
});

test('Radius over trail ending at 0 closes the spiral on the head; it is open in the middle', () => {
  const pts = spiralPoints(straight, { radius: 0.2, turns: 1.5, spin: 0, phase: 0, radiusOverTrail: curve([[0, 0.8], [0.5, 1], [1, 0]]) }, 0);
  assert.ok(dist(pts.at(-1)!) < 1e-9, 'head on the centre line');
  assert.ok(Math.abs(dist(pts[Math.round((SPIRAL_SAMPLES - 1) / 2)]) - 0.2) < 0.01, 'full radius mid-trail');
  assert.ok(Math.abs(pts.at(-1)![0] - 3) < 1e-9 && Math.abs(pts[0][0]) < 1e-9, 'ends stay at the trail ends');
});

test('phase π puts the second strand opposite; spin rotates it over time', () => {
  const a = spiralPoints(straight, { radius: 0.2, turns: 1, spin: 0, phase: 0 }, 0)[10];
  const b = spiralPoints(straight, { radius: 0.2, turns: 1, spin: 0, phase: Math.PI }, 0)[10];
  assert.ok(Math.abs(a[1] - 1 + (b[1] - 1)) < 1e-9 && Math.abs(a[2] + b[2]) < 1e-9);
  const later = spiralPoints(straight, { radius: 0.2, turns: 1, spin: 10, phase: 0 }, 0.1)[10];
  assert.ok(Math.hypot(later[1] - a[1], later[2] - a[2]) > 0.05);
});
