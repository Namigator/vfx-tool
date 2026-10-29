// Feature grid cases: one tiny effect per feature the editor can author, so every engine export is checked feature by
// feature instead of effect by effect. Each case lists the node types (and the options) it exercises; the coverage test
// (tests/v2-feature-grid.test.ts) fails when a node type with a visual result has no case, so a new node gets a case.
// A case is a list of MCP steps (mcp/run-steps.mjs) applied to a blank document. All cases share one camera and stage:
// Source at (0, 1, 0), Target at (2.5, 1, 0), duration 90 ticks, captured at `tick` (default 30).
export const STAGE = { source: [0, 1, 0], target: [2.5, 1, 0], durationTicks: 90 };
export const CAMERA = { position: [1.25, 1.7, 4.8], target: [1.25, 1, 0], fov: 50 };
export const DEFAULT_TICK = 30;

// Node types with no picture to compare (sound, camera shake, editor grouping, knobs). Listed so the coverage test can
// tell "deliberately not in the grid" from "forgotten".
export const NOT_VISUAL = {
  AudioSource: 'sound', AudioEnvelope: 'sound', AudioFilter: 'sound', AudioMix: 'sound', AudioOutput: 'sound',
  CameraImpulse: 'camera shake, no effect pixels', Group: 'editor grouping', GroupInput: 'editor grouping', GroupOutput: 'editor grouping',
  PublicParameter: 'exposes a knob, draws nothing',
};

const lin = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const col = (srgb, alpha = 1) => ({ srgb, alpha });
const grad = stops => ({ stops: stops.map(([position, srgb]) => ({ position, color: col(srgb) })) });

/** Step helpers for one document. */
function kit(D) {
  const S = [];
  const doc = (tool, args) => S.push([tool, { docId: D, ...args }]);
  const add = (type, id, params = {}) => { doc('vfx_add_node', { type, id, params }); return id; };
  const wire = (from, to) => doc('vfx_connect', { from, to });
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  const win = (id = 'win', startTicks = 0, durationTicks = 60) => add('Schedule', id, { startTicks, durationTicks, mode: 'window' });
  const mat = (id, extra = {}) => add('Material', id, { template: 'SpriteTextured', sprite: 'soft-glow', blend: 'additive', tint: col('#7FD4FF'), emission: 0.5, ...extra });
  /** Emitter at Source -> InitialProperties -> [mods] -> BillboardRenderer. Returns the last particles port before the renderer. */
  function particles({ emitter = {}, ip = {}, mods = [], bb = {}, material = {}, window = 'win', trigger, renderer = 'BillboardRenderer', rendererParams } = {}) {
    add('Emitter', 'emit', { shape: 'cone', coneAngle: 0.2, radius: 0.05, burst: 0, rate: 60, speedMin: 1, speedMax: 2, direction: [0, 1, 0], lifetimeMin: 0.8, lifetimeMax: 1, ...emitter });
    if (emitter.shape !== 'path') wire('node-source.out', 'emit.anchor'); // a path emitter takes its positions from the path only
    if (trigger) wire(trigger, 'emit.trigger'); else { win(window); wire(`${window}.window`, 'emit.window'); }
    add('InitialProperties', 'ip', { sizeMin: 0.12, sizeMax: 0.2, angularVelocityMin: 0, angularVelocityMax: 0, ...ip });
    wire('emit.particles', 'ip.particles');
    let last = 'ip.particles';
    for (const [type, id, params, anchor] of mods) {
      add(type, id, params); wire(last, `${id}.particles`);
      if (anchor) wire(anchor, `${id}.anchor`);
      last = `${id}.particles`;
    }
    mat('mat', material);
    add(renderer, 'draw', rendererParams ?? bb);
    wire(last, 'draw.particles'); wire('mat.material', 'draw.material'); out('draw');
    return last;
  }
  /** A ribbon on `paths` with an additive untextured (or `material`) look. */
  function ribbon(paths, { id = 'rib', material = {}, params = {}, window } = {}) {
    add('Material', `${id}mat`, { template: 'RibbonUnlit', blend: 'additive', tint: col('#B48CFF'), emission: 0.6, ...material });
    add('RibbonRenderer', id, { width: 0.08, endFade: 0.1, ...params });
    wire(paths, `${id}.paths`); wire(`${id}mat.material`, `${id}.material`);
    if (window) wire(window, `${id}.window`);
    out(id);
  }
  /** Source -> Target line path, returns its paths port. */
  const line = (id = 'line', samples = 32) => { add('LinePath', id, { samples }); wire('node-source.out', `${id}.start`); wire('node-target.out', `${id}.end`); return `${id}.paths`; };
  return { S, doc, add, wire, out, win, mat, particles, ribbon, line };
}

