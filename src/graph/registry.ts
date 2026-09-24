// First production node registry (05-NODE-CATALOG.md, 09-MATERIALS.md, 25-INTERFACE-CONTRACTS.md,
// WP01C-WORKER-CONTRACT.md). Metadata only: no compile functions, workload estimates or help examples
// yet (WP02). Pure: no DOM, React or Three dependencies. Keys are `${type}@${definitionVersion}`.
//
// Deliberate omissions (not filled with inert placeholders):
// - Emitter: box extents, path sampling policy and shape orientation are not declared in the catalog
//   with bounds; they are left out until specified.
// - Material: only the SpriteUnlit template; texture slots, UV settings, color gradient, opacity curve,
//   dissolve, rim, softIntersection, faceMode, depthTest and distortion are not registered yet.
// - BillboardRenderer: size multiplier, envelope and world-axis vector are not registered yet; worldAxis is not renderable in this slice.
// - Group/GroupInput/GroupOutput ports are per-instance (interface-derived), so none are static here.
// - Capability identifiers are empty: the vocabulary is defined with the renderer.
import type { EvaluationDomain, NodeSpec, ParameterSpec, PortSpec } from '../model/types.ts';
import { TICKS_PER_SECOND, MAX_DURATION_TICKS } from '../model/types.ts';

export const REGISTRY_DEFINITION_VERSION = 1;
export const MATERIAL_TEMPLATES = ['SpriteUnlit'];

const CONST: EvaluationDomain[] = ['constant'];
const ONE_TICK_SECONDS = 1 / TICKS_PER_SECOND;

type P = Omit<ParameterSpec, 'domains' | 'editPolicy' | 'description'> &
  Partial<Pick<ParameterSpec, 'domains' | 'editPolicy' | 'description'>>;

const param = (p: P): ParameterSpec => ({
  domains: [...CONST], editPolicy: 'resample', description: '', ...p,
});

const port = (p: Omit<PortSpec, 'cardinality' | 'required'> & Partial<Pick<PortSpec, 'cardinality' | 'required'>>): PortSpec =>
  ({ cardinality: 'one', required: false, ...p });

const node = (type: string, s: Omit<NodeSpec, 'type' | 'definitionVersion' | 'capabilities'>): NodeSpec =>
  ({ type, definitionVersion: REGISTRY_DEFINITION_VERSION, capabilities: [], ...s });

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
    inputs: [],
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
    ],
    outputs: [port({ id: 'particles', label: 'Particles', type: 'particles' })],
    parameters: [
      param({ id: 'shape', label: 'Shape', type: 'enum', unit: 'none', default: 'point', choices: ['point', 'cone', 'sphere', 'disc', 'box', 'path'] }),
      param({ id: 'burst', label: 'Burst', type: 'integer', unit: 'none', default: 32, min: 0, max: 4096, step: 1, description: 'Particles per trigger event.' }),
      param({ id: 'rate', label: 'Rate', type: 'number', unit: 'perSecond', default: 0, min: 0, max: 4096, description: 'Continuous particles per second while the window is open.' }),
      param({ id: 'lifetimeMin', label: 'Lifetime min', type: 'number', unit: 'second', default: 0.6, min: ONE_TICK_SECONDS, max: 10, description: 'Authored in seconds; simulation converts to ticks.' }),
      param({ id: 'lifetimeMax', label: 'Lifetime max', type: 'number', unit: 'second', default: 1.2, min: ONE_TICK_SECONDS, max: 10, description: 'Authored in seconds; simulation converts to ticks.' }),
      param({ id: 'radius', label: 'Radius', type: 'number', unit: 'meter', default: 0.2, min: 0, max: 20 }),
      param({ id: 'coneAngle', label: 'Cone angle', type: 'number', unit: 'radian', default: Math.PI / 9, min: 0, max: Math.PI }),
      param({ id: 'speedMin', label: 'Speed min', type: 'number', unit: 'metersPerSecond', default: 1, min: 0, max: 100 }),
      param({ id: 'speedMax', label: 'Speed max', type: 'number', unit: 'metersPerSecond', default: 3, min: 0, max: 100 }),
      param({ id: 'direction', label: 'Direction', type: 'vec3', unit: 'none', default: [1, 0, 0], min: -1, max: 1, description: 'Spread direction; normalized at compile time.' }),
      param({ id: 'space', label: 'Space', type: 'enum', unit: 'none', default: 'world', choices: ['world', 'local'] }),
      param({ id: 'useEventPosition', label: 'Use event position', type: 'boolean', unit: 'none', default: true }),
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

function material(): NodeSpec {
  const signal: EvaluationDomain[] = ['constant', 'effectTime', 'normalizedAge'];
  return node('Material', {
    inputs: [],
    outputs: [port({ id: 'material', label: 'Material', type: 'material' })],
    parameters: [
      param({ id: 'template', label: 'Template', type: 'enum', unit: 'none', default: 'SpriteUnlit', choices: [...MATERIAL_TEMPLATES], description: 'Only SpriteUnlit is registered; it needs no texture asset.' }),
      param({ id: 'blend', label: 'Blend', type: 'enum', unit: 'none', default: 'additive', choices: ['normal', 'additive', 'cutout'] }),
      param({ id: 'tint', label: 'Tint', type: 'color', unit: 'none', default: white(), domains: [...signal], editPolicy: 'live' }),
      param({ id: 'opacity', label: 'Opacity', type: 'number', unit: 'normalized', default: 1, min: 0, max: 1, domains: [...signal], editPolicy: 'live' }),
      param({ id: 'emission', label: 'Emission', type: 'number', unit: 'linearGain', default: 0, min: 0, max: 20, domains: [...signal], editPolicy: 'live' }),
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
    parameters: [],
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
    anchor(), schedule(), emitter(), initialProperties(), material(), billboardRenderer(),
    effectOutput(), group(), bridge('GroupInput'), bridge('GroupOutput'),
  ];
  return new Map(specs.map(s => [`${s.type}@${s.definitionVersion}`, s]));
}
