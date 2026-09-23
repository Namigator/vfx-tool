import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, encodeWav, EffectAudio } from '../src/audio/synth.ts';
import { FAMILIES } from '../src/core/types.ts';
import type { Recipe, Family } from '../src/core/types.ts';

function recipe(family: Family = 'lightning'): Recipe {
  return { schemaVersion: 1, generatorVersion: '1.0.0', id: 'test', name: 'test', family, seed: 1937, source: [0, 1, 0], target: [5, 0, 0], parameters: {
    scale: 1, intensity: 1, count: 100, spread: 1, speed: 1, turbulence: 1, branches: 14, width: 0.05,
    charge: 0.4, active: 0.65, decay: 0.8, color: '#ffffff', secondaryColor: '#00aaff', volume: 1, pitch: 1,
  } };
}
function rms(samples: Float32Array, from: number, to: number, sampleRate: number) {
  let sum = 0, count = 0;
  for (let i = Math.floor(from * sampleRate); i < Math.min(samples.length, to * sampleRate); i++) { sum += samples[i] ** 2; count++; }
  return Math.sqrt(sum / count);
}

test('all ten families produce finite, bounded, deterministic audio with silent boundaries', () => {
  const signatures = new Set<string>();
  for (const family of FAMILIES) {
    const input = recipe(family), samples = synthesize(input, 12000);
    assert.equal(samples.length, Math.ceil(1.85 * 12000));
    assert.ok(samples.every(Number.isFinite), family);
    assert.ok(samples.every(value => Math.abs(value) <= 0.85), family);
    assert.equal(samples[0], 0);
    assert.equal(Math.abs(samples[samples.length - 1]), 0);
    assert.ok(rms(samples, 0.42, 0.9, 12000) > 0.01, family);
    assert.deepEqual(samples, synthesize(input, 12000), family);
    signatures.add(Array.from(samples.slice(6000, 6020)).join(','));
  }
  assert.equal(signatures.size, FAMILIES.length, 'each family has a distinct waveform');
});

test('volume zero is silent and volume scales the waveform once', () => {
  const input = recipe(), full = synthesize(input, 8000);
  input.parameters.volume = 0.5;
  const half = synthesize(input, 8000);
  assert.ok(half.every((value, i) => Math.abs(value - full[i] * 0.5) < 1e-7));
  input.parameters.volume = 0;
  assert.ok(synthesize(input, 8000).every(value => value === 0));
});

test('lightning discharge follows charge time and decays after active time', () => {
  const input = recipe(), rate = 12000;
  for (const charge of [0.2, 0.8]) {
    input.parameters.charge = charge;
    const samples = synthesize(input, rate);
    const before = rms(samples, charge - 0.09, charge - 0.02, rate);
    const after = rms(samples, charge + 0.01, charge + 0.09, rate);
    assert.ok(after > before * 2, `discharge begins after charge=${charge}`);
    const ending = input.parameters.charge + input.parameters.active + input.parameters.decay;
    assert.ok(rms(samples, ending - 0.1, ending, rate) < after * 0.2);
  }
});

test('pitch and seed change the result, maximum settings cannot clip', () => {
  const input = recipe(), initial = synthesize(input, 8000);
  input.seed++;
  assert.notDeepEqual(initial, synthesize(input, 8000));
  input.seed--; input.parameters.pitch = 2;
  assert.notDeepEqual(initial, synthesize(input, 8000));
  input.parameters.intensity = 3;
  for (const family of FAMILIES) {
    input.family = family;
    assert.ok(synthesize(input, 8000).every(value => Number.isFinite(value) && Math.abs(value) <= 0.85));
  }
});

test('PCM WAV has valid header, length, and signed samples', () => {
  const result = encodeWav(new Float32Array([-1, 0, 1]), 48000), view = new DataView(result);
  const text = (start: number, length: number) => String.fromCharCode(...new Uint8Array(result, start, length));
  assert.equal(result.byteLength, 50);
  assert.equal(text(0, 4), 'RIFF'); assert.equal(text(8, 4), 'WAVE'); assert.equal(text(12, 4), 'fmt '); assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint32(4, true), 42); assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48000); assert.equal(view.getUint32(28, true), 96000);
  assert.equal(view.getUint16(32, true), 2); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(46, true), 0); assert.equal(view.getInt16(48, true), 32767);
});

test('audio module is safe before browser unlock and validates sample rates', () => {
  const player = new EffectAudio();
  assert.equal(player.state, 'locked');
  player.play(recipe()); player.stop(); player.dispose();
  assert.throws(() => synthesize(recipe(), 0), RangeError);
  assert.throws(() => encodeWav(new Float32Array(), 0), RangeError);
});
