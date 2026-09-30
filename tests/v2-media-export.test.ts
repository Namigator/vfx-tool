import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVfxServer } from '../mcp/server.ts';
import { decodePng } from '../mcp/imageTools.ts';
import { frameTicks, mediaExtension, resolveMediaOptions, sequenceNames, sheetLayout, sheetSidecar } from '../src/export/media/layout.ts';
import { acesSrgb, blitFrame, compositeOver, matteFrame, meanAbsDifference, opaqueFrame } from '../src/export/media/matte.ts';
import { downscaleRgba, encodePngRgba } from '../src/export/media/png.ts';
import { encodeGif, encodePngSequenceZip, gifDelaysMs, packSheet } from '../src/export/media/encoders.ts';

// ---------- sheet packing / tick sampling ----------
test('frame ticks sample every 60/fps ticks across the whole effect (end exclusive)', () => {
  assert.deepEqual(frameTicks(0, 120, 60).length, 120);
  assert.deepEqual(frameTicks(0, 120, 30).slice(0, 4), [0, 2, 4, 6]);
  assert.equal(frameTicks(0, 120, 30).length, 60);
  assert.deepEqual(frameTicks(0, 120, 20).slice(0, 3), [0, 3, 6]);
  assert.equal(frameTicks(0, 120, 20).length, 40);
  assert.deepEqual(frameTicks(0, 120, 15).slice(0, 3), [0, 4, 8]);
  assert.equal(frameTicks(0, 120, 15).length, 30);
  // A sub-range starts at its own tick and never reaches endTick.
  const r = frameTicks(30, 90, 30);
  assert.equal(r[0], 30); assert.ok(r.every(t => t < 90)); assert.equal(r.length, 30);
  // 24 fps = 2.5 ticks per frame: rounded, strictly increasing.
  const f24 = frameTicks(0, 60, 24);
  assert.equal(f24.length, 24); assert.ok(f24.every((t, i) => i === 0 || t > f24[i - 1]));
  assert.deepEqual(frameTicks(5, 5, 30), []);
});

test('sheet layout: default columns ~ sqrt, rows just enough, pixel size', () => {
  const a = sheetLayout(60, 256, 256);
  assert.deepEqual([a.columns, a.rows, a.width, a.height], [8, 8, 2048, 2048]);
  const b = sheetLayout(30, 128, 64, 6);
  assert.deepEqual([b.columns, b.rows, b.width, b.height], [6, 5, 768, 320]);
  const one = sheetLayout(1, 64, 64);
  assert.deepEqual([one.columns, one.rows], [1, 1]);
  assert.equal(sheetLayout(5, 10, 10, 99).columns, 5, 'columns never exceed the frame count');
  assert.equal(sheetLayout(10, 10, 10, 3).rows, 4);
});

