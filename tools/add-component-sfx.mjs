// Adds layered SFX chains (AudioSource → AudioFilter? → AudioEnvelope → AudioMix → AudioOutput) to the
// MCP component recipes. Idempotent: removes previously generated sfx-* nodes first.
// Usage: node tools/add-component-sfx.mjs
import { readFileSync, writeFileSync } from 'node:fs';

// voice: [id, cueSchedule, source params, filter params | null, envelope params, mix gain]
const noise = (color, dur, gain) => ({ source: 'noise', noiseColor: color, durationTicks: dur, gain });
const chirp = (a, b, dur, gain) => ({ source: 'chirp', chirpStartHz: a, chirpEndHz: b, chirpSweep: 'exponential', durationTicks: dur, gain });
const osc = (wave, hz, dur, gain) => ({ source: 'oscillator', waveform: wave, frequencyHz: hz, durationTicks: dur, gain });
const lp = (a, b, q = 0.8) => ({ mode: 'lowpass', cutoffHz: a, cutoffEndHz: b, q });
const hp = (a, b, q = 0.8) => ({ mode: 'highpass', cutoffHz: a, cutoffEndHz: b, q });
const bp = (a, b, q = 1.2) => ({ mode: 'bandpass', cutoffHz: a, cutoffEndHz: b, q });
const env = (attack, hold, release, curve = 'exponential') => ({ attack, hold, release, curve });

const SFX = {
  'flame-jet': [['roar', 'sched', noise('brown', 124, 1.6), lp(1200, 700), env(0.08, 1.7, 0.35, 'linear')], ['hiss', 'sched', noise('pink', 124, 0.5), bp(2500, 1800, 0.9), env(0.1, 1.6, 0.4, 'linear')], ['whoomp', 'sched', chirp(160, 45, 30, 1.1), null, env(0.003, 0.03, 0.4)]],
  'impact-flash': [['boom', 'hit', noise('brown', 60, 1.5), lp(1500, 150), env(0.003, 0.04, 0.8)], ['snap', 'hit', noise('white', 20, 0.8), hp(2000, 4000), env(0.001, 0.02, 0.2)], ['thump', 'hit', chirp(110, 40, 30, 1), null, env(0.002, 0.02, 0.4)]],
  'rock-burst': [['rumble', 'hit', noise('brown', 90, 1.8), lp(700, 110), env(0.005, 0.1, 1.2)], ['thump', 'hit', chirp(90, 32, 36, 1.2), null, env(0.002, 0.03, 0.5)], ['clatter', 'hit', noise('white', 70, 0.35), bp(1800, 900, 1.5), env(0.02, 0.3, 0.8)]],
  'ice-shards': [['shatter', 'burst', noise('white', 40, 1), hp(3500, 7000), env(0.001, 0.03, 0.55)], ['chime', 'burst', osc('triangle', 1760, 90, 0.35), null, env(0.002, 0.05, 1.3)], ['chime2', 'burst', osc('sine', 2637, 80, 0.25), null, env(0.004, 0.04, 1.1)], ['crunch', 'burst', noise('pink', 30, 0.8), lp(2500, 400), env(0.002, 0.03, 0.35)]],
  'arc-beam': [['buzz', 'on', osc('saw', 110, 70, 0.4), bp(900, 1300, 2), env(0.02, 1, 0.12, 'linear')], ['crackle', 'on', noise('white', 70, 0.45), hp(3000, 3500), env(0.01, 1, 0.12, 'linear')], ['zap', 'on', chirp(3000, 300, 12, 0.6), null, env(0.001, 0.02, 0.15)]],
  'charge-up': [['rise', 'gather', chirp(180, 1400, 70, 0.5), null, env(0.4, 0.6, 0.15, 'linear')], ['whine', 'gather', noise('pink', 70, 0.6), bp(400, 3000, 3), env(0.3, 0.7, 0.2, 'linear')]],
  'poison-cloud': [['seep', 'seep', noise('brown', 200, 2), lp(500, 350, 1), env(0.5, 2.2, 0.6, 'linear')], ['fizz', 'seep', noise('white', 200, 0.6), bp(3500, 2500, 4), env(0.5, 2.2, 0.6, 'linear')]],
  'shadow-vortex': [['drone', 'gather', noise('brown', 150, 1.6), lp(260, 140, 1.4), env(0.6, 1.4, 0.5, 'linear')], ['suck', 'gather', chirp(900, 70, 150, 0.35), null, env(0.3, 1.8, 0.4, 'linear')]],
  'holy-light': [['c5', 'pulse', osc('sine', 523.25, 80, 0.32), null, env(0.25, 0.7, 0.4, 'linear')], ['e5', 'pulse', osc('sine', 659.25, 80, 0.26), null, env(0.3, 0.65, 0.4, 'linear')], ['g5', 'pulse', osc('sine', 783.99, 80, 0.22), null, env(0.35, 0.6, 0.4, 'linear')], ['shimmer', 'pulse', noise('white', 80, 0.18), hp(6000, 8000), env(0.3, 0.6, 0.4, 'linear')]],
  'tornado': [['wind', 'spin', noise('pink', 220, 2), bp(350, 900, 1.1), env(0.8, 2.2, 0.7, 'linear')], ['roar', 'spin', noise('brown', 220, 1.8), lp(400, 600), env(0.8, 2.2, 0.7, 'linear')]],
  'fountain': [['water', 'sched', noise('white', 180, 0.7), bp(2200, 2000, 0.7), env(0.15, 2.5, 0.4, 'linear')], ['gurgle', 'sched', noise('brown', 180, 0.6), lp(600, 500, 2), env(0.2, 2.4, 0.4, 'linear')]],
  'rain': [['rain', 'sched', noise('pink', 200, 2), hp(2500, 2200, 0.7), env(0.4, 2.3, 0.6, 'linear')]],
};
const FILES = { 'flame-jet': 'flame-jet', 'impact-flash': 'impact-flash', 'rock-burst': 'rock-burst', 'ice-shards': 'ice-shards', 'arc-beam': 'arc-beam', 'charge-up': 'charge-up', 'poison-cloud': 'poison-cloud', 'shadow-vortex': 'shadow-vortex', 'holy-light': 'holy-light', 'tornado': 'tornado', 'fountain': 'fountain', 'rain': 'rain-splash' };

