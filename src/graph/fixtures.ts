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
// Branch/fork lengths are scaled down from the reference to the 3.2 m preview span. No particle chain and
// no timing: every layer is visible from tick 0 until charge/impact and a signal graph exist. Ribbon
// parameters stay at their defaults except width/renderOrderOffset.
export function createL01Document(): EffectDocumentV2 {
  const ribbon = (id: string, label: string, width: number, renderOrderOffset: number) =>
    ({ id, type: 'RibbonRenderer', definitionVersion: 1, label, enabled: true, randomStreamId: `rs-${id.slice(5)}`, params: { width, renderOrderOffset } });
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
        ribbon('node-rib-halo', 'Halo ribbon', 0.43, 0),
        ribbon('node-rib-outer', 'Outer ribbon', 0.185, 1),
        ribbon('node-rib-branch-glow', 'Branch glow ribbon', 0.07, 2),
        ribbon('node-rib-inner', 'Inner ribbon', 0.07, 3),
        ribbon('node-rib-fork', 'Fork ribbon', 0.012, 4),
        ribbon('node-rib-branch-core', 'Branch core ribbon', 0.018, 5),
        ribbon('node-rib-core', 'Core ribbon', 0.026, 6),
        { id: 'node-output', type: 'EffectOutput', definitionVersion: 1, label: 'Output', enabled: true, randomStreamId: 'rs-output', params: {} },
      ],
      edges: [
        edge('edge-base-start', 'node-source', 'out', 'node-base', 'start'),
        edge('edge-base-end', 'node-target', 'out', 'node-base', 'end'),
        edge('edge-jagged', 'node-base', 'paths', 'node-jagged', 'paths'),
        edge('edge-branch', 'node-jagged', 'paths', 'node-branch', 'paths'),
        edge('edge-fork', 'node-branch', 'branches', 'node-fork', 'paths'),
        edge('edge-halo-paths', 'node-branch', 'trunk', 'node-rib-halo', 'paths'),
        edge('edge-outer-paths', 'node-branch', 'trunk', 'node-rib-outer', 'paths'),
        edge('edge-inner-paths', 'node-branch', 'trunk', 'node-rib-inner', 'paths'),
        edge('edge-core-paths', 'node-branch', 'trunk', 'node-rib-core', 'paths'),
        edge('edge-branch-glow-paths', 'node-fork', 'trunk', 'node-rib-branch-glow', 'paths'),
        edge('edge-branch-core-paths', 'node-fork', 'trunk', 'node-rib-branch-core', 'paths'),
        edge('edge-fork-paths', 'node-fork', 'branches', 'node-rib-fork', 'paths'),
        edge('edge-halo-mat', 'node-mat-halo', 'material', 'node-rib-halo', 'material'),
        edge('edge-outer-mat', 'node-mat-outer', 'material', 'node-rib-outer', 'material'),
        edge('edge-inner-mat', 'node-mat-inner', 'material', 'node-rib-inner', 'material'),
        edge('edge-core-mat', 'node-mat-core', 'material', 'node-rib-core', 'material'),
        edge('edge-branch-glow-mat', 'node-mat-branch-glow', 'material', 'node-rib-branch-glow', 'material'),
        edge('edge-branch-core-mat', 'node-mat-branch-core', 'material', 'node-rib-branch-core', 'material'),
        edge('edge-fork-mat', 'node-mat-fork', 'material', 'node-rib-fork', 'material'),
        { ...edge('edge-visual-halo', 'node-rib-halo', 'visual', 'node-output', 'visual'), order: 0 },
        { ...edge('edge-visual-outer', 'node-rib-outer', 'visual', 'node-output', 'visual'), order: 1 },
        { ...edge('edge-visual-branch-glow', 'node-rib-branch-glow', 'visual', 'node-output', 'visual'), order: 2 },
        { ...edge('edge-visual-inner', 'node-rib-inner', 'visual', 'node-output', 'visual'), order: 3 },
        { ...edge('edge-visual-fork', 'node-rib-fork', 'visual', 'node-output', 'visual'), order: 4 },
        { ...edge('edge-visual-branch-core', 'node-rib-branch-core', 'visual', 'node-output', 'visual'), order: 5 },
        { ...edge('edge-visual-core', 'node-rib-core', 'visual', 'node-output', 'visual'), order: 6 },
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
            'node-output': { x: 1500, y: 160 },
          },
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      openedGraphId: 'graph-root',
    },
  };
}
