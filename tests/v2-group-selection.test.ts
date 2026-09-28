import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSelection } from '../src/graph/groupSelection.ts';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument, createF01Document } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import type { EffectDocumentV2 } from '../src/model/types.ts';

const valid = (d: unknown) => { const v = validateDocument(d, { registry: createRegistry() }); if (!v.ok) assert.fail(JSON.stringify(v.errors.slice(0, 3))); };
const particles = (d: EffectDocumentV2) => { const r = compileParticlePreview(d, { ribbonsHandled: true, audioHandled: true }); if (!r.ok) assert.fail(JSON.stringify(r.errors.slice(0, 3))); return r.value; };
/** What the viewer draws, independent of node ids: bursts, layer counts, lights, follower travel. */
const shape = (d: EffectDocumentV2) => {
  const p = particles(d), paths = compilePathPreview(d, 60, { audioHandled: true });
  if (!paths.ok) assert.fail(JSON.stringify(paths.errors.slice(0, 3)));
  return {
    bursts: p.systems.map(s => s.descriptor.bursts.map(b => [b.tick, b.count])).sort(),
    layers: p.layers.length, trails: p.trails.length, lights: p.lights.map(l => [l.startTick, l.endTick, l.intensity]).sort(), meshes: p.meshes.length,
    followers: p.followers.map(f => [f.startTick, f.travelTicks]), ribbons: paths.value.layers.length,
  };
};

test('grouping part of F01 keeps the compiled effect identical and exposes crossing links as ports', () => {
  const d = createF01Document();
  const before = shape(d);
  const r = groupSelection(d, d.rootGraphId, ['node-emitter', 'node-initial'], 'Emitter block');
  if (!r.ok) assert.fail(r.message);
  valid(r.doc);
  assert.deepEqual(shape(r.doc), before);
  const root = r.doc.graphs.find(g => g.id === r.doc.rootGraphId)!, child = r.doc.graphs.find(g => g.id === r.childGraphId)!;
  assert.ok(root.nodes.some(n => n.id === r.groupNodeId && n.label === 'Emitter block'));
  assert.ok(!root.nodes.some(n => n.id === 'node-emitter'));
  assert.ok(child.inputs.length >= 2 && child.outputs.length === 1, `inputs ${child.inputs.map(p => p.id)} outputs ${child.outputs.map(p => p.id)}`);
  assert.equal(r.doc.editor.graphs[r.childGraphId].nodes['node-emitter'] !== undefined, true, 'inner layout kept');
});

test('grouping a whole flat component (visual nodes) keeps its look, timing and knobs working', () => {
  const { doc } = insertComponent(createBlankDocument(), 'energy-bolt');
  const before = shape(doc);
  const root = doc.graphs.find(g => g.id === doc.rootGraphId)!;
  const pick = root.nodes.filter(n => n.id.startsWith('energy-bolt-') && !n.type.startsWith('Audio')).map(n => n.id);
  const r = groupSelection(doc, doc.rootGraphId, pick);
  if (!r.ok) assert.fail(r.message);
  valid(r.doc);
  assert.deepEqual(shape(r.doc), before);
  const bend = r.doc.controls.find(c => c.label === 'Arc bend')!;
  assert.equal(bend.scopeGraphId, r.childGraphId, 'knobs move into the group');
  bend.value = 1.2; // Still drives the (now grouped) arc.
  valid(r.doc);
  particles(r.doc);
});

test('refuses the Output node, sound nodes and knobs split across the boundary', () => {
  const d = createF01Document();
  const out = groupSelection(d, d.rootGraphId, ['node-output']);
  assert.ok(!out.ok && /cannot go inside a group/.test(out.message));
  const { doc } = insertComponent(createBlankDocument(), 'fireball');
  const root = doc.graphs.find(g => g.id === doc.rootGraphId)!;
  const audio = root.nodes.find(n => n.type.startsWith('Audio'))!;
  const a = groupSelection(doc, doc.rootGraphId, [audio.id]);
  assert.ok(!a.ok && /Sound nodes/.test(a.message));
  const knob = doc.controls.find(c => c.bindings.length > 1 && new Set(c.bindings.map(b => b.nodeId)).size > 1);
  if (knob) {
    const s = groupSelection(doc, doc.rootGraphId, [knob.bindings[0].nodeId]);
    assert.ok(!s.ok && /drives nodes inside and outside/.test(s.message));
  }
  const e = groupSelection(d, d.rootGraphId, []);
  assert.ok(!e.ok);
});
