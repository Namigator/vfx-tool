import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_TEMPLATES, insertComponent } from '../src/graph/components.ts';
import { createBlankDocument, createF01Document } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';

const valid = (d: unknown) => { const v = validateDocument(d, { registry: createRegistry() }); if (!v.ok) assert.fail(JSON.stringify(v.errors.slice(0, 3))); return v.value; };
const compiles = (d: unknown) => { const r = compileParticlePreview(d, { ribbonsHandled: true }); if (!r.ok) assert.fail(JSON.stringify(r.errors.slice(0, 3))); return r.value; };

test('every component inserts into a blank document, validates and compiles', () => {
  assert.ok(COMPONENT_TEMPLATES.length >= 7);
  for (const c of COMPONENT_TEMPLATES) {
    const { doc } = insertComponent(createBlankDocument(), c.id);
    const p = compiles(valid(doc));
    assert.ok(p.layers.length + p.trails.length > 0, `${c.id} draws something`);
  }
});

test('components compose: two components and a repeat get unique ids and all compile together', () => {
  let d = createF01Document();
  const a = insertComponent(d, 'spark-burst'); d = a.doc;
  const b = insertComponent(d, 'fireball'); d = b.doc;
  const c = insertComponent(d, 'spark-burst'); d = c.doc;
  assert.notEqual(a.prefix, c.prefix);
  const p = compiles(valid(d));
  assert.ok(p.systems.length >= 1 + 1 + 4 + 1, `systems: ${p.systems.length}`);
  assert.equal(d.graphs[0].nodes.filter(n => n.type === 'EffectOutput').length, 1, 'shares the one output');
  assert.ok(d.durationTicks >= 120);
});

test('components bind to the existing Source/Target anchor nodes and never mutate the input', () => {
  const blank = createBlankDocument(), before = JSON.stringify(blank);
  const { doc } = insertComponent(blank, 'flame-jet');
  assert.equal(JSON.stringify(blank), before);
  const g = doc.graphs[0];
  assert.equal(g.nodes.filter(n => n.type === 'Anchor' && n.params.anchorId === 'source').length, 1);
  assert.ok(g.edges.some(e => e.source.nodeId === 'node-source' && e.target.port === 'anchor'));
  assert.ok(doc.anchors.some(a => a.id.endsWith('flamecenter')), 'component-owned anchor added with prefix');
  assert.throws(() => insertComponent(blank, 'nope'), /Unknown component/);
});
