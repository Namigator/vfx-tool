// Sample sources (recorded CC0 library sounds): WAV decoding (T18), playback in renderVoice, compileAudio wiring and
// the shipped library's files + provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeWav, to48k } from '../src/audio/wavDecode.ts';
import { encodeWavPcm16Stereo } from '../src/audio/wav.ts';
import { renderVoice } from '../src/audio/synthesis.ts';
import { SOUND_LIBRARY } from '../src/audio/soundLibrary.generated.ts';
import { loadSoundsNode } from '../src/audio/sampleLoader.node.ts';

/** A minimal RIFF/WAVE with one fmt chunk (format, channels, rate, bits) and the given data bytes. */
function wav(format: number, channels: number, rate: number, bits: number, data: Uint8Array): Uint8Array {
  const b = new Uint8Array(44 + data.length), v = new DataView(b.buffer), w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, format, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * bits / 8, true); v.setUint16(32, channels * bits / 8, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, data.length, true); b.set(data, 44);
  return b;
}

test('decodeWav: PCM16 stereo (our own encoder) mixes down to mono at its rate', () => {
  const l = new Float32Array([0.5, -0.5, 0.25]), r = new Float32Array([0.5, 0.5, 0.25]);
  const d = decodeWav(encodeWavPcm16Stereo(l, r, 48000));
  assert.ok(typeof d !== 'string');
  assert.equal(d.channels, 2); assert.equal(d.sampleRate, 48000);
  assert.ok(Math.abs(d.data[0] - 0.5) < 1e-3 && Math.abs(d.data[1]) < 1e-3 && Math.abs(d.data[2] - 0.25) < 1e-3);
});

test('decodeWav: 24-bit PCM and 32-bit float; to48k resamples', () => {
  const p24 = new Uint8Array([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]); // +0.5, -0.5
  const d24 = decodeWav(wav(1, 1, 24000, 24, p24));
  assert.ok(typeof d24 !== 'string' && Math.abs(d24.data[0] - 0.5) < 1e-6 && Math.abs(d24.data[1] + 0.5) < 1e-6);
  assert.equal(to48k(d24 as Exclude<typeof d24, string>).length, 4);
  const f = new Uint8Array(new Float32Array([0.75, -0.25]).buffer);
  const df = decodeWav(wav(3, 1, 48000, 32, f));
  assert.ok(typeof df !== 'string' && df.format === 'float' && df.data[0] === 0.75);
});

test('decodeWav rejects what it cannot read (T18): not RIFF, ADPCM, bad depth, no data', () => {
  assert.match(decodeWav(new Uint8Array(60)) as string, /RIFF/);
  assert.match(decodeWav(wav(2, 1, 44100, 4, new Uint8Array(8))) as string, /encoding 2/);
  assert.match(decodeWav(wav(1, 1, 44100, 12, new Uint8Array(8))) as string, /bit depth 12/);
  const noData = wav(1, 1, 44100, 16, new Uint8Array(0)); noData[36] = 0x4c; // 'data' -> 'Lata'
  assert.match(decodeWav(noData) as string, /no data chunk/);
});

test('sample voices: pitch plays faster, a loop fills the duration, a one-shot goes silent after its end', () => {
  const data = new Float32Array(1600).map((_, i) => Math.sin(i / 10));
  const ctx = { documentSeed: 1, eventRandomKey: 'k', entityOrdinal: 0 };
  const one = renderVoice({ source: { kind: 'sample', soundId: 's', data, loop: false }, offsetTicks: 0, durationTicks: 6, gain: 1 }, ctx).samples;
  assert.equal(one.length, 4800);
  assert.ok(Math.max(...one.slice(2000, 4500).map(Math.abs)) === 0, 'silent after the 1600-sample sound');
  const loop = renderVoice({ source: { kind: 'sample', soundId: 's', data, loop: true }, offsetTicks: 0, durationTicks: 6, gain: 1 }, ctx).samples;
  assert.ok(Math.max(...loop.slice(2000, 4500).map(Math.abs)) > 0.5, 'looping fills the voice');
  const fast = renderVoice({ source: { kind: 'sample', soundId: 's', data, loop: false }, offsetTicks: 0, durationTicks: 6, gain: 1, pitchRatio: 2 }, ctx).samples;
  assert.ok(Math.abs(fast[300] - data[600]) < 1e-6, 'pitch 2 reads twice as fast');
});

test('the shipped sound library: every file exists, decodes at 48 kHz, and is CC0 with author and source', () => {
  const manifest = JSON.parse(readFileSync('assets/sounds/manifest.json', 'utf8'));
  assert.equal(manifest.sounds.length, SOUND_LIBRARY.length);
  for (const s of manifest.sounds) {
    assert.ok(existsSync(`assets/sounds/${s.file}`), s.file);
    assert.match(s.provenance.license, /^CC0/, `${s.id} license`);
    assert.ok(s.provenance.author && /^https:\/\/opengameart\.org\//.test(s.provenance.source), `${s.id} provenance`);
  }
  const some = loadSoundsNode([SOUND_LIBRARY[0].id, SOUND_LIBRARY.at(-1)!.id]);
  assert.equal(some.size, 2);
  for (const d of some.values()) assert.ok(d.length > 1000 && d.every(Number.isFinite));
});
