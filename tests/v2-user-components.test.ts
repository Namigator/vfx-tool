import test from 'node:test';
import assert from 'node:assert/strict';
import { insertUserComponent, saveGroupAsComponent } from '../src/graph/userComponents.ts';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { resolveParameters } from '../src/model/controls.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';

const valid = (d: unknown) => { const v = validateDocument(d, { registry: createRegistry() }); if (!v.ok) assert.fail(JSON.stringify(v.errors.slice(0, 3))); };

test('A-05: save a reusable group, insert it twice, edit one instance, the other is unchanged', () => {
  const { doc: src, groupNodeId } = insertComponent(createBlankDocument(), 'energy-bolt', undefined, { group: true });
  const saved = saveGroupAsComponent(JSON.parse(JSON.stringify(src)), groupNodeId!, 'My bolt');
  if (!saved.ok) assert.fail(saved.message);
  // JSON round trip: what the browser store keeps.
  const comp = JSON.parse(JSON.stringify(saved.value));
  let d = createBlankDocument();
  const a = insertUserComponent(d, comp); d = a.doc;
  const b = insertUserComponent(d, comp); d = b.doc;
  assert.notEqual(a.groupNodeId, b.groupNodeId);
  valid(d);
  const bendA = d.controls.find(c => c.label === 'Arc bend' && c.section.includes(`(${a.groupNodeId})`))!;
  const bendB = d.controls.find(c => c.label === 'Arc bend' && c.section.includes(`(${b.groupNodeId})`))!;
  assert.ok(bendA && bendB && bendA.id !== bendB.id);
  bendA.value = 1.5;
  valid(d);
  const r = resolveParameters(d, createRegistry());
  if (!r.ok) assert.fail(JSON.stringify(r.errors.slice(0, 3)));
  const handle = (prefix: string) => (r.value.find(x => x.nodeId === `${prefix}-energy-bolt-arc` && x.parameter === 'startHandle')!.value as number[])[1];
  assert.ok(Math.abs(handle(a.groupNodeId) - 2) < 1e-9, 'edited instance follows its knob');
  assert.ok(Math.abs(handle(b.groupNodeId) - 0.4 * 4 / 3) < 1e-9, 'other instance unchanged');
  // Both copies render (outputs auto-wired to the effect output).
  const p = compileParticlePreview(d, { ribbonsHandled: true, audioHandled: true });
  if (!p.ok) assert.fail(JSON.stringify(p.errors.slice(0, 3)));
  assert.equal(p.value.followers.length, 2);
});

test('only Group nodes can be saved as components', () => {
  const d = createBlankDocument();
  const r = saveGroupAsComponent(d, 'node-output', 'x');
  assert.ok(!r.ok);
});
