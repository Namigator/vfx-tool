// Writes mcp/examples/force-lance.steps.json: "Force Lance", a thrown, lance-shaped energy projectile (no sprites).
// The lance is a short MotionTrail (LAG ticks of history) behind a PathFollower on the Source→Target line, drawn
// with a spear-shaped Width over trail: it stretches out of the hand on release, flies rigid, and plunges into
// Target tip first. Two spiralled trails (MotionTrail Spiral) wrap strands around it, closed at the tip. Layers, in breakdown order:
//   1 charge   gyroscope rings + inward streaks at Source
//   2 lance    spear-shaped core/inner/outer/halo ribbons
//   3 helix    two strands spiralling around the lance, closed at the tip
//   4 trail    motion-trail ribbons + ribbon sparks shed backwards along the flight
//   5 impact   floor shockwaves, ray burst, ribbon sparks
//   6 light    hand glow, travelling light, impact light, flash, shake
//   7 residue  crackling arcs fading at Target
// Usage: node tools/make-force-lance-recipe.mjs   (then node tools/build-components.mjs)
import { writeFileSync } from 'node:fs';
import { recipe } from './recipe-kit.mjs';

const DOC = 'flance';
const { S, add, wire, out, curve, col, ribbon, envelope } = recipe(DOC);
const T = 60, sec = t => t / T;
const Q_X90 = [0.7071068, 0, 0, 0.7071068], Q_Z90 = [0, 0, 0.7071068, 0.7071068], Q_Y90 = [0, 0.7071068, 0, 0.7071068];
const VIOLET = '#8A3CFF', MAGENTA = '#FF4FD8', CYAN = '#B89CFF', WHITE = '#FFF6FF';
const STRAND = '#D2A8FF';   // light purple helix strands (owner: cyan -> more purplish)

// Timeline (ticks). FLIGHT = head travel time; LAG = lance length in ticks of travel.
const CHARGE = 34, THROW = 34, FLIGHT = 26, LAG = 7, END = 170;
const HIT = THROW + FLIGHT;

S.push(['vfx_new_document', { template: 'blank', id: DOC }]);
S.push(['vfx_set_document', { docId: DOC, durationTicks: END, seed: 23 }]);
S.push(['vfx_set_anchor', { docId: DOC, anchorId: 'source', position: [-4.5, 1.5, 0] }]);
S.push(['vfx_set_anchor', { docId: DOC, anchorId: 'target', position: [4.2, 0.6, 0] }]);
add('OffsetAnchor', 'floor', { offset: [0, 0, 0], dropToGround: true }); wire('node-target.out', 'floor.anchor');

// ── 1 CHARGE ─────────────────────────────────────────────────────────────────────────────────────
add('Schedule', 'charge', { startTicks: 0, durationTicks: CHARGE + 2, mode: 'window' });
const grow = [[0, 0.04], [0.8, 0.4], [0.95, 0.46], [1, 0.1]];
for (const [i, q, c, w] of [[0, Q_X90, VIOLET, 0.026], [1, Q_Z90, MAGENTA, 0.02], [2, [0, 0, 0, 1], CYAN, 0.016], [3, Q_Y90, VIOLET, 0.012]]) {
  add('Material', `gyro${i}mat`, { template: 'RibbonUnlit', blend: 'additive', tint: col(c), emission: 0.6, opacity: 0.9 });
  add('RingRenderer', `gyro${i}`, { radius: curve(grow.map(([x, y]) => [x, y * (1 - i * 0.12)])), width: w, orientation: q, segments: 64 });
  wire('node-source.out', `gyro${i}.anchor`); wire(`gyro${i}mat.material`, `gyro${i}.material`); wire('charge.window', `gyro${i}.window`); out(`gyro${i}`);
}
add('Emitter', 'motes', { shape: 'sphere', radius: 1.6, burst: 0, rate: 150, speedMin: 0, speedMax: 0.3, lifetimeMin: 0.35, lifetimeMax: 0.6,
  rateOverWindow: curve([[0, 0.3], [0.8, 1], [1, 0]]) });
add('InitialProperties', 'moteip', { sizeMin: 0.02, sizeMax: 0.04 });
add('Attract', 'pull', { acceleration: 26, softRadius: 0.2, killRadius: 0.12 });
add('Material', 'motemat', { template: 'RibbonUnlit', blend: 'additive', tint: col('#D8A8FF'), emission: 0.8 });
add('ParticleTrail', 'motetrail', { history: 0.12, width: 0.014, endFade: 0.4 });
wire('node-source.out', 'motes.anchor'); wire('charge.window', 'motes.window'); wire('motes.particles', 'moteip.particles');
wire('moteip.particles', 'pull.particles'); wire('node-source.out', 'pull.anchor'); wire('pull.particles', 'motetrail.particles');
wire('motemat.material', 'motetrail.material'); out('motetrail');

