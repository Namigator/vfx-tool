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

test('Controls From/To: re-point a socketed component and an older group with inner anchor copies', async () => {
  const { componentAnchorSlots, setComponentAnchor } = await import('../src/graph/componentAnchors.ts');
  let { doc: d, groupNodeId } = insertComponent(createBlankDocument(), 'energy-bolt', undefined, { group: true });
  d.anchors.push({ id: 'anchor-1', name: 'Anchor 1', position: [0, 5, 4] });
  assert.deepEqual(componentAnchorSlots(d, groupNodeId!), [{ role: 'source', anchorId: 'source' }, { role: 'target', anchorId: 'target' }]);
  d = setComponentAnchor(d, groupNodeId!, 'target', 'anchor-1');
  assert.deepEqual(componentAnchorSlots(d, groupNodeId!).map(s => s.anchorId), ['source', 'anchor-1']);
  assert.ok(compileParticlePreview(d, { ribbonsHandled: true, audioHandled: true }).ok);
  // Older layout: the group keeps Anchor copies inside (ids ending -source/-target).
  const old = structuredClone(d), root = old.graphs.find(g => g.id === old.rootGraphId)!;
  const child = old.graphs.find(g => g.id === root.nodes.find(n => n.id === groupNodeId)!.params.graphId)!;
  child.inputs = child.inputs.filter(p => p.type !== 'anchor');
  root.edges = root.edges.filter(e => e.target.nodeId !== groupNodeId || (e.target.port !== 'source' && e.target.port !== 'target'));
  for (const role of ['source', 'target']) {
    const bridge = child.nodes.find(n => n.type === 'GroupInput' && n.params.portId === role)!;
    Object.assign(bridge, { id: `${groupNodeId}-${role}`, type: 'Anchor', params: { anchorId: role } });
    for (const e of child.edges) if (e.source.nodeId === `${groupNodeId}-in-${role}`) e.source.nodeId = bridge.id;
  }
  const moved = setComponentAnchor(old, groupNodeId!, 'source', 'anchor-1');
  assert.deepEqual(componentAnchorSlots(moved, groupNodeId!).map(s => s.anchorId), ['anchor-1', 'target']);
});
