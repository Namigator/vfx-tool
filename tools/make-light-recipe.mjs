// Generates the light recipes (docs/v2-plan/effects/09-LIGHT.md) from generic nodes: a radiant pulse with a
// narrow core, distinct tapered rays (RadialPath), faint halo/ground rings and drifting motes, plus the focused
// cone and broad blessing variants. Run: node tools/make-light-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'light-pulse': { doc: 'light', rays: 32, mode: 'sphere', cone: 0.52, len: [0.6, 2.4], motes: 48, moteLife: [0.6, 1.5], halo: 2, rayWidth: 0.03 },
  'light-cone': { doc: 'lightcone', rays: 24, mode: 'cone', cone: 0.3, len: [1.2, 3.2], motes: 30, moteLife: [0.5, 1.1], halo: 1.2, rayWidth: 0.025 },
  'light-blessing': { doc: 'lightblessing', rays: 14, mode: 'sphere', cone: 0.52, len: [0.8, 1.8], motes: 90, moteLife: [1.4, 2.6], halo: 3, rayWidth: 0.04 },
};
const PULSE = 36;

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [];
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  const glow = (id, tint, extra = {}) => add('Material', id, { template: 'SpriteTextured', sprite: 'soft-glow', blend: 'additive', tint: col(tint), ...extra });

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: 168, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.3, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [0, 1, 0] });
  add('Schedule', 'charge', { startTicks: 0, durationTicks: PULSE, mode: 'window' });
  add('Schedule', 'pulse', { startTicks: PULSE, durationTicks: 54, mode: 'window' });

  // ---- Charge: 24 inward warm motes and a small growing core ----
  add('Emitter', 'gather', { shape: 'sphere', radius: 1.6, burst: 24, rate: 0, speedMin: 0, speedMax: 0.1, lifetimeMin: PULSE / 60, lifetimeMax: PULSE / 60 });
  add('InitialProperties', 'gatherip', { sizeMin: 0.04, sizeMax: 0.07 });
  add('Attract', 'gatherpull', { acceleration: 9, softRadius: 0.15, killRadius: 0.06 });
  glow('motemat', '#FFF1D0', { emission: 0.8 });
  add('BillboardRenderer', 'gatherbb');
  wire('node-target.out', 'gather.anchor'); wire('charge.start', 'gather.trigger');
  wire('gather.particles', 'gatherip.particles'); wire('gatherip.particles', 'gatherpull.particles'); wire('node-target.out', 'gatherpull.anchor');
  wire('gatherpull.particles', 'gatherbb.particles'); wire('motemat.material', 'gatherbb.material'); out('gatherbb');
  glow('chargemat', '#FFF4DC', { emission: 1 });
  add('SpriteRenderer', 'chargecore', { size: 0.3, sizeOverWindow: lin([[0, 0.2], [1, 1]]), opacityOverWindow: lin([[0, 0.2], [1, 0.9]]) });
  wire('node-target.out', 'chargecore.anchor'); wire('chargemat.material', 'chargecore.material'); wire('charge.window', 'chargecore.window'); out('chargecore');

  // ---- Pulse core: sharp 3-tick attack, narrow bright core, broad low-alpha halo ----
  glow('coremat', '#FFFFFF', { emission: 1.5 });
  add('SpriteRenderer', 'core', { size: 0.4, sizeOverWindow: lin([[0, 1], [0.06, 0.8], [0.3, 0.5], [1, 0.3]]), opacityOverWindow: lin([[0, 1], [0.06, 0.9], [0.5, 0.4], [1, 0]]) });
  glow('halomat', '#FFD890', { opacity: 0.35 });
  add('SpriteRenderer', 'halo', { size: V.halo, sizeOverWindow: lin([[0, 0.4], [0.06, 1], [1, 1.2]]), opacityOverWindow: lin([[0, 0.9], [0.2, 0.5], [1, 0]]) });
  for (const [r, m] of [['core', 'coremat'], ['halo', 'halomat']]) { wire('node-target.out', `${r}.anchor`); wire(`${m}.material`, `${r}.material`); wire('pulse.window', `${r}.window`); out(r); }

  // ---- Rays: seeded RadialPath shooting out over 4 ticks, tapered ribbons, fading through the window ----
  add('RadialPath', 'rays', { mode: V.mode, count: V.rays, lengthMin: V.len[0], lengthMax: V.len[1], coneAngle: V.cone });
  add('Schedule', 'raywin', { startTicks: PULSE, durationTicks: 32, mode: 'window' });
  add('Time', 'rayclock'); wire('raywin.window', 'rayclock.window');
  add('ScalarMath', 'rayshoot', { operation: 'multiply', b: 8, inputUnit: 'normalized', unit: 'normalized' });
  add('RevealPath', 'rayreveal');
  add('ScalarMath', 'raydim', { operation: 'multiply', b: -0.9, inputUnit: 'normalized', unit: 'normalized' });
  add('ScalarMath', 'rayfade', { operation: 'add', b: 0.9, unit: 'normalized' });
  wire('node-target.out', 'rays.center');
  wire('rayclock.progress', 'rayshoot.a'); wire('rays.paths', 'rayreveal.paths'); wire('rayshoot.value', 'rayreveal.fraction');
  wire('rayclock.progress', 'raydim.a'); wire('raydim.value', 'rayfade.a');
  add('Material', 'raymat', { blend: 'additive', tint: col('#FFF0CC'), emission: 0.6 });
  wire('rayfade.value', 'raymat.opacity');
  add('RibbonRenderer', 'raysrib', { width: V.rayWidth, endFade: 0.25, widthOverPath: lin([[0, 1], [1, 0.25]]) });
  wire('rayreveal.paths', 'raysrib.paths'); wire('raymat.material', 'raysrib.material'); wire('raywin.window', 'raysrib.window'); out('raysrib');

  // ---- Halo/ring: one upright halo and one ground ring, thin, expanding .2 → 2 m, fading ----
  add('Schedule', 'ringwin', { startTicks: PULSE, durationTicks: 26, mode: 'window' });
  add('Time', 'ringclock'); wire('ringwin.window', 'ringclock.window');
  add('ScalarMath', 'ringsize', { operation: 'max', b: 0.1, unit: 'normalized' });
  add('ScalarMath', 'ringdim', { operation: 'multiply', b: -0.6, inputUnit: 'normalized', unit: 'normalized' });
  add('ScalarMath', 'ringfade', { operation: 'add', b: 0.6, unit: 'normalized' });
  wire('ringclock.progress', 'ringsize.a'); wire('ringclock.progress', 'ringdim.a'); wire('ringdim.value', 'ringfade.a');
  add('Material', 'ringmat', { blend: 'additive', tint: col('#FFE2A8'), emission: 0.2 });
  wire('ringfade.value', 'ringmat.opacity');
  add('OffsetAnchor', 'floor', { offset: [0, -0.97, 0] });
  wire('node-target.out', 'floor.anchor');
  for (const [id, center, orientation] of [['halo', 'node-target.out', [Math.SQRT1_2, 0, 0, Math.SQRT1_2]], ['ground', 'floor.out', [0, 0, 0, 1]]]) {
    add('RingPath', `${id}ring`, { radius: 2, samples: 96, orientation });
    add('RibbonRenderer', `${id}ringrib`, { width: 0.02, endFade: 0 });
    wire(center, `${id}ring.center`); wire('ringsize.value', `${id}ring.radiusScale`);
    wire(`${id}ring.paths`, `${id}ringrib.paths`); wire('ringmat.material', `${id}ringrib.material`); wire('ringwin.window', `${id}ringrib.window`); out(`${id}ringrib`);
  }

  // ---- Motes: slow outward drift, tiny soft sprites, gone by the end ----
  add('Emitter', 'motes', { shape: 'sphere', radius: 0.2, burst: V.motes, rate: 0, speedMin: 0.3, speedMax: 1, lifetimeMin: V.moteLife[0], lifetimeMax: V.moteLife[1] });
  add('InitialProperties', 'moteip', { sizeMin: 0.03, sizeMax: 0.06 });
  add('Drag', 'motedrag', { coefficient: 0.5 });
  add('BillboardRenderer', 'motebb', { opacityOverLife: lin([[0, 1], [0.7, 0.6], [1, 0]]) });
  wire('node-target.out', 'motes.anchor'); wire('pulse.start', 'motes.trigger');
  wire('motes.particles', 'moteip.particles'); wire('moteip.particles', 'motedrag.particles'); wire('motedrag.particles', 'motebb.particles'); wire('motemat.material', 'motebb.material'); out('motebb');

  // ---- Point light: one short bounded warm light ----
  add('Schedule', 'lightwin', { startTicks: PULSE, durationTicks: 40, mode: 'window' });
  add('PointLight', 'lamp', { color: col('#FFD9A0'), intensity: 30, range: 6, intensityOverWindow: lin([[0, 1], [0.15, 0.6], [1, 0]]) });
  wire('node-target.out', 'lamp.anchor'); wire('lightwin.window', 'lamp.window'); out('lamp');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [24, PULSE + 2, PULSE + 12, PULSE + 24, 80, 150] }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [PULSE + 13], glow: false }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
