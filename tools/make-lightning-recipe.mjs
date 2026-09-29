// Generates mcp/examples/lightning-strike.steps.json from docs/v2-plan/effects/01-LIGHTNING.md using only
// generic nodes (no lightning-specific code). Re-run after editing: node tools/make-lightning-recipe.mjs
import { writeFileSync } from 'node:fs';

// Variants (01 'Required variants') are the same graph with different values; nothing is cloned in code.
const VARIANTS = {
  'lightning-strike': { doc: 'bolt', charge: 24, core: 1, branches: { count: 14, len: [0.4, 1.8], op: [0.2, 0.48], w: [0.2, 0.4] }, forks: 7, srcSparks: 45, hitSparks: 70, decay: 3, active: 39, halo: 2, ripple: 5.6 },
  'lightning-thin-fork': { doc: 'thinfork', charge: 24, core: 0.5, branches: { count: 14, len: [0.3, 1.4], op: [0.12, 0.3], w: [0.1, 0.2] }, forks: 6, srcSparks: 25, hitSparks: 35, decay: 5, active: 26, halo: 1.4, ripple: 4 },
  'lightning-heavy-strike': { doc: 'heavy', charge: 33, core: 1.6, branches: { count: 8, len: [0.8, 2.4], op: [0.4, 0.7], w: [0.35, 0.6] }, forks: 5, srcSparks: 60, hitSparks: 100, decay: 2.5, active: 45, halo: 3, ripple: 7.5 },
};
for (const [file, V] of Object.entries(VARIANTS)) {
const D = V.doc, S = [], C = V.charge, t0 = C / 60, t1 = (C + 2) / 60;
const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
const wire = (from, to) => doc('vfx_connect', { from, to });
const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const eff = keys => ({ domain: 'effectSeconds', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const col = srgb => ({ srgb, alpha: 1 });
const glow = (id, tint, extra = {}) => add('Material', id, { template: 'SpriteTextured', sprite: 'soft-glow', blend: 'additive', tint: col(tint), ...extra });
const flat = (id, tint, extra = {}) => add('Material', id, { blend: 'additive', tint: col(tint), ...extra });
const out = id => wire(`${id}.visual`, 'node-output.visual');

S.push(['vfx_new_document', { template: 'blank', id: D }]);
doc('vfx_set_document', { durationTicks: 144, seed: 2 });
doc('vfx_set_anchor', { anchorId: 'source', position: [-5.1, 1.65, 0] });
doc('vfx_set_anchor', { anchorId: 'target', position: [4.5, 0.1, 0] });
add('OffsetAnchor', 'floor', { offset: [0, -0.08, 0] });
wire('node-target.out', 'floor.anchor');

// ---- Charge (ticks 0–24): core/halo at Source, motes pulled in with tethers ----
add('Schedule', 'charge', { startTicks: 0, durationTicks: C, mode: 'window' });
glow('chargecoremat', '#DDF2FF', { emission: 2.5 });
glow('chargehalomat', '#3F7BFF', { opacity: 0.9, emission: 0.6 });
add('SpriteRenderer', 'chargecore', { size: 0.34, sizeOverWindow: lin([[0, 0.14], [1, 1]]), opacityOverWindow: lin([[0, 0.2], [1, 1]]) });
add('SpriteRenderer', 'chargehalo', { size: 1.4, sizeOverWindow: lin([[0, 0.14], [1, 1]]), opacityOverWindow: lin([[0, 0], [1, 0.8]]) });
for (const [r, m] of [['chargecore', 'chargecoremat'], ['chargehalo', 'chargehalomat']]) { wire('node-source.out', `${r}.anchor`); wire(`${m}.material`, `${r}.material`); wire('charge.window', `${r}.window`); out(r); }
add('Emitter', 'motes', { shape: 'sphere', radius: 1.5, burst: 27, rate: 0, speedMin: 0, speedMax: 0.2, lifetimeMin: t0, lifetimeMax: t0 });
add('InitialProperties', 'moteip', { sizeMin: 0.03, sizeMax: 0.05 });
add('Attract', 'pull', { acceleration: Math.min(100, +(3 / (t0 * t0)).toFixed(2)), softRadius: 0.2, killRadius: 0.08 });
glow('motemat', '#9FD8FF', { emission: 1 });
add('BillboardRenderer', 'motebb');
wire('node-source.out', 'motes.anchor'); wire('charge.start', 'motes.trigger');
wire('motes.particles', 'moteip.particles'); wire('moteip.particles', 'pull.particles'); wire('node-source.out', 'pull.anchor');
wire('pull.particles', 'motebb.particles'); wire('motemat.material', 'motebb.material'); out('motebb');
add('ParticlePaths', 'tethers', { maxCount: 4, samples: 10 });
add('JaggedPath', 'tetherjag', { amplitude: 0.06, regenerationHz: 24, samples: 10 });
flat('tethermat', '#CFEBFF', { emission: 0.6, opacity: 0.8 });
add('RibbonRenderer', 'tetherrib', { width: 0.012, endFade: 0.15 });
wire('pull.particles', 'tethers.particles'); wire('node-source.out', 'tethers.anchor'); wire('tethers.paths', 'tetherjag.paths');
wire('tetherjag.paths', 'tetherrib.paths'); wire('tethermat.material', 'tetherrib.material'); wire('charge.window', 'tetherrib.window'); out('tetherrib');

// ---- Discharge (tick 24, 39 ticks): bowed jagged trunk + branches + forks, revealed over 2 ticks ----
add('Schedule', 'strike', { startTicks: C, durationTicks: V.active, mode: 'window' });
add('BezierPath', 'base', { startHandle: [2.4, 0.56, 0], endHandle: [-2.4, 0.56, 0], samples: 48 });
wire('node-source.out', 'base.start'); wire('node-target.out', 'base.end');
add('JaggedPath', 'trunk', { amplitude: 0.55, regenerationHz: 24, samples: 42 });
add('BranchPath', 'branches', { count: V.branches.count, attachmentMin: 0.12, attachmentMax: 0.88, lengthMin: V.branches.len[0], lengthMax: V.branches.len[1], opacityMin: V.branches.op[0], opacityMax: V.branches.op[1], widthMin: V.branches.w[0], widthMax: V.branches.w[1] });
add('BranchPath', 'forks', { count: V.forks, lengthMin: 0.3, lengthMax: 1, opacityMin: 0.15, opacityMax: 0.15, widthMin: 0.15, widthMax: 0.25 });
add('JaggedPath', 'branchjag', { amplitude: 0.14, regenerationHz: 24, samples: 14 });
add('JaggedPath', 'forkjag', { amplitude: 0.08, regenerationHz: 24, samples: 10 });
add('MergePaths', 'boltpaths');
add('RevealPath', 'reveal');
add('EffectTimeCurve', 'revealcurve', { curve: eff([[t0, 0], [t1 + 0.0001, 1]]) });
wire('base.paths', 'trunk.paths'); wire('trunk.paths', 'branches.paths'); wire('branches.branches', 'branchjag.paths'); wire('branchjag.paths', 'forks.paths'); wire('forks.branches', 'forkjag.paths');
wire('trunk.paths', 'boltpaths.paths'); wire('branchjag.paths', 'boltpaths.paths'); wire('forkjag.paths', 'boltpaths.paths');
wire('boltpaths.paths', 'reveal.paths'); wire('revealcurve.value', 'reveal.fraction');
// Secondary filaments: two independent jagged chains on the same base, opacity scale .32.
add('JaggedPath', 'filA', { amplitude: 0.36, regenerationHz: 24, samples: 48 });
add('JaggedPath', 'filB', { amplitude: 0.56, regenerationHz: 24, samples: 48 });
add('MergePaths', 'filaments');
add('RevealPath', 'filreveal');
wire('base.paths', 'filA.paths'); wire('base.paths', 'filB.paths'); wire('filA.paths', 'filaments.paths'); wire('filB.paths', 'filaments.paths');
wire('filaments.paths', 'filreveal.paths'); wire('revealcurve.value', 'filreveal.fraction');

// Discharge envelope exp(-3t)·(.72+.28·sin²(96t)) from nodes (t = seconds since the strike started).
add('Time', 'clock'); wire('strike.window', 'clock.window');
add('ScalarMath', 'decay', { operation: 'multiply', b: -V.decay, inputUnit: 'second', unit: 'none' });
add('ScalarMath', 'expo', { operation: 'exp', unit: 'none' });
add('Oscillator', 'flicker', { waveform: 'sine', frequency: 96 / Math.PI, phase: 1 - ((96 * t0 / Math.PI) % 1), min: 0.72, max: 1, unit: 'none' });
add('ScalarMath', 'envelope', { operation: 'multiply', inputUnit: 'none', unit: 'none' });
wire('clock.localSeconds', 'decay.a'); wire('decay.value', 'expo.a'); wire('expo.value', 'envelope.a'); wire('flicker.value', 'envelope.b');

// Four passes share the bolt geometry: core / inner / outer / halo (widths and base opacities from the spec).
const passes = [
  ['core', 0.026, '#FFFFFF', 1, 0.5], ['inner', 0.07, '#7FD6FF', 0.65, 0.15], ['outer', 0.185, '#2F7BFF', 0.17, 0], ['halo', 0.43, '#1A3A9A', 0.07, 0],
  ['filcore', 0.02, '#DDF2FF', 0.32, 0.6], ['filouter', 0.12, '#3F8CFF', 0.32 * 0.17, 0],
];
for (const [name, width, tint, opacity, emission] of passes) {
  flat(`${name}mat`, tint, { emission });
  add('ScalarMath', `${name}level`, { operation: 'multiply', b: opacity, inputUnit: 'none', unit: 'normalized' });
  wire('envelope.value', `${name}level.a`); wire(`${name}level.value`, `${name}mat.opacity`);
  add('RibbonRenderer', `${name}rib`, { width: +(width * V.core).toFixed(4), endFade: 0.04 });
  wire(`${name.startsWith('fil') ? 'filreveal' : 'reveal'}.paths`, `${name}rib.paths`); wire(`${name}mat.material`, `${name}rib.material`); wire('strike.window', `${name}rib.window`); out(`${name}rib`);
}

// Impact lands when the 2-tick reveal reaches the target (tick 26).
add('Schedule', 'impact', { startTicks: C + 2, durationTicks: 36, mode: 'window' });

// ---- Sparks at both ends: moving streaks with individual lifetimes ----
glow('sparkmat', '#CFEFFF', { emission: 1.2 });
flat('sparktrailmat', '#9FD8FF', { emission: 0.8 });
for (const [id, anchor, burst, extra] of [['srcsparks', 'node-source', V.srcSparks, { shape: 'sphere', radius: 0.05, speedMin: 1.5, speedMax: 6.5 }], ['hitsparks', 'node-target', V.hitSparks, { shape: 'cone', direction: [0, 1, 0], coneAngle: 1.4, radius: 0.05, speedMin: 1, speedMax: 6 }]]) {
  add('Emitter', id, { burst, rate: 0, lifetimeMin: 11 / 60, lifetimeMax: 71 / 60, ...extra });
  add('InitialProperties', `${id}ip`, { sizeMin: 0.02, sizeMax: 0.035 });
  add('Gravity', `${id}g`, { acceleration: [0, -10, 0] });
  add('GroundCollision', `${id}floor`, { mode: 'bounce', restitution: 0.3 });
  add('ParticleTrail', `${id}trail`, { history: 4 / 60, width: 0.012, endFade: 0.3 });
  add('BillboardRenderer', `${id}bb`, { alignment: 'velocity', stretchRatio: 2 });
  wire(`${anchor}.out`, `${id}.anchor`); wire(id === 'hitsparks' ? 'impact.start' : 'strike.start', `${id}.trigger`);
  wire(`${id}.particles`, `${id}ip.particles`); wire(`${id}ip.particles`, `${id}g.particles`); wire(`${id}g.particles`, `${id}floor.particles`);
  wire(`${id}floor.particles`, `${id}trail.particles`); wire('sparktrailmat.material', `${id}trail.material`); out(`${id}trail`);
  wire(`${id}floor.particles`, `${id}bb.particles`); wire('sparkmat.material', `${id}bb.material`); out(`${id}bb`);
}

// ---- Impact: core/halo with a fast exponential envelope, ground light, ripple ----
glow('impcoremat', '#FFFFFF', { emission: 1.5 });
glow('imphalomat', '#2F6BFF', { opacity: 0.7 });
add('SpriteRenderer', 'impcore', { size: 0.35, opacityOverWindow: lin([[0, 1], [0.08, 0.55], [0.25, 0.18], [0.6, 0.03], [1, 0]]) });
add('SpriteRenderer', 'imphalo', { size: V.halo, opacityOverWindow: lin([[0, 0.8], [0.12, 0.35], [0.4, 0.08], [1, 0]]) });
for (const [r, m] of [['impcore', 'impcoremat'], ['imphalo', 'imphalomat']]) { wire('node-target.out', `${r}.anchor`); wire(`${m}.material`, `${r}.material`); wire('impact.window', `${r}.window`); out(r); }
add('PointLight', 'light', { color: col('#8FC8FF'), intensity: 25, range: 6, intensityOverWindow: lin([[0, 1], [0.15, 0.35], [0.5, 0.08], [1, 0]]) });
wire('floor.out', 'light.anchor'); wire('impact.window', 'light.window'); out('light');
add('Schedule', 'ripplewin', { startTicks: C + 2, durationTicks: 96, mode: 'window' });
add('RingPath', 'ripple', { radius: V.ripple, samples: 96 });
add('EffectTimeCurve', 'ripplesize', { curve: eff([[t1, 0.15 / V.ripple], [t1 + 0.5, 0.55], [t1 + 1.6, 1]]) });
add('EffectTimeCurve', 'ripplefade', { curve: eff([[t1, 0.6], [t1 + 0.4, 0.22], [t1 + 0.9, 0.06], [t1 + 1.6, 0]]) });
flat('ripplemat', '#5FA8FF', { emission: 0.3 });
add('RibbonRenderer', 'ripplerib', { width: 0.05, endFade: 0 });
wire('floor.out', 'ripple.center'); wire('ripplesize.value', 'ripple.radiusScale'); wire('ripplefade.value', 'ripplemat.opacity');
wire('ripple.paths', 'ripplerib.paths'); wire('ripplemat.material', 'ripplerib.material'); wire('ripplewin.window', 'ripplerib.window'); out('ripplerib');

// ---- Presentation: flash + subtle impulse on the discharge event ----
add('ScreenFlash', 'flash', { color: col('#CFE6FF'), alpha: 0.13, durationTicks: 4 });
add('CameraImpulse', 'shake', { durationTicks: 6, translation: 0.03, rotation: 0.006 });
wire('strike.start', 'flash.trigger'); wire('strike.start', 'shake.trigger');
wire('flash.presentation', 'node-output.presentation'); wire('shake.presentation', 'node-output.presentation');

S.push(['vfx_compile', { docId: D }, true]);
S.push(['vfx_render_frames', { docId: D, ticks: [C - 2, C + 1, C + 3, C + 16, C + 56] }, true]);
writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
console.log(`${file}: ${S.length} steps`);
}
