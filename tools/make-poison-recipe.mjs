// Generates the poison recipes (docs/v2-plan/effects/08-POISON.md) from generic nodes: a slow caustic cloud
// with rising rim bubbles that pop into droplets, dark drips and ground residue, plus the creeping-pool and
// tall-plume variants. Run: node tools/make-poison-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'poison-caustic': { doc: 'poison', radius: 0.65, cloudRate: 24, rise: [0.25, 0.7], bubbles: 10, bubbleRise: [0.4, 1], drips: 3, residue: 1.4, cloudSize: [0.25, 0.35] },
  'poison-pool': { doc: 'poisonpool', radius: 1.2, cloudRate: 22, rise: [0.05, 0.2], bubbles: 3, bubbleRise: [0.2, 0.5], drips: 0.5, residue: 2.4, cloudSize: [0.3, 0.45] },
  'poison-plume': { doc: 'poisonplume', radius: 0.3, cloudRate: 26, rise: [0.8, 1.5], bubbles: 20, bubbleRise: [0.8, 1.6], drips: 7, residue: 0.9, cloudSize: [0.2, 0.3], drag: 0.15, lift: 0.6 },
};
const BLOOM = 18, STOP = 138, END = 240;

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [];
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const grad = stops => ({ stops: stops.map(([position, srgb, alpha = 1]) => ({ position, color: col(srgb, alpha) })) });
  const out = id => wire(`${id}.visual`, 'node-output.visual');

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: END, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.2, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [0, 0.1, 0] });
  add('Schedule', 'active', { startTicks: 0, durationTicks: STOP, mode: 'window' });

  // ---- Low cloud: slow buoyant drift, normal alpha, yellow-green with darker dense regions, low emission ----
  add('Emitter', 'cloud', { shape: 'disc', direction: [0, 1, 0], radius: V.radius, rate: V.cloudRate, burst: 8, speedMin: V.rise[0], speedMax: V.rise[1], lifetimeMin: 1.2, lifetimeMax: 2.3,
    rateOverWindow: lin([[0, 0.3], [BLOOM / STOP, 1], [0.85, 1], [1, 0.2]]) });
  add('InitialProperties', 'cloudip', { sizeMin: V.cloudSize[0], sizeMax: V.cloudSize[1], randomFrameStart: true, rotationMin: 0, rotationMax: 6.283, angularVelocityMin: -0.4, angularVelocityMax: 0.4 });
  add('Drag', 'clouddrag', { coefficient: V.drag ?? 0.6 });
  add('NoiseForce', 'clouddrift', { mode: 'curl', amplitude: 0.25, frequency: 0.5, evolution: 0.35 });
  add('Gravity', 'cloudlift', { acceleration: [0, V.lift ?? 0.12, 0] });
  add('Material', 'cloudmat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', opacity: 1, emission: 0.08, groundFade: 0.2 });
  add('BillboardRenderer', 'cloudbb', { flipbookMode: 'overLife', sizeOverLife: lin([[0, 1], [1, 3.3]]), opacityOverLife: lin([[0, 0], [0.15, 0.6], [0.7, 0.42], [1, 0]]),
    colorOverLife: grad([[0, '#A6C832'], [0.35, '#6F9A22'], [1, '#2E4712']]) });
  wire('node-target.out', 'cloud.anchor'); wire('active.window', 'cloud.window'); wire('active.start', 'cloud.trigger');
  wire('cloud.particles', 'cloudip.particles'); wire('cloudip.particles', 'clouddrag.particles'); wire('clouddrag.particles', 'clouddrift.particles'); wire('clouddrift.particles', 'cloudlift.particles');
  wire('cloudlift.particles', 'cloudbb.particles'); wire('cloudmat.material', 'cloudbb.material'); out('cloudbb');

  // ---- Bubbles: thin rims with transparent centres, rising with seeded lifetimes (no synchronous popping) ----
  add('Schedule', 'bubblewin', { startTicks: BLOOM, durationTicks: STOP - BLOOM, mode: 'window' });
  add('Emitter', 'bubbles', { shape: 'disc', direction: [0, 1, 0], radius: V.radius * 0.8, rate: V.bubbles, burst: 0, speedMin: V.bubbleRise[0], speedMax: V.bubbleRise[1], lifetimeMin: 0.6, lifetimeMax: 1.3 });
  add('InitialProperties', 'bubbleip', { sizeMin: 0.08, sizeMax: 0.28 });
  add('NoiseForce', 'bubblewobble', { mode: 'vector', amplitude: 0.4, frequency: 1.5, evolution: 1 });
  // Real bubbles (review 2026-09-29: circles "more transparent or more gassy"): bubble sprite, clear middle, glints.
  add('Material', 'bubblemat', { template: 'SpriteTextured', sprite: 'bubble', blend: 'normal', tint: col('#C8EE6A'), opacity: 0.75, emission: 0.1 });
  add('BillboardRenderer', 'bubblebb', { sizeOverLife: lin([[0, 0.5], [0.9, 1], [1, 1.2]]), opacityOverLife: lin([[0, 0], [0.1, 1], [0.95, 1], [1, 0]]) });
  wire('node-target.out', 'bubbles.anchor'); wire('bubblewin.window', 'bubbles.window');
  wire('bubbles.particles', 'bubbleip.particles'); wire('bubbleip.particles', 'bubblewobble.particles');
  wire('bubblewobble.particles', 'bubblebb.particles'); wire('bubblemat.material', 'bubblebb.material'); out('bubblebb');
  // Pops: each bubble's death spawns 4 tiny droplets (event budget capped).
  add('ParticleEvents', 'pops', { probability: 1, maxEvents: 256 });
  add('Emitter', 'popdrops', { shape: 'sphere', radius: 0.02, burst: 4, rate: 0, speedMin: 0.3, speedMax: 1.2, lifetimeMin: 0.15, lifetimeMax: 0.35, useEventPosition: true });
  add('InitialProperties', 'popip', { sizeMin: 0.015, sizeMax: 0.03 });
  add('Gravity', 'popg', { acceleration: [0, -4, 0] });
  add('Material', 'popmat', { template: 'SpriteTextured', sprite: 'droplet', blend: 'normal', tint: col('#B8DA50'), opacity: 0.9 });
  add('BillboardRenderer', 'popbb', { alignment: 'velocity', stretchRatio: 1.6, opacityOverLife: lin([[0, 1], [1, 0]]) });
  wire('bubblewobble.particles', 'pops.particles'); wire('pops.death', 'popdrops.trigger');
  wire('popdrops.particles', 'popip.particles'); wire('popip.particles', 'popg.particles'); wire('popg.particles', 'popbb.particles'); wire('popmat.material', 'popbb.material'); out('popbb');

  // ---- Drips: sparse dark wet drops falling out of the cloud (not bright sparks) ----
  if (V.drips > 0) {
    add('OffsetAnchor', 'cloudbelly', { offset: [0, 0.9, 0] });
    wire('node-target.out', 'cloudbelly.anchor');
    add('Emitter', 'drips', { shape: 'disc', direction: [0, 1, 0], radius: V.radius * 0.7, rate: V.drips, burst: 0, speedMin: 0, speedMax: 0.1, lifetimeMin: 0.6, lifetimeMax: 1 });
    add('InitialProperties', 'dripip', { sizeMin: 0.03, sizeMax: 0.05 });
    add('Gravity', 'dripg', { acceleration: [0, -9.81, 0] });
    add('GroundCollision', 'dripfloor', { mode: 'kill' });
    add('Material', 'dripmat', { template: 'SpriteTextured', sprite: 'droplet', blend: 'normal', tint: col('#4A6A1C'), opacity: 0.95 });
    add('BillboardRenderer', 'dripbb', { alignment: 'velocity', stretchRatio: 2 });
    wire('cloudbelly.out', 'drips.anchor'); wire('bubblewin.window', 'drips.window');
    wire('drips.particles', 'dripip.particles'); wire('dripip.particles', 'dripg.particles'); wire('dripg.particles', 'dripfloor.particles');
    wire('dripfloor.particles', 'dripbb.particles'); wire('dripmat.material', 'dripbb.material'); out('dripbb');
  }

  // ---- Ground residue: irregular flat stain, opacity ≤ .25, fades by the end ----
  add('Schedule', 'residuewin', { startTicks: 6, durationTicks: END - 8, mode: 'window' });
  add('OffsetAnchor', 'floor', { offset: [0, -0.08, 0] });
  wire('node-target.out', 'floor.anchor');
  add('Material', 'residuemat', { template: 'SpriteTextured', sprite: 'smoke-puff', variant: 5, blend: 'normal', tint: col('#4E6E1E'), opacity: 1 });
  add('SpriteRenderer', 'residue', { size: V.residue, alignment: 'worldAxis', worldAxis: [0, 1, 0], sizeOverWindow: lin([[0, 0.45], [0.2, 1], [1, 1.1]]), opacityOverWindow: lin([[0, 0], [0.1, 0.25], [0.6, 0.2], [1, 0]]) });
  wire('floor.out', 'residue.anchor'); wire('residuemat.material', 'residue.material'); wire('residuewin.window', 'residue.window'); out('residue');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [10, 80, 160, 230] }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [80], background: 'light' }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