test('sidecar JSON carries the sheet description', () => {
  const l = sheetLayout(60, 256, 256);
  const s = sheetSidecar(l, { fps: 30, startTick: 0, endTick: 120, loop: true, background: 'transparent' }, 'fx.png', 'Fx');
  for (const [k, v] of Object.entries({ columns: 8, rows: 8, frameCount: 60, fps: 30, frameWidth: 256, frameHeight: 256, durationTicks: 120, loop: true, image: 'fx.png', sheetWidth: 2048, sheetHeight: 2048 })) assert.equal((s as Record<string, unknown>)[k], v, k);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('options: defaults per format, even video size, limits and clear errors', () => {
  const sheet = resolveMediaOptions({ format: 'spritesheet', width: 128 }, 120);
  assert.ok(sheet.ok && sheet.options.background === 'transparent' && sheet.options.height === 128 && sheet.ticks.length === 60 && sheet.layout?.columns === 8);
  const gif = resolveMediaOptions({ format: 'gif' }, 120);
  assert.ok(gif.ok && gif.options.background === 'dark' && gif.options.fps === 20);
  const video = resolveMediaOptions({ format: 'mp4', width: 255, height: 101 }, 120);
  assert.ok(video.ok && video.options.width === 256 && video.options.height === 102 && video.options.fps === 30);
  const t = resolveMediaOptions({ format: 'mp4', background: 'transparent' }, 120);
  assert.ok(!t.ok && /solid background/.test(t.message));
  const big = resolveMediaOptions({ format: 'spritesheet', width: 1024, height: 1024, fps: 60 }, 600);
  assert.ok(!big.ok, 'a 600-frame 1024 px sheet is refused');
  const empty = resolveMediaOptions({ format: 'gif', startTick: 50, endTick: 50 }, 120);
  assert.ok(!empty.ok && /empty/.test(empty.message));
  assert.ok(!resolveMediaOptions({ format: 'gif', width: 8 }, 120).ok);
  assert.equal(mediaExtension('spritesheet'), 'png'); assert.equal(mediaExtension('png-sequence'), 'zip');
});

// ---------- matting math ----------
/** Synthesises the three renders from a known scene: per pixel coverage `a`, premultiplied linear colour `f`, identity output transform. */
function scene(px: { a: number; f: [number, number, number] }[]) {
  const display = new Float32Array(px.length * 4), black = new Float32Array(px.length * 4), white = new Float32Array(px.length * 4);
  px.forEach((p, i) => { for (let c = 0; c < 3; c++) { display[i * 4 + c] = p.f[c]; black[i * 4 + c] = p.f[c]; white[i * 4 + c] = p.f[c] + (1 - p.a); } display[i * 4 + 3] = black[i * 4 + 3] = white[i * 4 + 3] = 1; });
  return { display, black, white };
}

test('matte: additive light has zero coverage; its brightness becomes alpha and colour is normalised', () => {
  const { display, black, white } = scene([{ a: 0, f: [0.3, 0.1, 0] }]);
  const out = matteFrame(display, black, white);
  assert.equal(out[3], Math.round(0.3 * 255));
  assert.deepEqual([out[0], out[1], out[2]], [255, Math.round((0.1 / 0.3) * 255), 0]);
  // Over black it reproduces the light exactly.
  const back = compositeOver(out, [0, 0, 0]);
  assert.ok(Math.abs(back[0] - 0.3 * 255) <= 1 && Math.abs(back[1] - 0.1 * 255) <= 1);
});

test('matte: normal-blend smoke keeps its opacity and its own colour', () => {
  // 50 % grey smoke of linear colour 0.4: premultiplied 0.2; with an identity output the straight colour must be 0.4.
  const { display, black, white } = scene([{ a: 0.5, f: [0.2, 0.2, 0.2] }]);
  const out = matteFrame(display, black, white);
  assert.equal(out[3], 128);
  assert.ok(Math.abs(out[0] - 0.4 * 255) <= 1, `colour ${out[0]}`);
});

test('matte: mixed layers (smoke under additive glow), empty pixels and fully opaque pixels', () => {
  const { display, black, white } = scene([
    { a: 0, f: [0, 0, 0] },            // nothing drawn
    { a: 1, f: [0.25, 0.5, 0.75] },    // opaque
    { a: 0.5, f: [0.2 + 0.3, 0.2 + 0.1, 0.2] }, // smoke 0.5 with additive light on top
  ]);
  const out = matteFrame(display, black, white);
  assert.deepEqual([out[0], out[1], out[2], out[3]], [0, 0, 0, 0]);
  assert.deepEqual([out[4], out[5], out[6], out[7]], [64, 128, 191, 255]);
  // Mixed pixel: coverage 0.5, light max 0.5 -> alpha 0.5; colour = premultiplied / alpha.
  assert.equal(out[11], 128);
  assert.ok(Math.abs(out[8] - 255) <= 1 && Math.abs(out[9] - 0.3 / 0.5 * 255) <= 1 && Math.abs(out[10] - 0.4 * 255) <= 1);
  // Compositing every pixel over black returns the premultiplied render.
  const back = compositeOver(out, [0, 0, 0]);
  [[0, 0, 0], [0.25, 0.5, 0.75], [0.5, 0.3, 0.2]].forEach((f, i) => f.forEach((v, c) => assert.ok(Math.abs(back[i * 4 + c] - v * 255) <= 1.5, `pixel ${i} channel ${c}`)));
});

test('matte over the dark arena reproduces the display render (bg-aware variant)', () => {
  const bg: [number, number, number] = [0.05, 0.05, 0.08];
  // Display = arena + light; coverage 0 (additive only).
  const d = new Float32Array([0.05 + 0.4, 0.05 + 0.2, 0.08 + 0.1, 1, 0.05, 0.05, 0.08, 1]);
  const zero = new Float32Array(8), white = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
  const out = matteFrame(d, zero, white, undefined, bg);
  const back = compositeOver(out, bg.map(v => v * 255) as [number, number, number]), direct = opaqueFrame(d);
  assert.ok(meanAbsDifference(back, direct) < 0.6, `mean abs diff ${meanAbsDifference(back, direct)}`);
  assert.deepEqual([out[4], out[5], out[6], out[7]], [0, 0, 0, 0], 'the empty arena is fully transparent');
});

test('output transform mirror: the dark arena colour maps to the near-black the editor shows', () => {
  const c = acesSrgb([0.0033, 0.004, 0.006]).map(v => Math.round(v * 255));
  assert.ok(c[0] <= 3 && c[2] <= 4 && c[2] >= c[0], `got ${c}`);
  const hi = acesSrgb([50, 50, 50]);
  assert.ok(hi.every(v => v > 0.99 && v <= 1));
  const mid = acesSrgb([0.18, 0.18, 0.18]);
  assert.ok(mid[0] > 0.4 && mid[0] < 0.65);
});

// ---------- PNG / sheet / zip ----------
function gradient(w: number, h: number, seed = 0): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { a[i * 4] = (i * 7 + seed) & 255; a[i * 4 + 1] = (i * 3 + seed * 5) & 255; a[i * 4 + 2] = (i + seed * 11) & 255; a[i * 4 + 3] = (i % 5) * 60 + 15; }
  return a;
}

test('PNG writer round-trips straight RGBA exactly (the decoder is the MCP one)', () => {
  const src = gradient(37, 23, 4), png = encodePngRgba(src, 37, 23), img = decodePng(png);
  assert.equal(img.w, 37); assert.equal(img.h, 23);
  assert.deepEqual([...img.px], [...src]);
  assert.throws(() => encodePngRgba(new Uint8Array(3), 4, 4));
});

test('sheet packing puts frame i at column i % columns, row floor(i / columns)', () => {
  const frames = [0, 1, 2, 3, 4].map(i => new Uint8ClampedArray(2 * 2 * 4).fill(10 * (i + 1)));
  const s = packSheet(frames, 2, 2, 2);
  assert.deepEqual([s.columns, s.rows, s.width, s.height], [2, 3, 4, 6]);
  const at = (x: number, y: number) => s.rgba[(y * s.width + x) * 4];
  assert.equal(at(0, 0), 10); assert.equal(at(2, 0), 20); assert.equal(at(0, 2), 30); assert.equal(at(3, 3), 40); assert.equal(at(1, 5), 50);
  assert.equal(at(2, 5), 0, 'the unused last cell stays transparent');
  const dst = new Uint8ClampedArray(4 * 4 * 4);
  blitFrame(dst, 4, new Uint8ClampedArray(2 * 2 * 4).fill(9), 2, 2, 2, 3);
  assert.equal(dst[(2 * 4 + 2) * 4], 9);
});

test('downscale keeps colour under partial alpha', () => {
  const px = new Uint8ClampedArray([200, 0, 0, 255, 0, 0, 0, 0, 200, 0, 0, 255, 0, 0, 0, 0]);
  const d = downscaleRgba(px, 2, 2, 1);
  assert.equal(d.width, 1); assert.equal(d.data[0], 200); assert.equal(d.data[3], 128);
});

test('PNG sequence zip holds <name>_0000.png ... in order', () => {
  const frames = [gradient(4, 4, 1), gradient(4, 4, 2), gradient(4, 4, 3)].map(f => encodePngRgba(f, 4, 4, 1));
  const zip = unzipSync(encodePngSequenceZip(frames, 'spark'));
  assert.deepEqual(Object.keys(zip), ['spark_0000.png', 'spark_0001.png', 'spark_0002.png']);
  assert.equal(decodePng(zip['spark_0001.png']).px[0], gradient(4, 4, 2)[0]);
  assert.equal(sequenceNames('a', 12000)[11999], 'a_11999.png');
  assert.equal(sequenceNames('a', 3)[0], 'a_0000.png');
});

// ---------- GIF ----------
/** Reads a GIF: frame count, loop count (NETSCAPE2.0), delays, dimensions, and LZW-decodes every frame to palette indices. */
function readGif(b: Uint8Array) {
  assert.equal(String.fromCharCode(...b.subarray(0, 6)), 'GIF89a');
  const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8), packed = b[10];
  let p = 13, palette: number[][] = [];
  if (packed & 0x80) { const n = 1 << ((packed & 7) + 1); for (let i = 0; i < n; i++) palette.push([b[p + i * 3], b[p + i * 3 + 1], b[p + i * 3 + 2]]); p += n * 3; }
  const frames: { indices: Uint8Array; delay: number; transparentIndex: number }[] = [];
  let loop: number | null = null, delay = 0, transparentIndex = -1;
  const subblocks = () => { const out: number[] = []; for (;;) { const n = b[p++]; if (!n) break; for (let i = 0; i < n; i++) out.push(b[p++]); } return Uint8Array.from(out); };
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9) { p++; const f = b[p]; delay = b[p + 1] | (b[p + 2] << 8); transparentIndex = f & 1 ? b[p + 3] : -1; p += 5; }
      else if (label === 0xff) { const n = b[p++]; const id = String.fromCharCode(...b.subarray(p, p + n)); p += n; const d = subblocks(); if (id === 'NETSCAPE2.0') loop = d[1] | (d[2] << 8); }
      else subblocks();
    } else if (t === 0x2c) {
      p += 8; const f = b[p++]; assert.equal(f & 0x80, 0, 'shared global palette expected');
      const minCode = b[p++], data = subblocks();
      frames.push({ indices: lzwDecode(data, minCode, w * h), delay, transparentIndex });
    } else throw new Error(`unexpected GIF block 0x${t.toString(16)}`);
  }
  return { w, h, palette, frames, loop };
}
function lzwDecode(data: Uint8Array, minCode: number, total: number): Uint8Array {
  const clear = 1 << minCode, eoi = clear + 1, out = new Uint8Array(total);
  let size = minCode + 1, next = eoi + 1, bits = 0, acc = 0, at = 0, prev: number[] | null = null;
  let table: number[][] = [];
  const reset = () => { table = []; for (let i = 0; i < clear; i++) table[i] = [i]; table[clear] = []; table[eoi] = []; size = minCode + 1; next = eoi + 1; prev = null; };
  reset();
  for (let i = 0; i < data.length && at < total;) {
    while (bits < size && i < data.length) { acc |= data[i++] << bits; bits += 8; }
    if (bits < size) break;
    const code = acc & ((1 << size) - 1); acc >>= size; bits -= size;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < next && table[code]) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad LZW stream');
    for (const v of entry) if (at < total) out[at++] = v;
    if (prev) { table[next++] = [...prev, entry[0]]; if (next === 1 << size && size < 12) size++; }
    prev = entry;
  }
  assert.equal(at, total, 'LZW decoded every pixel');
  return out;
}

