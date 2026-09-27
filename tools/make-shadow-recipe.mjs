// Generates the shadow recipes (docs/v2-plan/effects/04-SHADOW.md) from generic nodes: an inward vortex that
// collapses, plus the inward-puff and narrow-tendril variants (same building blocks, other values).
// Dark parts use normal blending so they darken the scene; a separate restrained violet accent gives edge
// definition on a dark floor. Run: node tools/make-shadow-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'shadow-vortex-full': { doc: 'shadow', gather: 30, collapse: 138, collapseLen: 30, duration: 210, radius: 1.4, wisps: 36, tendrils: 5, puff: false, beam: false },
  'shadow-puff': { doc: 'puff', gather: 12, collapse: 60, collapseLen: 18, duration: 120, radius: 1.1, wisps: 60, tendrils: 0, puff: true, beam: false },
  'shadow-tendril': { doc: 'tendril', gather: 20, collapse: 110, collapseLen: 24, duration: 170, radius: 0.7, wisps: 20, tendrils: 0, puff: false, beam: true },
};

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [], C0 = V.collapse, C1 = V.collapse + V.collapseLen;
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const grad = stops => ({ stops: stops.map(([position, srgb, alpha = 1]) => ({ position, color: col(srgb, alpha) })) });
  const out = id => wire(`${id}.visual`, 'node-output.visual');

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: V.duration, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.4, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [0, 0.75, 0] });
  add('Schedule', 'active', { startTicks: 0, durationTicks: C0, mode: 'window' });
  add('Schedule', 'collapse', { startTicks: C0, durationTicks: V.collapseLen, mode: 'window' });

  // ---- Dark body: overlapping dark smoke cards (normal alpha, internal variation, soft edges) ----
  add('Emitter', 'body', { shape: 'sphere', radius: 0.55, rate: 14, burst: 10, speedMin: 0, speedMax: 0.15, lifetimeMin: 1.0, lifetimeMax: 1.4 });
  add('InitialProperties', 'bodyip', { sizeMin: 1.0, sizeMax: 1.4, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283, angularVelocityMin: -0.5, angularVelocityMax: 0.5 });
  add('Attract', 'bodypull', { acceleration: 0.6, softRadius: 0.4, killRadius: 0 });
  add('Material', 'bodymat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#161823'), opacity: 1 });
  add('BillboardRenderer', 'bodybb', { flipbookMode: 'fps', flipbookFps: 6, sizeOverLife: lin([[0, 0.6], [0.5, 1], [1, 0.8]]), opacityOverLife: lin([[0, 0], [0.2, 0.55], [0.7, 0.45], [1, 0]]) });
  wire('node-target.out', 'body.anchor'); wire('active.window', 'body.window'); wire('active.start', 'body.trigger');
  wire('body.particles', 'bodyip.particles'); wire('bodyip.particles', 'bodypull.particles'); wire('node-target.out', 'bodypull.anchor');
  wire('bodypull.particles', 'bodybb.particles'); wire('bodymat.material', 'bodybb.material'); out('bodybb');

  // ---- Inward wisps: spawned on a wide sphere, swirled (Vortex) and pulled in (Attract), killed at the core ----
  add('Emitter', 'wisps', { shape: 'sphere', radius: V.radius, rate: V.wisps, burst: V.puff ? 40 : 0, speedMin: V.puff ? 1.5 : 0, speedMax: V.puff ? 2.5 : 0.2, lifetimeMin: 0.8, lifetimeMax: 1.5 });
  add('InitialProperties', 'wispip', { sizeMin: 0.3, sizeMax: 0.5, randomFrameStart: true });
  add('Vortex', 'swirl', { axis: [0, 1, 0], tangential: 2.5, inward: 1.8, falloff: 2 });
  add('Attract', 'pull', { acceleration: V.puff ? 5 : 1.6, softRadius: 0.3, killRadius: 0.08 });
  add('Drag', 'wispdrag', { coefficient: V.puff ? 1.2 : 0.4 });
  wire('node-target.out', 'wisps.anchor'); wire('active.window', 'wisps.window'); wire('active.start', 'wisps.trigger');
  wire('wisps.particles', 'wispip.particles'); wire('wispip.particles', 'wispdrag.particles'); wire('wispdrag.particles', 'swirl.particles'); wire('swirl.particles', 'pull.particles');
  wire('node-target.out', 'swirl.anchor'); wire('node-target.out', 'pull.anchor');
  add('Material', 'wispmat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#1E1D29'), opacity: 0.9,
    dissolve: 0.6, dissolveStart: 0.5, dissolveSoftness: 0.2 });
  add('BillboardRenderer', 'wispbb', { alignment: 'velocity', stretchRatio: 2.4, pivot: 0.4, flipbookMode: 'overLife', opacityOverLife: lin([[0, 0], [0.2, 1], [0.8, 0.8], [1, 0]]) });
  wire('pull.particles', 'wispbb.particles'); wire('wispmat.material', 'wispbb.material'); out('wispbb');
  // Edge accent: the same wisps, a restrained desaturated-violet additive rim (alpha ≤ .3, emission ≤ .5).
  add('Material', 'accentmat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'additive', tint: col('#6A5C94'), opacity: 0.18, emission: 0.2 });
  add('BillboardRenderer', 'accentbb', { alignment: 'velocity', stretchRatio: 2.4, pivot: 0.4, flipbookMode: 'overLife', sizeOverLife: lin([[0, 1.1], [1, 0.9]]), opacityOverLife: lin([[0, 0], [0.3, 1], [1, 0]]) });
  wire('pull.particles', 'accentbb.particles'); wire('accentmat.material', 'accentbb.material'); out('accentbb');

  // ---- Tendrils: tapering helices from points around the vortex into the core ----
  for (let i = 0; i < V.tendrils; i++) {
    const a = (i / V.tendrils) * Math.PI * 2 + 0.4, r = 1.3;
    add('OffsetAnchor', `tip${i}`, { offset: [+(Math.cos(a) * r).toFixed(3), +(((i % 3) - 1) * 0.35).toFixed(3), +(Math.sin(a) * r).toFixed(3)] });
    wire('node-target.out', `tip${i}.anchor`);
    add('HelixPath', `tendril${i}`, { radius: 0.35, turns: 0.8, phase: +(a).toFixed(3), spin: 3, taper: 'out', samples: 40 });
    wire(`tip${i}.out`, `tendril${i}.start`); wire('node-target.out', `tendril${i}.end`);
  }
  if (V.tendrils) {
    add('MergePaths', 'tendrils');
    for (let i = 0; i < V.tendrils; i++) wire(`tendril${i}.paths`, 'tendrils.paths');
    add('Material', 'tendrilmat', { blend: 'normal', tint: col('#12131B'), opacity: 0.6 });
    add('RibbonRenderer', 'tendrilrib', { width: 0.16, endFade: 0.35, widthOverPath: lin([[0, 0.4], [0.4, 1], [1, 0.2]]) });
    add('Material', 'tendrilrimmat', { blend: 'additive', tint: col('#5E5288'), opacity: 0.14, emission: 0.1 });
    add('RibbonRenderer', 'tendrilrim', { width: 0.2, endFade: 0.35, widthOverPath: lin([[0, 0.4], [0.4, 1], [1, 0.2]]) });
    for (const r of ['tendrilrib', 'tendrilrim']) { wire('tendrils.paths', `${r}.paths`); wire('active.window', `${r}.window`); out(r); }
    wire('tendrilmat.material', 'tendrilrib.material'); wire('tendrilrimmat.material', 'tendrilrim.material');
  }

  // ---- Narrow tendril variant: a dark textured ribbon Source → Target with trailing wisps ----
  if (V.beam) {
    add('HelixPath', 'beampath', { radius: 0.14, turns: 2.5, spin: 2.5, taper: 'both', samples: 96 });
    wire('node-source.out', 'beampath.start'); wire('node-target.out', 'beampath.end');
    add('RevealPath', 'beamreveal');
    add('Time', 'beamclock'); wire('active.window', 'beamclock.window');
    add('ScalarMath', 'beamgrow', { operation: 'multiply', b: 4, inputUnit: 'normalized', unit: 'normalized' });
    wire('beamclock.progress', 'beamgrow.a'); wire('beamgrow.value', 'beamreveal.fraction');
    wire('beampath.paths', 'beamreveal.paths');
    add('Material', 'beammat', { blend: 'normal', tint: col('#14151E'), opacity: 0.6 });
    add('RibbonRenderer', 'beam', { width: 0.12, endFade: 0.2, widthOverPath: lin([[0, 0.4], [0.6, 1], [1, 0.6]]) });
    add('Material', 'beamrimmat', { blend: 'additive', tint: col('#6E5E9C'), opacity: 0.25, emission: 0.3 });
    add('RibbonRenderer', 'beamrim', { width: 0.03, endFade: 0.25 });
    for (const r of ['beam', 'beamrim']) { wire('beamreveal.paths', `${r}.paths`); wire('active.window', `${r}.window`); out(r); }
    wire('beammat.material', 'beam.material'); wire('beamrimmat.material', 'beamrim.material');
    add('PathFollower', 'trail', { durationTicks: 40, easing: 'linear' });
    add('Schedule', 'trailwin', { startTicks: 0, durationTicks: C0, mode: 'window' });
    wire('beampath.paths', 'trail.paths'); wire('trailwin.window', 'trail.window');
    add('Emitter', 'trailwisps', { shape: 'sphere', radius: 0.1, rate: 30, burst: 0, speedMin: 0, speedMax: 0.3, lifetimeMin: 0.5, lifetimeMax: 0.9 });
    add('InitialProperties', 'trailip', { sizeMin: 0.15, sizeMax: 0.25, randomFrameStart: true });
    wire('trail.anchor', 'trailwisps.anchor'); wire('trailwin.window', 'trailwisps.window');
    add('BillboardRenderer', 'trailbb', { opacityOverLife: lin([[0, 0], [0.2, 0.6], [1, 0]]) });
    wire('trailwisps.particles', 'trailip.particles'); wire('trailip.particles', 'trailbb.particles');
    wire('wispmat.material', 'trailbb.material'); out('trailbb');
  }

  // ---- Collapse: dark core shrinks .6 → 0 with an inward burst; everything else has stopped ----
  add('Material', 'coremat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#0E0F16'), opacity: 0.85 });
  add('SpriteRenderer', 'core', { size: 1.2, sizeOverWindow: lin([[0, 1], [1, 0]]), opacityOverWindow: lin([[0, 0.9], [0.8, 0.6], [1, 0]]) });
  wire('node-target.out', 'core.anchor'); wire('coremat.material', 'core.material'); wire('collapse.window', 'core.window'); out('core');
  add('Material', 'corerimmat', { template: 'SpriteTextured', sprite: 'soft-glow', blend: 'additive', tint: col('#7A6AA8'), opacity: 0.25, emission: 0.2 });
  add('SpriteRenderer', 'corerim', { size: 1.5, sizeOverWindow: lin([[0, 1], [1, 0]]), opacityOverWindow: lin([[0, 1], [1, 0]]) });
  wire('node-target.out', 'corerim.anchor'); wire('corerimmat.material', 'corerim.material'); wire('collapse.window', 'corerim.window'); out('corerim');
  add('Emitter', 'implode', { shape: 'sphere', radius: 0.9, burst: 40, rate: 0, speedMin: 0, speedMax: 0.1, lifetimeMin: 0.3, lifetimeMax: 0.5 });
  add('InitialProperties', 'implodeip', { sizeMin: 0.1, sizeMax: 0.2, randomFrameStart: true });
  add('Attract', 'implodepull', { acceleration: 18, softRadius: 0.1, killRadius: 0.06 });
  add('BillboardRenderer', 'implodebb', { alignment: 'velocity', stretchRatio: 3, opacityOverLife: lin([[0, 0.8], [1, 0]]) });
  wire('node-target.out', 'implode.anchor'); wire('collapse.start', 'implode.trigger');
  wire('implode.particles', 'implodeip.particles'); wire('implodeip.particles', 'implodepull.particles'); wire('node-target.out', 'implodepull.anchor');
  wire('implodepull.particles', 'implodebb.particles'); wire('wispmat.material', 'implodebb.material'); out('implodebb');

  // ---- Residue: sparse dark wisps drifting after the collapse, fading to nothing ----
  add('Schedule', 'residuewin', { startTicks: C1, durationTicks: Math.max(1, V.duration - C1 - 42), mode: 'window' });
  add('Emitter', 'residue', { shape: 'sphere', radius: 0.4, rate: 8, burst: 0, speedMin: 0.1, speedMax: 0.3, lifetimeMin: 0.4, lifetimeMax: 0.7 });
  add('InitialProperties', 'residueip', { sizeMin: 0.1, sizeMax: 0.2, randomFrameStart: true });
  add('Gravity', 'residuelift', { acceleration: [0, 0.4, 0] });
  add('BillboardRenderer', 'residuebb', { opacityOverLife: lin([[0, 0.5], [1, 0]]) });
  wire('node-target.out', 'residue.anchor'); wire('residuewin.window', 'residue.window');
  wire('residue.particles', 'residueip.particles'); wire('residueip.particles', 'residuelift.particles');
  wire('residuelift.particles', 'residuebb.particles'); wire('wispmat.material', 'residuebb.material'); out('residuebb');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [Math.round(V.gather / 2), Math.round((V.gather + C0) / 2), C0 + Math.round(V.collapseLen / 2), C1 + 10] }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [Math.round((V.gather + C0) / 2)], background: 'light' }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
