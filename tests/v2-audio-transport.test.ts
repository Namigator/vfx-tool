import { comfortGain } from '../src/audio/mix.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioTransport, SCHEDULE_LEAD_SECONDS, type AudioContextLike, type BufferSourceLike } from '../src/audio/transport.ts';
import type { MixResult } from '../src/audio/mix.ts';

interface FakeSource extends BufferSourceLike { started: [number, number] | null; stopped: boolean; connectedTo: unknown }

class FakeContext implements AudioContextLike {
  currentTime = 10;
  state = 'suspended';
  destination = { name: 'dest' };
  sources: FakeSource[] = [];
  gain = { value: -1 };
  gainDisconnected = false;
  resumeCalls = 0;
  resumeImpl: () => Promise<void> = async () => { this.state = 'running'; };
  timestamp: { contextTime: number; performanceTime: number } | null = null;
  resume(): Promise<void> { this.resumeCalls++; return this.resumeImpl(); }
  createGain() {
    const self = this;
    return { gain: this.gain, connect() { return undefined; }, disconnect() { self.gainDisconnected = true; } };
  }
  createBufferSource(): BufferSourceLike {
    const s: FakeSource = {
      buffer: null, onended: null, started: null, stopped: false, connectedTo: null,
      start(when: number, offset: number) { s.started = [when, offset]; },
      stop() { s.stopped = true; },
      connect(d: unknown) { s.connectedTo = d; return d; },
      disconnect() { s.connectedTo = null; },
    };
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    assert.equal(channels, 2); assert.equal(sampleRate, 48000);
    const data = [new Float32Array(length), new Float32Array(length)];
    return { getChannelData: (c: number) => data[c]! };
  }
  getOutputTimestamp() { return this.timestamp ?? {}; }
}

const mix = (frames = 4800, v = 0.5): MixResult => ({
  sampleRate: 48000, left: new Float32Array(frames).fill(v), right: new Float32Array(frames).fill(-v),
} as unknown as MixResult);

test('schedules once at currentTime + 0.05 and reports cast origin', async () => {
  const ctx = new FakeContext();
  const t = new AudioTransport(ctx);
  const m = mix();
  t.setMix('r1', m);
  assert.equal(t.status, 'suspended');
  const r = await t.play();
  assert.ok(r.ok);
  assert.equal(ctx.sources.length, 1);
  assert.deepEqual(ctx.sources[0]!.started, [10 + SCHEDULE_LEAD_SECONDS, 0]);
  assert.equal(r.startTime, 10 + SCHEDULE_LEAD_SECONDS);
  assert.equal(r.castOrigin, r.startTime);
  assert.equal(r.revision, 'r1');
  assert.equal(r.startPerformanceTime, null);
  assert.equal(t.status, 'playing');
  assert.equal(ctx.sources[0]!.buffer!.getChannelData(1)[0], -0.5);
  assert.equal(m.left[0], 0.5);
});

test('plays from sample offset and maps output timestamp', async () => {
  const ctx = new FakeContext(); ctx.state = 'running';
  ctx.timestamp = { contextTime: 9.9, performanceTime: 1000 };
  const t = new AudioTransport(ctx);
  t.setMix('r1', mix());
  const r = await t.play(2400);
  assert.ok(r.ok);
  assert.deepEqual(ctx.sources[0]!.started, [10.05, 0.05]);
  assert.ok(Math.abs(r.castOrigin - 10) < 1e-12);
  assert.ok(Math.abs(r.startPerformanceTime! - 1150) < 1e-6);
  assert.equal(ctx.resumeCalls, 0);
  assert.deepEqual(await t.play(4800), { ok: false, reason: 'offset-out-of-range' });
});

test('uninitialized output timestamp does not claim a performance-time estimate', async () => {
  const ctx = new FakeContext(); ctx.state = 'running';
  ctx.timestamp = { contextTime: 0, performanceTime: 0 };
  const t = new AudioTransport(ctx);
  t.setMix('r1', mix());
  const r = await t.play();
  assert.ok(r.ok);
  assert.equal(r.startPerformanceTime, null);
});
test('stop and restart replace the source without double playback', async () => {
  const ctx = new FakeContext(); ctx.state = 'running';
  const t = new AudioTransport(ctx);
  t.setMix('r1', mix());
  await t.play();
  t.stop();
  assert.ok(ctx.sources[0]!.stopped);
  assert.equal(t.status, 'ready');
  ctx.currentTime = 12;
  await t.play(); await t.play(); // rapid restart
  assert.equal(ctx.sources.length, 3);
  assert.ok(ctx.sources[1]!.stopped);
  assert.ok(!ctx.sources[2]!.stopped);
  assert.deepEqual(ctx.sources[2]!.started, [12.05, 0]);
  ctx.sources[1]!.onended?.(); // stale ended callback cleared
  assert.equal(t.status, 'playing');
  ctx.sources[2]!.onended?.();
  assert.equal(t.status, 'ready');
});

