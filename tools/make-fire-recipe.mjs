// Generates the fire recipes (docs/v2-plan/effects/02-FIRE.md) from generic nodes: directed flame jet plus the
// compact-torch and wide-burst variants — same graph, different values. Density/cone follow the user-approved
// standalone flamethrower reference where it exceeds the table. Run: node tools/make-fire-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'fire-jet': { doc: 'firejet', emitStart: 12, emitTicks: 84, duration: 216, cone: 0.1, core: { rate: 140, speed: [9, 12] }, tongues: { rate: 210, speed: [7, 10], life: [0.4, 0.75], size: [0.1, 0.16], grow: 2.6 }, lift: 1.6, embers: 40, smoke: 18, turb: 3.5 },
  'fire-torch': { doc: 'torch', emitStart: 12, emitTicks: 54, duration: 180, cone: 0.07, core: { rate: 90, speed: [3, 4.5] }, tongues: { rate: 150, speed: [2.5, 4], life: [0.45, 0.8], size: [0.08, 0.13], grow: 3.2 }, lift: 4, embers: 22, smoke: 10, turb: 2.2 },
  'fire-burst': { doc: 'fireburst', emitStart: 12, emitTicks: 27, duration: 150, cone: 0.61, core: { rate: 220, speed: [11, 14] }, tongues: { rate: 420, speed: [10, 14], life: [0.25, 0.4], size: [0.1, 0.15], grow: 3 }, lift: 1.2, embers: 70, smoke: 24, turb: 4 },
};

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [], E0 = V.emitStart, E1 = V.emitStart + V.emitTicks;
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const grad = stops => ({ stops: stops.map(([position, srgb, alpha = 1]) => ({ position, color: col(srgb, alpha) })) });
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  // Emission ramps in over the first 10% and tails off over the last 20% of the window.
  const ramp = lin([[0, 0.2], [0.1, 1], [0.8, 1], [1, 0]]);

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: V.duration, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.2, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [3, 1.1, 0] });
  add('Schedule', 'emit', { startTicks: E0, durationTicks: V.emitTicks, mode: 'window' });

  // Ignition: .15 → .4 m flash over 6 ticks at the emission start.
  add('Schedule', 'ignite', { startTicks: E0, durationTicks: 6, mode: 'window' });
  add('Material', 'ignitemat', { template: 'SpriteTextured', sprite: 'soft-glow', blend: 'additive', tint: col('#FFE9B0'), emission: 1.5 });
  add('SpriteRenderer', 'ignition', { size: 0.4, sizeOverWindow: lin([[0, 0.37], [1, 1]]), opacityOverWindow: lin([[0, 1], [1, 0]]) });
  wire('node-source.out', 'ignition.anchor'); wire('ignitemat.material', 'ignition.material'); wire('ignite.window', 'ignition.window'); out('ignition');

  // Shared flame forces: drag, low-frequency curl noise and a gentle buoyant lift.
  const forces = (prefix, from, lift = V.lift, drag = 0.9) => {
    add('Drag', `${prefix}drag`, { coefficient: drag });
    add('NoiseForce', `${prefix}noise`, { mode: 'curl', amplitude: V.turb, frequency: 0.7, evolution: 1.1 });
    add('Gravity', `${prefix}lift`, { acceleration: [0, lift, 0] });
    wire(`${from}.particles`, `${prefix}drag.particles`); wire(`${prefix}drag.particles`, `${prefix}noise.particles`); wire(`${prefix}noise.particles`, `${prefix}lift.particles`);
    return `${prefix}lift`;
  };
  const emitter = (id, params) => {
    add('Emitter', id, { shape: 'cone', radius: 0.035, burst: 0, rateOverWindow: ramp, ...params });
    wire('node-source.out', `${id}.anchor`); wire('node-target.out', `${id}.aim`); wire('emit.window', `${id}.window`);
  };

  // Hot core: narrow, fast, yellow-white, restrained additive (velocity-aligned flipbook).
  emitter('core', { coneAngle: V.cone * 0.6, rate: V.core.rate, speedMin: V.core.speed[0], speedMax: V.core.speed[1], lifetimeMin: 0.3, lifetimeMax: 0.5 });
  add('InitialProperties', 'coreip', { sizeMin: 0.1, sizeMax: 0.14, randomFrameStart: true });
  const coreEnd = forces('core', 'coreip', V.lift * 0.5, 0.6);
  wire('core.particles', 'coreip.particles');
  add('Material', 'coremat', { template: 'SpriteTextured', sprite: 'flame-tongue-b', blend: 'additive', tint: col('#FFF1C8'), opacity: 0.3, emission: 0.2 });
  add('BillboardRenderer', 'corebb', { alignment: 'velocity', stretchRatio: 2.2, pivot: 0.25, flipbookMode: 'overLife',
    sizeOverLife: lin([[0, 1.2], [0.4, 4], [1, 0.2]]), opacityOverLife: lin([[0, 0], [0.08, 1], [0.6, 0.5], [1, 0]]),
    colorOverLife: grad([[0, '#FFFFFF'], [0.5, '#FFE08A'], [1, '#FF9A40', 0.5]]) });
  wire(`${coreEnd}.particles`, 'corebb.particles'); wire('coremat.material', 'corebb.material'); out('corebb');

  // Flame tongues: two atlases, normal blend, temperature over life, dissolve breaking up the tips.
  for (const [k, sprite] of [['a', 'flame-tongue-a'], ['b', 'flame-tongue-b']]) {
    emitter(`tongue${k}`, { coneAngle: V.cone, rate: V.tongues.rate, speedMin: V.tongues.speed[0], speedMax: V.tongues.speed[1], lifetimeMin: V.tongues.life[0], lifetimeMax: V.tongues.life[1] });
    add('InitialProperties', `tongue${k}ip`, { sizeMin: V.tongues.size[0], sizeMax: V.tongues.size[1], randomFrameStart: true });
    wire(`tongue${k}.particles`, `tongue${k}ip.particles`);
    const end = forces(`tongue${k}`, `tongue${k}ip`);
    add('Material', `tongue${k}mat`, { template: 'SpriteTextured', sprite, blend: 'additive', opacity: 0.11, emission: 0,
      dissolve: 0.85, dissolveStart: 0.45, dissolveSoftness: 0.1, dissolveEdge: 0.04, dissolveEdgeColor: col('#FFB040') });
    add('BillboardRenderer', `tongue${k}bb`, { alignment: 'velocity', stretchRatio: 1.5, pivot: 0.3, flipbookMode: 'overLife',
      sizeOverLife: lin([[0, 1], [0.45, V.tongues.grow], [1, V.tongues.grow * 0.6]]), opacityOverLife: lin([[0, 0], [0.06, 1], [0.6, 0.75], [1, 0]]),
      colorOverLife: grad([[0, '#FFF6D8'], [0.25, '#FFC05A'], [0.6, '#F0602A'], [1, '#6A1808', 0.4]]) });
    wire(`${end}.particles`, `tongue${k}bb.particles`); wire(`tongue${k}mat.material`, `tongue${k}bb.material`); out(`tongue${k}bb`);
  }

  // Embers: sparse, upward-biased streaks with trails.
  emitter('embers', { coneAngle: Math.max(0.35, V.cone * 3), rate: V.embers, speedMin: 3, speedMax: 6, lifetimeMin: 0.5, lifetimeMax: 1.2 });
  add('InitialProperties', 'emberip', { sizeMin: 0.015, sizeMax: 0.035 });
  add('Gravity', 'emberlift', { acceleration: [0, 1.8, 0] });
  add('Drag', 'emberdrag', { coefficient: 1.1 });
  add('NoiseForce', 'embernoise', { mode: 'curl', amplitude: 2.5, frequency: 1.4, evolution: 1.5 });
  wire('embers.particles', 'emberip.particles'); wire('emberip.particles', 'emberlift.particles'); wire('emberlift.particles', 'emberdrag.particles'); wire('emberdrag.particles', 'embernoise.particles');
  add('Material', 'embermat', { template: 'SpriteTextured', sprite: 'spark-streak', blend: 'additive', tint: col('#FFB060'), emission: 1.2 });
  add('BillboardRenderer', 'emberbb', { alignment: 'velocity', stretchRatio: 3, pivot: 0.8, opacityOverLife: lin([[0, 1], [0.7, 0.8], [1, 0]]) });
  add('Material', 'embertrailmat', { blend: 'additive', tint: col('#FF8A30'), emission: 0.8, opacity: 0.7 });
  add('ParticleTrail', 'embertrail', { history: 0.08, width: 0.01, endFade: 0.4 });
  wire('embernoise.particles', 'emberbb.particles'); wire('embermat.material', 'emberbb.material'); out('emberbb');
  wire('embernoise.particles', 'embertrail.particles'); wire('embertrailmat.material', 'embertrail.material'); out('embertrail');

  // Smoke: separate non-additive layer that rises and fades (not a grey wall).
  emitter('smoke', { coneAngle: V.cone * 1.5, rate: V.smoke, speedMin: V.tongues.speed[0] * 0.7, speedMax: V.tongues.speed[1] * 0.7, lifetimeMin: 1, lifetimeMax: 1.9 });
  add('InitialProperties', 'smokeip', { sizeMin: 0.2, sizeMax: 0.3, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283, angularVelocityMin: -0.4, angularVelocityMax: 0.4 });
  add('Drag', 'smokedrag', { coefficient: 1.6 });
  add('Gravity', 'smokelift', { acceleration: [0, 1.4, 0] });
  add('NoiseForce', 'smokenoise', { mode: 'curl', amplitude: 1.2, frequency: 0.5, evolution: 0.6 });
  wire('smoke.particles', 'smokeip.particles'); wire('smokeip.particles', 'smokedrag.particles'); wire('smokedrag.particles', 'smokelift.particles'); wire('smokelift.particles', 'smokenoise.particles');
  add('Material', 'smokemat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#8A8078'), opacity: 1 });
  add('BillboardRenderer', 'smokebb', { flipbookMode: 'overLife', sizeOverLife: lin([[0, 1], [1, 4]]), opacityOverLife: lin([[0, 0.05], [0.35, 0.25], [1, 0]]) });
  wire('smokenoise.particles', 'smokebb.particles'); wire('smokemat.material', 'smokebb.material'); out('smokebb');

  // Source light: warm, bounded flicker following the emission envelope.
  add('Schedule', 'lightwin', { startTicks: E0, durationTicks: V.emitTicks + 20, mode: 'window' });
  add('PointLight', 'light', { color: col('#FF8A3A'), intensity: 35, range: 6, flicker: 0.3, flickerRate: 10, intensityOverWindow: lin([[0, 0], [0.06, 1], [V.emitTicks / (V.emitTicks + 20), 0.9], [1, 0]]) });
  wire('node-source.out', 'light.anchor'); wire('lightwin.window', 'light.window'); out('light');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [E0 + 2, Math.round((E0 + E1) / 2), E1 + 30] }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
