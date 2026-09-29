import test from 'node:test';
import assert from 'node:assert/strict';
import { soloMask, canSolo } from '../src/graph/solo.ts';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';

test('T03 Solo: preview mask only; a component solos every sink inside it; several solos form a union', () => {
  let doc = insertComponent(createBlankDocument(), 'impact-flash', undefined, { group: true }).doc;
  doc = insertComponent(doc, 'smoke-plume', undefined, { group: true }).doc;
  const before = JSON.stringify(doc);
  assert.equal(soloMask(doc, new Set()), null, 'nothing soloed = no mask');
  const impact = soloMask(doc, new Set(['impact-flash']))!;
  assert.ok(impact.has('impact-flash-flash') && impact.has('impact-flash-bb') && ![...impact].some(id => id.startsWith('smoke-plume')));
  const both = soloMask(doc, new Set(['impact-flash-flash', 'smoke-plume']))!;
  assert.ok(both.has('impact-flash-flash') && !both.has('impact-flash-bb') && [...both].some(id => id.startsWith('smoke-plume')));
  assert.ok(![...both].some(id => id.includes('sparks') && !id.endsWith('bb')), 'emitters are not sinks');
  assert.equal(JSON.stringify(doc), before, 'solo never edits the document');
  assert.ok(canSolo('Group') && canSolo('RibbonRenderer') && !canSolo('Emitter'));
});
