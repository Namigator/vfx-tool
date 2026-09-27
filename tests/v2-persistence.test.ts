import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_KEY, documentFileName, loadDraftText, saveDraft } from '../src/model/persistence.ts';
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