test('GIF encoder: frame count, forever-loop extension, delays that average to the frame rate, pixels decode', () => {
  const w = 16, h = 12, frames = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]].map(([r, g, b]) => { const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; } return a; });
  const gif = readGif(encodeGif(frames, w, h, { fps: 20, loop: true, transparent: false }));
  assert.equal(gif.frames.length, 4); assert.equal(gif.w, w); assert.equal(gif.h, h);
  assert.equal(gif.loop, 0, 'loop count 0 = forever');
  assert.ok(gif.frames.every(f => f.delay === 5), 'delays are 5 cs at 20 fps');
  const colour = (f: number) => gif.palette[gif.frames[f].indices[0]];
  assert.ok(colour(0)[0] > 240 && colour(0)[1] < 20, 'frame 0 is red');
  assert.ok(colour(1)[1] > 240 && colour(2)[2] > 240);
  assert.ok(gif.frames[3].indices.every(v => v === gif.frames[3].indices[0]));
  const once = readGif(encodeGif(frames, w, h, { fps: 20, loop: false, transparent: false }));
  assert.equal(once.loop, null, 'no loop extension = play once');
});

test('GIF delays spread the centisecond rounding (30 fps averages 3.33 cs)', () => {
  const d = gifDelaysMs(30, 30);
  assert.equal(d.reduce((a, b) => a + b, 0), 1000);
  assert.ok(d.every(v => v === 30 || v === 40));
});

