import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { describeFrameStats, pngFrameStats } from '../mcp/frameStats.ts';

/** Minimal RGB PNG (filter 0); pixel(x, y) -> grey level 0..255. CRCs are not checked by the reader. */
function png(w: number, h: number, pixel: (x: number, y: number) => number): Buffer {
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill(pixel(x, y), y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('frame stats: lit/bright shares and the glow-flood warning', () => {
  // 100×100: a 10×10 white core inside a 60×60 dim halo.
  const flood = pngFrameStats(png(100, 100, (x, y) => (x >= 45 && x < 55 && y >= 20 && y < 30 ? 255 : x >= 20 && x < 80 && y >= 0 && y < 60 ? 60 : 0)))!;
  assert.ok(Math.abs(flood.lit - 0.36) < 0.01 && Math.abs(flood.bright - 0.01) < 0.001, JSON.stringify(flood));
  assert.match(describeFrameStats(48, flood), /WARNING/);
  const crisp = pngFrameStats(png(100, 100, (x, y) => (x >= 40 && x < 60 && y >= 20 && y < 40 ? 255 : 0)))!;
  assert.doesNotMatch(describeFrameStats(48, crisp), /WARNING/);
  assert.equal(pngFrameStats(new Uint8Array([1, 2, 3])), undefined);
});
