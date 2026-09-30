import test from 'node:test';
import assert from 'node:assert/strict';
import { copySelection, duplicateSelection, parseClipboard, pasteSelection } from '../src/editor/graphOps.ts';
import { createF01Document, createBlankDocument } from '../src/graph/fixtures.ts';
import { insertComponent } from '../src/graph/components.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';

test('12 duplicate: copies get fresh node, edge and random-stream ids, keep internal wiring, and the effect still compiles', () => {
  const doc = createF01Document();
  const g = doc.graphs[0];
  const ids = ['node-emitter', 'node-initial'];
  const r = duplicateSelection(doc, g.id, ids);
  if (!r.ok) assert.fail(r.message);
  assert.equal(r.newIds.length, 2);
  const g2 = r.doc.graphs[0];
  const copies = g2.nodes.filter(n => r.newIds.includes(n.id));
  assert.ok(copies.every(n => !ids.includes(n.id) && !g.nodes.some(o => o.randomStreamId === n.randomStreamId)), 'fresh ids and random streams');
  assert.ok(g2.edges.some(e => r.newIds.includes(e.source.nodeId) && r.newIds.includes(e.target.nodeId)), 'edge between the two copies kept');
  assert.equal(g2.nodes.length, g.nodes.length + 2);
  assert.ok(compileParticlePreview(r.doc, { audioHandled: true }).ok, 'the document with copies still compiles');
});

test('12 copy/paste: JSON payload round-trips through the clipboard; protected nodes and foreign text are refused', () => {
  const doc = createF01Document();
  const c = copySelection(doc, doc.graphs[0].id, ['node-emitter']);
  if (!c.ok) assert.fail(c.message);
  const back = parseClipboard(JSON.stringify(c.value));
  assert.ok(back.ok);
  const p = pasteSelection(createBlankDocument(), createBlankDocument().rootGraphId, back.ok ? back.value : c.value);
  assert.ok(p.ok && p.newIds.length === 1);
  assert.ok(!copySelection(doc, doc.graphs[0].id, ['node-output']).ok, 'EffectOutput cannot be copied');
  assert.ok(!parseClipboard('hello').ok && !parseClipboard('{"format":"other"}').ok);
});

test('12 duplicate a component group: an independent copy (editing one leaves the other unchanged)', () => {
  const { doc } = insertComponent(createBlankDocument(), 'spark-burst', undefined, { group: true });
  const r = duplicateSelection(doc, doc.rootGraphId, ['spark-burst']);
  if (!r.ok) assert.fail(r.message);
  const copyGroup = r.doc.graphs[0].nodes.find(n => n.id === r.newIds[0])!;
  assert.equal(copyGroup.type, 'Group');
  assert.notEqual(copyGroup.params.graphId, 'graph-spark-burst');
  const copyGraph = r.doc.graphs.find(g => g.id === copyGroup.params.graphId)!;
  copyGraph.nodes.find(n => n.type === 'Emitter')!.params.burst = 999;
  assert.notEqual(r.doc.graphs.find(g => g.id === 'graph-spark-burst')!.nodes.find(n => n.type === 'Emitter')!.params.burst, 999);
});

test('06 Delete and reconnect joins downstream links to the same-typed upstream source', async () => {
  const { removeAndReconnect } = await import('../src/editor/graphOps.ts');
  const { createF01Document } = await import('../src/graph/fixtures.ts');
  const d = createF01Document();
  const r = removeAndReconnect(d, 'graph-root', 'node-initial');
  if (!r.ok) assert.fail(r.message);
  const g = r.doc.graphs[0];
  assert.ok(!g.nodes.some(n => n.id === 'node-initial'));
  assert.ok(g.edges.some(e => e.source.nodeId === 'node-emitter' && e.target.nodeId === 'node-billboard' && e.target.port === 'particles'), 'Emitter → Billboard');
  assert.equal(r.newIds.length, 1);
  assert.ok(!removeAndReconnect(d, 'graph-root', 'node-output').ok, 'protected nodes refused');
  const m = removeAndReconnect(d, 'graph-root', 'node-material');
  assert.ok(m.ok && m.newIds.length === 0 && m.notes.length === 1 && /lost its material input/.test(m.notes[0]), JSON.stringify(m));
});
