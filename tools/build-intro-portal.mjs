// Writes mcp/examples/intro-portal.steps.json: the first-visit intro effect, built from editor nodes through the MCP
// tools. A sling-ring portal: a white-hot head traces a ring of orange sparks, the ring ignites when it closes, spins
// (sparks swirled round it and flung off, a counter-rotating outer band), then widens past the screen. Run the steps with
//   node mcp/run-steps.mjs mcp/examples/intro-portal.steps.json
// (needs the dev server for the contact sheet); they save the document to src/intro/portal.vfx.json.
// src/editor/IntroReveal.tsx reads the node ids grow, trace and ring: ring world radius = ring.radius x grow(t).
import { writeFileSync } from 'node:fs';

const doc = 'intro-portal';
const sec = s => Math.round(s * 60);
const curve = (domain, keys) => ({ domain, interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const gradient = stops => ({ stops: stops.map(([position, srgb, alpha]) => ({ position, color: { srgb, alpha } })) });
const steps = [];
const call = (name, args, print) => steps.push(print ? [name, { docId: doc, ...args }, true] : [name, { docId: doc, ...args }]);
// Spark density: every Emitter's rate and burst are scaled by this (the intro must stay smooth on modest GPUs).
const DENSITY = Number(process.env.PORTAL_DENSITY ?? 0.5);
const dense = (type, params) => type !== 'Emitter' ? params : { ...params, ...(params.rate ? { rate: Math.round(params.rate * DENSITY) } : {}), ...(params.burst ? { burst: Math.max(1, Math.round(params.burst * DENSITY)) } : {}) };
const node = (type, id, params = {}) => call('vfx_add_node', { type, id, params: dense(type, params) });
const wire = (from, to) => call('vfx_connect', { from, to });
const toOutput = id => wire(`${id}.visual`, 'node-output.visual');

// Timeline (seconds): trace 0.15-0.95, close flare at 0.95, spin until 1.72, widen 1.8-2.7; effect lasts 3 s.
const TRACE = [0.15, 0.95], CLOSE = TRACE[1], SPIN_END = 1.72, WIDEN = [1.8, 2.7], END = 3;
const VERTICAL = [0.7071068, 0, 0, 0.7071068]; // the XZ ring stood up to face the camera (+Z)
const RING_MAX = 10, RING_REST = 0.12; // RingPath radius and its rest scale: 1.2 m while tracing and spinning
const OUTER = 1.1; // the counter-rotating band sits just outside the ring, so the opened hole stays clear
const SPIN_AXIS = [0, 0, 1]; // the ring faces +Z; positive tangential swirl runs the same way the head traced
const growKeys = k => [[0, RING_REST * k], [WIDEN[0], RING_REST * k], [WIDEN[0] + 0.45, 0.32 * k], [WIDEN[1], Math.min(1, k)]];

steps.push(['vfx_new_document', { template: 'blank', id: doc }]);
call('vfx_set_document', { durationTicks: sec(END), seed: 7, name: 'Portal' });
call('vfx_set_anchor', { anchorId: 'source', position: [0, 1.5, 0] });
// Tight bloom: the portal is screen-blended over the editor, so a wide halo would wash out the view through the ring.
call('vfx_set_params', { nodeId: 'node-output', params: { glowStrength: 0.65, glowRadius: 0.2, glowLimit: 2 } });

// Shared looks. Sparks: velocity-stretched, white-hot cooling through orange to deep red.
const HOT = gradient([[0, '#FFFFFF', 1], [0.2, '#FFE9B0', 1], [0.55, '#FF9A2A', 0.9], [1, '#B02800', 0]]);
const EMBER = gradient([[0, '#FFF2D0', 1], [0.25, '#FFB040', 1], [0.7, '#FF5A0A', 0.8], [1, '#6A1000', 0]]);
const sparks = (id, { colors = HOT, stretch = 6, opacity = 1, emission = 1.2 } = {}) => {
  node('Material', `${id}mat`, { blend: 'additive', emission, opacity });
  node('BillboardRenderer', `${id}bb`, { alignment: 'velocity', stretchRatio: stretch, pivot: 0.8, colorOverLife: colors });
  wire(`${id}mat.material`, `${id}bb.material`);
  toOutput(`${id}bb`);
  return `${id}bb.particles`;
};
// Tapered light trails behind the particles leaving `from` (sparks racing round the ring draw arcs).
const trails = (id, from, { history = 0.06, width = 0.012, tint = '#FFB860', opacity = 0.8, emission = 1 } = {}) => {
  node('Material', `${id}mat`, { template: 'SpriteUnlit', blend: 'additive', tint: { srgb: tint, alpha: 1 }, emission, opacity });
  node('ParticleTrail', `${id}`, { history, width, maxPoints: 12, endFade: 0.5 });
  wire(`${from}.particles`, `${id}.particles`);
  wire(`${id}mat.material`, `${id}.material`);
  toOutput(id);
};
// A chain of particle operators, emitter first, renderer input last.
const chain = (...ports) => { for (let i = 0; i + 1 < ports.length; i++) wire(`${ports[i]}.particles`, ports[i + 1].includes('.') ? ports[i + 1] : `${ports[i + 1]}.particles`); };
const win = (id, start, dur) => node('Schedule', id, { startTicks: sec(start), durationTicks: Math.max(1, sec(dur)), mode: 'window' });

// The ring: radius scale holds, then eases out past the screen; RevealPath traces it.
node('EffectTimeCurve', 'grow', { curve: curve('effectSeconds', growKeys(1)) });
node('EffectTimeCurve', 'trace', { curve: curve('effectSeconds', [[TRACE[0], 0], [TRACE[1], 1]]) });
node('RingPath', 'ring', { radius: RING_MAX, samples: 160, orientation: VERTICAL });
node('RevealPath', 'reveal');
wire('node-source.out', 'ring.center');
wire('grow.value', 'ring.radiusScale');
wire('ring.paths', 'reveal.paths');
wire('trace.value', 'reveal.fraction');

// Glowing band: a thin white-hot core over a narrow orange halo (kept slim so the ring reads as a line of fire, not fog).
node('Material', 'coremat', { template: 'RibbonUnlit', blend: 'additive', tint: { srgb: '#FFF4DC', alpha: 1 }, emission: 1, opacity: 1 });
node('RibbonRenderer', 'core', { width: 0.035, endFade: 0.02 });
node('Material', 'halomat', { template: 'RibbonUnlit', blend: 'additive', tint: { srgb: '#FF7418', alpha: 1 }, emission: 0.8, opacity: 0.16 });
node('RibbonRenderer', 'halo', { width: 0.16, endFade: 0.02 });
for (const r of ['core', 'halo']) { wire('reveal.paths', `${r}.paths`); wire(`${r}mat.material`, `${r}.material`); toOutput(r); }

// Counter-rotating outer band: a faint thin second ring just outside the first (its sparks swirl the other way, below), faded in once the ring closes.
node('EffectTimeCurve', 'growout', { curve: curve('effectSeconds', growKeys(OUTER)) });
node('RingPath', 'ringout', { radius: RING_MAX, samples: 160, orientation: VERTICAL });
node('EffectTimeCurve', 'dashfade', { curve: curve('effectSeconds', [[CLOSE - 0.05, 0], [CLOSE + 0.25, 1], [WIDEN[0] + 0.5, 1], [WIDEN[1], 0]]) });
node('Material', 'dashmat', { template: 'RibbonUnlit', blend: 'additive', tint: { srgb: '#FF8A30', alpha: 1 }, emission: 0.9, opacity: 0.6 });
node('RibbonRenderer', 'dash', { width: 0.014, endFade: 0 });
wire('node-source.out', 'ringout.center');
wire('growout.value', 'ringout.radiusScale');
wire('dashfade.value', 'dashmat.opacity');
wire('ringout.paths', 'dash.paths');
wire('dashmat.material', 'dash.material');
toOutput('dash');

// Tracing head: a rider runs once round the ring while it draws: a hot glow with a comet tail, throwing a falling shower.
win('tracewin', TRACE[0], TRACE[1] - TRACE[0]);
node('PathFollower', 'head', { durationTicks: sec(TRACE[1] - TRACE[0]), easing: 'easeOut' });
wire('ring.paths', 'head.paths');
wire('tracewin.window', 'head.window');
node('Material', 'headglowmat', { blend: 'additive', emission: 1.3, opacity: 1, tint: { srgb: '#FFE2A8', alpha: 1 } });
node('SpriteRenderer', 'headglow', { size: 0.22, opacityOverWindow: curve('normalized', [[0, 0], [0.08, 1], [0.92, 1], [1, 0]]) });
node('Material', 'tailmat', { template: 'RibbonUnlit', blend: 'additive', emission: 1.2, opacity: 0.9, tint: { srgb: '#FFD890', alpha: 1 } });
node('MotionTrail', 'tail', { history: 0.18, width: 0.06, endFade: 0.5, widthOverTrail: curve('normalized', [[0, 0], [1, 1]]) });
for (const r of ['headglow', 'tail']) { wire('head.anchor', `${r}.anchor`); wire('tracewin.window', `${r}.window`); toOutput(r); }
wire('headglowmat.material', 'headglow.material');
wire('tailmat.material', 'tail.material');
node('Emitter', 'headsparks', { shape: 'cone', axisMode: 'motionBackward', coneAngle: 1.1, radius: 0.04, burst: 0, rate: 1500, speedMin: 1.2, speedMax: 4.5, lifetimeMin: 0.25, lifetimeMax: 0.75 });
node('InitialProperties', 'headip', { sizeMin: 0.016, sizeMax: 0.032 });
node('Gravity', 'headgrav', { acceleration: [0, -6, 0] });
node('Drag', 'headdrag', { coefficient: 1.4 });
wire('head.anchor', 'headsparks.anchor');
wire('tracewin.window', 'headsparks.window');
chain('headsparks', 'headip', 'headgrav', 'headdrag', sparks('head', { colors: EMBER, opacity: 0.8 }));

// Close: a flare and a starburst where the head meets its own start, and the whole ring ignites at once.
node('OffsetAnchor', 'closept', { offset: [RING_MAX * RING_REST, 0, 0] });
wire('node-source.out', 'closept.anchor');
win('flarewin', CLOSE - 0.02, 0.4);
node('Material', 'flaremat', { blend: 'additive', emission: 1.2, opacity: 1, tint: { srgb: '#FFE6B8', alpha: 1 } });
node('SpriteRenderer', 'flare', { size: 0.5, sizeOverWindow: curve('normalized', [[0, 0.3], [0.12, 1], [1, 0.6]]),
  opacityOverWindow: curve('normalized', [[0, 0], [0.06, 0.8], [0.3, 0.25], [1, 0]]) });
node('Material', 'glintmat', { template: 'SpriteTextured', sprite: 'star-ray', blend: 'additive', emission: 0.9, opacity: 1, tint: { srgb: '#FFD9A0', alpha: 1 } });
node('SpriteRenderer', 'glint', { size: 1.4, spin: 1.5, sizeOverWindow: curve('normalized', [[0, 0.2], [0.15, 1], [1, 0.5]]),
  opacityOverWindow: curve('normalized', [[0, 0], [0.1, 1], [0.5, 0.4], [1, 0]]) });
for (const r of ['flare', 'glint']) { wire('closept.out', `${r}.anchor`); wire('flarewin.window', `${r}.window`); wire(`${r}mat.material`, `${r}.material`); toOutput(r); }
node('Schedule', 'closehit', { startTicks: sec(CLOSE), mode: 'once' });
node('Emitter', 'closeburst', { shape: 'sphere', radius: 0.05, burst: 260, speedMin: 2, speedMax: 7, lifetimeMin: 0.3, lifetimeMax: 0.9 });
node('InitialProperties', 'closeip', { sizeMin: 0.018, sizeMax: 0.036 });
node('Gravity', 'closegrav', { acceleration: [0, -5, 0] });
node('Drag', 'closedrag', { coefficient: 1.8 });
wire('closept.out', 'closeburst.anchor');
wire('closehit.start', 'closeburst.trigger');
chain('closeburst', 'closeip', 'closegrav', 'closedrag', sparks('close'));
// Ignition: one short window of very dense sparks all round the ring, pushed outward and swirled.
win('ignitewin', CLOSE, 0.08);
node('Emitter', 'ignite', { shape: 'path', burst: 0, rate: 4000, rateOverWindow: curve('normalized', [[0, 2], [1, 2]]), coneAngle: Math.PI, speedMin: 0.2, speedMax: 1.2, lifetimeMin: 0.2, lifetimeMax: 0.5 });
node('InitialProperties', 'igniteip', { sizeMin: 0.014, sizeMax: 0.026 });
node('Vortex', 'igniteswirl', { axis: SPIN_AXIS, tangential: 40, inward: -14, falloff: 20 });
node('Drag', 'ignitedrag', { coefficient: 2.5 });
wire('ring.paths', 'ignite.paths');
wire('ignitewin.window', 'ignite.window');
wire('node-source.out', 'igniteswirl.anchor');
chain('ignite', 'igniteip', 'igniteswirl', 'ignitedrag', sparks('ignite', { opacity: 0.3 }));

// Spin, layer 1: a churning band of short, fast sparks racing round the ring (the sling-ring blur).
win('spinwin', CLOSE - 0.1, SPIN_END - CLOSE + 0.1);
node('Emitter', 'churn', { shape: 'path', burst: 0, rate: 2600, coneAngle: Math.PI, speedMin: 0.05, speedMax: 0.5, lifetimeMin: 0.12, lifetimeMax: 0.32,
  rateOverWindow: curve('normalized', [[0, 0.6], [0.15, 2], [0.92, 2], [1, 0.4]]) });
node('InitialProperties', 'churnip', { sizeMin: 0.008, sizeMax: 0.016 });
node('Vortex', 'churnswirl', { axis: SPIN_AXIS, tangential: 75, inward: -3, falloff: 20 });
node('Drag', 'churndrag', { coefficient: 4 });
wire('ring.paths', 'churn.paths');
wire('spinwin.window', 'churn.window');
wire('node-source.out', 'churnswirl.anchor');
chain('churn', 'churnip', 'churnswirl', 'churndrag', sparks('churn', { colors: EMBER, stretch: 9, opacity: 0.5 }));
trails('churntrail', 'churndrag');

// Spin, layer 2: slower embers flung off the ring, spiralling outward and dripping under gravity.
node('Emitter', 'fling', { shape: 'path', burst: 0, rate: 900, coneAngle: Math.PI, speedMin: 0.3, speedMax: 1.5, lifetimeMin: 0.45, lifetimeMax: 1.0,
  rateOverWindow: curve('normalized', [[0, 0.5], [0.15, 1], [0.9, 1], [1, 0]]) });
node('InitialProperties', 'flingip', { sizeMin: 0.016, sizeMax: 0.03 });
node('Vortex', 'flingswirl', { axis: SPIN_AXIS, tangential: 22, inward: -14, falloff: 20 });
node('Gravity', 'flinggrav', { acceleration: [0, -5.5, 0] });
node('Drag', 'flingdrag', { coefficient: 1.6 });
wire('ring.paths', 'fling.paths');
wire('spinwin.window', 'fling.window');
wire('node-source.out', 'flingswirl.anchor');
chain('fling', 'flingip', 'flingswirl', 'flinggrav', 'flingdrag', sparks('fling', { colors: EMBER, stretch: 5 }));

// Spin, layer 3: the outer band's sparks swirl the other way.
node('Emitter', 'counter', { shape: 'path', burst: 0, rate: 1600, coneAngle: Math.PI, speedMin: 0.05, speedMax: 0.4, lifetimeMin: 0.15, lifetimeMax: 0.35,
  rateOverWindow: curve('normalized', [[0, 0], [0.25, 1], [0.92, 1], [1, 0]]) });
node('InitialProperties', 'counterip', { sizeMin: 0.01, sizeMax: 0.02 });
node('Vortex', 'counterswirl', { axis: SPIN_AXIS, tangential: -55, inward: -2, falloff: 20 });
node('Drag', 'counterdrag', { coefficient: 4 });
wire('ringout.paths', 'counter.paths');
wire('spinwin.window', 'counter.window');
wire('node-source.out', 'counterswirl.anchor');
chain('counter', 'counterip', 'counterswirl', 'counterdrag', sparks('counter', { colors: EMBER, stretch: 8, opacity: 0.6 }));

// Widen: short emission windows catch the ring at successive radii (a path emitter captures its path when its window
// opens), each shedding a ring of sparks thrown outward with the swing. They spawn on a lead ring that runs LEAD seconds
// ahead of the real one, so the sparks start just outside it instead of being left behind inside the opening hole.
const SHED = [1.92, 2.04, 2.16, 2.28], LEAD = 0.05;
node('EffectTimeCurve', 'growlead', { curve: curve('effectSeconds', growKeys(1.02).map(([x, y]) => [Math.max(0, x - LEAD), y])) });
node('RingPath', 'ringlead', { radius: RING_MAX, samples: 160, orientation: VERTICAL });
wire('node-source.out', 'ringlead.center');
wire('growlead.value', 'ringlead.radiusScale');
SHED.forEach((t, i) => {
  win(`shedwin${i}`, t, 0.05);
  node('Emitter', `shed${i}`, { shape: 'path', burst: 0, rate: 3000, rateOverWindow: curve('normalized', [[0, 3], [1, 3]]), coneAngle: Math.PI, speedMin: 0.05, speedMax: 0.4, lifetimeMin: 0.12, lifetimeMax: 0.28 });
  wire('ringlead.paths', `shed${i}.paths`);
  wire(`shedwin${i}.window`, `shed${i}.window`);
  // A renderer takes one particle chain, so each shed emitter gets its own short chain.
  node('InitialProperties', `shedip${i}`, { sizeMin: 0.02, sizeMax: 0.04 });
  node('Vortex', `shedswirl${i}`, { axis: SPIN_AXIS, tangential: 45, inward: -30, falloff: 20 });
  node('Drag', `sheddrag${i}`, { coefficient: 2 });
  wire('node-source.out', `shedswirl${i}.anchor`);
  chain(`shed${i}`, `shedip${i}`, `shedswirl${i}`, `sheddrag${i}`, sparks(`shed${i}fx`, { colors: EMBER, stretch: 6, opacity: 0.5 }));
});

call('vfx_compile', {}, true);
const camera = { position: [0, 1.5, 7], target: [0, 1.5, 0], fov: 50 };
call('vfx_contact_sheet', { ticks: [20, 40, 58, 66, 85, 108, 122, 136], camera }, true);
call('vfx_save_document', { path: 'src/intro/portal.vfx.json' }, true);

writeFileSync('mcp/examples/intro-portal.steps.json', JSON.stringify(steps, null, 1));
console.log(`${steps.length} steps -> mcp/examples/intro-portal.steps.json`);
