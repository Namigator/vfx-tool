// An inserted component's Source/Target are anchor inputs on its Group box, wired to the root Anchor nodes, so the
// user can drag any other Anchor node onto them (user 2026-10-21).
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';

test('grouped component exposes Source/Target anchor inputs wired from the root anchors', () => {
  const { doc: d, groupNodeId } = insertComponent(createBlankDocument(), 'energy-bolt', undefined, { group: true });
  const root = d.graphs.find(g => g.id === d.rootGraphId)!;
  const group = root.nodes.find(n => n.id === groupNodeId)!;
  const child = d.graphs.find(g => g.id === group.params.graphId)!;
  assert.deepEqual(child.inputs.filter(p => p.type === 'anchor').map(p => p.id).sort(), ['source', 'target']);
  assert.ok(!child.nodes.some(n => n.type === 'Anchor' && (n.params.anchorId === 'source' || n.params.anchorId === 'target')), 'no hidden anchor copies');
  for (const port of ['source', 'target']) {
    const e = root.edges.find(x => x.target.nodeId === groupNodeId && x.target.port === port)!;
    assert.equal(root.nodes.find(n => n.id === e.source.nodeId)!.params.anchorId, port);
  }
  const before = compileParticlePreview(d, { ribbonsHandled: true, audioHandled: true });
  if (!before.ok) assert.fail(JSON.stringify(before.errors.slice(0, 3)));

  // Rewire Target to a new anchor: the effect still compiles and the bolt now aims there.
  d.anchors.push({ id: 'anchor-1', name: 'Anchor 1', position: [0, 5, 4] });
  root.nodes.push({ id: 'a1', type: 'Anchor', definitionVersion: 1, label: 'Anchor 1', enabled: true, randomStreamId: 'rs-a1', params: { anchorId: 'anchor-1' } });
  root.edges.find(x => x.target.nodeId === groupNodeId && x.target.port === 'target')!.source.nodeId = 'a1';
  const p = compileParticlePreview(d, { ribbonsHandled: true, audioHandled: true });
  if (!p.ok) assert.fail(JSON.stringify(p.errors.slice(0, 3)));
  assert.notEqual(JSON.stringify(p.value), JSON.stringify(before.value), 'rewiring Target changes the compiled effect');
});