// ── 2 LANCE ──────────────────────────────────────────────────────────────────────────────────────
// The lance is a short MotionTrail behind the flying head with a spear-shaped Width over trail: it grows out of the
// hand on release, flies rigid along the trajectory, and slides into Target after the head arrives (tip first).
add('LinePath', 'line', { samples: 2 }); wire('node-source.out', 'line.start'); wire('node-target.out', 'line.end');
add('Schedule', 'headwin', { startTicks: THROW, durationTicks: FLIGHT + 1, mode: 'window' });
add('PathFollower', 'head', { durationTicks: FLIGHT, easing: 'linear' });
wire('line.paths', 'head.paths'); wire('headwin.window', 'head.window');
add('Schedule', 'flight', { startTicks: THROW, durationTicks: FLIGHT + LAG + 2, mode: 'window' });
const LANCE_S = sec(LAG);
// Spear silhouette along tail(0) → head(1): thin butt, long shaft, broad blade, sharp tip.
const spear = curve([[0, 0.05], [0.08, 0.2], [0.62, 0.26], [0.7, 0.55], [0.8, 1], [0.9, 0.6], [1, 0]]);
function lanceLayer(id, color, width, opacity, emission = 0) {
  add('Material', `${id}mat`, { template: 'RibbonUnlit', blend: 'additive', tint: col(color), opacity, emission });
  add('MotionTrail', id, { history: LANCE_S, maxPoints: 32, width, endFade: 0, widthOverTrail: spear });
  wire('head.anchor', `${id}.anchor`); wire(`${id}mat.material`, `${id}.material`); wire('flight.window', `${id}.window`); out(id);
}
lanceLayer('lancehalo', '#3A0E8A', 1.1, 0.1);
lanceLayer('lanceouter', VIOLET, 0.75, 0.5);
lanceLayer('lanceinner', MAGENTA, 0.36, 0.5, 0);
lanceLayer('lancecore', '#F4E8FF', 0.11, 0.55, 0);

// ── 3 HELIX ──────────────────────────────────────────────────────────────────────────────────────
// Two strands that spiral around the lance itself (MotionTrail Spiral): closed onto the tip, circling wider toward
// the middle and back, spinning as it flies.
const helixOpen = curve([[0, 0.75], [0.4, 1], [0.75, 0.55], [1, 0]]);
for (const [i, phase] of [[0, 0], [1, Math.PI]]) {
  add('Material', `hx${i}mat`, { template: 'RibbonUnlit', blend: 'additive', tint: col(STRAND), opacity: 0.95, emission: 0.5 });
  add('MotionTrail', `hx${i}line`, { history: LANCE_S, maxPoints: 32, width: 0.02, endFade: 0.25,
    spiralRadius: 0.17, spiralTurns: 1.75, spiralSpin: 18, spiralPhase: phase, spiralRadiusOverTrail: helixOpen });
  wire('head.anchor', `hx${i}line.anchor`); wire(`hx${i}mat.material`, `hx${i}line.material`); wire('flight.window', `hx${i}line.window`); out(`hx${i}line`);
}

// ── 4 TRAIL ──────────────────────────────────────────────────────────────────────────────────────
add('Material', 'wakemat', { template: 'RibbonUnlit', blend: 'additive', tint: col(VIOLET), opacity: 0.4, emission: 0.2 });
add('MotionTrail', 'wake', { history: 0.3, width: 0.2, endFade: 0.5, widthOverTrail: curve([[0, 0], [0.7, 0.6], [1, 1]]) });
wire('head.anchor', 'wake.anchor'); wire('wakemat.material', 'wake.material'); wire('flight.window', 'wake.window'); out('wake');
add('Emitter', 'shed', { shape: 'cone', coneAngle: 0.35, radius: 0.05, rate: 260, burst: 0, speedMin: 2, speedMax: 6, lifetimeMin: 0.15, lifetimeMax: 0.35,
  axisMode: 'motionBackward', rateOverWindow: curve([[0, 0], [0.15, 1], [1, 1]]) });
add('InitialProperties', 'shedip', { sizeMin: 0.02, sizeMax: 0.03 });
add('Drag', 'sheddrag', { coefficient: 3 });
add('Material', 'shedmat', { template: 'RibbonUnlit', blend: 'additive', tint: col('#E8B8FF'), emission: 0.8 });
add('ParticleTrail', 'shedtrail', { history: 0.06, width: 0.012, endFade: 0.4 });
wire('head.anchor', 'shed.anchor'); wire('headwin.window', 'shed.window'); wire('shed.particles', 'shedip.particles');
wire('shedip.particles', 'sheddrag.particles'); wire('sheddrag.particles', 'shedtrail.particles'); wire('shedmat.material', 'shedtrail.material'); out('shedtrail');

