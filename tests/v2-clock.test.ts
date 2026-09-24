import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock, TICK_EPSILON } from '../src/runtime/clock.ts';

function run(hz: number, seconds: number, duration = 600): PlaybackClock {
  const c = new PlaybackClock({ durationTicks: duration });
  c.play();
  const frames = Math.round(seconds * hz);
  for (let i = 0; i < frames; i++) c.advance(1 / hz);
  return c;
}

test('equal elapsed time yields the same integer tick at 30/60/144 Hz', () => {
  for (const seconds of [0.5, 1, 2.5, 7]) {
    const ticks = [30, 60, 144].map(hz => run(hz, seconds).tick);
    assert.deepEqual(ticks, [seconds * 60, seconds * 60, seconds * 60], `seconds=${seconds}`);
    for (const hz of [30, 60, 144]) assert.ok(run(hz, seconds).alpha < TICK_EPSILON);
  }
});

test('fractional alpha accumulates and interpolates', () => {
  const c = new PlaybackClock({ durationTicks: 60 });
  c.play();
  const r = c.advance(1.5 / 60);
  assert.equal(r.ticksAdvanced, 1);
  assert.equal(c.tick, 1);
  assert.ok(Math.abs(c.alpha - 0.5) < 1e-12);
  c.advance(0.25 / 60);
  assert.ok(Math.abs(c.alpha - 0.75) < 1e-12);
  assert.equal(c.advance(0.25 / 60).ticksAdvanced, 1);
  assert.equal(c.tick, 2);
  assert.equal(c.alpha, 0);
});

test('stops exactly at duration, reports unused time and never wraps', () => {
  const c = new PlaybackClock({ durationTicks: 60 });
  c.play();
  c.advance(59 / 60);
  const r = c.advance(0.5);
  assert.equal(r.ticksAdvanced, 1);
  assert.equal(r.reachedEnd, true);
  assert.ok(Math.abs(r.unusedSeconds - (0.5 - 1 / 60)) < 1e-12);
  assert.equal(c.tick, 60);
  assert.equal(c.alpha, 0);
  assert.equal(c.ended, true);
  assert.equal(c.playing, false);
  assert.deepEqual(c.advance(1), { ticksAdvanced: 0, reachedEnd: false, unusedSeconds: 0 });
  assert.equal(c.play(), false);
  assert.equal(c.tick, 60);
});

test('large single delta is not capped: all ticks up to the endpoint are counted', () => {
  const c = new PlaybackClock({ durationTicks: 600 });
  c.play();
  assert.equal(c.advance(4).ticksAdvanced, 240);
  const r = c.advance(100);
  assert.equal(r.ticksAdvanced, 360);
  assert.ok(Math.abs(r.unusedSeconds - 94) < 1e-9);
});

test('seek discards remainder, matches prior advancement and retains pause', () => {
  const a = new PlaybackClock({ durationTicks: 120 });
  a.play();
  a.advance(30.4 / 60);
  assert.equal(a.tick, 30);
  a.seek(30);
  assert.equal(a.alpha, 0);
  assert.equal(a.playing, true);
  const b = new PlaybackClock({ durationTicks: 120 });
  b.seek(30);
  assert.equal(b.playing, false);
  assert.deepEqual({ ...b.snapshot(), playing: true }, a.snapshot());
  b.advance(1);
  assert.equal(b.tick, 30);
  a.seek(120);
  assert.equal(a.ended, true);
  assert.equal(a.playing, false);
  a.seek(5);
  assert.equal(a.ended, false);
});

test('pause advances nothing; speed scales; restart replays from 0', () => {
  const c = new PlaybackClock({ durationTicks: 600, speed: 0.5 });
  assert.equal(c.advance(1).ticksAdvanced, 0);
  c.play();
  c.advance(1);
  assert.equal(c.tick, 30);
  c.pause();
  c.advance(10);
  assert.equal(c.tick, 30);
  c.setSpeed(2);
  c.play();
  c.advance(0.5);
  assert.equal(c.tick, 90);
  c.seek(600);
  c.restart();
  assert.equal(c.tick, 0);
  assert.equal(c.alpha, 0);
  assert.equal(c.playing, true);
  assert.equal(c.speed, 2);
  c.setSpeed(0.25);
  for (let i = 0; i < 144; i++) c.advance(1 / 144);
  assert.equal(c.tick, 15);
});

test('invalid numeric inputs are rejected without mutating state', () => {
  for (const d of [0, 601, 1.5, NaN, Infinity, -1, '60' as unknown as number]) {
    assert.throws(() => new PlaybackClock({ durationTicks: d }), RangeError);
  }
  for (const s of [0, 0.1, 5, NaN, -1, Infinity]) {
    assert.throws(() => new PlaybackClock({ durationTicks: 60, speed: s }), RangeError);
  }
  const c = new PlaybackClock({ durationTicks: 60 });
  c.play();
  c.advance(0.5 / 60);
  const before = c.snapshot();
  for (const d of [-0.001, NaN, Infinity, -Infinity, '1' as unknown as number]) {
    assert.throws(() => c.advance(d), RangeError);
  }
  assert.throws(() => c.advance(Number.MAX_VALUE), RangeError);
  for (const t of [-1, 61, 2.5, NaN]) assert.throws(() => c.seek(t), RangeError);
  assert.throws(() => c.setSpeed(0), RangeError);
  assert.deepEqual(c.snapshot(), before);
});

test('snapshot round-trips through JSON and restore validates', () => {
  const c = new PlaybackClock({ durationTicks: 90, speed: 0.5 });
  c.play();
  c.advance(0.33);
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const r = PlaybackClock.restore(snap);
  assert.deepEqual(r.snapshot(), c.snapshot());
  r.advance(0.1); c.advance(0.1);
  assert.deepEqual(r.snapshot(), c.snapshot());
  const good = c.snapshot();
  const bad: unknown[] = [
    null, [], 'x',
    { ...good, version: 2 },
    { ...good, extra: 1 },
    { ...good, fraction: 1 },
    { ...good, fraction: -0.1 },
    { ...good, tick: 91 },
    { ...good, playing: 'yes' },
    { ...good, speed: 9 },
    { ...good, tick: 90, fraction: 0.5, playing: false },
    { ...good, tick: 90, fraction: 0, playing: true },
  ];
  for (const b of bad) assert.throws(() => PlaybackClock.restore(b));
});

test('restore requires explicit speed and validates boundary snapshots', () => {
  const clock = new PlaybackClock({ durationTicks: 1 });
  const snapshot = clock.snapshot();
  assert.throws(() => PlaybackClock.restore({ ...snapshot, speed: undefined }));
  assert.throws(() => PlaybackClock.restore({ ...snapshot, durationTicks: 0 }));
  assert.throws(() => PlaybackClock.restore({ ...snapshot, tick: 0.5 }));
  clock.play();
  clock.advance(1 / 120);
  clock.pause();
  assert.equal(clock.alpha, 0.5);
  clock.advance(2);
  assert.equal(clock.alpha, 0.5);
  clock.play();
  assert.equal(clock.advance(1 / 120).reachedEnd, true);
  assert.equal(clock.tick, 1);
  assert.equal(clock.alpha, 0);
});