test('transparent GIF marks one palette entry transparent', () => {
  const w = 8, h = 8, a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const on = i % 2 === 0; a[i * 4] = on ? 200 : 0; a[i * 4 + 1] = on ? 100 : 0; a[i * 4 + 2] = 0; a[i * 4 + 3] = on ? 255 : 0; }
  const gif = readGif(encodeGif([a, a], w, h, { fps: 10, loop: true, transparent: true }));
  assert.equal(gif.frames.length, 2);
  const ti = gif.frames[0].transparentIndex;
  assert.ok(ti >= 0);
  assert.ok(gif.frames[0].indices.filter((v, i) => i % 2 === 1 && v === ti).length === 32, 'transparent pixels use the transparent index');
  assert.ok(gif.frames[0].indices.filter((v, i) => i % 2 === 0 && v === ti).length === 0);
});

// ---------- MCP tool ----------
async function connect() {
  const root = mkdtempSync(join(tmpdir(), 'vfx-media-'));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createVfxServer({ root, chromePath: join(root, 'no-such-chrome.exe') });
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map(c => c.text).join('\n'), error: r.isError === true };
  };
  return { client, call };
}

test('vfx_export_media is registered and validates before it needs a browser', async () => {
  const { client, call } = await connect();
  assert.ok((await client.listTools()).tools.some(t => t.name === 'vfx_export_media'));
  await call('vfx_new_document', { template: 'blank', id: 'media' });
  const video = await call('vfx_export_media', { docId: 'media', format: 'mp4', background: 'transparent' });
  assert.ok(video.error && /solid background/.test(video.text), video.text);
  const range = await call('vfx_export_media', { docId: 'media', format: 'gif', startTick: 500, endTick: 400 });
  assert.ok(range.error && /empty/.test(range.text), range.text);
  const huge = await call('vfx_export_media', { docId: 'media', format: 'spritesheet', size: 2048, fps: 60 });
  assert.ok(huge.error && /limit|sheet/.test(huge.text), huge.text);
  const noChrome = await call('vfx_export_media', { docId: 'media', format: 'spritesheet', size: 64 });
  assert.ok(noChrome.error && /Chrome|Edge|export failed/i.test(noChrome.text), noChrome.text);
});
