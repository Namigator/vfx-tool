// L01 lightning with a prototype audio layer (WP04). Starts from createL01Document() unchanged and appends
// ordinary, editable audio nodes: a low-gain rising chirp "charge" from tick 0 to the strike, then a short
// white-noise "discharge" at the impact tick (24, matching the impact-spark Schedule). Both sources feed one
// AudioMix (centered per-edge gain/pan, safe masterGain) → AudioOutput → root EffectOutput.audio. Visual nodes
// and edges are untouched, so compilePathPreview(doc, t, { audioHandled: true }) equals the plain L01 plan.
// Prototype sound only, not listening acceptance.
import type { EffectDocumentV2, NodeDefinition } from '../model/types.ts';
import { createL01Document } from './fixtures.ts';

const node = (id: string, type: string, label: string, params: NodeDefinition['params']): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label, enabled: true, randomStreamId: `rs-${id.slice(5)}`, params });
const edge = (id: string, sourceNode: string, sourcePort: string, targetNode: string, targetPort: string, order = 0) =>
  ({ id, source: { nodeId: sourceNode, port: sourcePort }, target: { nodeId: targetNode, port: targetPort }, order });

export function createL01AudioDocument(): EffectDocumentV2 {
  const d = createL01Document();
  d.id = 'doc-l01-audio';
  d.name = 'L01 lightning showcase with audio';
  d.tags = [...d.tags, 'audio'];
  const g = d.graphs[0];
  g.nodes.push(
    node('node-charge-cue', 'Schedule', 'Charge cue', { startTicks: 0, durationTicks: 24, mode: 'once' }),
    node('node-charge-sound', 'AudioSource', 'Charge chirp', {
      source: 'chirp', chirpStartHz: 180, chirpEndHz: 1400, chirpSweep: 'exponential', offsetTicks: 0, durationTicks: 24, gain: 0.25, pitchRatio: 1,
    }),
    node('node-strike-cue', 'Schedule', 'Strike cue', { startTicks: 24, durationTicks: 6, mode: 'once' }),
    node('node-strike-sound', 'AudioSource', 'Discharge noise', {
      source: 'noise', noiseColor: 'white', offsetTicks: 0, durationTicks: 6, gain: 0.8, pitchRatio: 1,
    }),
    node('node-audio-mix', 'AudioMix', 'Audio mix', { masterGain: 0.7 }),
    node('node-audio-out', 'AudioOutput', 'Audio output', {}),
  );
  g.edges.push(
    edge('edge-charge-trigger', 'node-charge-cue', 'start', 'node-charge-sound', 'trigger'),
    edge('edge-strike-trigger', 'node-strike-cue', 'start', 'node-strike-sound', 'trigger'),
    { ...edge('edge-charge-mix', 'node-charge-sound', 'audio', 'node-audio-mix', 'inputs', 0), mix: { gain: 0.8, pan: 0 } },
    { ...edge('edge-strike-mix', 'node-strike-sound', 'audio', 'node-audio-mix', 'inputs', 1), mix: { gain: 1, pan: 0 } },
    edge('edge-mix-out', 'node-audio-mix', 'audio', 'node-audio-out', 'audio'),
    edge('edge-audio-root', 'node-audio-out', 'audio', 'node-output', 'audio'),
  );
  Object.assign(d.editor.graphs['graph-root'].nodes, {
    'node-charge-cue': { x: 980, y: 1400 }, 'node-charge-sound': { x: 1240, y: 1400 },
    'node-strike-cue': { x: 980, y: 1560 }, 'node-strike-sound': { x: 1240, y: 1560 },
    'node-audio-mix': { x: 1500, y: 1480 }, 'node-audio-out': { x: 1760, y: 1480 },
  });
  return d;
}
