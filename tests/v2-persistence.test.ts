import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_KEY, MAX_SHELF, documentFileName, loadDraftText, readShelf, removeFromShelf, saveDraft, saveToShelf } from '../src/model/persistence.ts';
import { createBlankDocument, createF01Document } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

test('draft round-trips through storage and still validates', () => {
  const s = memory(), d = createF01Document();
  const r = saveDraft(s, d);
  assert.ok(r.ok && r.bytes > 100);
  const text = loadDraftText(s)!;
  const v = validateDocument(JSON.parse(text), { registry: createRegistry() });
  assert.ok(v.ok);
  assert.deepEqual(v.ok && v.value, d);
  assert.ok(s.m.has(DRAFT_KEY));
});

test('storage failures are reported, not thrown', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota exceeded'); } };
  const r = saveDraft(broken, createF01Document());
  assert.deepEqual(r, { ok: false, message: 'quota exceeded' });
  assert.equal(loadDraftText(broken), null);
  assert.equal(loadDraftText(undefined), null);
});

test('blank document validates and file names are safe', () => {
  const b = createBlankDocument();
  assert.ok(validateDocument(b, { registry: createRegistry() }).ok);
  assert.deepEqual(b.graphs[0].nodes.map(n => n.type).sort(), ['Anchor', 'Anchor', 'EffectOutput']);
  assert.equal(documentFileName({ ...b, name: 'My Fire: v2 / final' }), 'My_Fire_v2_final.vfx.json');
  assert.equal(documentFileName({ ...b, name: '' }), 'effect.vfx.json');
});

test('project shelf keeps named documents newest first, replaces same names, caps at MAX_SHELF, removes by name', () => {
  const s = memory(), a = { ...createF01Document(), name: 'Alpha' }, b = { ...createBlankDocument(), name: 'Beta' };
  assert.ok(saveToShelf(s, a, new Date(1)).ok);
  assert.ok(saveToShelf(s, b, new Date(2)).ok);
  assert.ok(saveToShelf(s, { ...a, durationTicks: 90 }, new Date(3)).ok);
  const shelf = readShelf(s);
  assert.deepEqual(shelf.map(e => e.name), ['Alpha', 'Beta']);
  assert.equal(JSON.parse(shelf[0].text).durationTicks, 90);
  assert.deepEqual(removeFromShelf(s, 'Alpha').map(e => e.name), ['Beta']);
  for (let i = 0; i < MAX_SHELF - 1; i++) assert.ok(saveToShelf(s, { ...b, name: `p${i}` }).ok);
  const full = saveToShelf(s, { ...b, name: 'one-too-many' });
  assert.ok(!full.ok && /full/.test(full.message));
  assert.ok(saveToShelf(s, { ...b, name: 'p3' }).ok, 'replacing an existing name is allowed when full');
  s.m.set('vfx-studio.v2.projects', '{broken');
  assert.deepEqual(readShelf(s), []);
});
