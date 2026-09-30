// Minimal typed v2 document fixture. Structural only: node parameter schemas are not yet
// registered (WP02), so nodes carry empty params rather than invented keys. This is not F01 and
// makes no claim that it compiles or renders; no runtime or renderer exercises it yet.
import type { EffectDocumentV2 } from './types.ts';

export function minimalDocument(): EffectDocumentV2 {
  return {
    format: 'vfx-studio',
    schemaVersion: 2,
    runtimeVersion: '2.0.0',
    id: 'doc-minimal',
    name: 'Minimal',
    tags: ['fixture'],
    seed: 42,
    rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 },
    anchors: [
      { id: 'source', name: 'Source', position: [0, 1, 0] },
      { id: 'target', name: 'Target', position: [0, 1, 5] },
    ],
    durationTicks: 60,
    rootGraphId: 'graph-root',
    graphs: [{
      id: 'graph-root',
      inputs: [],
      outputs: [],
      nodes: [
        { id: 'node-source', type: 'Anchor', definitionVersion: 1, label: 'Source', enabled: true, randomStreamId: 'rs-source', params: {} },
        { id: 'node-target', type: 'Anchor', definitionVersion: 1, label: 'Target', enabled: true, randomStreamId: 'rs-target', params: {} },
        { id: 'node-output', type: 'EffectOutput', definitionVersion: 1, label: 'Output', enabled: true, randomStreamId: 'rs-output', params: {} },
      ],
      edges: [],
    }],
    controls: [],
    assets: [],
    editor: {
      graphs: { 'graph-root': { nodes: { 'node-source': { x: 0, y: 0 }, 'node-target': { x: 0, y: 120 }, 'node-output': { x: 400, y: 60 } }, viewport: { x: 0, y: 0, zoom: 1 } } },
      openedGraphId: 'graph-root',
    },
  };
}
