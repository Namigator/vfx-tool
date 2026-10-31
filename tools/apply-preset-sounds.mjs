#!/usr/bin/env node
// Replaces the audio block of each preset recipe (mcp/examples/<id>.steps.json) with the sample layers in
// tools/preset-sounds.json: removes every Audio* node, its connections, the EffectOutput.audio link and
// vfx_render_audio steps, then appends AudioSource(sample) [+ AudioEnvelope fade for loops] -> AudioMix -> AudioOutput.
// Re-runnable. Then: node --experimental-strip-types tools/build-components.mjs && npm run guide
//   node tools/apply-preset-sounds.mjs [id ...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..'), EX = join(ROOT, 'mcp/examples');
const design = JSON.parse(readFileSync(join(ROOT, 'tools/preset-sounds.json'), 'utf8'));
const libSec = new Map(JSON.parse(readFileSync(join(ROOT, 'assets/sounds/manifest.json'), 'utf8')).sounds.map(s => [s.id, s.durationSec]));
const lib = { has: id => libSec.has(id) };
const only = process.argv.slice(2);
for (const [id, layers] of Object.entries(design.presets)) {
  if (only.length && !only.includes(id)) continue;
  const file = join(EX, `${id}.steps.json`);
  if (!existsSync(file)) { console.log(`skip ${id}: no recipe`); continue; }
  const raw = JSON.parse(readFileSync(file, 'utf8')), steps = raw.steps ?? raw;
  const docId = steps.find(s => s[1]?.docId)?.[1].docId ?? id;
  const audioIds = new Set(steps.filter(s => s[0] === 'vfx_add_node' && /^Audio/.test(s[1].type)).map(s => s[1].id));
  const touches = s => s[0] === 'vfx_connect' && ([s[1].from, s[1].to].some(e => audioIds.has(String(e).split('.')[0])) || s[1].to === 'node-output.audio');
  const kept = steps.filter(s => !(s[0] === 'vfx_add_node' && audioIds.has(s[1].id)) && !touches(s) && s[0] !== 'vfx_render_audio');
  const scheds = new Set(kept.filter(s => s[0] === 'vfx_add_node' && s[1].type === 'Schedule').map(s => s[1].id));
  if (!layers.length) {
    // A silent preset (smoke): strip the audio and add nothing.
    writeFileSync(file, JSON.stringify(raw.steps ? { ...raw, steps: kept } : kept, null, 1) + '\n');
    console.log(`${id}: ${audioIds.size} old audio nodes -> silent`);
    continue;
  }
  const add = [];
  const node =(type, nid, params) => add.push(['vfx_add_node', { docId, type, id: nid, params }]);
  const wire = (from, to) => add.push(['vfx_connect', { docId, from, to }]);
  node('AudioMix', 'sfx-mix', { masterGain: design.masterGain });
  node('AudioOutput', 'sfx-out', {});
  layers.forEach(([sound, cue, offsetTicks, durationTicks, gain, pitch = 1, loop = false], k) => {
    if (!lib.has(sound)) throw new Error(`${id}: unknown sound ${sound}`);
    if (!scheds.has(cue)) throw new Error(`${id}: no Schedule "${cue}" (has ${[...scheds].join(', ')})`);
    const src = `sfx-${k + 1}`;
    node('AudioSource', src, { source: 'sample', sound, offsetTicks, durationTicks, gain, pitchRatio: pitch, sampleLoop: loop });
    wire(`${cue}.start`, `${src}.trigger`);
    const sec = durationTicks / 60;
    if (loop || libSec.get(sound) / pitch > sec + 0.02) {
      // A bed, or a sound cut short by Duration, fades out over its last 0.25 s instead of stopping dead.
      const env = `${src}-fade`;
      node('AudioEnvelope', env, { attack: loop ? 0.03 : 0.005, hold: Math.max(0, sec - 0.28), release: 0.25, curve: 'linear' });
      wire(`${src}.audio`, `${env}.audio`); wire(`${env}.audio`, 'sfx-mix.inputs');
    } else wire(`${src}.audio`, 'sfx-mix.inputs');
  });
  wire('sfx-mix.audio', 'sfx-out.audio');
  wire('sfx-out.audio', 'node-output.audio');
  add.push(['vfx_render_audio', { docId }, true]);
  // Insert before trailing checks (vfx_validate / vfx_save / snapshot steps) so the sound is part of the saved component.
  let at = kept.length;
  while (at > 0 && !['vfx_add_node', 'vfx_connect', 'vfx_set_param', 'vfx_set_params'].includes(kept[at - 1][0])) at--;
  const next = [...kept.slice(0, at), ...add, ...kept.slice(at)];
  writeFileSync(file, JSON.stringify(raw.steps ? { ...raw, steps: next } : next, null, 1) + '\n');
  console.log(`${id}: ${audioIds.size} old audio nodes -> ${layers.length} sample layers`);
}
