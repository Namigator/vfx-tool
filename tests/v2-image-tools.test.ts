import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePng, downscale, encodePng, grid, meanDifference, type Rgba } from '../mcp/imageTools.ts';

const solid = (w: number, h: number, v: number): Rgba => ({ w, h, px: new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : v)) });

test('image tools: PNG round trip, downscale, grid layout, mean difference', () => {
  const img = solid(8, 6, 120); img.px[0] = 255;
  const back = decodePng(encodePng(img));
  assert.equal(back.w, 8); assert.equal(back.h, 6); assert.deepEqual([...back.px], [...img.px]);
  const half = downscale(solid(8, 6, 100), 2);
  assert.deepEqual([half.w, half.h, half.px[0]], [4, 3, 100]);
  const g = grid([solid(4, 4, 10), solid(4, 4, 20), solid(4, 4, 30)], 2);
  assert.deepEqual([g.w, g.h], [4 + 4 + 4, 4 + 4 + 4]);
  assert.equal(meanDifference(solid(4, 4, 10), solid(4, 4, 40)), 30);
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3])), /Not a PNG/);
});
