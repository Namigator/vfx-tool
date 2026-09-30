// Ceiling test for A-05 (user question "tool issue or model issue?"): the standalone flamethrower
// (docs/v2-plan/references/standalone-flamethrower) ported layer by layer onto generic tool nodes, by hand, to see
// how close the tool can get. Layers follow the standalone: normal-blend cooling tongue body (420/s, 6° cone,
// stretched ×3), faint additive accent, narrow additive core, smoke and embers born where tongues die, nozzle,
// floor light, ignition flash. Run: node tools/make-flamethrower-recipe.mjs && node mcp/run-steps.mjs mcp/examples/flamethrower.steps.json
import { writeFileSync } from 'node:fs';

const D = 'flamethrower', S = [];
const IGNITE = 12, EMIT_END = 96, END = 240;
const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
const wire = (from, to) => doc('vfx_connect', { from, to });
const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const col = (srgb, alpha = 1) => ({ srgb, alpha });
const grad = stops => ({ stops: stops.map(([position, srgb, alpha = 1]) => ({ position, color: col(srgb, alpha) })) });
const out = id => wire(`${id}.visual`, 'node-output.visual');
const deg = d => +(d * Math.PI / 180).toFixed(4);
// Emission ramp of the standalone: 35% at ignition, full after 3 ticks, off over the last 7 ticks.
const RAMP = lin([[0, 0.35], [0.04, 1], [0.92, 1], [1, 0]]);

S.push(['vfx_new_document', { template: 'blank', id: D }]);
doc('vfx_set_document', { durationTicks: END + 2, seed: 42, name: 'Flamethrower (hand-built)' });
doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.2, 0] });
doc('vfx_set_anchor', { anchorId: 'target', position: [3, 1.1, 0] });
// No effect-wide glow overrides: as a component it must look right under the default EffectOutput glow.
add('Schedule', 'emit', { startTicks: IGNITE, durationTicks: EMIT_END - IGNITE, mode: 'window' });

// ---- Tongue body: normal blend, cooling white-yellow -> orange -> deep red over life, dissolving silhouettes.
const tongue = (id, sprite) => {
  add('Emitter', id, { shape: 'cone', coneAngle: deg(6), radius: 0.02, rate: 210, burst: 0, speedMin: 8.5, speedMax: 11, lifetimeMin: 24 / 60, lifetimeMax: 45 / 60, rateOverWindow: RAMP });
  add('InitialProperties', `${id}ip`, { sizeMin: 0.22, sizeMax: 0.3, randomFrameStart: false });
  add('Drag', `${id}drag`, { coefficient: 0.18 });
  add('NoiseForce', `${id}noise`, { mode: 'vector', amplitude: 3, frequency: 0.55, evolution: 0.8 });
  add('Gravity', `${id}lift`, { acceleration: [0, 0.9, 0] });
  add('Material', `${id}mat`, { template: 'SpriteTextured', sprite, blend: 'normal', opacity: 0.62, dissolve: 0.6, dissolveStart: 0.5, dissolveSoftness: 0.12 });
  add('BillboardRenderer', `${id}bb`, { alignment: 'velocity', stretchRatio: 1.6, pivot: 0.38, flipbookMode: 'overLife',
    sizeOverLife: lin([[0, 1], [0.7, 3.7], [1, 2.2]]), opacityOverLife: lin([[0, 0], [0.07, 1], [0.55, 1], [1, 0]]),
    colorOverLife: grad([[0, '#FFFFFF'], [0.25, '#FFE0A0'], [0.5, '#FFA050'], [0.75, '#C8501E'], [1, '#5A1E0A']]) });
  wire('node-source.out', `${id}.anchor`); wire('node-target.out', `${id}.aim`); wire('emit.window', `${id}.window`);
  wire(`${id}.particles`, `${id}ip.particles`); wire(`${id}ip.particles`, `${id}drag.particles`); wire(`${id}drag.particles`, `${id}noise.particles`); wire(`${id}noise.particles`, `${id}lift.particles`);
  wire(`${id}lift.particles`, `${id}bb.particles`); wire(`${id}mat.material`, `${id}bb.material`); out(`${id}bb`);
  return `${id}lift`;
};
const tA = tongue('tonguea', 'flame-tongue-a'), tB = tongue('tongueb', 'flame-tongue-b');

// ---- Additive accent on young tongues (same particles, a second faint hot layer early in life).
add('Material', 'accentmat', { template: 'SpriteTextured', sprite: 'flame-tongue-a', blend: 'additive', tint: col('#FFF2D0'), opacity: 0.05 });
add('BillboardRenderer', 'accentbb', { alignment: 'velocity', stretchRatio: 1.6, pivot: 0.38, flipbookMode: 'overLife',
  sizeOverLife: lin([[0, 0.8], [0.45, 2.2], [0.46, 0], [1, 0]]), opacityOverLife: lin([[0, 0], [0.05, 1], [0.45, 0], [1, 0]]) });
