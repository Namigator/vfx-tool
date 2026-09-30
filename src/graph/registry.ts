// First production node registry (05-NODE-CATALOG.md, 09-MATERIALS.md, 25-INTERFACE-CONTRACTS.md,
// WP01C-WORKER-CONTRACT.md). Metadata only: no compile functions, workload estimates or help examples
// yet (WP02). Pure: no DOM, React or Three dependencies. Keys are `${type}@${definitionVersion}`.
//
// Deliberate omissions (not filled with inert placeholders):
// - Emitter: box extents, path sampling policy and shape orientation are not declared in the catalog
//   with bounds; they are left out until specified.
// - Material: only the SpriteUnlit template; texture slots, UV settings, color gradient, opacity curve,
//   dissolve, rim, softIntersection, faceMode, depthTest and distortion are not registered yet.
// - BillboardRenderer: envelope and world-axis vector are not registered yet; worldAxis is not renderable in this slice.
// - Group/GroupInput/GroupOutput ports are per-instance (interface-derived), so none are static here.
// - Path nodes: HelixPath, PathFollower, PathTransform and ParticlePaths are not registered yet;
//   RibbonRenderer envelope is not registered yet (same as BillboardRenderer).
// - Capability identifiers are empty: the vocabulary is defined with the renderer.
import { NODE_PORTABILITY } from './portability.ts';
import { MATERIAL_TEMPLATE_IDS } from './materialSprite.ts';
import type { EvaluationDomain, NodeSpec, ParameterSpec, PortSpec } from '../model/types.ts';
import { TICKS_PER_SECOND, MAX_DURATION_TICKS } from '../model/types.ts';
import { BUILTIN_SPRITES } from '../assets/builtinSprites.generated.ts';

export const REGISTRY_DEFINITION_VERSION = 1;
export const MATERIAL_TEMPLATES = [...MATERIAL_TEMPLATE_IDS];

const CONST: EvaluationDomain[] = ['constant'];
const ONE_TICK_SECONDS = 1 / TICKS_PER_SECOND;

type P = Omit<ParameterSpec, 'domains' | 'editPolicy' | 'description'> &
  Partial<Pick<ParameterSpec, 'domains' | 'editPolicy' | 'description'>>;

const param = (p: P): ParameterSpec => ({
  domains: [...CONST], editPolicy: 'resample', description: '', ...p,
});

const port = (p: Omit<PortSpec, 'cardinality' | 'required'> & Partial<Pick<PortSpec, 'cardinality' | 'required'>>): PortSpec =>
  ({ cardinality: 'one', required: false, ...p });

/** 16: every node declares its capabilities and portability class (src/graph/portability.ts). */
const node = (type: string, s: Omit<NodeSpec, 'type' | 'definitionVersion' | 'capabilities'>): NodeSpec =>
  ({ type, definitionVersion: REGISTRY_DEFINITION_VERSION, capabilities: [`portability:${NODE_PORTABILITY[type]?.class ?? 'approximation'}`, ...(NODE_PORTABILITY[type]?.capabilities ?? [])], ...s });

const white = () => ({ srgb: '#FFFFFF', alpha: 1 });

function anchor(): NodeSpec {
  return node('Anchor', {
    inputs: [],
    outputs: [port({ id: 'out', label: 'Anchor', type: 'anchor' })],
    parameters: [
      param({ id: 'anchorId', label: 'Anchor', type: 'string', unit: 'none', default: 'source', description: 'Document anchor ID (source, target or a custom anchor).' }),
    ],
    // Value provider: consumers fall back to their literal/default or report a missing input.
    disabledBehavior: 'fallback',
  });
}

function schedule(): NodeSpec {
  return node('Schedule', {
    // Optional trigger: the window starts at that event's tick + Start (e.g. a splash at a stream's arrival).
    inputs: [port({ id: 'trigger', label: 'Trigger', type: 'event' })],
    outputs: [
      port({ id: 'start', label: 'Start', type: 'event' }),
      port({ id: 'end', label: 'End', type: 'event' }),
      port({ id: 'window', label: 'Window', type: 'timeWindow' }),
    ],
    parameters: [
      param({ id: 'startTicks', label: 'Start', type: 'integer', unit: 'tick', default: 0, min: 0, max: MAX_DURATION_TICKS, step: 1 }),
      param({ id: 'durationTicks', label: 'Duration', type: 'integer', unit: 'tick', default: 60, min: 1, max: MAX_DURATION_TICKS, step: 1 }),
      param({ id: 'mode', label: 'Mode', type: 'enum', unit: 'none', default: 'once', choices: ['once', 'window', 'repeat'] }),
      param({ id: 'repeatIntervalTicks', label: 'Repeat interval', type: 'integer', unit: 'tick', default: 60, min: 1, max: MAX_DURATION_TICKS, step: 1, description: 'Used only in repeat mode.' }),
      param({ id: 'repeatCount', label: 'Repeat count', type: 'integer', unit: 'none', default: 1, min: 1, max: 128, step: 1, description: 'Used only in repeat mode.' }),
    ],
    disabledBehavior: 'empty',
  });
}

function emitter(): NodeSpec {
  return node('Emitter', {
    inputs: [
      port({ id: 'anchor', label: 'Anchor', type: 'anchor' }),
      port({ id: 'paths', label: 'Paths', type: 'paths' }),
      port({ id: 'trigger', label: 'Trigger', type: 'event', cardinality: 'many' }),
      port({ id: 'window', label: 'Window', type: 'timeWindow' }),
      port({ id: 'aim', label: 'Aim', type: 'anchor' }),
    ],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      param({ id: 'shape', label: 'Shape', type: 'enum', unit: 'none', default: 'point', choices: ['point', 'cone', 'sphere', 'disc', 'box', 'path'] }),
      param({ id: 'burst', label: 'Burst', type: 'integer', unit: 'none', default: 32, min: 0, max: 4096, step: 1, description: 'Particles per trigger event (needs the Trigger input). For continuous emission only, set Burst to 0 and use Rate with a Window.' }),
      param({ id: 'rate', label: 'Rate', type: 'number', unit: 'perSecond', default: 0, min: 0, max: 4096, description: 'Continuous particles per second while the window is open.' }),
      param({ id: 'rateOverWindow', label: 'Rate over window', type: 'curve', unit: 'none', curveDomain: 'normalized', default: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }, min: 0, max: 4, description: 'Rate multiplier across the emission window (0 = window start, 1 = end): ramps, pulses, tails.' }),
      param({ id: 'lifetimeMin', label: 'Lifetime min', type: 'number', unit: 'second', default: 0.6, min: ONE_TICK_SECONDS, max: 10, description: 'Authored in seconds; simulation converts to ticks.' }),
      param({ id: 'lifetimeMax', label: 'Lifetime max', type: 'number', unit: 'second', default: 1.2, min: ONE_TICK_SECONDS, max: 10, description: 'Authored in seconds; simulation converts to ticks.' }),
      param({ id: 'radius', label: 'Radius', type: 'number', unit: 'meter', default: 0.2, min: 0, max: 20 }),
      param({ id: 'coneAngle', label: 'Cone angle', type: 'number', unit: 'radian', default: Math.PI / 9, min: 0, max: Math.PI, description: 'Cone shape: half-angle of the spread around the emit axis (the Aim direction when Aim is connected, else Direction). 0 = a straight line, π/2 = a hemisphere. Particles start on a disc of Radius across the axis.' }),
      param({ id: 'speedMin', label: 'Speed min', type: 'number', unit: 'metersPerSecond', default: 1, min: 0, max: 100 }),
      param({ id: 'speedMax', label: 'Speed max', type: 'number', unit: 'metersPerSecond', default: 3, min: 0, max: 100 }),
      param({ id: 'direction', label: 'Direction', type: 'vec3', unit: 'none', default: [1, 0, 0], min: -1, max: 1, description: 'Spread direction (local +X axis); normalized at compile time. Ignored when the Aim input is connected.' }),
      param({ id: 'space', label: 'Space', type: 'enum', unit: 'none', default: 'world', choices: ['world', 'local'], description: 'world only for now (local is reserved); the emit axis always follows Aim/Direction.' }),
      param({ id: 'useEventPosition', label: 'Use event position', type: 'boolean', unit: 'none', default: true }),
      param({ id: 'inheritVelocity', label: 'Inherit velocity', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1, description: 'Particle-event triggers only: fraction of the parent particle velocity added to each child (e.g. debris carried along by a moving spark).' }),
    ],
    disabledBehavior: 'empty',
  });
}

