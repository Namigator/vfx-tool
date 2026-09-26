// F01 minimum graph (22-CONFORMANCE-FIXTURES.md, WP01C-WORKER-CONTRACT.md). Structurally executable
// against createRegistry(); this is not simulation acceptance. Duration is 120 ticks so the particle's
// death at tick 60 (lifetime 1 s) is observable before the document ends.
import type { EffectDocumentV2 } from '../model/types.ts';

const edge = (id: string, sourceNode: string, sourcePort: string, targetNode: string, targetPort: string) =>
  ({ id, source: { nodeId: sourceNode, port: sourcePort }, target: { nodeId: targetNode, port: targetPort }, order: 0 });

export function createF01Document(): EffectDocumentV2 {
  return {
    format: 'vfx-studio',
    schemaVersion: 2,
    runtimeVersion: '2.0.0',
    id: 'doc-f01',
    name: 'F01 minimum graph',
    tags: ['fixture', 'F01'],
    seed: 42,
    rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 },
    anchors: [
      { id: 'source', name: 'Source', position: [0, 1, 0] },
      { id: 'target', name: 'Target', position: [0, 1, 5] },
    ],
    durationTicks: 120,
    rootGraphId: 'graph-root',
    graphs: [{
      id: 'graph-root',
      inputs: [],
      outputs: [],
      nodes: [
        { id: 'node-source', type: 'Anchor', definitionVersion: 1, label: 'Source', enabled: true, randomStreamId: 'rs-source', params: { anchorId: 'source' } },
        { id: 'node-target', type: 'Anchor', definitionVersion: 1, label: 'Target', enabled: true, randomStreamId: 'rs-target', params: { anchorId: 'target' } },
        { id: 'node-schedule', type: 'Schedule', definitionVersion: 1, label: 'Schedule', enabled: true, randomStreamId: 'rs-schedule', params: { startTicks: 0, durationTicks: 60, mode: 'once' } },
        {
          id: 'node-emitter', type: 'Emitter', definitionVersion: 1, label: 'Emitter', enabled: true, randomStreamId: 'rs-emitter',
          params: { shape: 'point', burst: 1, rate: 0, lifetimeMin: 1, lifetimeMax: 1, speedMin: 0, speedMax: 0 },
        },
        { id: 'node-initial', type: 'InitialProperties', definitionVersion: 1, label: 'Initial properties', enabled: true, randomStreamId: 'rs-initial', params: { sizeMin: 0.1, sizeMax: 0.1, rotationMin: 0, rotationMax: 0, angularVelocityMin: 0, angularVelocityMax: 0 } },
        { id: 'node-material', type: 'Material', definitionVersion: 1, label: 'Material', enabled: true, randomStreamId: 'rs-material', params: { template: 'SpriteUnlit' } },
        { id: 'node-billboard', type: 'BillboardRenderer', definitionVersion: 1, label: 'Billboard', enabled: true, randomStreamId: 'rs-billboard', params: {} },
        { id: 'node-output', type: 'EffectOutput', definitionVersion: 1, label: 'Output', enabled: true, randomStreamId: 'rs-output', params: {} },
      ],
      edges: [
        edge('edge-trigger', 'node-schedule', 'start', 'node-emitter', 'trigger'),
        edge('edge-anchor', 'node-source', 'out', 'node-emitter', 'anchor'),
        edge('edge-emit', 'node-emitter', 'particles', 'node-initial', 'particles'),
        edge('edge-initial', 'node-initial', 'particles', 'node-billboard', 'particles'),
        edge('edge-material', 'node-material', 'material', 'node-billboard', 'material'),
        edge('edge-visual', 'node-billboard', 'visual', 'node-output', 'visual'),
      ],
    }],
    controls: [],
    assets: [],
    editor: {
      graphs: {
        'graph-root': {
          nodes: {
            'node-source': { x: 0, y: 0 }, 'node-target': { x: 0, y: 160 }, 'node-schedule': { x: 0, y: -160 },
            'node-emitter': { x: 260, y: 0 }, 'node-initial': { x: 520, y: 0 }, 'node-material': { x: 520, y: 160 },
            'node-billboard': { x: 780, y: 0 }, 'node-output': { x: 1040, y: 0 },
          },
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      openedGraphId: 'graph-root',
    },
  };
}

// L01 path-only lightning bolt (01-LIGHTNING.md main bolt, branches, forks, four bolt materials). Every
// visual is an ordinary, removable node: a bowed BezierPath → JaggedPath → BranchPath (primary branches) →
// BranchPath (fine forks on the branches). The trunk feeds four stacked RibbonRenderers (halo/outer/inner/
// core, reference widths, colors and opacities); branches get glow + core layers and forks one fine layer.
// Branch/fork lengths are scaled down from the reference to the 3.2 m preview span. A generic point-particle
// charge core + halo sits at the source through tick 24 (below the bolt); trunk and branch layers share a ticks 24-62 bolt window; impact sparks follow tip arrival at ticks 26-37. Ribbon
// parameters stay at their defaults except width/renderOrderOffset, and endFade 0 on the four trunk layers
// so the bolt stays full-width up to the target anchor where the impact burst sits.
const chargeSizeOverLife = () => ({ domain: 'normalized' as const, interpolation: 'linear' as const, keys: [{ x: 0, y: 1 }, { x: 1, y: 7 }] });
const chargeOpacityOverLife = () => ({ domain: 'normalized' as const, interpolation: 'linear' as const, keys: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] });
// Ground ripple: ticks 26-119 (window end 120 exclusive). Radius grows linearly 0.15 -> 5.6 m; opacity is a
// piecewise-linear approximation of 0.8 * e^(-4u), shifted so it reaches exactly 0 at u = 1.
export const L01_RIPPLE_START_TICK = 26;
export const L01_RIPPLE_END_TICK = 120;
export const L01_RIPPLE_RADIUS = 5.6;
export const L01_RIPPLE_MIN_RADIUS = 0.15;
export const L01_RIPPLE_OPACITY = 0.8;
export const L01_RIPPLE_FADE_KEYS = [0, 0.1, 0.25, 0.5, 0.75, 1];
export const l01RippleFade = (u: number) => L01_RIPPLE_OPACITY * (Math.exp(-4 * u) - Math.exp(-4)) / (1 - Math.exp(-4));
const rippleSeconds = (u: number) => (L01_RIPPLE_START_TICK + u * (L01_RIPPLE_END_TICK - L01_RIPPLE_START_TICK)) / 60;