wire(`${tA}.particles`, 'accentbb.particles'); wire('accentmat.material', 'accentbb.material'); out('accentbb');

// ---- Narrow additive core.
add('Emitter', 'core', { shape: 'cone', coneAngle: deg(3), radius: 0.015, rate: 130, burst: 0, speedMin: 10, speedMax: 13, lifetimeMin: 14 / 60, lifetimeMax: 26 / 60, rateOverWindow: RAMP });
add('InitialProperties', 'coreip', { sizeMin: 0.15, sizeMax: 0.18 });
add('Drag', 'coredrag', { coefficient: 0.12 });
add('NoiseForce', 'corenoise', { mode: 'vector', amplitude: 1, frequency: 0.55, evolution: 0.8 });
add('Material', 'coremat', { template: 'SpriteTextured', sprite: 'flame-tongue-b', blend: 'additive', tint: col('#FFF6E0'), opacity: 0.13 });
add('BillboardRenderer', 'corebb', { alignment: 'velocity', stretchRatio: 1.9, pivot: 0.38, flipbookMode: 'overLife',
  sizeOverLife: lin([[0, 1], [0.4, 3.4], [1, 2]]), opacityOverLife: lin([[0, 1], [0.6, 1], [1, 0]]) });
wire('node-source.out', 'core.anchor'); wire('node-target.out', 'core.aim'); wire('emit.window', 'core.window');
wire('core.particles', 'coreip.particles'); wire('coreip.particles', 'coredrag.particles'); wire('coredrag.particles', 'corenoise.particles');
wire('corenoise.particles', 'corebb.particles'); wire('coremat.material', 'corebb.material'); out('corebb');

// ---- Smoke and embers are born where tongues die (ParticleEvents death), so they sit inside the fire.
for (const [src, tag] of [[tA, 'a'], [tB, 'b']]) {
  add('ParticleEvents', `smokeev${tag}`, { probability: 0.08, maxEvents: 1024 });
  add('ParticleEvents', `emberev${tag}`, { probability: 0.1, maxEvents: 1024 });
  wire(`${src}.particles`, `smokeev${tag}.particles`); wire(`${src}.particles`, `emberev${tag}.particles`);
}
add('Emitter', 'smoke', { shape: 'sphere', radius: 0.05, burst: 1, rate: 0, speedMin: 0.2, speedMax: 0.6, lifetimeMin: 1, lifetimeMax: 1.9, useEventPosition: true, inheritVelocity: 0.35 });
add('InitialProperties', 'smokeip', { sizeMin: 0.35, sizeMax: 0.5, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283, angularVelocityMin: -0.7, angularVelocityMax: 0.7 });
add('Drag', 'smokedrag', { coefficient: 1.2 });
add('Gravity', 'smokelift', { acceleration: [0, 1.6, 0] });
add('NoiseForce', 'smokenoise', { mode: 'curl', amplitude: 2.2, frequency: 0.55, evolution: 0.6 });
add('Material', 'smokemat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#6A625A'), opacity: 1, groundFade: 0.2 });
add('BillboardRenderer', 'smokebb', { flipbookMode: 'overLife', sizeOverLife: lin([[0, 0.45], [1, 2.4]]), opacityOverLife: lin([[0, 0.15], [0.2, 0.32], [1, 0]]) });
wire('smokeeva.death', 'smoke.trigger'); wire('smokeevb.death', 'smoke.trigger');
wire('smoke.particles', 'smokeip.particles'); wire('smokeip.particles', 'smokedrag.particles'); wire('smokedrag.particles', 'smokelift.particles'); wire('smokelift.particles', 'smokenoise.particles');
wire('smokenoise.particles', 'smokebb.particles'); wire('smokemat.material', 'smokebb.material'); out('smokebb');