function initialProperties(): NodeSpec {
  return node('InitialProperties', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      param({ id: 'sizeMin', label: 'Size min', type: 'number', unit: 'meter', default: 0.08, min: 0.001, max: 20 }),
      param({ id: 'sizeMax', label: 'Size max', type: 'number', unit: 'meter', default: 0.16, min: 0.001, max: 20 }),
      param({ id: 'rotationMin', label: 'Rotation min', type: 'number', unit: 'radian', default: 0, min: -2 * Math.PI, max: 2 * Math.PI }),
      param({ id: 'rotationMax', label: 'Rotation max', type: 'number', unit: 'radian', default: 2 * Math.PI, min: -2 * Math.PI, max: 2 * Math.PI }),
      // Provisional bound +/-20 rad/s pending full catalog tuning. No radians-per-second unit exists; perSecond with radians stated in the description.
      param({ id: 'angularVelocityMin', label: 'Angular velocity min', type: 'number', unit: 'perSecond', default: -20, min: -20, max: 20, description: 'Radians per second.' }),
      param({ id: 'angularVelocityMax', label: 'Angular velocity max', type: 'number', unit: 'perSecond', default: 20, min: -20, max: 20, description: 'Radians per second.' }),
      param({ id: 'color', label: 'Color', type: 'color', unit: 'none', default: white() }),
      param({ id: 'randomFrameStart', label: 'Random frame start', type: 'boolean', unit: 'none', default: false }),
    ],
    // Modifier: passes particles through unchanged (emitter defaults apply).
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

// Force modifiers (05 "Gravity"/"Drag", 07 semi-implicit Euler). Pass-through particle modifiers;
// disabled acts as bypass. Accelerations are world-space meters/s² scaled by the effect transform scale.
function gravity(): NodeSpec {
  return node('Gravity', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      forceStrength(),
      param({ id: 'acceleration', label: 'Acceleration', type: 'vec3', unit: 'metersPerSecondSquared', default: [0, -9.81, 0], min: -100, max: 100, description: 'World-space acceleration in m/s². Positive Y gives buoyancy (rising smoke/flame).' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

function drag(): NodeSpec {
  return node('Drag', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      forceStrength(),
      param({ id: 'coefficient', label: 'Coefficient', type: 'number', unit: 'perSecond', default: 0.8, min: 0, max: 20, description: 'Exponential velocity damping: velocity *= exp(-coefficient·dt).' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

function noiseForce(): NodeSpec {
  return node('NoiseForce', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      forceStrength(),
      param({ id: 'amplitude', label: 'Amplitude', type: 'number', unit: 'metersPerSecondSquared', default: 1, min: 0, max: 100, description: 'Peak turbulent acceleration.' }),
      param({ id: 'frequency', label: 'Frequency', type: 'number', unit: 'perSecond', default: 1, min: 0.01, max: 20, description: 'Spatial frequency (cycles per meter); low values give broad coherent swirls.' }),
      param({ id: 'evolution', label: 'Evolution', type: 'number', unit: 'perSecond', default: 0.5, min: 0, max: 10, description: 'How fast the field changes over effect time; 0 freezes it.' }),
      param({ id: 'mode', label: 'Mode', type: 'enum', unit: 'none', default: 'curl', choices: ['vector', 'curl'], description: 'curl: swirling, divergence-free (smoke, flame); vector: independent push per axis.' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

function particleEvents(): NodeSpec {
  return node('ParticleEvents', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true })],
    outputs: [port({ id: 'birth', label: 'Birth', type: 'event' }), port({ id: 'death', label: 'Death', type: 'event' })],
    parameters: [
      param({ id: 'probability', label: 'Probability', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1, description: 'Chance each particle event is passed on (deterministic per particle).' }),
      param({ id: 'maxEvents', label: 'Max events', type: 'integer', unit: 'none', default: 256, min: 1, max: 1024, step: 1, description: 'Events after this many (in time order) are not passed on.' }),
    ],
    disabledBehavior: 'empty',
  });
}

function attract(): NodeSpec {
  return node('Attract', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true }), port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      forceStrength(),
      param({ id: 'acceleration', label: 'Acceleration', type: 'number', unit: 'metersPerSecondSquared', default: 2, min: 0, max: 100 }),
      param({ id: 'softRadius', label: 'Soft radius', type: 'number', unit: 'meter', default: 0.1, min: 0.01, max: 10, description: 'Pull fades smoothly inside this radius (no singularity at the centre).' }),
      param({ id: 'killRadius', label: 'Kill radius', type: 'number', unit: 'meter', default: 0, min: 0, max: 10, description: 'Particles reaching this distance die (0 = never): absorption / charge-up.' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

function vortex(): NodeSpec {
  return node('Vortex', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true }), port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      forceStrength(),
      param({ id: 'axis', label: 'Axis', type: 'vec3', unit: 'none', default: [0, 1, 0], min: -1, max: 1 }),
      param({ id: 'tangential', label: 'Tangential', type: 'number', unit: 'metersPerSecondSquared', default: 3, min: -100, max: 100, description: 'Swirl strength (sign sets the direction).' }),
      param({ id: 'inward', label: 'Inward', type: 'number', unit: 'metersPerSecondSquared', default: 1, min: -100, max: 100, description: 'Pull toward the axis (negative pushes out).' }),
      param({ id: 'falloff', label: 'Radius falloff', type: 'number', unit: 'meter', default: 1, min: 0.01, max: 20 }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

/** 05 RandomRange: one deterministic sample per cast (document seed + node stream), unit chosen per instance. */
function randomRange(): NodeSpec {
  return node('RandomRange', {
    inputs: [],
    outputs: [port({ id: 'value', label: 'Value', type: 'scalarSignal', unit: 'none', domains: ['constant'] })],
    parameters: [
      param({ id: 'min', label: 'Min', type: 'number', unit: 'none', default: 0, min: -10000, max: 10000 }),
      param({ id: 'max', label: 'Max', type: 'number', unit: 'none', default: 1, min: -10000, max: 10000 }),
      param({ id: 'unit', label: 'Unit', type: 'enum', unit: 'none', default: 'none', choices: ['none', 'meter', 'second', 'tick', 'radian', 'metersPerSecond', 'metersPerSecondSquared', 'hertz', 'perSecond', 'linearGain', 'normalized'], description: 'Output unit; must match the parameter it drives.' }),
    ],
    disabledBehavior: 'empty',
  });
}

/** 05 Constant: one literal value with a per-instance unit, so a single number can feed several parameters. */
function constantNode(): NodeSpec {
  return node('Constant', {
    inputs: [],
    outputs: [port({ id: 'value', label: 'Value', type: 'scalarSignal', unit: 'none', domains: ['constant'] })],
    parameters: [
      param({ id: 'value', label: 'Value', type: 'number', unit: 'none', default: 1, min: -10000, max: 10000 }),
      param({ id: 'unit', label: 'Unit', type: 'enum', unit: 'none', default: 'none', choices: ['none', 'meter', 'second', 'tick', 'radian', 'metersPerSecond', 'metersPerSecondSquared', 'hertz', 'perSecond', 'linearGain', 'normalized'], description: 'Output unit; must match the parameter it drives.' }),
    ],
    disabledBehavior: 'empty',
  });
}

/** 05 OverLife: size/opacity/colour/spin-speed over each particle's life for every renderer downstream (a renderer's own over-life settings win). */
function overLife(): NodeSpec {
  const lin = (keys: [number, number][]) => ({ domain: 'normalized' as const, interpolation: 'linear' as const, keys: keys.map(([x, y]) => ({ x, y })) });
  return node('OverLife', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      param({ id: 'sizeOverLife', label: 'Size over life', type: 'curve', unit: 'none', curveDomain: 'normalized', default: lin([[0, 1], [1, 1]]), min: 0, max: 20, editPolicy: 'live' }),
      param({ id: 'opacityOverLife', label: 'Opacity over life', type: 'curve', unit: 'normalized', curveDomain: 'normalized', default: lin([[0, 0], [0.1, 1], [1, 0]]), min: 0, max: 1, editPolicy: 'live', description: 'Default: fade in over the first 10% of life, fade out to the end.' }),
      param({ id: 'colorOverLife', label: 'Colour over life', type: 'gradient', unit: 'none', default: { stops: [{ position: 0, color: { srgb: '#FFFFFF', alpha: 1 } }, { position: 1, color: { srgb: '#FFFFFF', alpha: 1 } }] }, editPolicy: 'live' }),
      param({ id: 'spinOverLife', label: 'Spin speed over life', type: 'curve', unit: 'none', curveDomain: 'normalized', default: lin([[0, 1], [1, 1]]), min: 0, max: 10, editPolicy: 'live', description: 'Multiplies the angular velocity from InitialProperties across the life (e.g. fast then slowing).' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

/** 05 RingRenderer: a ring at an anchor whose radius follows a curve over its window (shockwaves, halos, ripples). */
function ringRenderer(): NodeSpec {
  return node('RingRenderer', {
    inputs: [
      port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true }),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
      port({ id: 'window', label: 'Window', type: 'timeWindow' }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'radius', label: 'Radius over window', type: 'curve', unit: 'meter', curveDomain: 'normalized', default: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, min: 0, max: 50, editPolicy: 'live', description: 'Ring radius in metres across the window (0 = window start, 1 = end).' }),
      param({ id: 'width', label: 'Width', type: 'number', unit: 'meter', default: 0.03, min: 0.001, max: 5, editPolicy: 'live' }),
      param({ id: 'orientation', label: 'Orientation', type: 'quaternion', unit: 'none', default: [0, 0, 0, 1], editPolicy: 'live', description: 'Rotation of the ring; identity lies flat on the ground (XZ plane).' }),
      param({ id: 'segments', label: 'Segments', type: 'integer', unit: 'none', default: 64, min: 8, max: 128, editPolicy: 'resample' }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -100, max: 100, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

/** 05 Curve: a reusable normalized curve (linear or hold, 2–16 keys) that can drive any curve parameter. */
function curveNode(): NodeSpec {
  return node('Curve', {
    inputs: [],
    outputs: [port({ id: 'curve', label: 'Curve', type: 'curveValue' })],
    parameters: [param({ id: 'curve', label: 'Curve', type: 'curve', unit: 'none', curveDomain: 'normalized', default: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }, min: -100, max: 100, editPolicy: 'live', description: 'Connect to any curve setting (size/opacity over life, rate over window, width over path...). The receiving setting still checks its own value range.' })],
    disabledBehavior: 'empty',
  });
}

/** 05 Gradient: a reusable colour ramp (2–8 stops, linear RGB) that can drive any gradient parameter. */
function gradientNode(): NodeSpec {
  return node('Gradient', {
    inputs: [],
    outputs: [port({ id: 'gradient', label: 'Gradient', type: 'gradientValue' })],
    parameters: [param({ id: 'gradient', label: 'Gradient', type: 'gradient', unit: 'none', default: { stops: [{ position: 0, color: { srgb: '#FFFFFF', alpha: 1 } }, { position: 1, color: { srgb: '#FFFFFF', alpha: 1 } }] }, editPolicy: 'live', description: 'Connect to any colour-over-life/window setting; one ramp can colour several parts.' })],
    disabledBehavior: 'empty',
  });
}

/** 05 ScalarMath: a (op) b. Evaluated once per cast from constants; over effect time when an operand is a time signal (Time, Oscillator, curve). */
function scalarMath(): NodeSpec {
  return node('ScalarMath', {
    inputs: [],
    outputs: [port({ id: 'value', label: 'Value', type: 'scalarSignal', unit: 'none', domains: ['constant'] })],
    parameters: [
      param({ id: 'operation', label: 'Operation', type: 'enum', unit: 'none', default: 'add', choices: ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'exp', 'power'], description: 'exp uses A only (clamped to ±20); power is A^B (negative A with fractional B gives 0).' }),
      param({ id: 'a', label: 'A', type: 'number', unit: 'none', default: 0, min: -10000, max: 10000, domains: ['constant', 'effectTime'] }),
      param({ id: 'b', label: 'B', type: 'number', unit: 'none', default: 1, min: -10000, max: 10000, domains: ['constant', 'effectTime'], description: 'Unitless for multiply/divide/exp/power; otherwise the same unit as A.' }),
      param({ id: 'unit', label: 'Unit', type: 'enum', unit: 'none', default: 'none', choices: ['none', 'meter', 'second', 'tick', 'radian', 'metersPerSecond', 'metersPerSecondSquared', 'hertz', 'perSecond', 'linearGain', 'normalized'], description: 'Unit of the output (and of A unless Input unit says otherwise).' }),
      param({ id: 'inputUnit', label: 'Input unit', type: 'enum', unit: 'none', default: 'same', choices: ['same', ...(['none', 'meter', 'second', 'tick', 'radian', 'metersPerSecond', 'metersPerSecondSquared', 'hertz', 'perSecond', 'linearGain', 'normalized'])], description: 'Unit of A when it differs from the output (e.g. seconds in, unitless out).' }),
    ],
    disabledBehavior: 'empty',
  });
}

/** 05 EventDelay: re-emits every incoming event a fixed number of ticks later (disabled = no delay). */
function eventDelay(): NodeSpec {
  return node('EventDelay', {
    inputs: [port({ id: 'events', label: 'Events', type: 'event', required: true })],
    outputs: [port({ id: 'event', label: 'Event', type: 'event' })],
    parameters: [param({ id: 'delayTicks', label: 'Delay', type: 'integer', unit: 'tick', default: 6, min: 0, max: 600, step: 1 })],
    disabledBehavior: 'bypass',
    bypass: { input: 'events', output: 'event' },
  });
}

/** 05 MergeEvents: one event stream from several sources (Schedule, PathFollower arrival, particle events). */
function mergeEvents(): NodeSpec {
  return node('MergeEvents', {
    inputs: [port({ id: 'events', label: 'Events', type: 'event', cardinality: 'many', required: true })],
    outputs: [port({ id: 'event', label: 'Event', type: 'event' })],
    parameters: [],
    disabledBehavior: 'empty',
  });
}

/** 05 force Strength: multiplies the force's magnitude; an EffectTimeCurve makes it ramp over effect time. */
function forceStrength(): ParameterSpec {
  return param({ id: 'strength', label: 'Strength', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1, domains: ['constant', 'effectTime'], editPolicy: 'live', description: 'Gain on this force (0..1); drive with an EffectTimeCurve to ramp it over time.' });
}

/** 05 OffsetAnchor: a fixed document-space offset from another anchor (chainable; disabled = pass-through). */
function offsetAnchor(): NodeSpec {
  return node('OffsetAnchor', {
    inputs: [port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true })],
    outputs: [port({ id: 'out', label: 'Out', type: 'anchor' })],
    parameters: [
      param({ id: 'offset', label: 'Offset', type: 'vec3', unit: 'meter', default: [0, 1, 0], min: -100, max: 100 }),
      param({ id: 'dropToGround', label: 'Drop to ground', type: 'boolean', unit: 'none', default: false, description: 'Follow the anchor sideways but sit on the ground (height = Offset Y). For ground rings, scorch marks and light pools under a moving Target.' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'anchor', output: 'out' },
  });
}

/** 05 PublicParameter: reads one numeric control declared in its own graph (25) as a value; unit = the control's. */
function publicParameter(): NodeSpec {
  return node('PublicParameter', {
    inputs: [],
    outputs: [port({ id: 'value', label: 'Value', type: 'scalarSignal', unit: 'none', domains: ['constant'] })],
    parameters: [param({ id: 'controlId', label: 'Control', type: 'string', unit: 'none', default: '', description: 'ID of a number/integer control whose scope is this graph (document controls panel / published knobs).' })],
    disabledBehavior: 'empty',
  });
}

/** 24 Time: effect seconds, seconds since its window started, and 0..1 progress through the window (clamped). */
function timeNode(): NodeSpec {
  return node('Time', {
    inputs: [port({ id: 'window', label: 'Window', type: 'timeWindow' })],
    outputs: [
      port({ id: 'effectSeconds', label: 'Effect seconds', type: 'scalarSignal', unit: 'second', domains: ['effectTime'] }),
      port({ id: 'localSeconds', label: 'Local seconds', type: 'scalarSignal', unit: 'second', domains: ['effectTime'] }),
      port({ id: 'progress', label: 'Progress', type: 'scalarSignal', unit: 'normalized', domains: ['effectTime'] }),
    ],
    parameters: [],
    disabledBehavior: 'empty',
  });
}

function groundCollision(): NodeSpec {
  return node('GroundCollision', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true })],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' }), port({ id: 'collision', label: 'Collision', type: 'event' })],
    parameters: [
      param({ id: 'mode', label: 'Mode', type: 'enum', unit: 'none', default: 'bounce', choices: ['kill', 'slide', 'bounce'], description: 'What happens when a particle reaches the ground plane y=0.' }),
      param({ id: 'restitution', label: 'Restitution', type: 'number', unit: 'normalized', default: 0.2, min: 0, max: 1, description: 'Fraction of vertical speed kept on each bounce.' }),
      param({ id: 'friction', label: 'Friction', type: 'number', unit: 'normalized', default: 0.5, min: 0, max: 1, description: 'Tangential speed lost per bounce; sliding deceleration friction·9.81 m/s².' }),
      param({ id: 'maxBounces', label: 'Max bounces', type: 'integer', unit: 'none', default: 2, min: 0, max: 8, step: 1, description: 'After this many bounces the particle slides.' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'particles', output: 'particles' },
  });
}

/**
 * PropMesh (A-05 gap: "no nozzle/prop"): one static mesh at an anchor over a window — a nozzle, staff, pedestal.
 * Its +Y axis points at `aim` when connected (the mesh's length runs along Y), otherwise stays upright.
 */
function propMesh(): NodeSpec {
  return node('PropMesh', {
    inputs: [
      port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true }),
      port({ id: 'aim', label: 'Aim at', type: 'anchor' }),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
      port({ id: 'window', label: 'Window', type: 'timeWindow', required: true }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'mesh', label: 'Mesh', type: 'enum', unit: 'none', default: 'cylinder', choices: ['shard', 'rock-a', 'rock-b', 'rock-c', 'orb', 'cone', 'crystal', 'crystal-b', 'cylinder', 'box', 'plane'], description: 'Included mesh, ≈1 m, length along its +Y axis.' }),
      param({ id: 'meshAsset', label: 'Mesh asset', type: 'string', unit: 'none', default: '', description: 'Imported GLB asset ID; replaces Mesh.' }),
      param({ id: 'importedSize', label: 'Imported size', type: 'enum', unit: 'none', default: 'fit', choices: ['fit', 'real'] }),
      param({ id: 'size', label: 'Width', type: 'number', unit: 'meter', default: 0.12, min: 0.001, max: 20, editPolicy: 'live' }),
      param({ id: 'length', label: 'Length', type: 'number', unit: 'meter', default: 0.6, min: 0.001, max: 50, editPolicy: 'live', description: 'Size along the aim direction (+Y).' }),
      param({ id: 'offset', label: 'Offset', type: 'vec3', unit: 'meter', default: [0, 0, 0], min: -50, max: 50, editPolicy: 'live', description: 'Shift from the anchor in world meters (e.g. put the nozzle behind the flame start).' }),
      param({ id: 'direction', label: 'Direction', type: 'vec3', unit: 'none', default: [0, 1, 0], min: -1, max: 1, editPolicy: 'live', description: 'World direction the mesh length (+Y) points in when Aim is not connected ([0,1,0] = upright, [0,0,1] = a crossbar); normalized.' }),
      param({ id: 'pivot', label: 'Pivot', type: 'enum', unit: 'none', default: 'end', choices: ['center', 'end', 'start'], description: 'Where the anchor sits along the mesh length. start: the mesh begins at the anchor and extends IN the pointing direction (a leg hanging down = Direction [0,-1,0], pivot start). end: the mesh ends at the anchor, body behind it (a nozzle whose muzzle is the anchor, aimed at the target). center: centred on the anchor.' }),
      param({ id: 'lit', label: 'Lit', type: 'boolean', unit: 'none', default: true }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -32, max: 32, step: 1, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

function spriteRenderer(): NodeSpec {
  const flat = () => ({ domain: 'normalized' as const, interpolation: 'linear' as const, keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] });
  return node('SpriteRenderer', {
    inputs: [
      port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true }),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
      port({ id: 'window', label: 'Window', type: 'timeWindow', required: true }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'size', label: 'Size', type: 'number', unit: 'meter', default: 0.5, min: 0.001, max: 20, editPolicy: 'live' }),
      param({ id: 'sizeOverWindow', label: 'Size over window', type: 'curve', unit: 'none', curveDomain: 'normalized', default: flat(), min: 0, max: 20, editPolicy: 'live', description: 'Size multiplier across the window (0 = window start, 1 = end).' }),
      param({ id: 'opacityOverWindow', label: 'Opacity over window', type: 'curve', unit: 'normalized', curveDomain: 'normalized', default: flat(), min: 0, max: 1, editPolicy: 'live' }),
      param({ id: 'colorOverWindow', label: 'Colour over window', type: 'gradient', unit: 'none', default: { stops: [{ position: 0, color: white() }, { position: 1, color: white() }] }, editPolicy: 'live' }),
      param({ id: 'rotation', label: 'Rotation', type: 'number', unit: 'radian', default: 0, min: -2 * Math.PI, max: 2 * Math.PI }),
      param({ id: 'spin', label: 'Spin', type: 'number', unit: 'perSecond', default: 0, min: -20, max: 20, description: 'Radians per second.' }),
      param({ id: 'alignment', label: 'Alignment', type: 'enum', unit: 'none', default: 'camera', choices: ['camera', 'worldAxis'], editPolicy: 'live', description: 'worldAxis lays the sprite in the plane facing World axis (flat on the ground by default): shockwaves, scorch marks.' }),
      param({ id: 'worldAxis', label: 'World axis', type: 'vec3', unit: 'none', default: [0, 1, 0], min: -1, max: 1, editPolicy: 'live' }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -32, max: 32, step: 1, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

function pointLight(): NodeSpec {
  return node('PointLight', {
    inputs: [
      port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true }),
      port({ id: 'window', label: 'Window', type: 'timeWindow', required: true }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'color', label: 'Colour', type: 'color', unit: 'none', default: white(), editPolicy: 'live' }),
      param({ id: 'intensity', label: 'Intensity', type: 'number', unit: 'linearGain', default: 20, min: 0, max: 100, editPolicy: 'live', description: 'Peak intensity (candela-like preview units).' }),
      param({ id: 'intensityOverWindow', label: 'Intensity over window', type: 'curve', unit: 'normalized', curveDomain: 'normalized', default: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 0.1, y: 1 }, { x: 1, y: 0 }] }, min: 0, max: 1, editPolicy: 'live' }),
      param({ id: 'range', label: 'Range', type: 'number', unit: 'meter', default: 5, min: 0.1, max: 50, editPolicy: 'live' }),
      param({ id: 'flicker', label: 'Flicker', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1, editPolicy: 'live', description: 'Depth of deterministic noise flicker (fire, electricity).' }),
      param({ id: 'flickerRate', label: 'Flicker rate', type: 'number', unit: 'hertz', default: 12, min: 0, max: 60, editPolicy: 'live' }),
      param({ id: 'recolorFrom', label: 'Recolour from', type: 'color', unit: 'none', default: { srgb: '#808080', alpha: 0 }, editPolicy: 'live', description: 'Per-part colour: the light representative colour, mapped onto Recolour to (hue, saturation and brightness). Alpha 0 = off.' }),
      param({ id: 'recolorTo', label: 'Recolour to', type: 'color', unit: 'none', default: { srgb: '#808080', alpha: 0 }, editPolicy: 'live', description: 'Per-part colour: what Recolour from becomes; every other colour of the light moves the same way.' }),
      param({ id: 'hueShift', label: 'Colour shift', type: 'number', unit: 'none', default: 0, min: -180, max: 180, editPolicy: 'live', description: 'Rotates the light colour around the colour wheel (degrees), so it follows a Colour shift knob with the materials.' }),
    ],
    disabledBehavior: 'empty',
  });
}

function pathFollower(): NodeSpec {
  return node('PathFollower', {
    inputs: [
      port({ id: 'paths', label: 'Paths', type: 'paths', required: true }),
      port({ id: 'window', label: 'Window', type: 'timeWindow', required: true }),
    ],
    outputs: [port({ id: 'anchor', label: 'Anchor', type: 'anchor' }), port({ id: 'arrival', label: 'Arrival', type: 'event' })],
    parameters: [
      param({ id: 'durationTicks', label: 'Travel ticks', type: 'integer', unit: 'tick', default: 30, min: 1, max: 600, step: 1, description: 'Ticks every path of the set takes from start to end; arrival fires then. Holds at the end until the window closes.' }),
      param({ id: 'easing', label: 'Easing', type: 'enum', unit: 'none', default: 'linear', choices: ['linear', 'easeIn', 'easeOut', 'easeInOut'] }),
      param({ id: 'speed', label: 'Speed', type: 'number', unit: 'metersPerSecond', default: 0, min: 0, max: 200, description: '0 = travel for Travel ticks. Above 0: travel ticks = path length ÷ speed (rounded to ticks, per path), so a farther Target, or a longer path, takes longer at the same speed.' }),
    ],
    disabledBehavior: 'empty',
  });
}

function meshRenderer(): NodeSpec {
  const flat = () => ({ domain: 'normalized' as const, interpolation: 'linear' as const, keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] });
  return node('MeshRenderer', {
    inputs: [
      port({ id: 'particles', label: 'Particles', type: 'particles', required: true }),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'meshAsset', label: 'Mesh asset', type: 'string', unit: 'none', default: '', description: 'Imported GLB asset ID (Import 3D model…); when set it replaces Mesh. See Imported size.' }),
      param({ id: 'importedSize', label: 'Imported size', type: 'enum', unit: 'none', default: 'fit', choices: ['fit', 'real'], description: 'fit: the imported model is fitted to ≈1 m like the included meshes. real: its true size (file units × the import scale chosen at import) in meters. Particle size × Scale multiplies either.' }),
      param({ id: 'mesh', label: 'Mesh', type: 'enum', unit: 'none', default: 'rock-a', choices: ['shard', 'rock-a', 'rock-b', 'rock-c', 'orb', 'cone', 'crystal', 'crystal-b', 'cylinder', 'box', 'plane'], description: 'Included procedural mesh (≈1 m across, scaled by particle size × Scale).' }),
      param({ id: 'scale', label: 'Scale', type: 'number', unit: 'none', default: 1, min: 0.01, max: 20, editPolicy: 'live' }),
      param({ id: 'scaleY', label: 'Height scale', type: 'number', unit: 'none', default: 1, min: 0.05, max: 20, editPolicy: 'live', description: 'Extra stretch along the mesh +Y (tall shards: height independent of width).' }),
      param({ id: 'pivot', label: 'Pivot', type: 'enum', unit: 'none', default: 'center', choices: ['center', 'base'], editPolicy: 'live', description: 'base: the mesh grows up from the particle position (grounded shards).' }),
      param({ id: 'tilt', label: 'Upright tilt', type: 'number', unit: 'radian', default: 0.2, min: 0, max: 1.2, editPolicy: 'live', description: 'Upright orientation: maximum random lean from vertical.' }),
      param({ id: 'orientation', label: 'Orientation', type: 'enum', unit: 'none', default: 'tumble', choices: ['tumble', 'velocity', 'upright'], editPolicy: 'live', description: 'tumble: random axis per particle, spun by InitialProperties rotation/angular velocity; velocity: +Y follows the velocity.' }),
      param({ id: 'lit', label: 'Lit', type: 'boolean', unit: 'none', default: true, editPolicy: 'live', description: 'Shaded by the preview lights (normal blend); additive meshes are always unlit.' }),
      param({ id: 'sizeOverLife', label: 'Size over life', type: 'curve', unit: 'none', curveDomain: 'normalized', default: flat(), min: 0, max: 20, editPolicy: 'live' }),
      param({ id: 'colorOverLife', label: 'Colour over life', type: 'gradient', unit: 'none', default: { stops: [{ position: 0, color: white() }, { position: 1, color: white() }] }, editPolicy: 'live' }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -32, max: 32, step: 1, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

function helixPathNode(): NodeSpec {
  return node('HelixPath', {
    inputs: [port({ id: 'start', label: 'Start', type: 'anchor', required: true }), port({ id: 'end', label: 'End', type: 'anchor', required: true })],
    outputs: [port({ id: 'paths', label: 'Paths', type: 'paths' })],
    parameters: [
      param({ id: 'radius', label: 'Radius', type: 'number', unit: 'meter', default: 0.5, min: 0, max: 20 }),
      param({ id: 'turns', label: 'Turns', type: 'number', unit: 'none', default: 2, min: -16, max: 16 }),
      param({ id: 'phase', label: 'Phase', type: 'number', unit: 'radian', default: 0, min: -2 * Math.PI, max: 2 * Math.PI }),
      param({ id: 'spin', label: 'Spin', type: 'number', unit: 'perSecond', default: 0, min: -20, max: 20, description: 'Radians per second the helix rotates over effect time.' }),
      param({ id: 'taper', label: 'Taper', type: 'enum', unit: 'none', default: 'none', choices: ['none', 'in', 'out', 'both'], description: 'Radius grows from 0 (in), shrinks to 0 (out) or swells in the middle (both).' }),
      param({ id: 'samples', label: 'Samples', type: 'integer', unit: 'none', default: 64, min: 4, max: 128, step: 1 }),
    ],
    disabledBehavior: 'empty',
  });
}

/** MergePaths: one path set from several (e.g. trunk + branches + forks) so shared ribbon layers draw them all; ids are prefixed per input. */
function mergePathsNode(): NodeSpec {
  return node('MergePaths', {
    inputs: [port({ id: 'paths', label: 'Paths', type: 'paths', cardinality: 'many', required: true })],
    outputs: [port({ id: 'paths', label: 'Paths', type: 'paths' })],
    parameters: [],
    disabledBehavior: 'empty',
  });
}

function pathTransformNode(): NodeSpec {
  return node('PathTransform', {
    inputs: [port({ id: 'paths', label: 'Paths', type: 'paths', required: true })],
    outputs: [port({ id: 'paths', label: 'Paths', type: 'paths' })],
    parameters: [
      param({ id: 'offset', label: 'Offset', type: 'vec3', unit: 'meter', default: [0, 0, 0], min: -100, max: 100 }),
      param({ id: 'rotation', label: 'Rotation', type: 'quaternion', unit: 'none', default: [0, 0, 0, 1], min: -1, max: 1, description: 'About each path\'s first point (xyzw).' }),
      param({ id: 'scale', label: 'Scale', type: 'number', unit: 'none', default: 1, min: 0.01, max: 20 }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'paths', output: 'paths' },
  });
}

/** PathSplitter: decides which paths of a set go on (`paths`) and which are left behind (`rest`); see runtime/pathSplit.ts. */
function pathSplitterNode(): NodeSpec {
  return node('PathSplitter', {
    inputs: [pathsIn()],
    outputs: [
      port({ id: 'paths', label: 'Chosen', type: 'paths' }),
      port({ id: 'rest', label: 'Rest', type: 'paths' }),
    ],
    parameters: [
      param({ id: 'mode', label: 'Mode', type: 'enum', unit: 'none', default: 'range', choices: ['range', 'everyNth', 'random', 'longest', 'shortest'], description: 'range: Count paths starting at From. everyNth: every Step-th path starting at Offset. random: Count paths picked at random (same pick every time; change the random stream of the node or the document seed for another pick). longest / shortest: the Count longest / shortest paths.' }),
      param({ id: 'from', label: 'From', type: 'integer', unit: 'none', default: 0, min: 0, max: 255, step: 1, description: 'range mode: index of the first chosen path (0 = the first path).' }),
      param({ id: 'count', label: 'Count', type: 'integer', unit: 'none', default: 1, min: 1, max: 256, step: 1, description: 'range, random, longest and shortest modes: how many paths go on.' }),
      param({ id: 'step', label: 'Step', type: 'integer', unit: 'none', default: 2, min: 1, max: 256, step: 1, description: 'everyNth mode: take every Step-th path (2 = every other one).' }),
      param({ id: 'offset', label: 'Offset', type: 'integer', unit: 'none', default: 0, min: 0, max: 255, step: 1, description: 'everyNth mode: index of the first chosen path.' }),
    ],
    // Disabled: every path goes on (the Rest output is empty).
    disabledBehavior: 'bypass',
    bypass: { input: 'paths', output: 'paths' },
  });
}

function motionTrail(): NodeSpec {
  return node('MotionTrail', {
    inputs: [
      port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true }),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
      port({ id: 'window', label: 'Window', type: 'timeWindow', required: true }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'history', label: 'History', type: 'number', unit: 'second', default: 0.25, min: ONE_TICK_SECONDS, max: 2 }),
      param({ id: 'maxPoints', label: 'Max points', type: 'integer', unit: 'none', default: 48, min: 2, max: 128, step: 1 }),
      param({ id: 'width', label: 'Width', type: 'number', unit: 'meter', default: 0.12, min: 0.001, max: 5, editPolicy: 'live' }),
      param({ id: 'endFade', label: 'End fade', type: 'number', unit: 'normalized', default: 0.35, min: 0, max: 0.5, editPolicy: 'live' }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -32, max: 32, step: 1, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

function screenFlash(): NodeSpec {
  return node('ScreenFlash', {
    inputs: [port({ id: 'trigger', label: 'Trigger', type: 'event', cardinality: 'many' })],
    outputs: [port({ id: 'presentation', label: 'Presentation', type: 'presentation' })],
    parameters: [
      param({ id: 'color', label: 'Colour', type: 'color', unit: 'none', default: white(), editPolicy: 'live' }),
      param({ id: 'alpha', label: 'Alpha', type: 'number', unit: 'normalized', default: 0.12, min: 0, max: 0.15, editPolicy: 'live', description: 'Peak overlay opacity (bounded; suppressed by reduced motion).' }),
      param({ id: 'durationTicks', label: 'Duration', type: 'integer', unit: 'tick', default: 3, min: 1, max: 60, step: 1 }),
    ],
    disabledBehavior: 'empty',
  });
}

function cameraImpulse(): NodeSpec {
  return node('CameraImpulse', {
    inputs: [port({ id: 'trigger', label: 'Trigger', type: 'event', cardinality: 'many' })],
    outputs: [port({ id: 'presentation', label: 'Presentation', type: 'presentation' })],
    parameters: [
      param({ id: 'durationTicks', label: 'Duration', type: 'integer', unit: 'tick', default: 6, min: 1, max: 60, step: 1 }),
      param({ id: 'translation', label: 'Translation', type: 'number', unit: 'meter', default: 0.05, min: 0, max: 0.05, description: 'Peak camera shake offset (bounded; suppressed by reduced motion).' }),
      param({ id: 'rotation', label: 'Rotation', type: 'number', unit: 'radian', default: 0.01, min: 0, max: 0.01 }),
    ],
    disabledBehavior: 'empty',
  });
}

/** 25 ParticlePaths: paths from an anchor to up to maxCount live particles (stable selection by particle ID), e.g. charge tethers. */
function particlePathsNode(): NodeSpec {
  return node('ParticlePaths', {
    inputs: [port({ id: 'particles', label: 'Particles', type: 'particles', required: true }), port({ id: 'anchor', label: 'Anchor', type: 'anchor', required: true })],
    outputs: [port({ id: 'paths', label: 'Paths', type: 'paths' })],
    parameters: [
      param({ id: 'maxCount', label: 'Max count', type: 'integer', unit: 'none', default: 4, min: 1, max: 128, step: 1 }),
      param({ id: 'direction', label: 'Direction', type: 'enum', unit: 'none', default: 'anchorToParticle', choices: ['anchorToParticle', 'particleToAnchor'] }),
      param({ id: 'samples', label: 'Samples', type: 'integer', unit: 'none', default: 16, min: 2, max: 128, step: 1, description: 'Points per path (more lets JaggedPath displace it).' }),
    ],
    disabledBehavior: 'empty',
  });
}

function particleTrail(): NodeSpec {
  return node('ParticleTrail', {
    inputs: [
      port({ id: 'particles', label: 'Particles', type: 'particles', required: true }),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'history', label: 'History', type: 'number', unit: 'second', default: 0.15, min: ONE_TICK_SECONDS, max: 2, description: 'How far back each trail reaches; trails keep fading this long after their particle dies. Trails are untextured ribbons: give them their own Material with template SpriteUnlit (a SpriteTextured spark material is rejected).' }),
      param({ id: 'maxPoints', label: 'Max points', type: 'integer', unit: 'none', default: 32, min: 2, max: 128, step: 1 }),
      param({ id: 'width', label: 'Width', type: 'number', unit: 'meter', default: 0.015, min: 0.001, max: 2, editPolicy: 'live' }),
      param({ id: 'endFade', label: 'End fade', type: 'number', unit: 'normalized', default: 0.3, min: 0, max: 0.5, editPolicy: 'live', description: 'Fraction of the trail over which both ends taper.' }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -32, max: 32, step: 1, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

function material(): NodeSpec {
  const signal: EvaluationDomain[] = ['constant', 'effectTime', 'normalizedAge'];
  return node('Material', {
    inputs: [],
    outputs: [port({ id: 'material', label: 'Material', type: 'material' })],
    parameters: [
      param({ id: 'template', label: 'Template', type: 'enum', unit: 'none', default: 'SpriteUnlit', choices: [...MATERIAL_TEMPLATES], description: 'SpriteUnlit: soft disc. SpriteTextured: a library/imported sprite or flipbook. RibbonUnlit: plain strips. MeshLit: lit PBR meshes. SurfaceTranslucent: water/ice-like (normal blend, liquid shading, reflection, optional refraction). DarkVolumeSprite: dark textured smoke (no emission; edge tint = rim colour).' }),
      param({ id: 'textureAsset', label: 'Texture asset', type: 'string', unit: 'none', default: '', description: 'Imported texture/flipbook asset ID (Import texture…); when set it replaces Sprite. Empty = use the included library sprite.' }),
      param({ id: 'normalAsset', label: 'Normal map', type: 'string', unit: 'none', default: '', description: 'Lit meshes: an imported texture with role Normal adds fine surface relief (tangent-space, uses the mesh UVs). Empty = none.' }),
      param({ id: 'noiseAsset', label: 'Noise texture', type: 'string', unit: 'none', default: '', description: 'An imported texture with role Noise replaces the included dissolve noise (billboard dissolve pattern). Empty = included noise.' }),
      param({ id: 'sprite', label: 'Sprite', type: 'enum', unit: 'none', default: 'soft-glow', choices: BUILTIN_SPRITES.map(s => s.id), description: 'Included library sheet (SpriteTextured only). Flipbooks animate; variant sets pick one cell per particle.' }),
      param({ id: 'variant', label: 'Variant', type: 'integer', unit: 'none', default: -1, min: -1, max: 255, step: 1, description: 'Variant/mask sheets: -1 picks a random cell per particle; otherwise this fixed cell (row-major).' }),
      param({ id: 'blend', label: 'Blend', type: 'enum', unit: 'none', default: 'additive', choices: ['normal', 'additive', 'cutout'] }),
      param({ id: 'tint', label: 'Tint', type: 'color', unit: 'none', default: white(), domains: [...signal], editPolicy: 'live' }),
      param({ id: 'opacity', label: 'Opacity', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1, domains: [...signal], editPolicy: 'live' }),
      param({ id: 'emission', label: 'Emission', type: 'number', unit: 'linearGain', default: 0, min: 0, max: 20, domains: [...signal], editPolicy: 'live' }),
      param({ id: 'uvScroll', label: 'UV scroll', type: 'vec2', unit: 'none', default: [0, 0], min: -10, max: 10, editPolicy: 'live', description: 'Texture flow in UV units per second of effect time (x along a ribbon, y across). Textured ribbons and textured billboards.' }),
      param({ id: 'uvTiling', label: 'UV tiling', type: 'vec2', unit: 'none', default: [1, 1], min: 0.01, max: 32, editPolicy: 'live', description: 'Texture repeats per sprite (09). Textured billboards.' }),
      param({ id: 'uvOffset', label: 'UV offset', type: 'vec2', unit: 'none', default: [0, 0], min: -1, max: 1, editPolicy: 'live', description: 'Texture shift in UV units. Textured billboards.' }),
      param({ id: 'uvRotation', label: 'UV rotation', type: 'number', unit: 'radian', default: 0, min: -6.2832, max: 6.2832, editPolicy: 'live', description: 'Texture rotation about the sprite centre (radians). Textured billboards.' }),
      param({ id: 'uvDistort', label: 'UV distortion', type: 'number', unit: 'normalized', default: 0, min: 0, max: 0.15, editPolicy: 'live', description: 'Noise wobble of the texture lookup (09: 0–.15 normalized UV). Textured ribbons.' }),
      param({ id: 'roughness', label: 'Roughness', type: 'number', unit: 'normalized', default: 0.75, min: 0.04, max: 1, editPolicy: 'live', description: 'Lit meshes: low = glossy facets (ice ≈ .18).' }),
      param({ id: 'metalness', label: 'Metalness', type: 'number', unit: 'normalized', default: 0.05, min: 0, max: 1, editPolicy: 'live', description: 'Lit meshes only.' }),
      param({ id: 'reflection', label: 'Reflection', type: 'number', unit: 'normalized', default: 0, min: 0, max: 3, editPolicy: 'live', description: 'Lit meshes: mirrors a soft studio sky, so glossy surfaces (low Roughness) shine. Ice about 1.2, wet stone about .4, 0 = off.' }),
      param({ id: 'surfaceDetail', label: 'Surface detail', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1, editPolicy: 'live', description: 'Lit meshes: procedural bumps, grain and patchy roughness on the surface. Stone about .7, ice about .3, 0 = smooth.' }),
      param({ id: 'detailScale', label: 'Detail scale', type: 'number', unit: 'none', default: 4, min: 0.5, max: 30, editPolicy: 'live', description: 'Size of the surface detail: higher = finer grain.' }),
      param({ id: 'recolorFrom', label: 'Recolour from', type: 'color', unit: 'none', default: { srgb: '#808080', alpha: 0 }, editPolicy: 'live', description: 'Per-part colour: the material representative colour, mapped onto Recolour to (hue, saturation and brightness). Alpha 0 = off.' }),
      param({ id: 'recolorTo', label: 'Recolour to', type: 'color', unit: 'none', default: { srgb: '#808080', alpha: 0 }, editPolicy: 'live', description: 'Per-part colour: what Recolour from becomes; every other colour of the material moves the same way.' }),
      param({ id: 'hueShift', label: 'Colour shift', type: 'number', unit: 'none', default: 0, min: -180, max: 180, editPolicy: 'live', description: 'Rotates every colour this material draws (tint, colour over life and the colours baked into the texture) around the colour wheel: 180 turns orange fire blue, 120 green. Brightness is kept. 0 = unchanged. (degrees)' }),
      param({ id: 'liquid', label: 'Liquid', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1, editPolicy: 'live', description: 'Ribbons: a clear liquid look. The middle turns see-through, the edges catch light and highlights run along the flow. Use a pale Tint with Blend normal. Water about .85, 0 = solid colour.' }),
      param({ id: 'colorVariation', label: 'Colour variation', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1, editPolicy: 'live', description: 'Meshes: every piece gets a slightly different shade and hue (natural stone, crystal clusters). 0 = all identical.' }),
      param({ id: 'rim', label: 'Rim glow', type: 'number', unit: 'linearGain', default: 0, min: 0, max: 8, editPolicy: 'live', description: 'Meshes: glow on edges seen side-on (fresnel), e.g. energy shells or backlit ice. Billboards: a radial glow toward the sprite edge (a flat sprite has no useful normal). 0 = off.' }),
      param({ id: 'rimColor', label: 'Rim colour', type: 'color', unit: 'none', default: white(), editPolicy: 'live' }),
      param({ id: 'rimPower', label: 'Rim sharpness', type: 'number', unit: 'none', default: 3, min: 0.5, max: 8, editPolicy: 'live', description: 'Higher = thinner rim hugging the silhouette.' }),
      param({ id: 'dissolve', label: 'Dissolve', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1, editPolicy: 'live', description: 'How far each particle burns away through a noise pattern by the end of its life (09 dissolve; 1 = fully gone). 0 = off. Billboards only.' }),
      param({ id: 'dissolveStart', label: 'Dissolve start', type: 'number', unit: 'normalized', default: 0.3, min: 0, max: 0.95, editPolicy: 'live', description: 'Fraction of the particle life before dissolving begins.' }),
      param({ id: 'dissolveSoftness', label: 'Dissolve softness', type: 'number', unit: 'normalized', default: 0.08, min: 0.001, max: 0.5, editPolicy: 'live' }),
      param({ id: 'dissolveEdge', label: 'Dissolve edge width', type: 'number', unit: 'normalized', default: 0, min: 0, max: 0.25, editPolicy: 'live', description: 'Width of a glowing band on the burning edge (0 = none).' }),
      param({ id: 'dissolveEdgeColor', label: 'Dissolve edge colour', type: 'color', unit: 'none', default: { srgb: '#FFB040', alpha: 1 }, editPolicy: 'live' }),
      param({ id: 'groundFade', label: 'Ground fade', type: 'number', unit: 'meter', default: 0, min: 0, max: 2, editPolicy: 'live', description: 'Sprites fade out over this height above the floor (y = 0) instead of being cut by it (08 analytic ground fade). 0 = off.' }),
      param({ id: 'faceMode', label: 'Faces', type: 'enum', unit: 'none', default: 'front', choices: ['front', 'back', 'double'], editPolicy: 'live', description: 'Meshes: which faces are drawn (double for thin open shapes). Camera-facing sprites and ribbons always face the camera.' }),
      param({ id: 'depthTest', label: 'Depth test', type: 'boolean', unit: 'none', default: true, editPolicy: 'live', description: 'Off: always drawn on top of solid objects (UI-like glows).' }),
      param({ id: 'refraction', label: 'Refraction', type: 'number', unit: 'none', default: 0, min: 0, max: 8, editPolicy: 'live', description: 'Enhancement: bends what is behind (pixels at 1080p). Previewed on lit meshes (ice, glass); sprites and ribbons show a notice instead.' }),
      param({ id: 'alphaCutoff', label: 'Alpha cutoff', type: 'number', unit: 'normalized', default: 0.5, min: 0, max: 1, editPolicy: 'live', description: 'Cutout blend only.' }),
    ],
    disabledBehavior: 'fallback',
  });
}

function billboardRenderer(): NodeSpec {
  return node('BillboardRenderer', {
    inputs: [
      port({ id: 'particles', label: 'Particles', type: 'particles', required: true }),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'alignment', label: 'Alignment', type: 'enum', unit: 'none', default: 'camera', choices: ['camera', 'velocity', 'worldAxis'], editPolicy: 'live' }),
      param({ id: 'stretchRatio', label: 'Stretch ratio', type: 'number', unit: 'none', default: 1, min: 1, max: 20, editPolicy: 'live' }),
      param({ id: 'softIntersection', label: 'Soft intersection', type: 'boolean', unit: 'none', default: false, editPolicy: 'live' }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -32, max: 32, step: 1, editPolicy: 'live' }),
      // Life curves: x is the particle's normalized age; constant only (no driven curve yet).
      param({
        id: 'sizeOverLife', label: 'Size over life', type: 'curve', unit: 'none', curveDomain: 'normalized',
        default: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
        min: 0, max: 20, editPolicy: 'live', description: 'Size multiplier over normalized particle age.',
      }),
      param({
        id: 'opacityOverLife', label: 'Opacity over life', type: 'curve', unit: 'normalized', curveDomain: 'normalized',
        default: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
        min: 0, max: 1, editPolicy: 'live', description: 'Opacity multiplier over normalized particle age.',
      }),
      param({
        id: 'colorOverLife', label: 'Colour over life', type: 'gradient', unit: 'none',
        default: { stops: [{ position: 0, color: white() }, { position: 1, color: white() }] },
        editPolicy: 'live', description: 'Colour × alpha multiplier over normalized particle age (linear-RGB interpolation).',
      }),
      param({ id: 'worldAxis', label: 'World axis', type: 'vec3', unit: 'none', default: [0, 1, 0], min: -1, max: 1, editPolicy: 'live', description: 'worldAxis alignment: the quad faces this direction (default +Y = flat on the ground).' }),
      param({ id: 'flipbookMode', label: 'Flipbook', type: 'enum', unit: 'none', default: 'overLife', choices: ['overLife', 'fps', 'first'], editPolicy: 'live', description: 'overLife: play once over each particle life; fps: loop at Flipbook FPS; first: hold frame 0.' }),
      param({ id: 'flipbookLoop', label: 'Flipbook loop', type: 'boolean', unit: 'none', default: true, editPolicy: 'live', description: 'Frames-per-second mode: loop the sequence while the particle lives (off: hold the last frame).' }),
      param({ id: 'flipbookCrossfade', label: 'Flipbook crossfade', type: 'boolean', unit: 'none', default: false, editPolicy: 'live', description: 'Blend each frame into the next for smoother slow flipbooks (never samples outside the cell).' }),
      param({ id: 'flipbookFps', label: 'Flipbook FPS', type: 'number', unit: 'hertz', default: 24, min: 0, max: 60, editPolicy: 'live', description: 'Frames per second in fps mode.' }),
      param({ id: 'pivot', label: 'Pivot', type: 'number', unit: 'normalized', default: 0.5, min: 0, max: 1, editPolicy: 'live', description: 'Where the particle sits along the stretch axis: 0 = trailing end, 1 = leading tip.' }),
    ],
    disabledBehavior: 'empty',
  });
}

// Path nodes (05 "Paths and moving anchors", 25 port table, 24 BranchPath). Bounds mirror the pure
// runtime cores (runtime/paths.ts MIN/MAX_PATH_SAMPLES, runtime/branches.ts resolveBranchOptions);
// registry.ts does not import runtime so the graph layer stays independent of it.
const PATH_SAMPLES_MAX = 128;
const MAX_BRANCH_COUNT = 64;
/** Authoring bound for handle offsets, branch lengths and ground height (meters). */
const PATH_EXTENT_METERS = 20;

const samplesParam = (def: number) =>
  param({ id: 'samples', label: 'Samples', type: 'integer', unit: 'none', default: def, min: 2, max: PATH_SAMPLES_MAX, step: 1 });
const endpointInputs = () => [
  port({ id: 'start', label: 'Start', type: 'anchor', required: true }),
  port({ id: 'end', label: 'End', type: 'anchor', required: true }),
];
const pathsIn = () => port({ id: 'paths', label: 'Paths', type: 'paths', required: true });
const pathsOut = () => port({ id: 'paths', label: 'Paths', type: 'paths' });

function linePath(): NodeSpec {
  return node('LinePath', {
    inputs: endpointInputs(),
    outputs: [pathsOut()],
    parameters: [samplesParam(2)],
    disabledBehavior: 'empty',
  });
}

function bezierPath(): NodeSpec {
  const handle = (id: string, label: string) => param({
    id, label, type: 'vec3', unit: 'meter', default: [0, 1, 0], min: -PATH_EXTENT_METERS, max: PATH_EXTENT_METERS,
    description: 'World-space offset from the matching endpoint to its cubic control point.',
  });
  return node('BezierPath', {
    inputs: endpointInputs(),
    outputs: [pathsOut()],
    parameters: [handle('startHandle', 'Start handle'), handle('endHandle', 'End handle'), samplesParam(48)],
    disabledBehavior: 'empty',
  });
}

function jaggedPath(): NodeSpec {
  return node('JaggedPath', {
    inputs: [pathsIn()],
    outputs: [pathsOut()],
    parameters: [
      param({ id: 'amplitude', label: 'Amplitude', type: 'number', unit: 'meter', default: 0.3, min: 0, max: 10, description: 'Tapers to zero at both endpoints.' }),
      param({ id: 'regenerationHz', label: 'Regeneration', type: 'number', unit: 'hertz', default: 24, min: 0, max: 60, description: '0 keeps one stable shape.' }),
      samplesParam(42),
      param({ id: 'pinned', label: 'Pinned endpoints', type: 'boolean', unit: 'none', default: true }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'paths', output: 'paths' },
  });
}

function branchPath(): NodeSpec {
  const range = (id: string, label: string, unit: 'meter' | 'normalized', def: number, min: number, max: number) =>
    param({ id, label, type: 'number', unit, default: def, min, max });
  return node('BranchPath', {
    inputs: [pathsIn()],
    outputs: [
      port({ id: 'trunk', label: 'Trunk', type: 'paths' }),
      port({ id: 'branches', label: 'Branches', type: 'paths' }),
    ],
    parameters: [
      param({ id: 'count', label: 'Count', type: 'integer', unit: 'none', default: 14, min: 0, max: MAX_BRANCH_COUNT, step: 1 }),
      param({ id: 'countMode', label: 'Count mode', type: 'enum', unit: 'none', default: 'total', choices: ['total', 'perParent'] }),
      range('attachmentMin', 'Attachment min', 'normalized', 0.12, 0, 1),
      range('attachmentMax', 'Attachment max', 'normalized', 0.88, 0, 1),
      range('lengthMin', 'Length min', 'meter', 0.4, 0, PATH_EXTENT_METERS),
      range('lengthMax', 'Length max', 'meter', 1.8, 0, PATH_EXTENT_METERS),
      param({ id: 'spread', label: 'Spread', type: 'number', unit: 'radian', default: 1, min: 0, max: Math.PI }),
      range('widthMin', 'Width min', 'normalized', 0.2, 0, 1),
      range('widthMax', 'Width max', 'normalized', 0.4, 0, 1),
      range('opacityMin', 'Opacity min', 'normalized', 0.2, 0, 1),
      range('opacityMax', 'Opacity max', 'normalized', 0.48, 0, 1),
      param({ id: 'groundEndClamp', label: 'Ground end clamp', type: 'boolean', unit: 'none', default: false }),
      range('groundY', 'Ground height', 'meter', 0, -PATH_EXTENT_METERS, PATH_EXTENT_METERS),
    ],
    // Disabled: trunk passes through; the branches output is empty. Forks chain via another BranchPath.
    disabledBehavior: 'bypass',
    bypass: { input: 'paths', output: 'trunk' },
  });
}

function revealPath(): NodeSpec {
  return node('RevealPath', {
    inputs: [pathsIn()],
    outputs: [pathsOut()],
    parameters: [
      param({ id: 'fraction', label: 'Fraction', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1, domains: ['constant', 'effectTime'], description: 'Clips each path at this interpolated arc-length fraction.' }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'paths', output: 'paths' },
  });
}

// Generic effect-time driver: an authored effectSeconds curve sampled at effectTick / TICKS_PER_SECOND
// (linear/hold, endpoint clamp). Output is a normalized scalar; y outside [0,1] is an error, not clamped.
// Disabled: consumers fall back to their literal parameter.
function effectTimeCurve(): NodeSpec {
  return node('EffectTimeCurve', {
    inputs: [],
    outputs: [port({ id: 'value', label: 'Value', type: 'scalarSignal', unit: 'normalized', domains: ['effectTime'] })],
    parameters: [
      param({
        id: 'curve', label: 'Curve', type: 'curve', unit: 'normalized', curveDomain: 'effectSeconds',
        default: { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        min: 0, max: 1, description: 'Value over effect time in seconds; clamps to the first/last key outside the key range.',
      }),
    ],
    disabledBehavior: 'fallback',
  });
}

/** 05 Oscillator: periodic effect-time driver between min and max (starts at min); drives what EffectTimeCurve drives. */
function oscillator(): NodeSpec {
  return node('Oscillator', {
    inputs: [],
    outputs: [port({ id: 'value', label: 'Value', type: 'scalarSignal', unit: 'normalized', domains: ['effectTime'] })],
    parameters: [
      param({ id: 'waveform', label: 'Waveform', type: 'enum', unit: 'none', default: 'sine', choices: ['sine', 'triangle', 'square', 'saw'] }),
      param({ id: 'frequency', label: 'Frequency', type: 'number', unit: 'hertz', default: 2, min: 0.01, max: 60, description: 'Cycles per second of effect time (05: 0–60 Hz).' }),
      param({ id: 'min', label: 'Min', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1 }),
      param({ id: 'max', label: 'Max', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1 }),
      param({ id: 'phase', label: 'Phase', type: 'number', unit: 'normalized', default: 0, min: 0, max: 1, description: 'Cycle offset (0..1).' }),
      param({ id: 'unit', label: 'Unit', type: 'enum', unit: 'none', default: 'normalized', choices: ['normalized', 'none', 'linearGain'], description: 'Output unit (normalized for opacity/strength; none to feed ScalarMath B).' }),
    ],
    disabledBehavior: 'fallback',
  });
}

// Bounds mirror runtime/radial.ts (24 "Path features required by the presets"). The catalog states the
// cone angle in degrees (default 30°, [0,180°]); no degree unit exists, so it is stored in radians.
function radialPath(): NodeSpec {
  const len = (id: string, label: string, def: number) =>
    param({ id, label, type: 'number', unit: 'meter', default: def, min: 0.001, max: 50 });
  return node('RadialPath', {
    inputs: [
      port({ id: 'center', label: 'Center', type: 'anchor', required: true }),
      port({ id: 'window', label: 'Window', type: 'timeWindow' }),
    ],
    outputs: [pathsOut()],
    parameters: [
      param({ id: 'mode', label: 'Mode', type: 'enum', unit: 'none', default: 'sphere', choices: ['sphere', 'disc', 'cone'], description: 'Sphere/cone pole is local +Y; disc lies in local XZ.' }),
      param({ id: 'count', label: 'Count', type: 'integer', unit: 'none', default: 32, min: 1, max: 128, step: 1 }),
      len('lengthMin', 'Length min', 0.6),
      len('lengthMax', 'Length max', 2.4),
      param({ id: 'coneAngle', label: 'Cone angle', type: 'number', unit: 'radian', default: Math.PI / 6, min: 0, max: Math.PI, description: 'Half-angle from the axis. Cone mode only.' }),
      param({ id: 'orientation', label: 'Orientation', type: 'quaternion', unit: 'none', default: [0, 0, 0, 1], description: 'Rotates the local distribution frame (xyzw).' }),
    ],
    disabledBehavior: 'empty',
  });
}

// Proof-of-concept closed ring as a path (design e3bbd3e7); bounds mirror runtime/ring.ts.
// Actual radius = max(minRadius, radius * radiusScale); radiusScale may be driven by EffectTimeCurve.
function ringPath(): NodeSpec {
  return node('RingPath', {
    inputs: [port({ id: 'center', label: 'Center', type: 'anchor', required: true })],
    outputs: [pathsOut()],
    parameters: [
      param({ id: 'radius', label: 'Radius', type: 'number', unit: 'meter', default: 1, min: 0.001, max: 50 }),
      param({ id: 'minRadius', label: 'Min radius', type: 'number', unit: 'meter', default: 0, min: 0, max: 50, description: 'Lower bound of the actual radius.' }),
      param({ id: 'radiusScale', label: 'Radius scale', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1, domains: ['constant', 'effectTime'], description: 'Multiplies radius.' }),
      param({ id: 'samples', label: 'Samples', type: 'integer', unit: 'none', default: 64, min: 8, max: 256, step: 1 }),
      param({ id: 'orientation', label: 'Orientation', type: 'quaternion', unit: 'none', default: [0, 0, 0, 1], description: 'Rotates the local XZ ring (xyzw).' }),
    ],
    disabledBehavior: 'empty',
  });
}

function ribbonRenderer(): NodeSpec {
  return node('RibbonRenderer', {
    inputs: [
      pathsIn(),
      port({ id: 'material', label: 'Material', type: 'material', required: true }),
      // Optional: unconnected means the whole document window (25).
      port({ id: 'window', label: 'Window', type: 'timeWindow' }),
    ],
    outputs: [port({ id: 'visual', label: 'Visual', type: 'visual' })],
    parameters: [
      param({ id: 'width', label: 'Width', type: 'number', unit: 'meter', default: 0.04, min: 0.001, max: 10, editPolicy: 'live' }),
      param({
        id: 'widthOverPath', label: 'Width over path', type: 'curve', unit: 'normalized', curveDomain: 'normalized',
        default: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
        min: 0, max: 1, editPolicy: 'live', description: 'Width multiplier over path arc fraction.',
      }),
      param({
        id: 'endFade', label: 'End fade', type: 'number', unit: 'normalized', default: 0.12, min: 0, max: 0.5, editPolicy: 'live',
        description: 'Fraction of each path length over which both ends taper and fade out; 0 keeps full width to the ends.',
      }),
      param({ id: 'uvMode', label: 'UV mode', type: 'enum', unit: 'none', default: 'stretch', choices: ['stretch', 'tile'], editPolicy: 'live' }),
      param({ id: 'uvTileLength', label: 'UV tile length', type: 'number', unit: 'meter', default: 1, min: 0.01, max: 100, editPolicy: 'live', description: 'Tile mode only.' }),
      param({ id: 'orientation', label: 'Orientation', type: 'enum', unit: 'none', default: 'camera', choices: ['camera', 'parallelTransport'], editPolicy: 'live' }),
      param({ id: 'renderOrderOffset', label: 'Render order offset', type: 'integer', unit: 'none', default: 0, min: -32, max: 32, step: 1, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

// Audio nodes (11-AUDIO.md, 24 "Audio source definitions" + A2/A3, 25 port table). Bounds mirror the
// pure audio core (audio/synthesis.ts, audio/mix.ts) without importing it. Deliberately omitted until
// specified: AudioEnvelope (attack/hold/release curves have no units, bounds or curve shape), the Sample
// source (trim/loop bounds and asset parameter), oscillator frequency curve, noise band emphasis,
// AudioFilter (cutoff curve schema undecided). AudioMix per-input gain/pan live on EdgeDefinition.mix
// (WP04-AUDIO-MIX-CONTRACT). Noise seeding uses node.randomStreamId, not a parameter.
const AUDIO_MAX_OFFSET_TICKS = 36000;
const AUDIO_MAX_DURATION_TICKS = 600;
const AUDIO_MIN_SYNTH_HZ = 20;
const AUDIO_MAX_SYNTH_HZ = 16000;
const audioIn = () => port({ id: 'audio', label: 'Audio', type: 'audio', required: true });
const audioOut = () => port({ id: 'audio', label: 'Audio', type: 'audio' });

function audioSource(): NodeSpec {
  const hz = (id: string, label: string, def: number, description: string) => param({
    id, label, type: 'number', unit: 'hertz', default: def, min: AUDIO_MIN_SYNTH_HZ, max: AUDIO_MAX_SYNTH_HZ, description,
  });
  return node('AudioSource', {
    inputs: [
      port({ id: 'trigger', label: 'Trigger', type: 'event', cardinality: 'many' }),
      port({ id: 'window', label: 'Window', type: 'timeWindow' }),
    ],
    outputs: [audioOut()],
    parameters: [
      param({ id: 'source', label: 'Source', type: 'enum', unit: 'none', default: 'oscillator', choices: ['oscillator', 'noise', 'chirp'] }),
      param({ id: 'offsetTicks', label: 'Offset', type: 'integer', unit: 'tick', default: 0, min: 0, max: AUDIO_MAX_OFFSET_TICKS, step: 1, description: 'Delay after each cue.' }),
      param({ id: 'durationTicks', label: 'Duration', type: 'integer', unit: 'tick', default: 30, min: 1, max: AUDIO_MAX_DURATION_TICKS, step: 1 }),
      param({ id: 'gain', label: 'Gain', type: 'number', unit: 'linearGain', default: 1, min: 0, max: 2, editPolicy: 'live' }),
      param({ id: 'pitchRatio', label: 'Pitch ratio', type: 'number', unit: 'none', default: 1, min: 0.25, max: 4, description: 'Synthesized sources only: rendered frequency is min(f*ratio, 0.45*sampleRate); duration is unchanged.' }),
      param({ id: 'waveform', label: 'Waveform', type: 'enum', unit: 'none', default: 'sine', choices: ['sine', 'triangle', 'saw', 'pulse'], description: 'Oscillator only.' }),
      hz('frequencyHz', 'Frequency', 440, 'Oscillator only.'),
      param({ id: 'pulseDuty', label: 'Pulse duty', type: 'number', unit: 'normalized', default: 0.5, min: 0.05, max: 0.95, description: 'Pulse waveform only.' }),
      param({ id: 'noiseColor', label: 'Noise color', type: 'enum', unit: 'none', default: 'white', choices: ['white', 'pink', 'brown'], description: 'Noise only.' }),
      hz('chirpStartHz', 'Chirp start', 2000, 'Chirp only.'),
      hz('chirpEndHz', 'Chirp end', 200, 'Chirp only.'),
      param({ id: 'chirpSweep', label: 'Chirp sweep', type: 'enum', unit: 'none', default: 'exponential', choices: ['linear', 'exponential'], description: 'Chirp only.' }),
    ],
    disabledBehavior: 'empty',
  });
}

function audioOutput(): NodeSpec {
  return node('AudioOutput', {
    inputs: [audioIn()],
    outputs: [audioOut()],
    // Fixed limiter and render stats (24 A3); no authored controls.
    parameters: [],
    disabledBehavior: 'bypass',
    bypass: { input: 'audio', output: 'audio' },
  });
}

// Per-input gain/pan are stored on incoming edges (edge.mix), not as parameters. Disabled contributes
// nothing; bypass would be ambiguous with many inputs (WP04-AUDIO-MIX-CONTRACT §3).
function audioEnvelope(): NodeSpec {
  return node('AudioEnvelope', {
    inputs: [port({ id: 'audio', label: 'Audio', type: 'audio', required: true })],
    outputs: [port({ id: 'audio', label: 'Audio', type: 'audio' })],
    parameters: [
      param({ id: 'attack', label: 'Attack', type: 'number', unit: 'second', default: 0.01, min: 0, max: 10 }),
      param({ id: 'hold', label: 'Hold', type: 'number', unit: 'second', default: 0.1, min: 0, max: 10 }),
      param({ id: 'release', label: 'Release', type: 'number', unit: 'second', default: 0.3, min: 0, max: 10 }),
      param({ id: 'curve', label: 'Release curve', type: 'enum', unit: 'none', default: 'exponential', choices: ['linear', 'exponential'] }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'audio', output: 'audio' },
  });
}

function audioFilter(): NodeSpec {
  return node('AudioFilter', {
    inputs: [port({ id: 'audio', label: 'Audio', type: 'audio', required: true })],
    outputs: [port({ id: 'audio', label: 'Audio', type: 'audio' })],
    parameters: [
      param({ id: 'mode', label: 'Mode', type: 'enum', unit: 'none', default: 'lowpass', choices: ['lowpass', 'highpass', 'bandpass'] }),
      param({ id: 'cutoffHz', label: 'Cutoff', type: 'number', unit: 'hertz', default: 1000, min: 20, max: 20000 }),
      param({ id: 'cutoffEndHz', label: 'Cutoff at end', type: 'number', unit: 'hertz', default: 1000, min: 20, max: 20000, description: 'Cutoff sweeps (log frequency) from Cutoff to this over the voice: whooshes, closing rumbles.' }),
      param({ id: 'q', label: 'Q', type: 'number', unit: 'none', default: 0.707, min: 0.1, max: 20 }),
    ],
    disabledBehavior: 'bypass',
    bypass: { input: 'audio', output: 'audio' },
  });
}

function audioMix(): NodeSpec {
  return node('AudioMix', {
    inputs: [port({ id: 'inputs', label: 'Inputs', type: 'audio', cardinality: 'many' })],
    outputs: [audioOut()],
    parameters: [
      param({ id: 'masterGain', label: 'Master gain', type: 'number', unit: 'linearGain', default: 1, min: 0, max: 1, step: 0.01, editPolicy: 'live' }),
    ],
    disabledBehavior: 'empty',
  });
}

function effectOutput(): NodeSpec {
  return node('EffectOutput', {
    inputs: [
      port({ id: 'visual', label: 'Visual', type: 'visual', cardinality: 'many' }),
      port({ id: 'audio', label: 'Audio', type: 'audio', cardinality: 'many' }),
      port({ id: 'presentation', label: 'Presentation', type: 'presentation', cardinality: 'many' }),
    ],
    outputs: [],
    // 08 glow (bloom) of this effect: A-05 gap — many overlapping additive layers bloomed into a halo that
    // hid the flame shapes and nothing could tame it. Defaults are the 08 values.
    parameters: [
      param({ id: 'glowStrength', label: 'Glow strength', type: 'number', unit: 'none', default: 0.8, min: 0, max: 3, editPolicy: 'live', description: 'How strong the bloom halo around bright parts is (0 = no glow).' }),
      param({ id: 'glowRadius', label: 'Glow radius', type: 'number', unit: 'normalized', default: 0.45, min: 0, max: 1, editPolicy: 'live', description: 'How far the halo spreads (lower = tighter glow hugging the shapes).' }),
      param({ id: 'glowThreshold', label: 'Glow threshold', type: 'number', unit: 'none', default: 1, min: 0, max: 8, editPolicy: 'live', description: 'Brightness above which things glow.' }),
      param({ id: 'glowLimit', label: 'Glow limit', type: 'number', unit: 'none', default: 3, min: 0, max: 50, editPolicy: 'live', description: 'Caps how bright any spot counts for the glow, so many overlapping additive sprites do not flood the frame with a halo (0 = no cap; lower = tighter).' }),
    ],
    disabledBehavior: 'protected',
  });
}

function group(): NodeSpec {
  return node('Group', {
    inputs: [], outputs: [],
    parameters: [
      param({ id: 'graphId', label: 'Graph', type: 'string', unit: 'none', default: '', description: 'Structural embedded-graph reference; not bindable or connectable.' }),
    ],
    disabledBehavior: 'empty',
  });
}

function bridge(type: 'GroupInput' | 'GroupOutput'): NodeSpec {
  return node(type, {
    inputs: [], outputs: [],
    parameters: [
      param({ id: 'portId', label: 'Port', type: 'string', unit: 'none', default: '', description: 'Structural interface port ID; not bindable or connectable.' }),
    ],
    disabledBehavior: 'protected',
  });
}

/** Fresh, independent registry each call. */
export function createRegistry(): Map<string, NodeSpec> {
  const specs = [
    anchor(), schedule(), emitter(), initialProperties(), gravity(), drag(), noiseForce(), attract(), vortex(), groundCollision(), randomRange(), constantNode(), overLife(), ringRenderer(), curveNode(), gradientNode(), scalarMath(), publicParameter(), offsetAnchor(), eventDelay(), mergeEvents(), particleEvents(), material(), billboardRenderer(), particleTrail(), motionTrail(), meshRenderer(), propMesh(), spriteRenderer(), pointLight(), pathFollower(), screenFlash(), cameraImpulse(),
    linePath(), bezierPath(), helixPathNode(), pathTransformNode(), pathSplitterNode(), mergePathsNode(), particlePathsNode(), jaggedPath(), branchPath(), revealPath(), radialPath(), ringPath(), ribbonRenderer(), effectTimeCurve(), oscillator(), timeNode(),
    audioSource(), audioEnvelope(), audioFilter(), audioMix(), audioOutput(),
    effectOutput(), group(), bridge('GroupInput'), bridge('GroupOutput'),
  ];
  return new Map(specs.map(s => [`${s.type}@${s.definitionVersion}`, s]));
}
