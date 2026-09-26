import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLifeGradient, sampleLifeGradient, srgbToLinear } from '../src/render/billboardLife.ts';

test('life gradient interpolates in linear RGB with alpha, clamps at the ends, and has a constant fast path', () => {
  const s = compileLifeGradient({ stops: [{ position: 0, color: { srgb: '#FFFFFF', alpha: 1 } }, { position: 0.5, color: { srgb: '#FF8000', alpha: 0.5 } }, { position: 1, color: { srgb: '#000000', alpha: 0 } }] });
  const o = new Float32Array(4);
  sampleLifeGradient(s, -1, o); assert.deepEqual([...o], [1, 1, 1, 1]);
  sampleLifeGradient(s, 0.5, o); assert.ok(Math.abs(o[1] - srgbToLinear(128 / 255)) < 1e-6 && o[3] === 0.5);
  sampleLifeGradient(s, 0.75, o); assert.ok(Math.abs(o[0] - 0.5) < 1e-6 && Math.abs(o[3] - 0.25) < 1e-6);
  sampleLifeGradient(s, 2, o); assert.deepEqual([...o], [0, 0, 0, 0]);
  const flat = compileLifeGradient({ stops: [{ position: 0, color: { srgb: '#336699', alpha: 1 } }, { position: 1, color: { srgb: '#336699', alpha: 1 } }] });
  assert.ok(flat.constant);
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.2140) < 1e-3);
});