add('Emitter', 'embers', { shape: 'sphere', radius: 0.03, burst: 1, rate: 0, speedMin: 2, speedMax: 4, lifetimeMin: 0.5, lifetimeMax: 1.2, useEventPosition: true, inheritVelocity: 0.45 });
add('InitialProperties', 'emberip', { sizeMin: 0.012, sizeMax: 0.03 });
add('Drag', 'emberdrag', { coefficient: 1.1 });
add('Gravity', 'embergrav', { acceleration: [0, -3.5, 0] });
add('NoiseForce', 'embernoise', { mode: 'vector', amplitude: 4, frequency: 0.55, evolution: 1 });
add('Material', 'embermat', { template: 'SpriteTextured', sprite: 'spark-streak', blend: 'additive', tint: col('#FFC080'), emission: 0.8 });
add('BillboardRenderer', 'emberbb', { alignment: 'velocity', stretchRatio: 3, pivot: 0.8, opacityOverLife: lin([[0, 1], [1, 0]]), colorOverLife: grad([[0, '#FFDC8C'], [1, '#FF5A14']]) });
add('Material', 'embertrailmat', { template: 'SpriteUnlit', blend: 'additive', tint: col('#FF9040'), opacity: 0.7 });
add('ParticleTrail', 'embertrail', { history: 0.05, width: 0.012, endFade: 0.4 });
wire('embereva.death', 'embers.trigger'); wire('emberevb.death', 'embers.trigger');
wire('embers.particles', 'emberip.particles'); wire('emberip.particles', 'emberdrag.particles'); wire('emberdrag.particles', 'embergrav.particles'); wire('embergrav.particles', 'embernoise.particles');
wire('embernoise.particles', 'emberbb.particles'); wire('embermat.material', 'emberbb.material'); out('emberbb');
wire('embernoise.particles', 'embertrail.particles'); wire('embertrailmat.material', 'embertrail.material'); out('embertrail');

// ---- Ignition flash at the muzzle.
add('Schedule', 'ignite', { startTicks: IGNITE, durationTicks: 11, mode: 'window' });
add('OffsetAnchor', 'muzzle', { offset: [0.25, 0, 0] });
wire('node-source.out', 'muzzle.anchor');
add('Material', 'flashmat', { template: 'SpriteTextured', sprite: 'soft-glow', variant: 1, blend: 'additive', tint: col('#FFE0A8'), emission: 0.6 });
add('SpriteRenderer', 'flash', { size: 0.9, sizeOverWindow: lin([[0, 0.35], [0.55, 1], [1, 1]]), opacityOverWindow: lin([[0, 1], [0.55, 1], [1, 0]]) });
wire('muzzle.out', 'flash.anchor'); wire('flashmat.material', 'flash.material'); wire('ignite.window', 'flash.window'); out('flash');
add('CameraImpulse', 'shake', { durationTicks: 18, translation: 0.03, rotation: 0.004 });
wire('ignite.start', 'shake.trigger'); wire('shake.presentation', 'node-output.presentation');

// ---- Warm floor light along the jet (fast attack, flicker, exp decay after the emission ends).
add('Schedule', 'lightwin', { startTicks: IGNITE, durationTicks: EMIT_END - IGNITE + 30, mode: 'window' });
for (const [i, along] of [[0, 1.2], [1, 3]]) {
  add('OffsetAnchor', `lamp${i}`, { offset: [along, 0.3, 0] });
  wire('node-source.out', `lamp${i}.anchor`);
  add('PointLight', `light${i}`, { color: col('#FF7A28'), intensity: 16, range: 3.5, flicker: 0.25, flickerRate: 11, intensityOverWindow: lin([[0, 0], [0.04, 1], [0.73, 0.95], [0.85, 0.3], [1, 0]]) });
  wire(`lamp${i}.out`, `light${i}.anchor`); wire('lightwin.window', `light${i}.window`); out(`light${i}`);
}

// ---- Nozzle: dark barrel behind the muzzle, aimed at the target, with a leg under its back end.
add('Schedule', 'always', { startTicks: 0, durationTicks: END, mode: 'window' });
add('Material', 'steel', { blend: 'normal', tint: col('#3A2E26'), roughness: 0.55, metalness: 0.4 });
add('PropMesh', 'barrel', { mesh: 'cylinder', size: 0.11, length: 1.1, pivot: 'end' });
wire('node-source.out', 'barrel.anchor'); wire('node-target.out', 'barrel.aim'); wire('steel.material', 'barrel.material'); wire('always.window', 'barrel.window'); out('barrel');
add('OffsetAnchor', 'legtop', { offset: [-0.85, -0.05, 0] });
wire('node-source.out', 'legtop.anchor');
add('PropMesh', 'leg', { mesh: 'cylinder', size: 0.06, length: 0.5, pivot: 'start', direction: [0, -1, 0] });
wire('legtop.out', 'leg.anchor'); wire('steel.material', 'leg.material'); wire('always.window', 'leg.window'); out('leg');

S.push(['vfx_compile', { docId: D }, true]);
// Reference framing (the standalone's camera, derived from its projection) at its 847×922 canvas.
const REF_CAM = { position: [-3.51, 4.29, 11.34], target: [0.25, 0.6, 0], fov: 76 };
S.push(['vfx_render_frames', { docId: D, ticks: [6, 21, 48, 72, 90, 132, 180], width: 847, height: 922, camera: REF_CAM }, true]);
writeFileSync('mcp/examples/flamethrower.steps.json', JSON.stringify(S, null, 1));
console.log(`flamethrower: ${S.length} steps`);