test('mute only changes preview gain', async () => {
  const ctx = new FakeContext(); ctx.state = 'running';
  const t = new AudioTransport(ctx);
  const m = mix();
  t.setMix('r1', m);
  const level = comfortGain(m); // loud mixes play at a comfortable level (never above 1)
  assert.ok(level > 0 && level <= 1);
  assert.equal(ctx.gain.value, level);
  t.setMuted(true);
  assert.equal(ctx.gain.value, 0);
  assert.equal(m.left[0], 0.5);
  t.setMuted(false);
  assert.equal(ctx.gain.value, level);
});

test('stale revision never plays after replacement during pending resume', async () => {
  const ctx = new FakeContext();
  let release!: () => void;
  ctx.resumeImpl = () => new Promise<void>((res) => { release = () => { ctx.state = 'running'; res(); }; });
  const t = new AudioTransport(ctx);
  t.setMix('r1', mix());
  const pending = t.play();
  t.setMix('r2', mix(4800, 0.25));
  release();
  assert.deepEqual(await pending, { ok: false, reason: 'stale' });
  assert.equal(ctx.sources.length, 0);
  const r = await t.play();
  assert.ok(r.ok && r.revision === 'r2');
  assert.equal(ctx.sources[0]!.buffer!.getChannelData(0)[0], 0.25);
});

test('replacement stops the currently playing source', async () => {
  const ctx = new FakeContext(); ctx.state = 'running';
  const t = new AudioTransport(ctx);
  t.setMix('r1', mix());
  await t.play();
  t.setMix('r2', mix());
  assert.ok(ctx.sources[0]!.stopped);
  assert.equal(t.status, 'ready');
});

test('rejected resume or still-suspended device does not report playing', async () => {
  const ctx = new FakeContext();
  ctx.resumeImpl = () => Promise.reject(new Error('NotAllowedError'));
  const t = new AudioTransport(ctx);
  t.setMix('r1', mix());
  assert.equal(await t.unlock(), false);
  assert.deepEqual(await t.play(), { ok: false, reason: 'resume-rejected' });
  assert.equal(ctx.sources.length, 0);
  assert.notEqual(t.status, 'playing');

  ctx.resumeImpl = async () => { /* resolves but device stays suspended */ };
  assert.deepEqual(await t.play(), { ok: false, reason: 'suspended' });
  assert.equal(ctx.sources.length, 0);

  ctx.resumeImpl = async () => { ctx.state = 'running'; };
  assert.equal(await t.unlock(), true);
  assert.ok((await t.play()).ok);
  ctx.state = 'suspended'; // device suspension mid-playback
  assert.equal(t.status, 'suspended');
});

test('dispose stops, disconnects and blocks pending and future plays', async () => {
  const ctx = new FakeContext();
  let release!: () => void;
  ctx.resumeImpl = () => new Promise<void>((res) => { release = () => { ctx.state = 'running'; res(); }; });
  const t = new AudioTransport(ctx);
  t.setMix('r1', mix());
  const pending = t.play();
  t.dispose();
  release();
  assert.deepEqual(await pending, { ok: false, reason: 'disposed' });
  assert.equal(ctx.sources.length, 0);
  assert.ok(ctx.gainDisconnected);
  assert.equal(t.status, 'disposed');
  assert.deepEqual(await t.play(), { ok: false, reason: 'disposed' });
  assert.equal(await t.unlock(), false);
  assert.throws(() => t.setMix('r3', mix()));
  t.dispose();
});

test('rejects non-canonical mixes', () => {
  const t = new AudioTransport(new FakeContext());
  assert.throws(() => t.setMix('x', { ...mix(), sampleRate: 44100 } as MixResult));
  assert.throws(() => t.setMix('x', { sampleRate: 48000, left: new Float32Array(2), right: new Float32Array(3) } as unknown as MixResult));
});
