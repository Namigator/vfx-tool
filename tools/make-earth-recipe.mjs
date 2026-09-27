// Generates the earth recipes (docs/v2-plan/effects/06-EARTH.md) from generic nodes: a stone upheaval with
// chips, ground-hugging dust and collision puffs, plus heavy-compact and wide-gravel variants.
// Run: node tools/make-earth-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'earth-upheaval': { doc: 'earth', stones: 6, stoneSize: [0.18, 0.5], stoneSpeed: [2, 5], chips: 48, chipSize: [0.025, 0.1], chipSpeed: [2, 6], spread: 0.8, dust: 35, dustRate: 20 },
  'earth-heavy': { doc: 'earthheavy', stones: 3, stoneSize: [0.35, 0.7], stoneSpeed: [1.5, 3.2], chips: 24, chipSize: [0.04, 0.12], chipSpeed: [1.5, 4], spread: 0.5, dust: 30, dustRate: 14 },
  'earth-gravel': { doc: 'earthgravel', stones: 2, stoneSize: [0.12, 0.25], stoneSpeed: [3, 6], chips: 110, chipSize: [0.02, 0.06], chipSpeed: [3, 8], spread: 1.1, dust: 14, dustRate: 8 },
};
const ERUPT = 30;

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [];
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const out = id => wire(`${id}.visual`, 'node-output.visual');

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: 216, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.3, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [0, 0, 0] });
  add('Schedule', 'erupt', { startTicks: ERUPT, durationTicks: 30, mode: 'window' });
  add('OffsetAnchor', 'floor', { offset: [0, 0.02, 0] });
  wire('node-target.out', 'floor.anchor');

  // ---- Ground anticipation (0–30): a dusty flat pulse .2 → 1.4 m, then again at the eruption ----
  add('Schedule', 'pulsewin', { startTicks: ERUPT - 18, durationTicks: 18, mode: 'window' });
  add('Material', 'pulsemat', { template: 'SpriteTextured', sprite: 'ripple-ring', blend: 'normal', tint: col('#7A6A58'), opacity: 0.7 });
  add('SpriteRenderer', 'pulse', { size: 2.8, alignment: 'worldAxis', worldAxis: [0, 1, 0], sizeOverWindow: lin([[0, 0.14], [1, 1]]), opacityOverWindow: lin([[0, 0.8], [1, 0]]) });
  wire('floor.out', 'pulse.anchor'); wire('pulsemat.material', 'pulse.material'); wire('pulsewin.window', 'pulse.window'); out('pulse');

  // ---- Shared rock material: rough, non-emissive, warm brown/grey; a warm key light reveals facets ----
  add('Material', 'rockmat', { blend: 'normal', tint: col('#857566'), roughness: 0.85, metalness: 0, emission: 0 });
  add('Schedule', 'lightwin', { startTicks: ERUPT - 6, durationTicks: 150, mode: 'window' });
  add('OffsetAnchor', 'lamp', { offset: [1.8, 3.5, 2.4] });
  wire('node-target.out', 'lamp.anchor');
  add('PointLight', 'light', { color: col('#FFE6CC'), intensity: 14, range: 10, intensityOverWindow: lin([[0, 0], [0.05, 1], [0.8, 1], [1, 0]]) });
  wire('lamp.out', 'light.anchor'); wire('lightwin.window', 'light.window'); out('light');

  // Motion shared by stones and chips: gravity, light drag, low bounce with friction, at most 2 bounces.
  const physics = (id, from) => {
    add('Gravity', `${id}g`, { acceleration: [0, -9.81, 0] });
    add('Drag', `${id}drag`, { coefficient: 0.15 });
    add('GroundCollision', `${id}floorhit`, { mode: 'bounce', restitution: 0.15, friction: 0.7, maxBounces: 2 });
    wire(`${from}.particles`, `${id}g.particles`); wire(`${id}g.particles`, `${id}drag.particles`); wire(`${id}drag.particles`, `${id}floorhit.particles`);
    return `${id}floorhit`;
  };
  const hits = [];

  // ---- Large stones: three rock shapes, upward with outward bias, tumbling, shrink away before the end ----
  for (const [id, mesh] of [['stonesa', 'rock-a'], ['stonesb', 'rock-b'], ['stonesc', 'rock-c']]) {
    add('Emitter', id, { shape: 'cone', direction: [0, 1, 0], coneAngle: 0.55, radius: V.spread, burst: V.stones, rate: 0, speedMin: V.stoneSpeed[0], speedMax: V.stoneSpeed[1], lifetimeMin: 2.4, lifetimeMax: 2.9 });
    add('InitialProperties', `${id}ip`, { sizeMin: V.stoneSize[0], sizeMax: V.stoneSize[1], angularVelocityMin: -5, angularVelocityMax: 5 });
    wire('node-target.out', `${id}.anchor`); wire('erupt.start', `${id}.trigger`); wire(`${id}.particles`, `${id}ip.particles`);
    const end = physics(id, `${id}ip`);
    add('MeshRenderer', `${id}mesh`, { mesh, orientation: 'tumble', lit: true, sizeOverLife: lin([[0, 1], [0.85, 1], [1, 0]]) });
    wire(`${end}.particles`, `${id}mesh.particles`); wire('rockmat.material', `${id}mesh.material`); out(`${id}mesh`);
    hits.push(end);
  }
  // ---- Small chips: many fast fragments with individual lifetimes ----
  add('Emitter', 'chips', { shape: 'cone', direction: [0, 1, 0], coneAngle: 0.8, radius: V.spread * 0.8, burst: V.chips, rate: 0, speedMin: V.chipSpeed[0], speedMax: V.chipSpeed[1], lifetimeMin: 0.5, lifetimeMax: 1.5 });
  add('InitialProperties', 'chipip', { sizeMin: V.chipSize[0], sizeMax: V.chipSize[1], angularVelocityMin: -9, angularVelocityMax: 9 });
  wire('node-target.out', 'chips.anchor'); wire('erupt.start', 'chips.trigger'); wire('chips.particles', 'chipip.particles');
  const chipEnd = physics('chips', 'chipip');
  add('MeshRenderer', 'chipmesh', { mesh: 'rock-c', orientation: 'tumble', lit: true, sizeOverLife: lin([[0, 1], [0.8, 1], [1, 0]]) });
  wire(`${chipEnd}.particles`, 'chipmesh.particles'); wire('rockmat.material', 'chipmesh.material'); out('chipmesh');

  // ---- Dust: ground-hugging burst plus a short trickle; expands and thins (textured alpha, not orange smoke) ----
  add('Emitter', 'dust', { shape: 'disc', direction: [0, 1, 0], radius: V.spread, burst: V.dust, rate: V.dustRate, speedMin: 0.3, speedMax: 1.2, lifetimeMin: 1, lifetimeMax: 2.5 });
  add('InitialProperties', 'dustip', { sizeMin: 0.3, sizeMax: 0.5, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283, angularVelocityMin: -0.3, angularVelocityMax: 0.3 });
  add('Drag', 'dustdrag', { coefficient: 1.4 });
  add('Gravity', 'dustlift', { acceleration: [0, 0.35, 0] });
  add('NoiseForce', 'dustnoise', { mode: 'curl', amplitude: 0.6, frequency: 0.6, evolution: 0.4 });
  add('Material', 'dustmat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#A89A86'), opacity: 1, groundFade: 0.25 });
  add('BillboardRenderer', 'dustbb', { flipbookMode: 'overLife', sizeOverLife: lin([[0, 0.5], [1, 2.6]]), opacityOverLife: lin([[0, 0], [0.12, 0.55], [1, 0]]) });
  wire('floor.out', 'dust.anchor'); wire('erupt.start', 'dust.trigger'); wire('erupt.window', 'dust.window');
  wire('dust.particles', 'dustip.particles'); wire('dustip.particles', 'dustdrag.particles'); wire('dustdrag.particles', 'dustlift.particles'); wire('dustlift.particles', 'dustnoise.particles');
  wire('dustnoise.particles', 'dustbb.particles'); wire('dustmat.material', 'dustbb.material'); out('dustbb');

  // ---- Contact puffs: every stone landing kicks up 2 small dust particles (no recursive chain) ----
  add('Emitter', 'puffs', { shape: 'sphere', radius: 0.05, burst: 2, rate: 0, speedMin: 0.2, speedMax: 0.6, lifetimeMin: 0.6, lifetimeMax: 1.1, useEventPosition: true });
  add('InitialProperties', 'puffip', { sizeMin: 0.2, sizeMax: 0.35, randomFrameStart: true });
  add('Drag', 'puffdrag', { coefficient: 1.6 });
  add('BillboardRenderer', 'puffbb', { flipbookMode: 'overLife', sizeOverLife: lin([[0, 0.6], [1, 1.8]]), opacityOverLife: lin([[0, 0.5], [1, 0]]) });
  for (const h of hits) wire(`${h}.collision`, 'puffs.trigger');
  wire('puffs.particles', 'puffip.particles'); wire('puffip.particles', 'puffdrag.particles');
  wire('puffdrag.particles', 'puffbb.particles'); wire('dustmat.material', 'puffbb.material'); out('puffbb');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [22, ERUPT + 12, 70, 120, 205] }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [70], background: 'light', glow: false }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
