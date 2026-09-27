// Generates the wind recipes (docs/v2-plan/effects/07-WIND.md) from generic nodes: a spiral gust of broken,
// scrolling helix ribbons with streaks and faint wisps under an attack/hold/fall envelope, plus the straight
// cutting gust and compact whirl variants. Run: node tools/make-wind-recipe.mjs
import { writeFileSync } from 'node:fs';

const VARIANTS = {
  'wind-gust': { doc: 'wind', radius: 0.55, turns: 1.5, spin: 4, ribbons: 4, streaks: 45, stretch: 6, wisps: 10, axisEnd: null, flow: 2.5 },
  'wind-cut': { doc: 'windcut', radius: 0.2, turns: 0.35, spin: 1, ribbons: 3, streaks: 80, stretch: 12, wisps: 5, axisEnd: null, flow: 4 },
  'wind-whirl': { doc: 'windwhirl', radius: 0.95, turns: 3, spin: 7, ribbons: 5, streaks: 25, stretch: 4, wisps: 16, axisEnd: [1.6, 0.25, 0], flow: 1.6 },
};
const BUILD = 18, GUST_END = 108, FADE_END = 180;

for (const [file, V] of Object.entries(VARIANTS)) {
  const D = V.doc, S = [];
  const doc = (tool, args, echo) => S.push(echo ? [tool, { docId: D, ...args }, true] : [tool, { docId: D, ...args }]);
  const add = (type, id, params) => doc('vfx_add_node', { type, id, ...(params ? { params } : {}) });
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const eff = keys => ({ domain: 'effectSeconds', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = (srgb, alpha = 1) => ({ srgb, alpha });
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  const sec = t => +(t / 60).toFixed(4);

  S.push(['vfx_new_document', { template: 'blank', id: D }]);
  doc('vfx_set_document', { durationTicks: FADE_END, seed: 42 });
  doc('vfx_set_anchor', { anchorId: 'source', position: [-3, 1.1, 0] });
  doc('vfx_set_anchor', { anchorId: 'target', position: [3, 1.1, 0] });
  add('Schedule', 'gust', { startTicks: 0, durationTicks: GUST_END + 30, mode: 'window' });
  // Axis end: the Target, or (compact whirl) a point just past the Source.
  let end = 'node-target.out';
  if (V.axisEnd) { add('OffsetAnchor', 'axisend', { offset: V.axisEnd }); wire('node-source.out', 'axisend.anchor'); end = 'axisend.out'; }

  // Gust envelope: attack over the buildup, hold, fall after 108 (drives ribbon opacity and force strength).
  add('EffectTimeCurve', 'envelope', { curve: eff([[0, 0], [sec(BUILD), 0.4], [sec(BUILD + 12), 1], [sec(GUST_END - 20), 0.85], [sec(GUST_END), 0.6], [sec(GUST_END + 30), 0]]) });

  // ---- Main ribbons: helices with different phase/radius/width, a broken soft texture scrolling along the flow ----
  for (let i = 0; i < V.ribbons; i++) {
    const phase = +(((i / V.ribbons) * Math.PI * 2 + i * 0.37) % (Math.PI * 2)).toFixed(3), r = +(V.radius * (0.8 + 0.1 * (i % 3))).toFixed(3), w = +(0.035 + 0.015 * (i % 4)).toFixed(3);
    add('HelixPath', `helix${i}`, { radius: r, turns: V.turns, phase, spin: V.spin * (i % 2 ? 1 : 0.8), taper: 'both', samples: 72 });
    wire('node-source.out', `helix${i}.start`); wire(end, `helix${i}.end`);
    add('Material', `ribmat${i}`, { template: 'SpriteTextured', sprite: 'smoke-puff', variant: i % 16, blend: 'normal', tint: col(i % 2 ? '#8FBDB9' : '#76AAA6'), emission: 0.15,
      uvScroll: [-V.flow * (1 + 0.15 * i), 0], uvDistort: 0.06 });
    add('ScalarMath', `ribfade${i}`, { operation: 'multiply', b: +(0.85 - 0.08 * (i % 3)).toFixed(2), inputUnit: 'normalized', unit: 'normalized' });
    wire('envelope.value', `ribfade${i}.a`); wire(`ribfade${i}.value`, `ribmat${i}.opacity`);
    add('RibbonRenderer', `ribbon${i}`, { width: w * 2.2, endFade: 0.3, uvMode: 'tile', uvTileLength: 1.4 });
    wire(`helix${i}.paths`, `ribbon${i}.paths`); wire(`ribmat${i}.material`, `ribbon${i}.material`); wire('gust.window', `ribbon${i}.window`); out(`ribbon${i}`);
  }

  // ---- Secondary streaks: fast, narrow, velocity-aligned, riding the gust direction ----
  add('Schedule', 'streakwin', { startTicks: BUILD, durationTicks: GUST_END - BUILD, mode: 'window' });
  add('Emitter', 'streaks', { shape: 'cone', coneAngle: 0.12, radius: V.radius * 1.2, rate: V.streaks, burst: 0, speedMin: 6, speedMax: 9, lifetimeMin: 0.3, lifetimeMax: 0.6, direction: [1, 0, 0],
    rateOverWindow: lin([[0, 0.3], [0.15, 1], [0.8, 1], [1, 0]]) });
  add('InitialProperties', 'streakip', { sizeMin: 0.02, sizeMax: 0.04 });
  add('Material', 'streakmat', { template: 'SpriteTextured', sprite: 'spark-streak', blend: 'normal', tint: col('#88B8B4'), opacity: 0.75, emission: 0.1 });
  add('BillboardRenderer', 'streakbb', { alignment: 'velocity', stretchRatio: V.stretch, pivot: 0.7, opacityOverLife: lin([[0, 0], [0.15, 1], [0.8, 0.6], [1, 0]]) });
  wire('node-source.out', 'streaks.anchor'); wire(end, 'streaks.aim'); wire('streakwin.window', 'streaks.window');
  wire('streaks.particles', 'streakip.particles'); wire('streakip.particles', 'streakbb.particles'); wire('streakmat.material', 'streakbb.material'); out('streakbb');

  // ---- Air wisps: faint textured billboards swirled around the gust axis, pushed along it ----
  add('Emitter', 'wisps', { shape: 'cone', coneAngle: 0.25, radius: V.radius, rate: V.wisps, burst: 0, speedMin: 2, speedMax: 3.5, lifetimeMin: 0.9, lifetimeMax: 1.5, direction: [1, 0, 0] });
  add('InitialProperties', 'wispip', { sizeMin: 0.35, sizeMax: 0.6, randomFrameStart: true, rotationMin: 0, rotationMax: 6.283, angularVelocityMin: -1, angularVelocityMax: 1 });
  add('Vortex', 'swirl', { axis: [1, 0, 0], tangential: 2.5, inward: 0.2, falloff: 2, strength: 1 });
  add('Drag', 'wispdrag', { coefficient: 0.6 });
  add('Material', 'wispmat', { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', tint: col('#B0CFCC'), opacity: 0.12 });
  add('BillboardRenderer', 'wispbb', { flipbookMode: 'overLife', sizeOverLife: lin([[0, 0.6], [1, 1.6]]), opacityOverLife: lin([[0, 0], [0.3, 1], [1, 0]]) });
  wire('node-source.out', 'wisps.anchor'); wire(end, 'wisps.aim'); wire('streakwin.window', 'wisps.window');
  wire('wisps.particles', 'wispip.particles'); wire('wispip.particles', 'swirl.particles'); wire('node-source.out', 'swirl.anchor'); wire('swirl.particles', 'wispdrag.particles');
  wire('envelope.value', 'swirl.strength');
  wire('wispdrag.particles', 'wispbb.particles'); wire('wispmat.material', 'wispbb.material'); out('wispbb');

  S.push(['vfx_compile', { docId: D }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [12, 40, 80, 125, 170] }, true]);
  S.push(['vfx_render_frames', { docId: D, ticks: [60], background: 'light' }, true]);
  writeFileSync(`mcp/examples/${file}.steps.json`, JSON.stringify(S, null, 1));
  console.log(`${file}: ${S.length} steps`);
}