export function createL01Document(): EffectDocumentV2 {
  const ribbon = (id: string, label: string, width: number, renderOrderOffset: number, extra: Record<string, number> = {}) =>
    ({ id, type: 'RibbonRenderer', definitionVersion: 1, label, enabled: true, randomStreamId: `rs-${id.slice(5)}`, params: { width, renderOrderOffset, ...extra } });
  const trunk = { endFade: 0 };
  const material = (id: string, label: string, srgb: string, opacity: number, emission: number) =>
    ({ id, type: 'Material', definitionVersion: 1, label, enabled: true, randomStreamId: `rs-${id.slice(5)}`, params: { template: 'SpriteUnlit', blend: 'additive', tint: { srgb, alpha: 1 }, opacity, emission } });
  return {
    format: 'vfx-studio',
    schemaVersion: 2,
    runtimeVersion: '2.0.0',
    id: 'doc-l01',
    name: 'L01 lightning showcase',
    tags: ['fixture', 'L01', 'lightning'],
    seed: 7,
    rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 },
    anchors: [
      { id: 'source', name: 'Source', position: [-1.6, 0.8, 0] },
      { id: 'target', name: 'Target', position: [1.6, 0.8, 0] },
      { id: 'ground', name: 'Ground under target', position: [1.6, 0, 0] },
    ],
    durationTicks: 120,
    rootGraphId: 'graph-root',
    graphs: [{
      id: 'graph-root',
      inputs: [],
      outputs: [],
      nodes: [
        { id: 'node-source', type: 'Anchor', definitionVersion: 1, label: 'Source', enabled: true, randomStreamId: 'rs-source', params: { anchorId: 'source' } },
        { id: 'node-target', type: 'Anchor', definitionVersion: 1, label: 'Target', enabled: true, randomStreamId: 'rs-target', params: { anchorId: 'target' } },
        // Handles of +0.56 m y give a 0.42 m mid-span bow (cubic midpoint = 3/4 of equal handle offsets).
        { id: 'node-base', type: 'BezierPath', definitionVersion: 1, label: 'Bowed base', enabled: true, randomStreamId: 'rs-base', params: { startHandle: [0.8, 0.56, 0], endHandle: [-0.8, 0.56, 0], samples: 42 } },
        { id: 'node-jagged', type: 'JaggedPath', definitionVersion: 1, label: 'Jagged', enabled: true, randomStreamId: 'rs-jagged', params: { amplitude: 0.55, regenerationHz: 24, samples: 42, pinned: true } },
        {
          id: 'node-branch', type: 'BranchPath', definitionVersion: 1, label: 'Primary branches', enabled: true, randomStreamId: 'rs-branch',
          params: { count: 14, countMode: 'total', attachmentMin: 0.12, attachmentMax: 0.88, lengthMin: 0.3, lengthMax: 0.9, spread: 1, widthMin: 0.2, widthMax: 0.4, opacityMin: 0.2, opacityMax: 0.48 },
        },
        {
          id: 'node-fork', type: 'BranchPath', definitionVersion: 1, label: 'Secondary forks', enabled: true, randomStreamId: 'rs-fork',
          params: { count: 7, countMode: 'total', attachmentMin: 0.2, attachmentMax: 0.8, lengthMin: 0.15, lengthMax: 0.45, spread: 1, widthMin: 0.2, widthMax: 0.3, opacityMin: 0.15, opacityMax: 0.15 },
        },
        material('node-mat-halo', 'Halo material', '#1B2F8F', 0.07, 1),
        material('node-mat-outer', 'Outer material', '#2E6BFF', 0.17, 2),
        material('node-mat-inner', 'Inner material', '#7FDBFF', 0.65, 4),
        material('node-mat-core', 'Core material', '#FFFFFF', 1, 6),
        material('node-mat-branch-glow', 'Branch glow material', '#3A7DFF', 0.2, 2),
        material('node-mat-branch-core', 'Branch core material', '#CFEFFF', 0.48, 4),
        material('node-mat-fork', 'Fork material', '#A8E4FF', 0.3, 3),
        // Bolt window: one generic Schedule shared by the four trunk, two branch and fork ribbons, visible
        // ticks 24-62 (end 63 exclusive).
        { id: 'node-bolt-window', type: 'Schedule', definitionVersion: 1, label: 'Bolt window', enabled: true, randomStreamId: 'rs-bolt-window', params: { startTicks: 24, durationTicks: 39, mode: 'window' } },
        // 2-tick strike reveal: one EffectTimeCurve (0 at tick 24 → 1 at tick 26) drives one RevealPath per
        // distinct path set (trunk, primary branches, forks). Reveals sit after both BranchPaths, so branch
        // attachment is computed on the full trunk and the layers stay separately editable.
        {
          id: 'node-strike-curve', type: 'EffectTimeCurve', definitionVersion: 1, label: 'Strike reveal curve', enabled: true, randomStreamId: 'rs-strike-curve',
          params: { curve: { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 24 / 60, y: 0 }, { x: 26 / 60, y: 1 }] } },
        },
        { id: 'node-reveal-trunk', type: 'RevealPath', definitionVersion: 1, label: 'Trunk reveal', enabled: true, randomStreamId: 'rs-reveal-trunk', params: { fraction: 1 } },
        { id: 'node-reveal-branches', type: 'RevealPath', definitionVersion: 1, label: 'Branch reveal', enabled: true, randomStreamId: 'rs-reveal-branches', params: { fraction: 1 } },
        { id: 'node-reveal-forks', type: 'RevealPath', definitionVersion: 1, label: 'Fork reveal', enabled: true, randomStreamId: 'rs-reveal-forks', params: { fraction: 1 } },
        ribbon('node-rib-halo', 'Halo ribbon', 0.43, 0, trunk),
        ribbon('node-rib-outer', 'Outer ribbon', 0.185, 1, trunk),
        ribbon('node-rib-branch-glow', 'Branch glow ribbon', 0.07, 2),
        ribbon('node-rib-inner', 'Inner ribbon', 0.07, 3, trunk),
        ribbon('node-rib-fork', 'Fork ribbon', 0.012, 4),
        ribbon('node-rib-branch-core', 'Branch core ribbon', 0.018, 5),
        ribbon('node-rib-core', 'Core ribbon', 0.026, 6, trunk),
        // Impact sparks: a short radial starburst at the target, disc rotated +90° about X into the XY
        // (view) plane. One RadialPath feeds a soft cyan glow ribbon and a thin white core ribbon, both
        // Start when the two-tick strike reveal reaches the target, then fade after a short burst.
        { id: 'node-impact-window', type: 'Schedule', definitionVersion: 1, label: 'Impact window', enabled: true, randomStreamId: 'rs-impact-window', params: { startTicks: 26, durationTicks: 12, mode: 'window' } },
        {
          id: 'node-impact-sparks', type: 'RadialPath', definitionVersion: 1, label: 'Impact sparks', enabled: true, randomStreamId: 'rs-impact-sparks',
          params: { mode: 'disc', count: 10, lengthMin: 0.18, lengthMax: 0.45, orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] },
        },
        material('node-mat-impact-glow', 'Impact glow material', '#4FD8FF', 0.32, 3),
        material('node-mat-impact', 'Impact spark material', '#F4FDFF', 0.9, 6),
        ribbon('node-rib-impact-glow', 'Impact glow ribbon', 0.06, 7),
        ribbon('node-rib-impact', 'Impact spark ribbon', 0.02, 8),
        // Charge: one generic point Emitter at the source bursts once at tick 0 with a 25-tick life,
        // so it overlaps the first strike tick instead of leaving a blank frame. Two InitialProperties give a white-blue
        // core and a wide blue halo; each feeds its own BillboardRenderer, ordered below every bolt ribbon.
        { id: 'node-charge-schedule', type: 'Schedule', definitionVersion: 1, label: 'Charge trigger', enabled: true, randomStreamId: 'rs-charge-schedule', params: { startTicks: 0, durationTicks: 24, mode: 'once' } },
        {
          id: 'node-charge-emitter', type: 'Emitter', definitionVersion: 1, label: 'Charge emitter', enabled: true, randomStreamId: 'rs-charge-emitter',
          params: { shape: 'point', burst: 1, rate: 0, lifetimeMin: 25 / 60, lifetimeMax: 25 / 60, speedMin: 0, speedMax: 0 },
        },
        { id: 'node-charge-halo-props', type: 'InitialProperties', definitionVersion: 1, label: 'Charge halo properties', enabled: true, randomStreamId: 'rs-charge-halo-props', params: { sizeMin: 0.2, sizeMax: 0.2, rotationMin: 0, rotationMax: 0, angularVelocityMin: 0, angularVelocityMax: 0 } },
        { id: 'node-charge-core-props', type: 'InitialProperties', definitionVersion: 1, label: 'Charge core properties', enabled: true, randomStreamId: 'rs-charge-core-props', params: { sizeMin: 0.04, sizeMax: 0.04, rotationMin: 0, rotationMax: 0, angularVelocityMin: 0, angularVelocityMax: 0 } },
        material('node-mat-charge-halo', 'Charge halo material', '#2E6BFF', 0.22, 2),
        material('node-mat-charge-core', 'Charge core material', '#DDF4FF', 0.85, 5),
        // Both charge billboards grow 1x -> 7x over life (halo 0.2 -> 1.4 m, core 0.04 -> 0.28 m) and brighten 0.2 -> 1.
        { id: 'node-bb-charge-halo', type: 'BillboardRenderer', definitionVersion: 1, label: 'Charge halo', enabled: true, randomStreamId: 'rs-bb-charge-halo', params: { renderOrderOffset: -2, sizeOverLife: chargeSizeOverLife(), opacityOverLife: chargeOpacityOverLife() } },
        { id: 'node-bb-charge-core', type: 'BillboardRenderer', definitionVersion: 1, label: 'Charge core', enabled: true, randomStreamId: 'rs-bb-charge-core', params: { renderOrderOffset: -1, sizeOverLife: chargeSizeOverLife(), opacityOverLife: chargeOpacityOverLife() } },
        // Ground ripple: a generic XZ RingPath at a ground anchor under the target; two EffectTimeCurves drive
        // its radiusScale and its material opacity over the ripple window.
        { id: 'node-ground', type: 'Anchor', definitionVersion: 1, label: 'Ground', enabled: true, randomStreamId: 'rs-ground', params: { anchorId: 'ground' } },
        { id: 'node-ripple-window', type: 'Schedule', definitionVersion: 1, label: 'Ripple window', enabled: true, randomStreamId: 'rs-ripple-window', params: { startTicks: L01_RIPPLE_START_TICK, durationTicks: L01_RIPPLE_END_TICK - L01_RIPPLE_START_TICK, mode: 'window' } },
        {
          id: 'node-ripple-ring', type: 'RingPath', definitionVersion: 1, label: 'Ground ripple ring', enabled: true, randomStreamId: 'rs-ripple-ring',
          params: { radius: L01_RIPPLE_RADIUS, minRadius: L01_RIPPLE_MIN_RADIUS, radiusScale: 1, samples: 64, orientation: [0, 0, 0, 1] },
        },
        {
          id: 'node-ripple-radius-curve', type: 'EffectTimeCurve', definitionVersion: 1, label: 'Ripple radius curve', enabled: true, randomStreamId: 'rs-ripple-radius-curve',
          params: { curve: { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: rippleSeconds(0), y: L01_RIPPLE_MIN_RADIUS / L01_RIPPLE_RADIUS }, { x: rippleSeconds(1), y: 1 }] } },
        },
        {
          id: 'node-ripple-fade-curve', type: 'EffectTimeCurve', definitionVersion: 1, label: 'Ripple fade curve', enabled: true, randomStreamId: 'rs-ripple-fade-curve',
          params: { curve: { domain: 'effectSeconds', interpolation: 'linear', keys: L01_RIPPLE_FADE_KEYS.map(u => ({ x: rippleSeconds(u), y: u === 1 ? 0 : l01RippleFade(u) })) } },
        },
        material('node-mat-ripple', 'Ripple material', '#5FF0FF', L01_RIPPLE_OPACITY, 3),
        ribbon('node-rib-ripple', 'Ripple ribbon', 0.03, 0, { endFade: 0 }),
        { id: 'node-output', type: 'EffectOutput', definitionVersion: 1, label: 'Output', enabled: true, randomStreamId: 'rs-output', params: {} },
      ],
      edges: [
        edge('edge-base-start', 'node-source', 'out', 'node-base', 'start'),
        edge('edge-base-end', 'node-target', 'out', 'node-base', 'end'),
        edge('edge-jagged', 'node-base', 'paths', 'node-jagged', 'paths'),
        edge('edge-branch', 'node-jagged', 'paths', 'node-branch', 'paths'),
        edge('edge-fork', 'node-branch', 'branches', 'node-fork', 'paths'),
        edge('edge-reveal-trunk', 'node-branch', 'trunk', 'node-reveal-trunk', 'paths'),
        edge('edge-reveal-branches', 'node-fork', 'trunk', 'node-reveal-branches', 'paths'),
        edge('edge-reveal-forks', 'node-fork', 'branches', 'node-reveal-forks', 'paths'),
        edge('edge-strike-trunk', 'node-strike-curve', 'value', 'node-reveal-trunk', 'fraction'),
        edge('edge-strike-branches', 'node-strike-curve', 'value', 'node-reveal-branches', 'fraction'),
        edge('edge-strike-forks', 'node-strike-curve', 'value', 'node-reveal-forks', 'fraction'),
        edge('edge-halo-paths', 'node-reveal-trunk', 'paths', 'node-rib-halo', 'paths'),
        edge('edge-outer-paths', 'node-reveal-trunk', 'paths', 'node-rib-outer', 'paths'),
        edge('edge-inner-paths', 'node-reveal-trunk', 'paths', 'node-rib-inner', 'paths'),
        edge('edge-core-paths', 'node-reveal-trunk', 'paths', 'node-rib-core', 'paths'),
        edge('edge-branch-glow-paths', 'node-reveal-branches', 'paths', 'node-rib-branch-glow', 'paths'),
        edge('edge-branch-core-paths', 'node-reveal-branches', 'paths', 'node-rib-branch-core', 'paths'),
        edge('edge-fork-paths', 'node-reveal-forks', 'paths', 'node-rib-fork', 'paths'),
        edge('edge-halo-mat', 'node-mat-halo', 'material', 'node-rib-halo', 'material'),
        edge('edge-outer-mat', 'node-mat-outer', 'material', 'node-rib-outer', 'material'),
        edge('edge-inner-mat', 'node-mat-inner', 'material', 'node-rib-inner', 'material'),
        edge('edge-core-mat', 'node-mat-core', 'material', 'node-rib-core', 'material'),
        edge('edge-branch-glow-mat', 'node-mat-branch-glow', 'material', 'node-rib-branch-glow', 'material'),
        edge('edge-branch-core-mat', 'node-mat-branch-core', 'material', 'node-rib-branch-core', 'material'),
        edge('edge-fork-mat', 'node-mat-fork', 'material', 'node-rib-fork', 'material'),
        edge('edge-bolt-window-halo', 'node-bolt-window', 'window', 'node-rib-halo', 'window'),
        edge('edge-bolt-window-outer', 'node-bolt-window', 'window', 'node-rib-outer', 'window'),
        edge('edge-bolt-window-inner', 'node-bolt-window', 'window', 'node-rib-inner', 'window'),
        edge('edge-bolt-window-core', 'node-bolt-window', 'window', 'node-rib-core', 'window'),
        edge('edge-bolt-window-branch-glow', 'node-bolt-window', 'window', 'node-rib-branch-glow', 'window'),
        edge('edge-bolt-window-branch-core', 'node-bolt-window', 'window', 'node-rib-branch-core', 'window'),
        edge('edge-bolt-window-fork', 'node-bolt-window', 'window', 'node-rib-fork', 'window'),
        { ...edge('edge-visual-halo', 'node-rib-halo', 'visual', 'node-output', 'visual'), order: 0 },
        { ...edge('edge-visual-outer', 'node-rib-outer', 'visual', 'node-output', 'visual'), order: 1 },
        { ...edge('edge-visual-branch-glow', 'node-rib-branch-glow', 'visual', 'node-output', 'visual'), order: 2 },
        { ...edge('edge-visual-inner', 'node-rib-inner', 'visual', 'node-output', 'visual'), order: 3 },
        { ...edge('edge-visual-fork', 'node-rib-fork', 'visual', 'node-output', 'visual'), order: 4 },
        { ...edge('edge-visual-branch-core', 'node-rib-branch-core', 'visual', 'node-output', 'visual'), order: 5 },
        { ...edge('edge-visual-core', 'node-rib-core', 'visual', 'node-output', 'visual'), order: 6 },
        edge('edge-impact-center', 'node-target', 'out', 'node-impact-sparks', 'center'),
        edge('edge-impact-paths', 'node-impact-sparks', 'paths', 'node-rib-impact', 'paths'),
        edge('edge-impact-mat', 'node-mat-impact', 'material', 'node-rib-impact', 'material'),
        edge('edge-impact-window', 'node-impact-window', 'window', 'node-rib-impact', 'window'),
        edge('edge-impact-glow-paths', 'node-impact-sparks', 'paths', 'node-rib-impact-glow', 'paths'),
        edge('edge-impact-glow-mat', 'node-mat-impact-glow', 'material', 'node-rib-impact-glow', 'material'),
        edge('edge-impact-glow-window', 'node-impact-window', 'window', 'node-rib-impact-glow', 'window'),
        { ...edge('edge-visual-impact-glow', 'node-rib-impact-glow', 'visual', 'node-output', 'visual'), order: 7 },
        { ...edge('edge-visual-impact', 'node-rib-impact', 'visual', 'node-output', 'visual'), order: 8 },
        edge('edge-visual-charge-trigger', 'node-charge-schedule', 'start', 'node-charge-emitter', 'trigger'),
        edge('edge-charge-anchor', 'node-source', 'out', 'node-charge-emitter', 'anchor'),
        edge('edge-charge-halo-emit', 'node-charge-emitter', 'particles', 'node-charge-halo-props', 'particles'),
        edge('edge-charge-core-emit', 'node-charge-emitter', 'particles', 'node-charge-core-props', 'particles'),
        edge('edge-charge-halo-particles', 'node-charge-halo-props', 'particles', 'node-bb-charge-halo', 'particles'),
        edge('edge-charge-core-particles', 'node-charge-core-props', 'particles', 'node-bb-charge-core', 'particles'),
        edge('edge-charge-halo-mat', 'node-mat-charge-halo', 'material', 'node-bb-charge-halo', 'material'),
        edge('edge-charge-core-mat', 'node-mat-charge-core', 'material', 'node-bb-charge-core', 'material'),
        { ...edge('edge-visual-charge-halo', 'node-bb-charge-halo', 'visual', 'node-output', 'visual'), order: 9 },
        { ...edge('edge-visual-charge-core', 'node-bb-charge-core', 'visual', 'node-output', 'visual'), order: 10 },
        edge('edge-ripple-center', 'node-ground', 'out', 'node-ripple-ring', 'center'),
        edge('edge-ripple-radius', 'node-ripple-radius-curve', 'value', 'node-ripple-ring', 'radiusScale'),
        edge('edge-ripple-fade', 'node-ripple-fade-curve', 'value', 'node-mat-ripple', 'opacity'),
        edge('edge-ripple-paths', 'node-ripple-ring', 'paths', 'node-rib-ripple', 'paths'),
        edge('edge-ripple-mat', 'node-mat-ripple', 'material', 'node-rib-ripple', 'material'),
        edge('edge-ripple-window', 'node-ripple-window', 'window', 'node-rib-ripple', 'window'),
        { ...edge('edge-visual-ripple', 'node-rib-ripple', 'visual', 'node-output', 'visual'), order: 11 },
      ],
    }],
    controls: [],
    assets: [],
    editor: {
      graphs: {
        'graph-root': {
          nodes: {
            'node-source': { x: 0, y: 0 }, 'node-target': { x: 0, y: 160 }, 'node-base': { x: 240, y: 80 },
            'node-jagged': { x: 480, y: 80 }, 'node-branch': { x: 720, y: 80 }, 'node-fork': { x: 720, y: 560 },
            'node-mat-halo': { x: 980, y: -560 }, 'node-mat-outer': { x: 980, y: -400 },
            'node-mat-inner': { x: 980, y: -240 }, 'node-mat-core': { x: 980, y: -80 },
            'node-mat-branch-glow': { x: 980, y: 400 }, 'node-mat-branch-core': { x: 980, y: 560 }, 'node-mat-fork': { x: 980, y: 720 },
            'node-rib-halo': { x: 1240, y: -480 }, 'node-rib-outer': { x: 1240, y: -320 },
            'node-rib-inner': { x: 1240, y: -160 }, 'node-rib-core': { x: 1240, y: 0 },
            'node-rib-branch-glow': { x: 1240, y: 480 }, 'node-rib-branch-core': { x: 1240, y: 640 }, 'node-rib-fork': { x: 1240, y: 800 },
            'node-bolt-window': { x: 980, y: -720 }, 'node-impact-window': { x: 980, y: 1040 }, 'node-impact-sparks': { x: 240, y: 880 },
            'node-mat-impact': { x: 980, y: 880 }, 'node-rib-impact': { x: 1240, y: 960 },
            'node-mat-impact-glow': { x: 980, y: 1200 }, 'node-rib-impact-glow': { x: 1240, y: 1120 },
            'node-strike-curve': { x: 720, y: -240 }, 'node-reveal-trunk': { x: 980, y: 80 },
            'node-reveal-branches': { x: 980, y: 240 }, 'node-reveal-forks': { x: 980, y: 1360 },
            'node-charge-schedule': { x: 0, y: -560 }, 'node-charge-emitter': { x: 240, y: -560 },
            'node-charge-halo-props': { x: 480, y: -720 }, 'node-charge-core-props': { x: 480, y: -560 },
            'node-mat-charge-halo': { x: 720, y: -880 }, 'node-mat-charge-core': { x: 720, y: -720 },
            'node-bb-charge-halo': { x: 1240, y: -800 }, 'node-bb-charge-core': { x: 1240, y: -640 },
            'node-ground': { x: 0, y: 1520 }, 'node-ripple-ring': { x: 240, y: 1520 },
            'node-ripple-radius-curve': { x: 0, y: 1680 }, 'node-ripple-fade-curve': { x: 720, y: 1680 },
            'node-mat-ripple': { x: 980, y: 1680 }, 'node-ripple-window': { x: 980, y: 1520 }, 'node-rib-ripple': { x: 1240, y: 1600 },
            'node-output': { x: 1500, y: 160 },
          },
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      openedGraphId: 'graph-root',
    },
  };
}
