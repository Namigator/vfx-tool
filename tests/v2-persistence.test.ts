import test from 'node:test';
import assert from 'node:assert/strict';
import { CORRUPT_KEY, DRAFT_KEY, MAX_SHELF, readRevisions, recoverDraft, documentFileName, loadDraftText, readShelf, removeFromShelf, saveDraft, saveToShelf } from '../src/model/persistence.ts';
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

test('draft revisions: replaced drafts become revisions (throttled, max 5); a corrupt latest draft recovers the newest valid revision', () => {
  const s = memory(), d = createF01Document();
  const t0 = Date.parse('2026-09-27T10:00:00Z');
  for (let i = 0; i < 8; i++) saveDraft(s, { ...d, durationTicks: 100 + i }, new Date(t0 + i * 30_000));
  saveDraft(s, { ...d, durationTicks: 599 }, new Date(t0 + 8 * 30_000 + 1000));
  saveDraft(s, { ...d, durationTicks: 598 }, new Date(t0 + 8 * 30_000 + 2000));
  const revs = readRevisions(s);
  assert.equal(revs.length, 5);
  assert.deepEqual(revs.map(r => JSON.parse(r.text).durationTicks), [107, 106, 105, 104, 103], 'the quick second save added no revision');
  const parse = (t: string) => { try { const v = validateDocument(JSON.parse(t), { registry: createRegistry() }); return v.ok ? v.value : null; } catch { return null; } };
  assert.equal(recoverDraft(s, parse)!.value.durationTicks, 598);
  s.m.set(DRAFT_KEY, '{"format": broken');
  const r = recoverDraft(s, parse)!;
  assert.equal(r.value.durationTicks, 107);
  assert.ok(r.recoveredFrom);
  assert.equal(s.m.get(CORRUPT_KEY), '{"format": broken', 'unreadable draft preserved');
});

test('two tabs: compare-and-swap on the draft revision blocks a stale tab; unchanged saves do not bump the revision', async () => {
  const { readDraftMeta } = await import('../src/model/persistence.ts');
  const s = memory(), a = { tabId: 'A', baseRevision: 0 }, b = { tabId: 'B', baseRevision: 0 };
  const d1 = createF01Document(), d2 = { ...createF01Document(), name: 'changed in A' }, d3 = { ...createF01Document(), name: 'changed in B' };
  const r1 = saveDraft(s, d1, new Date(), a); assert.ok(r1.ok); a.baseRevision = r1.ok ? r1.revision : -1;
  const r2 = saveDraft(s, d2, new Date(), a); assert.ok(r2.ok); a.baseRevision = r2.ok ? r2.revision : -1;
  // B loaded at revision 0 and never saw A's writes: its save is refused and A's work survives.
  const rb = saveDraft(s, d3, new Date(), b);
  assert.ok(!rb.ok && rb.conflict);
  assert.equal(JSON.parse(loadDraftText(s)!).name, 'changed in A');
  // B reloads (takes the current revision) and may save again.
  b.baseRevision = readDraftMeta(s).revision;
  assert.ok(saveDraft(s, d3, new Date(), b).ok);
  // Saving identical content does not create a new revision (other tabs stay current).
  const before = readDraftMeta(s).revision;
  assert.ok(saveDraft(s, d3, new Date(), { tabId: 'B', baseRevision: before }).ok);
  assert.equal(readDraftMeta(s).revision, before);
});

test('trash: Remove moves a project to the trash; Restore puts it back; Empty trash deletes; name clashes are refused', async () => {
  const { readTrash, restoreFromTrash, emptyTrash } = await import('../src/model/persistence.ts');
  const s = memory();
  saveToShelf(s, { ...createF01Document(), name: 'keep me' });
  removeFromShelf(s, 'keep me');
  assert.deepEqual(readShelf(s).map(e => e.name), []);
  assert.deepEqual(readTrash(s).map(e => e.name), ['keep me']);
  const r = restoreFromTrash(s, 'keep me');
  assert.ok(r.ok);
  assert.deepEqual(readShelf(s).map(e => e.name), ['keep me']);
  assert.deepEqual(readTrash(s), []);
  removeFromShelf(s, 'keep me');
  saveToShelf(s, { ...createF01Document(), name: 'keep me' });
  const clash = restoreFromTrash(s, 'keep me');
  assert.ok(!clash.ok && /already exists/.test(clash.message));
  emptyTrash(s);
  assert.deepEqual(readTrash(s), []);
});

test('merging project lists keeps every name once (newest copy wins), newest first', async () => {
  const { mergeEntryLists } = await import('../src/model/persistence.ts');
  const e = (name: string, savedAt: string, text = name) => ({ name, savedAt, text });
  const a = JSON.stringify([e('x', '2026-09-28T10:00:00Z', 'x-new'), e('y', '2026-09-27T10:00:00Z')]);
  const b = JSON.stringify([e('x', '2026-09-26T10:00:00Z', 'x-old'), e('z', '2026-09-28T11:00:00Z')]);
  const m = JSON.parse(mergeEntryLists(a, b));
  assert.deepEqual(m.map((x: { name: string }) => x.name), ['z', 'x', 'y']);
  assert.equal(m[1].text, 'x-new');
  assert.equal(mergeEntryLists('not json', '[]'), '[]');
});
