// Generates the water recipes (docs/v2-plan/effects/03-WATER.md) from generic nodes: an arcing stream that
// arrives, splashes and settles, plus the narrow-stream and broad-splash variants (same graph, other values).
// Arrival-timed parts are driven by PathFollower.arrival; windowed parts sit at arrival-relative ticks and the
// Travel time knob moves them together (control bindings with offsets). Run: node tools/make-water-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'water-stream': { doc: 'water', width: 0.28, arch: 2.4, travel: 30, droplets: 140, dropSize: [0.025, 0.07], dropSpeed: [1.5, 4.5], foam: 24, splash: 1.2, ripple: 2.2 },
  'water-narrow': { doc: 'narrow', width: 0.14, arch: 2.2, travel: 20, droplets: 60, dropSize: [0.018, 0.045], dropSpeed: [1.2, 3.5], foam: 3, splash: 0.7, ripple: 1.4 },
  'water-broad': { doc: 'broad', width: 0.32, arch: 1.1, travel: 24, droplets: 190, dropSize: [0.035, 0.09], dropSpeed: [2, 5.5], foam: 36, splash: 1.9, ripple: 3.2 },
};
const START = 18, STOP = 84;

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [], ARRIVE = START + V.travel;
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const eff = keys => ({ domain: 'effectSeconds', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  const sec = t => +(t / 60).toFixed(4);

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: 180, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.5, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [3, 0.05, 0] });
  add('OffsetAnchor', 'pool', { offset: [0, -0.03, 0] });
  wire('node-target.out', 'pool.anchor');

  // ---- Liquid body: arched Bezier revealed over the travel time, stops at 84 and fades by 108 ----
  add('BezierPath', 'arc', { startHandle: [1.2, V.arch, 0], endHandle: [-0.6, V.arch * 0.9, 0], samples: 64 });
  wire('node-source.out', 'arc.start'); wire('node-target.out', 'arc.end');
  add('RevealPath', 'reveal');
  // The body reveals with the head's travel progress, so the Travel time knob keeps them in step.
  add('Schedule', 'headwin', { startTicks: START, durationTicks: V.travel, mode: 'window' });
  add('Time', 'travelclock'); wire('headwin.window', 'travelclock.window');
  wire('arc.paths', 'reveal.paths'); wire('travelclock.progress', 'reveal.fraction');
  add('Schedule', 'flow', { startTicks: START, durationTicks: 108 - START, mode: 'window' });
  add('EffectTimeCurve', 'bodyfade', { curve: eff([[sec(START), 0.42], [sec(STOP), 0.42], [sec(108), 0]]) });
  add('Material', 'bodymat', { blend: 'normal', tint: col('#4F9CC8'), emission: 0 });
  wire('bodyfade.value', 'bodymat.opacity');
  add('RibbonRenderer', 'body', { width: V.width, endFade: 0.08, widthOverPath: lin([[0, 0.55], [0.5, 1], [1, 0.8]]) });
  wire('reveal.paths', 'body.paths'); wire('bodymat.material', 'body.material'); wire('flow.window', 'body.window'); out('body');
  // Surface highlight: a thin, lighter line riding the top of the body (non-emissive) and a soft inner core.
  add('PathTransform', 'lift', { offset: [0, V.width * 0.28, 0] });
  wire('reveal.paths', 'lift.paths');
  add('EffectTimeCurve', 'hlfade', { curve: eff([[sec(START), 0.55], [sec(STOP), 0.55], [sec(108), 0]]) });
  add('Material', 'hlmat', { blend: 'normal', tint: col('#E8F6FF'), emission: 0.1 });
  wire('hlfade.value', 'hlmat.opacity');
  add('RibbonRenderer', 'highlight', { width: 0.035, endFade: 0.15 });
  wire('lift.paths', 'highlight.paths'); wire('hlmat.material', 'highlight.material'); wire('flow.window', 'highlight.window'); out('highlight');
  add('Material', 'coremat', { blend: 'normal', tint: col('#9CD4F0'), emission: 0 });
  add('EffectTimeCurve', 'corefade', { curve: eff([[sec(START), 0.22], [sec(STOP), 0.22], [sec(108), 0]]) });
  wire('corefade.value', 'coremat.opacity');
  add('RibbonRenderer', 'core', { width: V.width * 0.45, endFade: 0.1 });
  wire('reveal.paths', 'core.paths'); wire('coremat.material', 'core.material'); wire('flow.window', 'core.window'); out('core');

  // ---- Moving head: follows the arc and arrives at the target; its arrival event drives the splash ----
  add('Schedule', 'travelwin', { startTicks: START, durationTicks: 180 - START, mode: 'window' });
  add('PathFollower', 'head', { durationTicks: V.travel, easing: 'linear' });
  wire('arc.paths', 'head.paths'); wire('travelwin.window', 'head.window');
  add('Material', 'headmat', { template: 'SpriteTextured', sprite: 'droplet', blend: 'normal', tint: col('#BFE6FF'), opacity: 0.8 });
  add('SpriteRenderer', 'headsprite', { size: 0.18 });
  wire('head.anchor', 'headsprite.anchor'); wire('headmat.material', 'headsprite.material'); wire('headwin.window', 'headsprite.window'); out('headsprite');

  // ---- Splash sheet: widening translucent foam card at arrival, gone by 48 ticks ----
  add('Schedule', 'splashwin', { startTicks: 0, durationTicks: 48, mode: 'window' });
  wire('head.arrival', 'splashwin.trigger');
  add('Material', 'splashmat', { template: 'SpriteTextured', sprite: 'foam', blend: 'normal', tint: col('#DDF1FF'), opacity: 0.65 });
  add('SpriteRenderer', 'splash', { size: V.splash, sizeOverWindow: lin([[0, 0.3], [0.375, 1], [1, 1.1]]), opacityOverWindow: lin([[0, 0.9], [0.375, 0.6], [1, 0]]) });
  wire('node-target.out', 'splash.anchor'); wire('splashmat.material', 'splash.material'); wire('splashwin.window', 'splash.window'); out('splash');

  // ---- Droplets: arrival burst, hemisphere, gravity, bounce then die on the ground ----
  add('Emitter', 'drops', { shape: 'cone', direction: [0, 1, 0], coneAngle: 1.3, radius: 0.08, burst: V.droplets, rate: 0, speedMin: V.dropSpeed[0], speedMax: V.dropSpeed[1], lifetimeMin: 0.4, lifetimeMax: 1.2, useEventPosition: false });
  add('InitialProperties', 'dropip', { sizeMin: V.dropSize[0] * 2, sizeMax: V.dropSize[1] * 2 });
  add('Gravity', 'dropg', { acceleration: [0, -9.81, 0] });
  add('GroundCollision', 'dropfloor', { mode: 'bounce', restitution: 0.25, maxBounces: 1 });
  add('Material', 'dropmat', { template: 'SpriteTextured', sprite: 'droplet', blend: 'normal', tint: col('#CFEBFF'), opacity: 0.85, groundFade: 0.12 });
  add('BillboardRenderer', 'dropbb', { alignment: 'velocity', stretchRatio: 1.6, opacityOverLife: lin([[0, 1], [0.8, 0.8], [1, 0]]) });
  wire('node-target.out', 'drops.anchor'); wire('head.arrival', 'drops.trigger');
  wire('drops.particles', 'dropip.particles'); wire('dropip.particles', 'dropg.particles'); wire('dropg.particles', 'dropfloor.particles');
  wire('dropfloor.particles', 'dropbb.particles'); wire('dropmat.material', 'dropbb.material'); out('dropbb');

  // ---- Foam: flat, ground-oriented low-opacity cards around the impact ----
  add('Emitter', 'foam', { shape: 'disc', direction: [0, 1, 0], radius: 0.6, burst: V.foam, rate: 0, speedMin: 0.1, speedMax: 0.5, lifetimeMin: 0.5, lifetimeMax: 1.1 });
  add('InitialProperties', 'foamip', { sizeMin: 0.25, sizeMax: 0.5, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283 });
  add('Drag', 'foamdrag', { coefficient: 2.5 });
  add('Material', 'foammat', { template: 'SpriteTextured', sprite: 'foam', blend: 'normal', tint: col('#EAF6FF'), opacity: 0.35 });
  add('BillboardRenderer', 'foambb', { alignment: 'worldAxis', worldAxis: [0, 1, 0], sizeOverLife: lin([[0, 0.6], [1, 1.4]]), opacityOverLife: lin([[0, 0], [0.2, 1], [1, 0]]) });
  wire('pool.out', 'foam.anchor'); wire('head.arrival', 'foam.trigger');
  wire('foam.particles', 'foamip.particles'); wire('foamip.particles', 'foamdrag.particles');
  wire('foamdrag.particles', 'foambb.particles'); wire('foammat.material', 'foambb.material'); out('foambb');

  // ---- Ripples: three delayed thin rings on the standing water (0/7/15 ticks after arrival) ----
  add('Material', 'ripplemat', { blend: 'normal', tint: col('#CFEAFF') });
  [0, 7, 15].forEach((delay, i) => {
    const t0 = ARRIVE + delay;
    add('Schedule', `ripwin${i}`, { startTicks: delay, durationTicks: 60, mode: 'window' });
    wire('head.arrival', `ripwin${i}.trigger`); // Ripples follow the arrival event (0/7/15 ticks after it).
    add('RingPath', `ring${i}`, { radius: V.ripple, samples: 96 });
    // Size and fade follow progress through this ripple's own window (moves with Travel time).
    add('Time', `ringclock${i}`); wire(`ripwin${i}.window`, `ringclock${i}.window`);
    add('ScalarMath', `ringsize${i}`, { operation: 'max', b: +(0.2 / V.ripple).toFixed(4), unit: 'normalized' });
    add('ScalarMath', `ringdim${i}`, { operation: 'multiply', b: -(0.3 - i * 0.07), inputUnit: 'normalized', unit: 'normalized' });
    add('ScalarMath', `ringfade${i}`, { operation: 'add', b: +(0.3 - i * 0.07).toFixed(3), unit: 'normalized' });
    wire(`ringclock${i}.progress`, `ringsize${i}.a`); wire(`ringclock${i}.progress`, `ringdim${i}.a`); wire(`ringdim${i}.value`, `ringfade${i}.a`);
    add('Material', `ringmat${i}`, { blend: 'normal', tint: col('#D6EEFF') });
    add('RibbonRenderer', `ripple${i}`, { width: 0.018, endFade: 0, orientation: 'camera' });
    wire('pool.out', `ring${i}.center`); wire(`ringsize${i}.value`, `ring${i}.radiusScale`); wire(`ringfade${i}.value`, `ringmat${i}.opacity`);
    wire(`ring${i}.paths`, `ripple${i}.paths`); wire(`ringmat${i}.material`, `ripple${i}.material`); wire(`ripwin${i}.window`, `ripple${i}.window`); out(`ripple${i}`);
  });

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [START + Math.round(V.travel / 2), ARRIVE + 3, ARRIVE + 18, 110] }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