for (const [key, voices] of Object.entries(SFX)) {
  const file = `mcp/examples/${FILES[key]}.steps.json`;
  let steps = JSON.parse(readFileSync(file, 'utf8'));
  const docId = steps[0][1].id;
  steps = steps.filter(([tool, a]) => !(tool === 'vfx_add_node' && String(a.id).startsWith('sfx-')) && !(tool === 'vfx_connect' && (String(a.from).startsWith('sfx-') || String(a.to).startsWith('sfx-'))) && tool !== 'vfx_render_audio');
  const tail = steps.filter(([t]) => t === 'vfx_compile' || t === 'vfx_render_frames');
  steps = steps.filter(([t]) => t !== 'vfx_compile' && t !== 'vfx_render_frames');
  const add = (type, id, params) => steps.push(['vfx_add_node', { docId, type, id, params }]);
  const con = (from, to) => steps.push(['vfx_connect', { docId, from, to }]);
  add('AudioMix', 'sfx-mix', { masterGain: 0.9 });
  add('AudioOutput', 'sfx-out', {});
  for (const [id, cue, src, filter, envelope] of voices) {
    add('AudioSource', `sfx-${id}`, src);
    let prev = `sfx-${id}`;
    con(`${cue}.start`, `sfx-${id}.trigger`);
    if (filter) { add('AudioFilter', `sfx-${id}-f`, filter); con(`${prev}.audio`, `sfx-${id}-f.audio`); prev = `sfx-${id}-f`; }
    add('AudioEnvelope', `sfx-${id}-e`, envelope); con(`${prev}.audio`, `sfx-${id}-e.audio`);
    con(`sfx-${id}-e.audio`, 'sfx-mix.inputs');
  }
  con('sfx-mix.audio', 'sfx-out.audio');
  con('sfx-out.audio', 'node-output.audio');
  steps.push(...tail, ['vfx_render_audio', { docId }, true]);
  writeFileSync(file, JSON.stringify(steps, null, 1));
  console.log(`${file}: ${voices.length} voices`);
}