// covers: node types this case exercises; feature: what a reader should see.
export const CASES = [
  { id: 'empty', feature: 'empty stage (plate subtracted from every other case)', covers: ['Anchor', 'EffectOutput'], build() {} },
  // ---- spawning ----
  { id: 'shape-point', feature: 'Emitter shape point, rate over a window', covers: ['Emitter', 'Schedule', 'InitialProperties', 'BillboardRenderer', 'Material'], build: k => k.particles({ emitter: { shape: 'point' } }) },
  { id: 'shape-sphere', feature: 'Emitter shape sphere', covers: ['Emitter'], build: k => k.particles({ emitter: { shape: 'sphere', radius: 0.6, speedMin: 0.1, speedMax: 0.3 } }) },
  { id: 'shape-box', feature: 'Emitter shape box', covers: ['Emitter'], build: k => k.particles({ emitter: { shape: 'box', radius: 0.7, speedMin: 0.1, speedMax: 0.3 } }) },
  { id: 'shape-cone', feature: 'Emitter shape cone (wide, sideways)', covers: ['Emitter'], build: k => k.particles({ emitter: { shape: 'cone', coneAngle: 0.5, direction: [1, 0, 0], speedMin: 2, speedMax: 3 } }) },
  { id: 'shape-disc', feature: 'Emitter shape disc', covers: ['Emitter'], build: k => k.particles({ emitter: { shape: 'disc', radius: 0.8, speedMin: 0.1, speedMax: 0.3 } }) },
  { id: 'shape-path', feature: 'Emitter shape path (spawn along a ring path)', covers: ['Emitter', 'RingPath'], build(k) {
    k.add('RingPath', 'ring', { radius: 0.8 }); k.wire('node-source.out', 'ring.center');
    k.particles({ emitter: { shape: 'path', speedMin: 0, speedMax: 0.2 } }); k.wire('ring.paths', 'emit.paths');
  } },
  { id: 'burst', feature: 'one burst of 80 at tick 10', covers: ['Emitter', 'Schedule'], tick: 25, build(k) {
    k.add('Schedule', 'go', { startTicks: 10, mode: 'once' });
    k.particles({ emitter: { burst: 80, rate: 0, shape: 'point', speedMin: 1, speedMax: 2.5, direction: [0, 1, 0] }, trigger: 'go.start' });
  } },
  // ---- forces ----
  { id: 'gravity', feature: 'Gravity pulls a sideways stream down', covers: ['Gravity'], build: k => k.particles({ emitter: { direction: [1, 0.6, 0], speedMin: 3, speedMax: 3.5 }, mods: [['Gravity', 'g', { acceleration: [0, -6, 0] }]] }) },
  { id: 'drag', feature: 'Drag stops a fast stream short', covers: ['Drag'], build: k => k.particles({ emitter: { direction: [1, 0, 0], speedMin: 6, speedMax: 6 }, mods: [['Drag', 'd', { coefficient: 4 }]] }) },
  { id: 'noise', feature: 'NoiseForce (curl) scatters a rising column', covers: ['NoiseForce'], build: k => k.particles({ mods: [['NoiseForce', 'n', { amplitude: 6, frequency: 1.5 }]] }) },
  { id: 'attract', feature: 'Attract pulls particles toward a point 1 m right of Source', covers: ['Attract', 'OffsetAnchor'], build(k) {
    k.add('OffsetAnchor', 'pt', { offset: [1.5, 0, 0] }); k.wire('node-source.out', 'pt.anchor');
    k.particles({ emitter: { shape: 'sphere', radius: 0.8, speedMin: 0, speedMax: 0.2 }, mods: [['Attract', 'a', { acceleration: 8, softRadius: 0.2 }, 'pt.out']] });
  } },
  { id: 'vortex', feature: 'Vortex swirls particles around the vertical axis', covers: ['Vortex'], build: k => k.particles({ emitter: { shape: 'disc', radius: 0.8, speedMin: 0.2, speedMax: 0.4 }, mods: [['Vortex', 'v', { tangential: 6, inward: 1.5 }, 'node-source.out']] }) },
  { id: 'collision', feature: 'GroundCollision bounce on the floor', covers: ['GroundCollision'], tick: 45, build: k => k.particles({ emitter: { direction: [0.4, 1, 0], speedMin: 2, speedMax: 3 }, mods: [['Gravity', 'g', {}], ['GroundCollision', 'c', { mode: 'bounce', restitution: 0.6 }]] }) },
  // ---- look over life ----
  { id: 'overlife', feature: 'OverLife colour cyan -> orange, size grows, opacity fades', covers: ['OverLife'], build: k => k.particles({ mods: [['OverLife', 'ol', { colorOverLife: grad([[0, '#00FFFF'], [1, '#FF6A00']]), sizeOverLife: lin([[0, 0.5], [1, 3]]), opacityOverLife: lin([[0, 1], [1, 0]]) }]], material: { tint: col('#FFFFFF') } }) },
  { id: 'bb-size-opacity', feature: 'BillboardRenderer size/opacity over life (shrink + fade)', covers: ['BillboardRenderer'], build: k => k.particles({ bb: { sizeOverLife: lin([[0, 3], [1, 0.2]]), opacityOverLife: lin([[0, 1], [1, 0]]) } }) },
  { id: 'spin', feature: 'InitialProperties spin on a star sprite', covers: ['InitialProperties'], build: k => k.particles({ ip: { sizeMin: 0.4, sizeMax: 0.5, angularVelocityMin: 6, angularVelocityMax: 8 }, material: { sprite: 'star-ray' } }) },
  { id: 'velocity-stretch', feature: 'velocity-aligned streaks (stretch 5)', covers: ['BillboardRenderer'], build: k => k.particles({ emitter: { shape: 'point', direction: [1, 0.3, 0], coneAngle: 0.4, speedMin: 3, speedMax: 4 }, bb: { alignment: 'velocity', stretchRatio: 5 }, material: { sprite: 'spark-streak' } }) },
  { id: 'world-axis', feature: 'world-axis billboards lying flat', covers: ['BillboardRenderer'], build: k => k.particles({ emitter: { shape: 'disc', radius: 0.9, speedMin: 0, speedMax: 0.1 }, ip: { sizeMin: 0.4, sizeMax: 0.5 }, bb: { alignment: 'worldAxis' }, material: { sprite: 'ripple-ring' } }) },
  // ---- materials ----
  { id: 'blend-normal', feature: 'normal (alpha) blend smoke', covers: ['Material'], build: k => k.particles({ emitter: { speedMin: 0.5, speedMax: 1 }, ip: { sizeMin: 0.5, sizeMax: 0.7 }, material: { sprite: 'smoke-puff', blend: 'normal', tint: col('#C8C8C8'), emission: 0 } }) },
  { id: 'emission-hot', feature: 'high emission (HDR) glow', covers: ['Material'], build: k => k.particles({ material: { emission: 4 } }) },
  { id: 'untextured', feature: 'SpriteUnlit (no texture) particles', covers: ['Material'], build: k => k.particles({ material: { template: 'SpriteUnlit', sprite: undefined } }) },
  { id: 'flipbook', feature: 'animated flipbook over life (sim fireball)', covers: ['BillboardRenderer', 'Material'], build: k => k.particles({ emitter: { rate: 12, speedMin: 0.3, speedMax: 0.6 }, ip: { sizeMin: 0.8, sizeMax: 1 }, bb: { flipbookMode: 'overLife' }, material: { sprite: 'sim-fireball', tint: col('#FFFFFF'), emission: 0.3 } }) },
  { id: 'variant', feature: 'variant sheet cell (soft-glow ring)', covers: ['Material'], build: k => k.particles({ emitter: { rate: 10, speedMin: 0.2, speedMax: 0.4 }, ip: { sizeMin: 0.8, sizeMax: 0.9 }, material: { variant: 1 } }) },
  { id: 'uv-scroll', feature: 'ribbon texture tiled + UV scroll', covers: ['Material', 'RibbonRenderer'], build: k => k.ribbon(k.line(), { material: { template: 'RibbonUnlit', sprite: 'electric-arc', uvScroll: [2, 0] }, params: { width: 0.3, uvMode: 'tile', uvTileLength: 0.6 } }) },
  { id: 'mesh-particles', feature: 'MeshRenderer rock particles (lit)', covers: ['MeshRenderer'], build: k => k.particles({ emitter: { rate: 20 }, renderer: 'MeshRenderer', rendererParams: { mesh: 'rock-a' }, material: { template: 'MeshLit', sprite: undefined, blend: 'normal', tint: col('#8A7A6A'), emission: 0 } }) },
  // ---- single visuals ----
  { id: 'sprite', feature: 'SpriteRenderer growing glow at Source', covers: ['SpriteRenderer'], build(k) {
    k.win(); k.mat('m', { emission: 1 }); k.add('SpriteRenderer', 's', { size: 1, sizeOverWindow: lin([[0, 0.3], [1, 1]]) });
    k.wire('node-source.out', 's.anchor'); k.wire('m.material', 's.material'); k.wire('win.window', 's.window'); k.out('s');
  } },
  { id: 'sprite-flat', feature: 'SpriteRenderer lying flat (world axis)', covers: ['SpriteRenderer'], build(k) {
    k.win(); k.mat('m', { sprite: 'ripple-ring' }); k.add('SpriteRenderer', 's', { size: 2, alignment: 'worldAxis' });
    k.wire('node-source.out', 's.anchor'); k.wire('m.material', 's.material'); k.wire('win.window', 's.window'); k.out('s');
  } },
  { id: 'light', feature: 'PointLight lighting the floor', covers: ['PointLight'], build(k) {
    k.win(); k.add('PointLight', 'l', { color: col('#FF8A3D'), intensity: 30, range: 4 });
    k.wire('node-source.out', 'l.anchor'); k.wire('win.window', 'l.window'); k.out('l');
  } },
  { id: 'ring', feature: 'RingRenderer expanding ring', covers: ['RingRenderer'], build(k) {
    k.win(); k.add('Material', 'm', { template: 'RibbonUnlit', blend: 'additive', tint: col('#FFD27F'), emission: 0.8 });
    k.add('RingRenderer', 'r', { width: 0.06 }); k.wire('node-source.out', 'r.anchor'); k.wire('m.material', 'r.material'); k.wire('win.window', 'r.window'); k.out('r');
  } },
  { id: 'prop-mesh', feature: 'PropMesh crystal at Source', covers: ['PropMesh'], build(k) {
    k.win(); k.add('Material', 'm', { template: 'MeshLit', tint: col('#6FB7FF'), blend: 'normal' });
    k.add('PropMesh', 'p', { mesh: 'crystal', size: 0.4, length: 1 });
    k.wire('node-source.out', 'p.anchor'); k.wire('m.material', 'p.material'); k.wire('win.window', 'p.window'); k.out('p');
  } },
  { id: 'screen-flash', feature: 'ScreenFlash at tick 28', covers: ['ScreenFlash'], build(k) {
    k.add('Schedule', 'go', { startTicks: 28, mode: 'once' }); k.add('ScreenFlash', 'f', { color: col('#FFFFFF'), alpha: 0.15, durationTicks: 6 });
    k.wire('go.start', 'f.trigger'); k.wire('f.presentation', 'node-output.presentation');
  } },
  // ---- motion ----
  { id: 'projectile', feature: 'PathFollower moves a glow Source -> Target', covers: ['PathFollower', 'LinePath'], build(k) {
    k.win('fly', 0, 90); k.add('PathFollower', 'f', { durationTicks: 60 }); k.wire(k.line(), 'f.paths'); k.wire('fly.window', 'f.window');
    k.mat('m', { emission: 1.5 }); k.add('SpriteRenderer', 's', { size: 0.4 }); k.wire('f.anchor', 's.anchor'); k.wire('m.material', 's.material'); k.wire('fly.window', 's.window'); k.out('s');
  } },
  { id: 'motion-trail', feature: 'MotionTrail behind a moving point', covers: ['MotionTrail', 'BezierPath'], build(k) {
    k.win('fly', 0, 90); k.add('BezierPath', 'arc', { startHandle: [1, 1.2, 0], endHandle: [-1, 1.2, 0] }); k.wire('node-source.out', 'arc.start'); k.wire('node-target.out', 'arc.end');
    k.add('PathFollower', 'f', { durationTicks: 50 }); k.wire('arc.paths', 'f.paths'); k.wire('fly.window', 'f.window');
    k.add('Material', 'm', { blend: 'additive', tint: col('#7FFFB0'), emission: 0.8 }); k.add('MotionTrail', 't', { history: 0.4, width: 0.12 });
    k.wire('f.anchor', 't.anchor'); k.wire('m.material', 't.material'); k.wire('fly.window', 't.window'); k.out('t');
  } },
  { id: 'particle-trail', feature: 'ParticleTrail on many sparks', covers: ['ParticleTrail'], build: k => k.particles({ emitter: { shape: 'point', direction: [1, 1, 0], speedMin: 2, speedMax: 3 }, mods: [['Gravity', 'g', { acceleration: [0, -4, 0] }]], renderer: 'ParticleTrail', rendererParams: { history: 0.25, width: 0.03 }, material: { template: 'RibbonUnlit', sprite: undefined, tint: col('#FFC060') } }) },
  { id: 'sub-emitter', feature: 'ParticleEvents: each dying particle bursts children (delayed, merged)', covers: ['ParticleEvents', 'EventDelay', 'MergeEvents'], tick: 42, build(k) {
    k.particles({ emitter: { rate: 12, speedMin: 2, speedMax: 2.5, lifetimeMin: 0.4, lifetimeMax: 0.5 } });
    k.add('ParticleEvents', 'ev'); k.wire('ip.particles', 'ev.particles');
    k.add('EventDelay', 'dl', { delayTicks: 2 }); k.wire('ev.death', 'dl.events');
    k.add('MergeEvents', 'mg'); k.wire('dl.event', 'mg.events');
    k.add('Emitter', 'kid', { shape: 'point', burst: 20, rate: 0, speedMin: 0.8, speedMax: 1.2, lifetimeMin: 0.4, lifetimeMax: 0.6 }); k.wire('mg.event', 'kid.trigger');
    k.add('InitialProperties', 'kip', { sizeMin: 0.06, sizeMax: 0.1 }); k.wire('kid.particles', 'kip.particles');
    k.mat('km', { tint: col('#FF7FD0') }); k.add('BillboardRenderer', 'kbb'); k.wire('kip.particles', 'kbb.particles'); k.wire('km.material', 'kbb.material'); k.out('kbb');
  } },
  // ---- ribbons / paths ----
  { id: 'ribbon-line', feature: 'RibbonRenderer straight soft beam', covers: ['RibbonRenderer', 'LinePath'], build: k => k.ribbon(k.line()) },
  { id: 'ribbon-bezier', feature: 'ribbon on a Bezier arc', covers: ['BezierPath'], build(k) { k.add('BezierPath', 'b', { startHandle: [0.8, 1.5, 0], endHandle: [-0.8, 1.5, 0] }); k.wire('node-source.out', 'b.start'); k.wire('node-target.out', 'b.end'); k.ribbon('b.paths'); } },
  { id: 'ribbon-helix', feature: 'HelixPath ribbon, 3 turns', covers: ['HelixPath'], build(k) { k.add('HelixPath', 'h', { radius: 0.35, turns: 3 }); k.wire('node-source.out', 'h.start'); k.wire('node-target.out', 'h.end'); k.ribbon('h.paths'); } },
  { id: 'jagged', feature: 'JaggedPath lightning bolt', covers: ['JaggedPath'], build(k) { k.add('JaggedPath', 'j', { amplitude: 0.35, regenerationHz: 0 }); k.wire(k.line(), 'j.paths'); k.ribbon('j.paths', { params: { width: 0.05 } }); } },
  { id: 'branch', feature: 'BranchPath: trunk + branches', covers: ['BranchPath'], build(k) {
    k.add('JaggedPath', 'j', { amplitude: 0.25, regenerationHz: 0 }); k.wire(k.line(), 'j.paths'); k.add('BranchPath', 'br', { count: 6 }); k.wire('j.paths', 'br.paths');
    k.ribbon('br.trunk', { params: { width: 0.05 } }); k.ribbon('br.branches', { id: 'rb2', params: { width: 0.03 } });
  } },
  { id: 'radial', feature: 'RadialPath spokes (disc)', covers: ['RadialPath'], build(k) { k.add('RadialPath', 'rp', { mode: 'disc', count: 12, lengthMin: 0.8, lengthMax: 1.2, orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }); k.wire('node-source.out', 'rp.center'); k.ribbon('rp.paths', { params: { width: 0.04 } }); } },
  { id: 'ring-path', feature: 'RingPath ribbon (vertical ring)', covers: ['RingPath'], build(k) { k.add('RingPath', 'rg', { radius: 0.8, orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }); k.wire('node-source.out', 'rg.center'); k.ribbon('rg.paths', { params: { endFade: 0 } }); } },
  { id: 'reveal', feature: 'RevealPath: first half of the line', covers: ['RevealPath'], build(k) { k.add('RevealPath', 'rv', { fraction: 0.5 }); k.wire(k.line(), 'rv.paths'); k.ribbon('rv.paths'); } },
  { id: 'path-ops', feature: 'PathTransform (raised copy) + MergePaths + PathSplitter', covers: ['PathTransform', 'MergePaths', 'PathSplitter'], build(k) {
    const l = k.line(); k.add('PathTransform', 'up', { offset: [0, 0.6, 0] }); k.wire(l, 'up.paths');
    k.add('MergePaths', 'mp'); k.wire(l, 'mp.paths'); k.wire('up.paths', 'mp.paths');
    k.add('PathSplitter', 'sp', { mode: 'range', from: 0, count: 2 }); k.wire('mp.paths', 'sp.paths'); k.ribbon('sp.paths');
  } },
  { id: 'particle-paths', feature: 'ParticlePaths: beams from Source to 4 particles', covers: ['ParticlePaths'], build(k) {
    k.particles({ emitter: { shape: 'sphere', radius: 1, speedMin: 0, speedMax: 0.2, rate: 10 } });
    k.add('ParticlePaths', 'pp', { maxCount: 4 }); k.wire('ip.particles', 'pp.particles'); k.wire('node-source.out', 'pp.anchor'); k.ribbon('pp.paths', { params: { width: 0.03 } });
  } },
  // ---- driven values ----
  { id: 'driven-opacity', feature: 'material opacity driven by Time x Oscillator (pulsing beam)', covers: ['Time', 'ScalarMath', 'Oscillator', 'Constant'], build(k) {
    k.win(); k.add('Time', 'clk'); k.wire('win.window', 'clk.window');
    k.add('Oscillator', 'osc', { frequency: 3, min: 0.2, max: 1, unit: 'none' });
    k.add('ScalarMath', 'mul', { operation: 'multiply', unit: 'normalized', inputUnit: 'none' }); k.wire('osc.value', 'mul.a');
    k.add('Constant', 'one', { value: 1 }); k.wire('one.value', 'mul.b');
    k.ribbon(k.line(), { window: 'win.window' }); k.wire('mul.value', 'ribmat.opacity');
  } },
  { id: 'value-nodes', feature: 'Gradient -> colour over life, Curve -> size over life, RandomRange -> size', covers: ['Gradient', 'Curve', 'RandomRange'], build(k) {
    k.particles({ mods: [['OverLife', 'ol', {}]], material: { tint: col('#FFFFFF') } });
    k.add('Gradient', 'gr', { gradient: grad([[0, '#FF3030'], [1, '#30FF60']]) }); k.wire('gr.gradient', 'ol.colorOverLife');
    k.add('Curve', 'cv', { curve: lin([[0, 0.3], [1, 2.5]]) }); k.wire('cv.curve', 'draw.sizeOverLife');
    k.add('RandomRange', 'rr', { min: 0.15, max: 0.3, unit: 'meter' }); k.wire('rr.value', 'ip.sizeMax');
  } },
  { id: 'effect-time-opacity', feature: 'EffectTimeCurve fades a beam 1 -> 0.2 over 1 s (dim at t30)', covers: ['EffectTimeCurve'], build(k) {
    k.add('EffectTimeCurve', 'etc', { curve: { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 0.2 }] } });
    k.ribbon(k.line()); k.wire('etc.value', 'ribmat.opacity');
  } },
];

/** MCP steps that build case `c` as document fg-<id> and save it to work/feature-grid/docs/<id>.json. */
export function stepsFor(c) {
  const D = `fg-${c.id}`, k = kit(D);
  k.S.push(['vfx_new_document', { template: 'blank', id: D }]);
  k.doc('vfx_set_document', { durationTicks: STAGE.durationTicks, seed: 7 });
  k.doc('vfx_set_anchor', { anchorId: 'source', position: STAGE.source });
  k.doc('vfx_set_anchor', { anchorId: 'target', position: STAGE.target });
  c.build(k);
  k.doc('vfx_save_document', { path: `work/feature-grid/docs/${c.id}.json` });
  return k.S;
}