// ── 5 IMPACT ─────────────────────────────────────────────────────────────────────────────────────
add('Schedule', 'impact', { startTicks: HIT, durationTicks: 90, mode: 'window' });
for (const [i, c, delay, maxR, w] of [[0, MAGENTA, 0, 2.2, 0.06], [1, CYAN, 6, 1.6, 0.035], [2, VIOLET, 12, 2.8, 0.08]]) {
  const t0 = sec(HIT + delay);
  add('RingPath', `wave${i}`, { radius: maxR, samples: 96 });
  add('EffectTimeCurve', `wave${i}r`, { curve: curve([[t0, 0.02], [t0 + 0.35, 0.6], [t0 + 1.1, 1]], 'effectSeconds') });
  add('EffectTimeCurve', `wave${i}a`, { curve: curve([[t0 - 0.001, 0], [t0, 0.85], [t0 + 0.4, 0.3], [t0 + 1.1, 0]], 'effectSeconds') });
  wire('floor.out', `wave${i}.center`); wire(`wave${i}r.value`, `wave${i}.radiusScale`);
  ribbon(`wave${i}rib`, `wave${i}.paths`, 'impact.window', { color: c, width: w, emission: 0.3, opacityFrom: `wave${i}a.value`, endFade: 0 });
}
add('Schedule', 'raywin', { startTicks: HIT, durationTicks: 26, mode: 'window' });
add('RadialPath', 'rays', { mode: 'cone', count: 22, lengthMin: 0.7, lengthMax: 2.6, coneAngle: 0.75 });
add('JaggedPath', 'rayjag', { amplitude: 0.05, regenerationHz: 30, samples: 10 });
wire('node-target.out', 'rays.center'); wire('rays.paths', 'rayjag.paths');
const rayEnv = envelope('ray', 'raywin.window', 7, 35, 0.6);
const fadeOut = curve([[0, 1], [1, 0.1]]);
ribbon('rayglow', 'rayjag.paths', 'raywin.window', { color: MAGENTA, width: 0.09, drive: rayEnv, driveScale: 0.4, widthOverPath: fadeOut });
ribbon('rayline', 'rayjag.paths', 'raywin.window', { color: WHITE, width: 0.022, emission: 0.5, drive: rayEnv, driveScale: 1, widthOverPath: fadeOut });
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
add('Schedule', 'handwin', { startTicks: 0, durationTicks: THROW + 6, mode: 'window' });
add('PointLight', 'handlight', { color: col('#B070FF'), intensity: 20, range: 4.5, flicker: 0.25, intensityOverWindow: curve([[0, 0.06], [0.82, 0.6], [0.86, 1], [1, 0]]) });
wire('node-source.out', 'handlight.anchor'); wire('handwin.window', 'handlight.window'); out('handlight');
add('PointLight', 'lancelight', { color: col('#D060FF'), intensity: 14, range: 4, flicker: 0.15 });
wire('head.anchor', 'lancelight.anchor'); wire('headwin.window', 'lancelight.window'); out('lancelight');
add('PointLight', 'hitlight', { color: col('#FF5CE0'), intensity: 70, range: 7, flicker: 0.2, intensityOverWindow: curve([[0, 1], [0.08, 0.6], [0.3, 0.18], [1, 0]]) });
wire('floor.out', 'hitlight.anchor'); wire('impact.window', 'hitlight.window'); out('hitlight');
add('ScreenFlash', 'flash', { color: col('#F2D8FF'), alpha: 0.15, durationTicks: 5 });
add('CameraImpulse', 'shake', { durationTicks: 10, translation: 0.05, rotation: 0.01 });
wire('impact.start', 'flash.trigger'); wire('impact.start', 'shake.trigger');
wire('flash.presentation', 'node-output.presentation'); wire('shake.presentation', 'node-output.presentation');

// ── 7 RESIDUE ────────────────────────────────────────────────────────────────────────────────────
add('Schedule', 'residue', { startTicks: HIT + 10, durationTicks: END - HIT - 10, mode: 'window' });
add('RadialPath', 'arcs', { mode: 'sphere', count: 7, lengthMin: 0.25, lengthMax: 0.85 });
add('JaggedPath', 'arcjag', { amplitude: 0.08, regenerationHz: 18, samples: 8 });
wire('node-target.out', 'arcs.center'); wire('arcs.paths', 'arcjag.paths');
const resEnv = envelope('res', 'residue.window', 1.6, 11, 0.15);
ribbon('arcglow', 'arcjag.paths', 'residue.window', { color: VIOLET, width: 0.06, drive: resEnv, driveScale: 0.4 });
ribbon('arcline', 'arcjag.paths', 'residue.window', { color: '#F0C8FF', width: 0.014, emission: 0.4, drive: resEnv, driveScale: 0.9 });

S.push(['vfx_compile', { docId: DOC }]);
S.push(['vfx_render_frames', { docId: DOC, ticks: [25, 40, 48, 56, 80] }]);
writeFileSync('mcp/examples/force-lance.steps.json', JSON.stringify(S, null, 1) + '\n');
console.log(`wrote mcp/examples/force-lance.steps.json (${S.length} steps)`);
