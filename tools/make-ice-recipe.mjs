// Generates the ice recipes (docs/v2-plan/effects/05-ICE.md) from generic nodes: grounded faceted shards that
// grow, hold and fracture into falling fragments and frost, plus the low-fan and tall-cluster variants.
// Run: node tools/make-ice-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'ice-eruption': { doc: 'ice', counts: [10, 9, 9], scaleY: 4, tilt: 0.28, radius: 1.1, growth: 24, frost: 30, fragments: 36 },
  'ice-fan': { doc: 'icefan', counts: [8, 7, 7], scaleY: 1.8, tilt: 0.95, radius: 1.4, growth: 16, frost: 24, fragments: 30 },
  'ice-cluster': { doc: 'icecluster', counts: [4, 3, 3], scaleY: 6, tilt: 0.18, radius: 0.55, growth: 40, frost: 12, fragments: 24 },
};
const ERUPT = 24, FRACTURE = 90;

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [];
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const grad = stops => ({ stops: stops.map(([position, srgb, alpha = 1]) => ({ position, color: col(srgb, alpha) })) });
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  const life = FRACTURE - ERUPT;

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: 192, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.3, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [0, 0, 0] });
  add('Schedule', 'charge', { startTicks: 0, durationTicks: ERUPT, mode: 'window' });
  add('Schedule', 'erupt', { startTicks: ERUPT, durationTicks: life, mode: 'window' });
  add('Schedule', 'fracture', { startTicks: FRACTURE, durationTicks: 60, mode: 'window' });
  add('OffsetAnchor', 'chest', { offset: [0, 0.4, 0] });
  wire('node-target.out', 'chest.anchor');

  // ---- Charge frost: 20 cold motes converge on the target, faint ring ----
  add('Emitter', 'motes', { shape: 'sphere', radius: 1.5, burst: 20, rate: 0, speedMin: 0, speedMax: 0.1, lifetimeMin: ERUPT / 60, lifetimeMax: ERUPT / 60 });
  add('InitialProperties', 'moteip', { sizeMin: 0.04, sizeMax: 0.07 });
  add('Attract', 'motepull', { acceleration: 20, softRadius: 0.15, killRadius: 0.06 });
  add('Material', 'motemat', { template: 'SpriteTextured', sprite: 'soft-glow', blend: 'additive', tint: col('#BFEAFF'), emission: 0.6 });
  add('BillboardRenderer', 'motebb');
  wire('chest.out', 'motes.anchor'); wire('charge.start', 'motes.trigger');
  wire('motes.particles', 'moteip.particles'); wire('moteip.particles', 'motepull.particles'); wire('chest.out', 'motepull.anchor');
  wire('motepull.particles', 'motebb.particles'); wire('motemat.material', 'motebb.material'); out('motebb');

  // ---- Ground shards: three shape variations, base pivot, grow over `growth` ticks, hold, gone at fracture ----
  add('Material', 'icemat', { blend: 'normal', tint: col('#8FCBE6'), roughness: 0.18, metalness: 0.05, emission: 0, opacity: 0.94 });
  const grow = Math.min(0.9, V.growth / life);
  [['shardsa', 'crystal', V.counts[0], 1], ['shardsb', 'crystal-b', V.counts[1], 0.8], ['shardsc', 'shard', V.counts[2], 0.6]].forEach(([id, mesh, count, hs]) => {
    add('Emitter', id, { shape: 'disc', direction: [0, 1, 0], radius: V.radius, burst: count, rate: 0, speedMin: 0, speedMax: 0, lifetimeMin: life / 60, lifetimeMax: life / 60 });
    add('InitialProperties', `${id}ip`, { sizeMin: 0.15, sizeMax: 0.35 });
    add('MeshRenderer', `${id}mesh`, { mesh, orientation: 'upright', pivot: 'base', tilt: V.tilt, scaleY: +(V.scaleY * hs).toFixed(2), lit: true,
      sizeOverLife: lin([[0, 0], [grow, 1], [1, 1]]) });
    wire('node-target.out', `${id}.anchor`); wire('erupt.start', `${id}.trigger`);
    wire(`${id}.particles`, `${id}ip.particles`); wire(`${id}ip.particles`, `${id}mesh.particles`); wire('icemat.material', `${id}mesh.material`); out(`${id}mesh`);
  });
  // Cold key light over the cluster so facets read without bloom.
  add('Schedule', 'lightwin', { startTicks: ERUPT, durationTicks: life + 30, mode: 'window' });
  add('OffsetAnchor', 'lamp', { offset: [1.6, 3.6, 2.6] });
  wire('node-target.out', 'lamp.anchor');
  add('PointLight', 'light', { color: col('#CFEFFF'), intensity: 16, range: 9, intensityOverWindow: lin([[0, 0], [0.1, 1], [0.7, 0.9], [1, 0]]) });
  wire('lamp.out', 'light.anchor'); wire('lightwin.window', 'light.window'); out('light');

  // ---- Ground ring: narrow cold ring expanding .2 → 1.5 m as the shards erupt ----
  add('Schedule', 'ringwin', { startTicks: ERUPT, durationTicks: 40, mode: 'window' });
  add('Time', 'ringclock'); wire('ringwin.window', 'ringclock.window');
  add('RingPath', 'ring', { radius: 1.5, samples: 96 });
  add('ScalarMath', 'ringsize', { operation: 'max', b: 0.13, unit: 'normalized' });
  add('ScalarMath', 'ringdim', { operation: 'multiply', b: -0.5, inputUnit: 'normalized', unit: 'normalized' });
  add('ScalarMath', 'ringfade', { operation: 'add', b: 0.5, unit: 'normalized' });
  wire('ringclock.progress', 'ringsize.a'); wire('ringclock.progress', 'ringdim.a'); wire('ringdim.value', 'ringfade.a');
  add('OffsetAnchor', 'floor', { offset: [0, 0.02, 0] });
  wire('node-target.out', 'floor.anchor');
  add('Material', 'ringmat', { blend: 'normal', tint: col('#DDF4FF') });
  add('RibbonRenderer', 'ringrib', { width: 0.03, endFade: 0 });
  wire('floor.out', 'ring.center'); wire('ringsize.value', 'ring.radiusScale'); wire('ringfade.value', 'ringmat.opacity');
  wire('ring.paths', 'ringrib.paths'); wire('ringmat.material', 'ringrib.material'); wire('ringwin.window', 'ringrib.window'); out('ringrib');

  // ---- Fracture (tick 90): shard fragments burst and fall, frost cloud rises ----
  add('Emitter', 'frags', { shape: 'sphere', radius: V.radius * 0.6, burst: V.fragments, rate: 0, speedMin: 1, speedMax: 3, lifetimeMin: 0.75, lifetimeMax: 1.2 });
  add('InitialProperties', 'fragip', { sizeMin: 0.05, sizeMax: 0.12, angularVelocityMin: -6, angularVelocityMax: 6 });
  add('Gravity', 'fragg', { acceleration: [0, -9.81, 0] });
  add('GroundCollision', 'fragfloor', { mode: 'bounce', restitution: 0.3, friction: 0.4, maxBounces: 2 });
  add('MeshRenderer', 'fragmesh', { mesh: 'shard', orientation: 'tumble', lit: true, sizeOverLife: lin([[0, 1], [0.7, 1], [1, 0]]) });
  wire('chest.out', 'frags.anchor'); wire('fracture.start', 'frags.trigger');
  wire('frags.particles', 'fragip.particles'); wire('fragip.particles', 'fragg.particles'); wire('fragg.particles', 'fragfloor.particles');
  wire('fragfloor.particles', 'fragmesh.particles'); wire('icemat.material', 'fragmesh.material'); out('fragmesh');
  add('Emitter', 'frost', { shape: 'sphere', radius: 0.8, burst: V.frost, rate: 0, speedMin: 0.3, speedMax: 0.8, lifetimeMin: 0.8, lifetimeMax: 1.4 });
  add('InitialProperties', 'frostip', { sizeMin: 0.4, sizeMax: 0.7, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283 });
  add('Gravity', 'frostlift', { acceleration: [0, 0.5, 0] });
  add('Drag', 'frostdrag', { coefficient: 1.2 });
  add('Material', 'frostmat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#DDEFF8'), opacity: 1, groundFade: 0.3 });
  add('BillboardRenderer', 'frostbb', { flipbookMode: 'overLife', sizeOverLife: lin([[0, 0.7], [1, 1.6]]), opacityOverLife: lin([[0, 0], [0.2, 0.35], [1, 0]]) });
  wire('chest.out', 'frost.anchor'); wire('fracture.start', 'frost.trigger');
  wire('frost.particles', 'frostip.particles'); wire('frostip.particles', 'frostlift.particles'); wire('frostlift.particles', 'frostdrag.particles');
  wire('frostdrag.particles', 'frostbb.particles'); wire('frostmat.material', 'frostbb.material'); out('frostbb');
  add('Material', 'glintmat', { template: 'SpriteTextured', sprite: 'spark-streak', blend: 'additive', tint: col('#E8F8FF'), emission: 0.6 });
  add('BillboardRenderer', 'glintbb', { alignment: 'velocity', stretchRatio: 2, sizeOverLife: lin([[0, 0.5], [1, 0.3]]), opacityOverLife: lin([[0, 0.6], [1, 0]]) });
  wire('fragfloor.particles', 'glintbb.particles'); wire('glintmat.material', 'glintbb.material'); out('glintbb');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [16, ERUPT + Math.round(V.growth / 2), 70, FRACTURE + 12, 170] }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [70], background: 'light' }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
