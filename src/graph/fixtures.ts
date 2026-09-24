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
        { id: 'node-initial', type: 'InitialProperties', definitionVersion: 1, label: 'Initial properties', enabled: true, randomStreamId: 'rs-initial', params: { sizeMin: 0.1, sizeMax: 0.1 } },
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
