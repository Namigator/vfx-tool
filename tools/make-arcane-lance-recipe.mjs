// Writes mcp/examples/arcane-lance.steps.json: "Arcane Lance", a no-sprite showcase spell built only from paths,
// ribbons, rings, ribbon particle trails, lights and presentation (flash/shake). Layers, in the order the breakdown
// video adds them back:
//   1 charge   gyroscope rings + inward streaks + crackling tethers at Source
//   2 lance    straight beam: jagged white core, magenta inner, violet outer, soft halo (decaying, flickering)
//   3 helix    two cyan strands braided around the lance
//   4 forks    short jagged branches off the beam
//   5 impact   floor shockwave rings, upward ray burst, ribbon sparks
//   6 light    impact light, screen flash, camera shake
//   7 residue  crackling arcs at the target fading out
// Usage: node tools/make-arcane-lance-recipe.mjs   (then node tools/build-components.mjs)
import { writeFileSync } from 'node:fs';

const DOC = 'lance';
const S = [];
const add = (type, id, params = {}) => S.push(['vfx_add_node', { docId: DOC, type, id, params }]);
const wire = (from, to) => S.push(['vfx_connect', { docId: DOC, from, to }]);
const out = id => wire(`${id}.visual`, 'node-output.visual');
const curve = (keys, domain = 'normalized') => ({ domain, interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const col = srgb => ({ srgb, alpha: 1 });
const T = 60, sec = t => t / T;                       // ticks → seconds
const Q_X90 = [0.7071068, 0, 0, 0.7071068], Q_Z90 = [0, 0, 0.7071068, 0.7071068], Q_Y90 = [0, 0.7071068, 0, 0.7071068];
const VIOLET = '#8A3CFF', MAGENTA = '#FF4FD8', CYAN = '#5FF0FF', WHITE = '#FFF4FF';

// Timeline (ticks)
const CHARGE = [0, 40], FIRE = 40, BEAM_LEN = 46, IMPACT = 43, END = 168;

S.push(['vfx_new_document', { template: 'blank', id: DOC }]);
S.push(['vfx_set_document', { docId: DOC, durationTicks: END, seed: 11 }]);
S.push(['vfx_set_anchor', { docId: DOC, anchorId: 'source', position: [-4.5, 1.5, 0] }]);
S.push(['vfx_set_anchor', { docId: DOC, anchorId: 'target', position: [4.2, 0.6, 0] }]);
add('OffsetAnchor', 'floor', { offset: [0, 0, 0], dropToGround: true }); wire('node-target.out', 'floor.anchor');   // ground under Target

/** Ribbon layer on `paths`: material + renderer, opacity optionally driven by a value output. */
function ribbon(id, paths, window, { color, width, opacity = 1, emission = 0, endFade = 0.06, drive, driveScale = 1, widthOverPath, opacityFrom }) {
  add('Material', `${id}mat`, { template: 'RibbonUnlit', blend: 'additive', tint: col(color), emission, opacity });
  add('RibbonRenderer', id, { width, endFade, ...(widthOverPath ? { widthOverPath } : {}) });
  wire(paths, `${id}.paths`); wire(`${id}mat.material`, `${id}.material`); wire(window, `${id}.window`); out(id);
  if (opacityFrom) wire(opacityFrom, `${id}mat.opacity`);   // an already-normalized value (EffectTimeCurve)
  else if (drive) {
    add('ScalarMath', `${id}lvl`, { operation: 'multiply', b: driveScale, inputUnit: 'none', unit: 'normalized' });
    wire(drive, `${id}lvl.a`); wire(`${id}lvl.value`, `${id}mat.opacity`);
  }
}
/** exp(-k·t)·flicker envelope over a window: returns the value output. */
function envelope(id, window, k, flickerHz, flickerMin = 0.7) {
  add('Time', `${id}clk`); wire(window, `${id}clk.window`);
  add('ScalarMath', `${id}dec`, { operation: 'multiply', b: -k, inputUnit: 'second', unit: 'none' }); wire(`${id}clk.localSeconds`, `${id}dec.a`);
  add('ScalarMath', `${id}exp`, { operation: 'exp', unit: 'none' }); wire(`${id}dec.value`, `${id}exp.a`);
  add('Oscillator', `${id}flk`, { waveform: 'sine', frequency: flickerHz, phase: 0.6, min: flickerMin, max: 1, unit: 'none' });
  add('ScalarMath', `${id}env`, { operation: 'multiply', inputUnit: 'none', unit: 'none' });
  wire(`${id}exp.value`, `${id}env.a`); wire(`${id}flk.value`, `${id}env.b`);
  return `${id}env.value`;
}

// ── 1 CHARGE ─────────────────────────────────────────────────────────────────────────────────────
add('Schedule', 'charge', { startTicks: CHARGE[0], durationTicks: CHARGE[1], mode: 'window' });
const grow = curve([[0, 0.05], [0.75, 0.55], [1, 0.42]]);
for (const [i, q, c, w] of [[0, Q_X90, VIOLET, 0.03], [1, Q_Z90, MAGENTA, 0.022], [2, [0, 0, 0, 1], CYAN, 0.018], [3, Q_Y90, VIOLET, 0.014]]) {
  add('Material', `gyro${i}mat`, { template: 'RibbonUnlit', blend: 'additive', tint: col(c), emission: 0.6, opacity: 0.9 });
  add('RingRenderer', `gyro${i}`, { radius: curve(grow.keys.map(k => [k.x, k.y * (1 - i * 0.12)])), width: w, orientation: q, segments: 64 });
  wire('node-source.out', `gyro${i}.anchor`); wire(`gyro${i}mat.material`, `gyro${i}.material`); wire('charge.window', `gyro${i}.window`); out(`gyro${i}`);
}
add('Emitter', 'motes', { shape: 'sphere', radius: 1.8, burst: 0, rate: 160, speedMin: 0, speedMax: 0.3, lifetimeMin: 0.35, lifetimeMax: 0.6,
  rateOverWindow: curve([[0, 0.3], [0.8, 1], [1, 0]]) });
add('InitialProperties', 'moteip', { sizeMin: 0.02, sizeMax: 0.04 });
add('Attract', 'pull', { acceleration: 26, softRadius: 0.2, killRadius: 0.12 });
add('Material', 'motemat', { template: 'RibbonUnlit', blend: 'additive', tint: col('#D8A8FF'), emission: 0.8 });
add('ParticleTrail', 'motetrail', { history: 0.12, width: 0.014, endFade: 0.4 });
wire('node-source.out', 'motes.anchor'); wire('charge.window', 'motes.window'); wire('motes.particles', 'moteip.particles');
wire('moteip.particles', 'pull.particles'); wire('node-source.out', 'pull.anchor'); wire('pull.particles', 'motetrail.particles');
wire('motemat.material', 'motetrail.material'); out('motetrail');
add('ParticlePaths', 'tethers', { maxCount: 5, samples: 10 });
add('JaggedPath', 'tetherjag', { amplitude: 0.07, regenerationHz: 24, samples: 10 });
wire('pull.particles', 'tethers.particles'); wire('node-source.out', 'tethers.anchor'); wire('tethers.paths', 'tetherjag.paths');
ribbon('tether', 'tetherjag.paths', 'charge.window', { color: '#E8C8FF', width: 0.012, opacity: 0.8, emission: 0.6 });

// ── 2 LANCE ──────────────────────────────────────────────────────────────────────────────────────
add('Schedule', 'beam', { startTicks: FIRE, durationTicks: BEAM_LEN, mode: 'window' });
add('LinePath', 'axis', { samples: 56 }); wire('node-source.out', 'axis.start'); wire('node-target.out', 'axis.end');
add('JaggedPath', 'trunk', { amplitude: 0.07, regenerationHz: 30, samples: 56 }); wire('axis.paths', 'trunk.paths');
add('EffectTimeCurve', 'shoot', { curve: curve([[sec(FIRE), 0], [sec(FIRE + 3), 1]], 'effectSeconds') });
add('RevealPath', 'trunkrev'); wire('trunk.paths', 'trunkrev.paths'); wire('shoot.value', 'trunkrev.fraction');
add('RevealPath', 'axisrev'); wire('axis.paths', 'axisrev.paths'); wire('shoot.value', 'axisrev.fraction');
const beamEnv = envelope('beam', 'beam.window', 2.2, 27);
const taper = curve([[0, 0.55], [0.08, 1], [0.92, 1], [1, 0.7]]);
ribbon('beamhalo', 'axisrev.paths', 'beam.window', { color: '#3A0E8A', width: 0.95, drive: beamEnv, driveScale: 0.26, widthOverPath: taper, endFade: 0.1 });
ribbon('beamouter', 'axisrev.paths', 'beam.window', { color: VIOLET, width: 0.34, drive: beamEnv, driveScale: 0.42, widthOverPath: taper });
ribbon('beaminner', 'trunkrev.paths', 'beam.window', { color: MAGENTA, width: 0.11, emission: 0.2, drive: beamEnv, driveScale: 0.8, widthOverPath: taper });
ribbon('beamcore', 'trunkrev.paths', 'beam.window', { color: WHITE, width: 0.035, emission: 0.6, drive: beamEnv, driveScale: 1 });

// ── 3 HELIX ──────────────────────────────────────────────────────────────────────────────────────
for (const [i, phase] of [[0, 0], [1, Math.PI]]) {
  add('HelixPath', `hx${i}`, { radius: 0.26, turns: 7, phase, spin: 14, taper: 'both', samples: 128 });
  wire('node-source.out', `hx${i}.start`); wire('node-target.out', `hx${i}.end`);
  add('RevealPath', `hx${i}rev`); wire(`hx${i}.paths`, `hx${i}rev.paths`); wire('shoot.value', `hx${i}rev.fraction`);
  ribbon(`hx${i}glow`, `hx${i}rev.paths`, 'beam.window', { color: '#1C8CFF', width: 0.13, drive: beamEnv, driveScale: 0.3 });
  ribbon(`hx${i}line`, `hx${i}rev.paths`, 'beam.window', { color: CYAN, width: 0.032, emission: 0.5, drive: beamEnv, driveScale: 0.95 });
}

// ── 4 FORKS ──────────────────────────────────────────────────────────────────────────────────────
add('BranchPath', 'forks', { count: 10, attachmentMin: 0.08, attachmentMax: 0.9, lengthMin: 0.35, lengthMax: 1.1, opacityMin: 0.35, opacityMax: 0.7, widthMin: 0.25, widthMax: 0.5 });
add('JaggedPath', 'forkjag', { amplitude: 0.09, regenerationHz: 24, samples: 12 });
wire('trunk.paths', 'forks.paths'); wire('forks.branches', 'forkjag.paths');
add('RevealPath', 'forkrev'); wire('forkjag.paths', 'forkrev.paths'); wire('shoot.value', 'forkrev.fraction');
ribbon('forkglow', 'forkrev.paths', 'beam.window', { color: VIOLET, width: 0.08, drive: beamEnv, driveScale: 0.35 });
ribbon('forkline', 'forkrev.paths', 'beam.window', { color: '#FFC8F4', width: 0.018, emission: 0.4, drive: beamEnv, driveScale: 0.9 });

// ── 5 IMPACT ─────────────────────────────────────────────────────────────────────────────────────
add('Schedule', 'impact', { startTicks: IMPACT, durationTicks: 90, mode: 'window' });
for (const [i, c, delay, maxR, w] of [[0, MAGENTA, 0, 2.2, 0.06], [1, CYAN, 6, 1.6, 0.035], [2, VIOLET, 12, 2.8, 0.08]]) {
  const t0 = sec(IMPACT + delay);
  add('RingPath', `wave${i}`, { radius: maxR, samples: 96 });
  add('EffectTimeCurve', `wave${i}r`, { curve: curve([[t0, 0.02], [t0 + 0.35, 0.6], [t0 + 1.1, 1]], 'effectSeconds') });
  add('EffectTimeCurve', `wave${i}a`, { curve: curve([[t0 - 0.001, 0], [t0, 0.85], [t0 + 0.4, 0.3], [t0 + 1.1, 0]], 'effectSeconds') });
  wire('floor.out', `wave${i}.center`); wire(`wave${i}r.value`, `wave${i}.radiusScale`);
  ribbon(`wave${i}rib`, `wave${i}.paths`, 'impact.window', { color: c, width: w, emission: 0.3, opacityFrom: `wave${i}a.value`, endFade: 0 });
}
add('Schedule', 'raywin', { startTicks: IMPACT, durationTicks: 26, mode: 'window' });
add('RadialPath', 'rays', { mode: 'cone', count: 22, lengthMin: 0.7, lengthMax: 2.6, coneAngle: 0.75 });
add('JaggedPath', 'rayjag', { amplitude: 0.05, regenerationHz: 30, samples: 10 });
wire('node-target.out', 'rays.center'); wire('rays.paths', 'rayjag.paths');
const rayEnv = envelope('ray', 'raywin.window', 7, 35, 0.6);
ribbon('rayglow', 'rayjag.paths', 'raywin.window', { color: MAGENTA, width: 0.09, drive: rayEnv, driveScale: 0.4, widthOverPath: curve([[0, 1], [1, 0.1]]) });
ribbon('rayline', 'rayjag.paths', 'raywin.window', { color: WHITE, width: 0.022, emission: 0.5, drive: rayEnv, driveScale: 1, widthOverPath: curve([[0, 1], [1, 0.1]]) });
add('Emitter', 'sparks', { shape: 'cone', direction: [0, 1, 0], coneAngle: 1.2, radius: 0.1, burst: 110, rate: 0, speedMin: 2, speedMax: 8, lifetimeMin: 0.4, lifetimeMax: 1.3 });
add('InitialProperties', 'sparkip', { sizeMin: 0.02, sizeMax: 0.03 });
add('Gravity', 'sparkg', { acceleration: [0, -9, 0] });
add('Drag', 'sparkdrag', { coefficient: 0.8 });
add('GroundCollision', 'sparkfloor', { mode: 'bounce', restitution: 0.35, friction: 0.4 });
add('Material', 'sparkmat', { template: 'RibbonUnlit', blend: 'additive', tint: col('#FFB8F0'), emission: 1 });
add('ParticleTrail', 'sparktrail', { history: 0.09, width: 0.016, endFade: 0.35 });
wire('node-target.out', 'sparks.anchor'); wire('impact.start', 'sparks.trigger'); wire('sparks.particles', 'sparkip.particles');
wire('sparkip.particles', 'sparkg.particles'); wire('sparkg.particles', 'sparkdrag.particles'); wire('sparkdrag.particles', 'sparkfloor.particles');
wire('sparkfloor.particles', 'sparktrail.particles'); wire('sparkmat.material', 'sparktrail.material'); out('sparktrail');

// ── 6 LIGHT, FLASH, SHAKE ────────────────────────────────────────────────────────────────────────
add('Schedule', 'srclightwin', { startTicks: 0, durationTicks: FIRE + 8, mode: 'window' });
add('PointLight', 'srclight', { color: col('#B070FF'), intensity: 20, range: 4.5, flicker: 0.25,
  intensityOverWindow: curve([[0, 0.06], [0.8, 0.6], [0.88, 1], [1, 0]]) });
wire('node-source.out', 'srclight.anchor'); wire('srclightwin.window', 'srclight.window'); out('srclight');
add('PointLight', 'hitlight', { color: col('#FF5CE0'), intensity: 70, range: 7, flicker: 0.2,
  intensityOverWindow: curve([[0, 1], [0.08, 0.6], [0.3, 0.18], [1, 0]]) });
wire('floor.out', 'hitlight.anchor'); wire('impact.window', 'hitlight.window'); out('hitlight');
add('ScreenFlash', 'flash', { color: col('#F2D8FF'), alpha: 0.15, durationTicks: 5 });
add('CameraImpulse', 'shake', { durationTicks: 10, translation: 0.05, rotation: 0.01 });
wire('impact.start', 'flash.trigger'); wire('impact.start', 'shake.trigger');
wire('flash.presentation', 'node-output.presentation'); wire('shake.presentation', 'node-output.presentation');

// ── 7 RESIDUE ────────────────────────────────────────────────────────────────────────────────────
add('Schedule', 'residue', { startTicks: IMPACT + 10, durationTicks: END - IMPACT - 10, mode: 'window' });
add('RadialPath', 'arcs', { mode: 'sphere', count: 7, lengthMin: 0.25, lengthMax: 0.85 });
add('JaggedPath', 'arcjag', { amplitude: 0.08, regenerationHz: 18, samples: 8 });
wire('node-target.out', 'arcs.center'); wire('arcs.paths', 'arcjag.paths');
const resEnv = envelope('res', 'residue.window', 1.6, 11, 0.15);
ribbon('arcglow', 'arcjag.paths', 'residue.window', { color: VIOLET, width: 0.06, drive: resEnv, driveScale: 0.4 });
ribbon('arcline', 'arcjag.paths', 'residue.window', { color: '#F0C8FF', width: 0.014, emission: 0.4, drive: resEnv, driveScale: 0.9 });

S.push(['vfx_compile', { docId: DOC }]);
S.push(['vfx_render_frames', { docId: DOC, ticks: [30, 44, 50, 70, 120] }]);
writeFileSync('mcp/examples/arcane-lance.steps.json', JSON.stringify(S, null, 1) + '\n');
console.log(`wrote mcp/examples/arcane-lance.steps.json (${S.length} steps)`);
