// Generates the energy recipes (docs/v2-plan/effects/10-ENERGY.md) from generic nodes: a charged projectile
// (gathering charge at Source, core + halo riding a PathFollower, MotionTrail, shed spark trails) whose
// arrival event drives every impact element (flash, ring, burst, light), plus fast-needle and heavy-orb
// variants. Sound is parked. Run: node tools/make-energy-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'energy-bolt': { doc: 'energy', travel: 36, bend: 0.4, core: 0.22, halo: 0.6, history: 0.3, width: 0.08, shed: 60, burst: 90, ring: 2.8, flash: 1.6 },
  'energy-needle': { doc: 'energyneedle', travel: 20, bend: 0.1, core: 0.12, halo: 0.35, history: 0.45, width: 0.035, shed: 40, burst: 50, ring: 1.6, flash: 1 },
  'energy-orb': { doc: 'energyorb', travel: 56, bend: 0.7, core: 0.38, halo: 1, history: 0.18, width: 0.2, shed: 80, burst: 150, ring: 3.6, flash: 2.4 },
};
const CHARGE = 30, END = 180;
// One accent colour (the Accent colour knob) tints every coloured layer; the cores stay white.
const ACCENT = '#9B6BFF';

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [];
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const grad = stops => ({ stops: stops.map(([position, srgb, alpha = 1]) => ({ position, color: col(srgb, alpha) })) });
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  const glow = (id, tint, extra = {}) => add('Material', id, { template: 'SpriteTextured', sprite: 'soft-glow', blend: 'additive', tint: col(tint), ...extra });
  const arrive = CHARGE + V.travel;

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: END, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-4, 1.4, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [4, 0.3, 0] });
  add('Schedule', 'charge', { startTicks: 0, durationTicks: CHARGE, mode: 'window' });

  // ---- Charge (0–30): 24 converging motes and a two-layer core growing .08 → .3 m at Source ----
  add('Emitter', 'gather', { shape: 'sphere', radius: 1.2, burst: 24, rate: 0, speedMin: 0, speedMax: 0.1, lifetimeMin: CHARGE / 60, lifetimeMax: CHARGE / 60 });
  add('InitialProperties', 'gatherip', { sizeMin: 0.03, sizeMax: 0.06 });
  add('Attract', 'gatherpull', { acceleration: 12, softRadius: 0.12, killRadius: 0.05 });
  glow('motemat', '#F2F0F6', { emission: 0.8 });
  add('BillboardRenderer', 'gatherbb');
  wire('node-source.out', 'gather.anchor'); wire('charge.start', 'gather.trigger');
  wire('gather.particles', 'gatherip.particles'); wire('gatherip.particles', 'gatherpull.particles'); wire('node-source.out', 'gatherpull.anchor');
  wire('gatherpull.particles', 'gatherbb.particles'); wire('motemat.material', 'gatherbb.material'); out('gatherbb');
  glow('coremat', '#FFFFFF', { emission: 1.4 });
  glow('halomat', ACCENT, { opacity: 0.35, emission: 0.4 });
  add('SpriteRenderer', 'chargecore', { size: 0.3, sizeOverWindow: lin([[0, 0.27], [1, 1]]), opacityOverWindow: lin([[0, 0.3], [1, 1]]) });
  add('SpriteRenderer', 'chargehalo', { size: 0.9, sizeOverWindow: lin([[0, 0.2], [1, 1]]), opacityOverWindow: lin([[0, 0], [1, 0.8]]) });
  for (const [r, m] of [['chargecore', 'coremat'], ['chargehalo', 'halomat']]) { wire('node-source.out', `${r}.anchor`); wire(`${m}.material`, `${r}.material`); wire('charge.window', `${r}.window`); out(r); }

  // ---- Travel: shallow Bezier arc, PathFollower; the flight window stays open so the trail drains at the target ----
  const h = V.bend * 4 / 3; // Cubic Bezier peak = .75 × handle height, so the arc rises by V.bend.
  add('BezierPath', 'arc', { startHandle: [2.6, h, 0], endHandle: [-2.6, h, 0], samples: 64 });
  wire('node-source.out', 'arc.start'); wire('node-target.out', 'arc.end');
  add('Schedule', 'flight', { startTicks: CHARGE, durationTicks: END - CHARGE, mode: 'window' });
  add('PathFollower', 'ball', { durationTicks: V.travel, easing: 'linear', speed: 0 }); // Speed 0 = duration mode (Travel ticks); the Speed knob switches to speed mode.
  wire('arc.paths', 'ball.paths'); wire('flight.window', 'ball.window');
  // Moving core + low-alpha halo live only while travelling (plus 2 ticks of overlap with the flash).
  add('Schedule', 'corewin', { startTicks: CHARGE, durationTicks: V.travel + 2, mode: 'window' });
  add('SpriteRenderer', 'core', { size: V.core });
  add('SpriteRenderer', 'halo', { size: V.halo, opacityOverWindow: lin([[0, 0.8], [1, 0.8]]) });
  for (const [r, m] of [['core', 'coremat'], ['halo', 'halomat']]) { wire('ball.anchor', `${r}.anchor`); wire(`${m}.material`, `${r}.material`); wire('corewin.window', `${r}.window`); out(r); }
  add('PointLight', 'balllight', { color: col(ACCENT), intensity: 18, range: 4 });
  wire('ball.anchor', 'balllight.anchor'); wire('corewin.window', 'balllight.window'); out('balllight');

  // ---- Main trail: past positions only (MotionTrail), white core over a wider violet sheath ----
  add('Material', 'trailmat', { blend: 'additive', tint: col('#F0EEF4'), emission: 0.5, opacity: 0.55 });
  add('MotionTrail', 'trail', { history: V.history, maxPoints: 64, width: V.width, endFade: 0.5 });
  add('Material', 'sheathmat', { blend: 'additive', tint: col(ACCENT), emission: 0.4, opacity: 0.45 });
  add('MotionTrail', 'sheath', { history: +(V.history * 0.8).toFixed(3), maxPoints: 64, width: +(V.width * 2.6).toFixed(3), endFade: 0.5 });
  for (const [r, m] of [['trail', 'trailmat'], ['sheath', 'sheathmat']]) { wire('ball.anchor', `${r}.anchor`); wire(`${m}.material`, `${r}.material`); wire('flight.window', `${r}.window`); out(r); }

  // ---- Orbiting accents: sparse short-lived sparkles hugging the core ----
  add('Emitter', 'accents', { shape: 'sphere', radius: V.core * 1.2, rate: 40, burst: 0, speedMin: 0.1, speedMax: 0.4, lifetimeMin: 0.08, lifetimeMax: 0.2 });
  add('InitialProperties', 'accentip', { sizeMin: 0.025, sizeMax: 0.05 });
  add('BillboardRenderer', 'accentbb', { opacityOverLife: lin([[0, 1], [1, 0]]) });
  wire('ball.anchor', 'accents.anchor'); wire('corewin.window', 'accents.window');
  wire('accents.particles', 'accentip.particles'); wire('accentip.particles', 'accentbb.particles'); wire('motemat.material', 'accentbb.material'); out('accentbb');

  // ---- Shed sparks: world-space, 60/s during travel, low noise, tapered trails ----
  add('Emitter', 'shed', { shape: 'sphere', radius: 0.05, rate: V.shed, burst: 0, speedMin: 0.2, speedMax: 0.8, lifetimeMin: 18 / 60, lifetimeMax: 42 / 60 });
  add('InitialProperties', 'shedip', { sizeMin: 0.02, sizeMax: 0.035 });
  add('NoiseForce', 'shednoise', { mode: 'curl', amplitude: 0.8, frequency: 1.2, evolution: 1 });
  add('Drag', 'sheddrag', { coefficient: 1 });
  add('Material', 'shedmat', { blend: 'additive', tint: col(ACCENT), emission: 0.8 });
  add('ParticleTrail', 'shedtrail', { history: 0.15, maxPoints: 10, width: 0.015, endFade: 0.5 });
  wire('ball.anchor', 'shed.anchor'); wire('corewin.window', 'shed.window');
  wire('shed.particles', 'shedip.particles'); wire('shedip.particles', 'shednoise.particles'); wire('shednoise.particles', 'sheddrag.particles');
  wire('sheddrag.particles', 'shedtrail.particles'); wire('shedmat.material', 'shedtrail.material'); out('shedtrail');

  // ---- Impact: everything below is triggered by ball.arrival, so it moves with the travel time ----
  add('Schedule', 'flashwin', { startTicks: 0, durationTicks: 18, mode: 'window' });
  add('Schedule', 'ringwin', { startTicks: 0, durationTicks: 36, mode: 'window' });
  add('Schedule', 'lightwin', { startTicks: 0, durationTicks: 30, mode: 'window' });
  for (const w of ['flashwin', 'ringwin', 'lightwin']) wire('ball.arrival', `${w}.trigger`);
  add('SpriteRenderer', 'flash', { size: V.flash, sizeOverWindow: lin([[0, 0.4], [0.15, 1], [1, 1.2]]), opacityOverWindow: lin([[0, 1], [0.3, 0.6], [1, 0]]),
    colorOverWindow: grad([[0, '#FFFFFF'], [1, '#8C8C8C']]) });
  wire('node-target.out', 'flash.anchor'); wire('coremat.material', 'flash.material'); wire('flashwin.window', 'flash.window'); out('flash');
  add('SpriteRenderer', 'flashglow', { size: +(V.flash * 1.8).toFixed(2), sizeOverWindow: lin([[0, 0.5], [0.2, 1], [1, 1.3]]), opacityOverWindow: lin([[0, 1], [1, 0]]) });
  wire('node-target.out', 'flashglow.anchor'); wire('halomat.material', 'flashglow.material'); wire('flashwin.window', 'flashglow.window'); out('flashglow');
  add('PointLight', 'impactlight', { color: col(ACCENT), intensity: 50, range: 6, intensityOverWindow: lin([[0, 1], [1, 0]]) });
  wire('node-target.out', 'impactlight.anchor'); wire('lightwin.window', 'impactlight.window'); out('impactlight');
  // Ring: thin, flat at the impact height, radius .2 → ring size over 36 ticks, fading.
  add('Time', 'ringclock'); wire('ringwin.window', 'ringclock.window');
  add('ScalarMath', 'ringsize', { operation: 'max', b: +(0.2 / V.ring).toFixed(4), unit: 'normalized' });
  add('ScalarMath', 'ringdim', { operation: 'multiply', b: -0.8, inputUnit: 'normalized', unit: 'normalized' });
  add('ScalarMath', 'ringfade', { operation: 'add', b: 0.8, unit: 'normalized' });
  wire('ringclock.progress', 'ringsize.a'); wire('ringclock.progress', 'ringdim.a'); wire('ringdim.value', 'ringfade.a');
  add('RingPath', 'ring', { radius: V.ring, samples: 96 });
  add('Material', 'ringmat', { blend: 'additive', tint: col(ACCENT), emission: 0.5 });
  add('RibbonRenderer', 'ringrib', { width: 0.03, endFade: 0 });
  wire('node-target.out', 'ring.center'); wire('ringsize.value', 'ring.radiusScale'); wire('ringfade.value', 'ringmat.opacity');
  wire('ring.paths', 'ringrib.paths'); wire('ringmat.material', 'ringrib.material'); wire('ringwin.window', 'ringrib.window'); out('ringrib');
  // Burst: velocity-stretched sparks, drag, gravity, white → violet.
  add('Emitter', 'burst', { shape: 'sphere', radius: 0.08, burst: V.burst, rate: 0, speedMin: 2, speedMax: 6, lifetimeMin: 0.3, lifetimeMax: 0.8 });
  add('InitialProperties', 'burstip', { sizeMin: 0.02, sizeMax: 0.04 });
  add('Drag', 'burstdrag', { coefficient: 2 });
  add('Gravity', 'burstg', { acceleration: [0, -3, 0] });
  add('Material', 'burstmat', { template: 'SpriteTextured', sprite: 'spark-streak', blend: 'additive', tint: col(ACCENT), emission: 0.8 });
  add('BillboardRenderer', 'burstbb', { alignment: 'velocity', stretchRatio: 4, pivot: 0.8, colorOverLife: grad([[0, '#FFFFFF'], [0.4, '#D0D0D0'], [1, '#707070', 0]]) });
  wire('node-target.out', 'burst.anchor'); wire('ball.arrival', 'burst.trigger');
  wire('burst.particles', 'burstip.particles'); wire('burstip.particles', 'burstdrag.particles'); wire('burstdrag.particles', 'burstg.particles');
  wire('burstg.particles', 'burstbb.particles'); wire('burstmat.material', 'burstbb.material'); out('burstbb');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [20, CHARGE + Math.round(V.travel / 2), arrive - 1, arrive + 4, arrive + 20, 170] }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [arrive + 2], glow: false }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
