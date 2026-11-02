// Writes mcp/examples/intro-portal.steps.json: the first-visit intro effect, built from editor nodes through the MCP
// tools. A ring of sparks traces itself, spins, then widens past the screen. Run the steps with
//   node mcp/run-steps.mjs mcp/examples/intro-portal.steps.json
// (needs the dev server for the contact sheet); they save the document to src/intro/portal.vfx.json.
import { writeFileSync } from 'node:fs';

const doc = 'intro-portal';
const sec = s => Math.round(s * 60);
const curve = (domain, keys) => ({ domain, interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const gradient = stops => ({ stops: stops.map(([position, srgb, alpha]) => ({ position, color: { srgb, alpha } })) });
const steps = [];
const call = (name, args, print) => steps.push(print ? [name, { docId: doc, ...args }, true] : [name, { docId: doc, ...args }]);
const node = (type, id, params = {}) => call('vfx_add_node', { type, id, params });
const wire = (from, to) => call('vfx_connect', { from, to });

// Timeline (seconds): trace 0.15-0.95, spin until 1.8, widen 1.8-2.7, sparks until 2.9; effect lasts 3 s.
const TRACE = [0.15, 0.95], WIDEN = [1.8, 2.7], END = 3;
const VERTICAL = [0.7071068, 0, 0, 0.7071068]; // the XZ ring stood up to face the camera (+Z)
const RING_MAX = 10, RING_REST = 0.12; // RingPath radius and its rest scale: 1.2 m while tracing and spinning

steps.push(['vfx_new_document', { template: 'blank', id: doc }]);
call('vfx_set_document', { durationTicks: sec(END), seed: 7, name: 'Portal' });
call('vfx_set_anchor', { anchorId: 'source', position: [0, 1.5, 0] });

// The ring: radius scale holds, then eases out past the screen; RevealPath traces it.
node('EffectTimeCurve', 'grow', { curve: curve('effectSeconds', [[0, RING_REST], [WIDEN[0], RING_REST], [WIDEN[0] + 0.45, 0.32], [WIDEN[1], 1]]) });
node('EffectTimeCurve', 'trace', { curve: curve('effectSeconds', [[TRACE[0], 0], [TRACE[1], 1]]) });
node('RingPath', 'ring', { radius: RING_MAX, samples: 160, orientation: VERTICAL });
node('RevealPath', 'reveal');
wire('node-source.out', 'ring.center');
wire('grow.value', 'ring.radiusScale');
wire('ring.paths', 'reveal.paths');
wire('trace.value', 'reveal.fraction');

// Glowing band: a hot core over a wide soft orange halo.
node('Material', 'coremat', { template: 'RibbonUnlit', blend: 'additive', tint: { srgb: '#FFE6B0', alpha: 1 }, emission: 1, opacity: 1 });
node('RibbonRenderer', 'core', { width: 0.05, endFade: 0.02 });
node('Material', 'halomat', { template: 'RibbonUnlit', blend: 'additive', tint: { srgb: '#FF6A10', alpha: 1 }, emission: 0.7, opacity: 0.45 });
node('RibbonRenderer', 'halo', { width: 0.26, endFade: 0.02 });
for (const r of ['core', 'halo']) { wire('reveal.paths', `${r}.paths`); wire(`${r === 'core' ? 'coremat' : 'halomat'}.material`, `${r}.material`); wire(`${r}.visual`, 'node-output.visual'); }

// Inner rune ring, slightly smaller and dimmer, traced a little behind the outer one.
node('EffectTimeCurve', 'growin', { curve: curve('effectSeconds', [[0, RING_REST * 0.88], [WIDEN[0], RING_REST * 0.88], [WIDEN[0] + 0.45, 0.3], [WIDEN[1], 0.95]]) });
node('EffectTimeCurve', 'tracein', { curve: curve('effectSeconds', [[TRACE[0] + 0.15, 0], [TRACE[1] + 0.2, 1]]) });
node('RingPath', 'ringin', { radius: RING_MAX, samples: 160, orientation: VERTICAL });
node('RevealPath', 'revealin');
node('Material', 'innermat', { template: 'RibbonUnlit', blend: 'additive', tint: { srgb: '#FFB040', alpha: 1 }, emission: 0.8, opacity: 0.6 });
node('RibbonRenderer', 'inner', { width: 0.02, endFade: 0.02 });
wire('node-source.out', 'ringin.center');
wire('growin.value', 'ringin.radiusScale');
wire('ringin.paths', 'revealin.paths');
wire('tracein.value', 'revealin.fraction');
wire('revealin.paths', 'inner.paths');
wire('innermat.material', 'inner.material');
wire('inner.visual', 'node-output.visual');

// Spark look shared by both emitters: velocity-stretched, white-hot to orange to nothing.
const sparkLook = suffix => {
  node('Material', `mat${suffix}`, { blend: 'additive', emission: 1 });
  node('BillboardRenderer', `bb${suffix}`, {
    alignment: 'velocity', stretchRatio: 6, pivot: 0.85,
    colorOverLife: gradient([[0, '#FFFFFF', 1], [0.25, '#FFD27A', 1], [0.65, '#FF7A12', 0.85], [1, '#7A1A00', 0]]),
  });
  wire(`mat${suffix}.material`, `bb${suffix}.material`);
  wire(`bb${suffix}.visual`, 'node-output.visual');
};

// Tracing head: a rider runs once round the ring while it draws, throwing a dense shower that falls.
node('Schedule', 'tracewin', { startTicks: sec(TRACE[0]), durationTicks: sec(TRACE[1] - TRACE[0]), mode: 'window' });
node('PathFollower', 'head', { durationTicks: sec(TRACE[1] - TRACE[0]), easing: 'easeOut' });
node('Emitter', 'headsparks', { shape: 'sphere', radius: 0.03, burst: 0, rate: 1100, speedMin: 0.6, speedMax: 3.2, lifetimeMin: 0.25, lifetimeMax: 0.7 });
node('InitialProperties', 'headip', { sizeMin: 0.018, sizeMax: 0.034 });
node('Gravity', 'headgrav');
node('Drag', 'headdrag', { coefficient: 1.2 });
sparkLook('head');
wire('ring.paths', 'head.paths');
wire('tracewin.window', 'head.window');
wire('head.anchor', 'headsparks.anchor');
wire('tracewin.window', 'headsparks.window');
wire('headsparks.particles', 'headip.particles');
wire('headip.particles', 'headgrav.particles');
wire('headgrav.particles', 'headdrag.particles');
wire('headdrag.particles', 'bbhead.particles');

// Ring sparks: spawned along the traced ring, swirled round it and flung slightly outward.
node('Schedule', 'spinwin', { startTicks: sec(TRACE[1]) - 6, durationTicks: sec(WIDEN[0] + 0.2 - TRACE[1]) + 6, mode: 'window' });
node('Emitter', 'ringsparks', { shape: 'path', burst: 0, rate: 1600, speedMin: 0.1, speedMax: 0.9, lifetimeMin: 0.2, lifetimeMax: 0.5,
  rateOverWindow: curve('normalized', [[0, 0.3], [0.3, 1], [0.9, 1], [1, 0]]) });
node('InitialProperties', 'ringip', { sizeMin: 0.014, sizeMax: 0.028 });
node('Vortex', 'swirl', { axis: [0, 0, 1], tangential: 28, inward: -5, falloff: 20 });
node('Drag', 'ringdrag', { coefficient: 1.5 });
sparkLook('ring');
wire('ring.paths', 'ringsparks.paths');
wire('spinwin.window', 'ringsparks.window');
wire('ringsparks.particles', 'ringip.particles');
wire('ringip.particles', 'swirl.particles');
wire('node-source.out', 'swirl.anchor');
wire('swirl.particles', 'ringdrag.particles');
wire('ringdrag.particles', 'bbring.particles');

call('vfx_compile', {}, true);
const camera = { position: [0, 1.5, 7], target: [0, 1.5, 0], fov: 50 };
call('vfx_contact_sheet', { ticks: [12, 30, 50, 80, 110, 125, 140, 160], camera }, true);
call('vfx_save_document', { path: 'src/intro/portal.vfx.json' }, true);

writeFileSync('mcp/examples/intro-portal.steps.json', JSON.stringify(steps, null, 1));
console.log(`${steps.length} steps -> mcp/examples/intro-portal.steps.json`);
