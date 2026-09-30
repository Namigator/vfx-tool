import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalDocument } from '../src/model/fixtures.ts';
import { DocumentHistory, MAX_HISTORY_BYTES, MAX_HISTORY_TRANSACTIONS, type Patch } from '../src/editor/history.ts';

const edit = (h: DocumentHistory, id: string, patches: Patch[]) => {
  assert.equal(h.begin(id, id).ok, true);
  const r = h.apply(patches);
  assert.equal(r.ok, true, JSON.stringify(r));
  return h.commit();
};

test('constructor and snapshot clone; caller data never retained or mutated', () => {
  const doc = minimalDocument();
  const original = structuredClone(doc);
  const h = new DocumentHistory(doc);
  doc.name = 'changed by caller';
  assert.equal(h.snapshot().name, 'Minimal');
  const snap = h.snapshot();
  snap.tags.push('x');
  assert.deepEqual(h.snapshot().tags, ['fixture']);

  const value = { position: [1, 2, 3] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: 2 };
  const patches: Patch[] = [{ op: 'set', path: ['rootTransform'], value }];
  edit(h, 't1', patches);
  value.position[0] = 99;
  assert.deepEqual(h.snapshot().rootTransform.position, [1, 2, 3]);
  assert.equal(patches.length, 1);
  assert.deepEqual(minimalDocument(), original);
});

test('undo/redo restore values and preserve absence versus value', () => {
  const h = new DocumentHistory(minimalDocument());
  const base = h.snapshot();
  edit(h, 't1', [
    { op: 'set', path: ['graphs', 0, 'nodes', 0, 'params', 'rate'], value: 5 },
    { op: 'set', path: ['name'], value: 'Renamed' },
    { op: 'delete', path: ['editor', 'graphs', 'graph-root', 'nodes', 'node-output'] },
  ]);
  const after = h.snapshot();
  assert.equal(h.undo().ok, true);
  assert.deepEqual(h.snapshot(), base);
  assert.equal(Object.hasOwn(h.snapshot().graphs[0].nodes[0].params, 'rate'), false);
  assert.equal(h.redo().ok, true);
  assert.deepEqual(h.snapshot(), after);
  assert.equal(Object.hasOwn(h.snapshot().editor.graphs['graph-root'].nodes, 'node-output'), false);
});

test('inverse ordering: dependent patches on the same path undo in reverse', () => {
  const h = new DocumentHistory(minimalDocument());
  const base = h.snapshot();
  edit(h, 't1', [
    { op: 'splice', path: ['tags'], index: 1, deleteCount: 0, insert: ['a', 'b'] },
    { op: 'set', path: ['tags', 2], value: 'B' },
    { op: 'splice', path: ['tags'], index: 0, deleteCount: 1, insert: [] },
    { op: 'set', path: ['name'], value: 'one' },
    { op: 'set', path: ['name'], value: 'two' },
  ]);
  assert.deepEqual(h.snapshot().tags, ['a', 'B']);
  h.undo();
  assert.deepEqual(h.snapshot(), base);
});

test('apply batch is atomic on invalid path, type, index and unsafe input', () => {
  const h = new DocumentHistory(minimalDocument());
  const base = h.snapshot();
  h.begin('t1', 'bad');
  const bad: [Patch[], string][] = [
    [[{ op: 'set', path: ['name'], value: 'x' }, { op: 'set', path: ['missing', 'deep'], value: 1 }], 'MISSING_KEY'],
    [[{ op: 'set', path: ['name'], value: 'x' }, { op: 'set', path: ['tags', 5], value: 'sparse' }], 'INVALID_INDEX'],
    [[{ op: 'set', path: ['name'], value: 'x' }, { op: 'splice', path: ['tags'], index: 3, deleteCount: 0, insert: [] }], 'INVALID_INDEX'],
    [[{ op: 'splice', path: ['tags'], index: 0, deleteCount: 1, insert: [] }, { op: 'delete', path: ['tags', 0] }], 'TYPE_MISMATCH'],
    [[{ op: 'set', path: ['name'], value: 'x' }, { op: 'splice', path: ['name'], index: 0, deleteCount: 0, insert: [] }], 'TYPE_MISMATCH'],
    [[{ op: 'set', path: ['name'], value: 'x' }, { op: 'delete', path: ['nope'] }], 'MISSING_KEY'],
    [[{ op: 'set', path: ['name'], value: 'x' }, { op: 'set', path: ['__proto__', 'polluted'], value: true }], 'UNSAFE_PATH'],
    [[{ op: 'set', path: ['constructor'], value: 1 }], 'UNSAFE_PATH'],
    [[{ op: 'set', path: ['name'], value: 'x' }, { op: 'set', path: ['seed'], value: Number.NaN }], 'UNSAFE_VALUE'],
    [[{ op: 'set', path: ['seed'], value: undefined }], 'UNSAFE_VALUE'],
    [[{ op: 'set', path: ['seed'], value: new Date() }], 'UNSAFE_VALUE'],
    [[{ op: 'set', path: ['seed'], value: JSON.parse('{"__proto__":{"polluted":true}}') }], 'UNSAFE_VALUE'],
    [[{ op: 'set', path: [], value: {} }], 'INVALID_PATH'],
    [[{ op: 'set', path: ['tags', -1], value: 'x' }], 'INVALID_PATH'],
  ];
  for (const [patches, code] of bad) {
    const r = h.apply(patches);
    assert.equal(r.ok, false, JSON.stringify(patches));
    if (!r.ok) assert.equal(r.code, code, JSON.stringify(patches));
    assert.deepEqual(h.snapshot(), base);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(h.commit(), { ok: true, notices: [], changed: false, semanticChanged: false, layoutChanged: false });
  assert.equal(h.canUndo(), false);
});

test('owned key add works even for names on Object.prototype', () => {
  const h = new DocumentHistory(minimalDocument());
  edit(h, 't1', [{ op: 'set', path: ['graphs', 0, 'nodes', 0, 'params', 'toString'], value: 1 }]);
  assert.equal(h.snapshot().graphs[0].nodes[0].params.toString, 1);
  h.undo();
  assert.equal(Object.hasOwn(h.snapshot().graphs[0].nodes[0].params, 'toString'), false);
});

test('transaction grouping: many apply calls form one undo step', () => {
  const h = new DocumentHistory(minimalDocument());
  const base = h.snapshot();
  h.begin('drag', 'Drag');
  for (let x = 1; x <= 5; x++) h.apply([{ op: 'set', path: ['editor', 'graphs', 'graph-root', 'nodes', 'node-source', 'x'], value: x }]);
  h.commit();
  assert.equal(h.stats().undo, 1);
  h.undo();
  assert.deepEqual(h.snapshot(), base);
  assert.equal(h.canUndo(), false);
});

test('transactions require IDs, block nesting and block undo/redo while active', () => {
  const h = new DocumentHistory(minimalDocument());
  assert.equal(h.apply([{ op: 'set', path: ['name'], value: 'x' }]).ok, false);
  assert.equal(h.begin('', 'x').ok, false);
  edit(h, 't1', [{ op: 'set', path: ['name'], value: 'a' }]);
  h.begin('t2', 'b');
  assert.equal(h.begin('t3', 'c').ok, false);
  assert.equal(h.canUndo(), false);
  const u = h.undo();
  assert.equal(u.ok, false);
  if (!u.ok) assert.equal(u.code, 'TRANSACTION_ACTIVE');
  h.cancel();
  assert.equal(h.canUndo(), true);
});

test('cancel restores the original and preserves history and redo', () => {
  const h = new DocumentHistory(minimalDocument());
  edit(h, 't1', [{ op: 'set', path: ['name'], value: 'a' }]);
  edit(h, 't2', [{ op: 'set', path: ['name'], value: 'b' }]);
  h.undo();
  const before = h.snapshot();
  h.begin('t3', 'c');
  h.apply([{ op: 'set', path: ['name'], value: 'c' }, { op: 'splice', path: ['tags'], index: 0, deleteCount: 1, insert: [] }]);
  assert.equal(h.cancel().ok, true);
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.stats().undo, 1);
  assert.equal(h.canRedo(), true);
  h.redo();
  assert.equal(h.snapshot().name, 'b');
});

test('no-op and net no-op commits preserve redo; a real edit clears it', () => {
  const h = new DocumentHistory(minimalDocument());
  edit(h, 't1', [{ op: 'set', path: ['name'], value: 'a' }]);
  h.undo();
  assert.equal(h.begin('empty', 'e').ok, true);
  const empty = h.commit();
  assert.ok(empty.ok);
  assert.equal(empty.changed, false);
  const same = edit(h, 'same', [{ op: 'set', path: ['name'], value: 'Minimal' }]);
  assert.ok(same.ok);
  assert.equal(same.changed, false);
  const net = edit(h, 'net', [{ op: 'set', path: ['seed'], value: 7 }, { op: 'set', path: ['seed'], value: 42 }]);
  assert.ok(net.ok);
  assert.equal(net.changed, false);
  assert.equal(h.canRedo(), true);
  assert.equal(h.canUndo(), false);
  edit(h, 'real', [{ op: 'set', path: ['seed'], value: 7 }]);
  assert.equal(h.canRedo(), false);
});

test('layout versus semantic classification', () => {
  const h = new DocumentHistory(minimalDocument());
  const move = edit(h, 'move', [{ op: 'set', path: ['editor', 'graphs', 'graph-root', 'nodes', 'node-source'], value: { x: 10, y: 10 } }]);
  assert.deepEqual([move.ok, move.ok && move.semanticChanged, move.ok && move.layoutChanged], [true, false, true]);
  const u = h.undo();
  assert.equal(u.ok && !u.semanticChanged && u.layoutChanged, true);
  const sem = edit(h, 'sem', [{ op: 'set', path: ['durationTicks'], value: 90 }]);
  assert.equal(sem.ok && sem.semanticChanged && !sem.layoutChanged, true);
  // Semantic edit reverted within the transaction while layout changes: layout only.
  const mixed = edit(h, 'mixed', [
    { op: 'set', path: ['durationTicks'], value: 1 },
    { op: 'set', path: ['editor', 'openedGraphId'], value: 'graph-root-2' },
    { op: 'set', path: ['durationTicks'], value: 90 },
  ]);
  assert.equal(mixed.ok && !mixed.semanticChanged && mixed.layoutChanged, true);
});

test('keeps at most MAX_HISTORY_TRANSACTIONS and evicts the oldest', () => {
  const h = new DocumentHistory(minimalDocument());
  let last: ReturnType<typeof edit> | undefined;
  for (let i = 1; i <= MAX_HISTORY_TRANSACTIONS + 5; i++) last = edit(h, `t${i}`, [{ op: 'set', path: ['seed'], value: i }]);
  assert.equal(h.stats().undo, MAX_HISTORY_TRANSACTIONS);
  assert.equal(last!.ok && last!.notices.some(n => n.code === 'HISTORY_EVICTED'), true);
  while (h.canUndo()) h.undo();
  assert.equal(h.snapshot().seed, 5);
});

test('byte budget evicts oldest; oversized transaction applies but clears history with notice', () => {
  const h = new DocumentHistory(minimalDocument());
  const big = 'x'.repeat(4 * 1024 * 1024);
  for (let i = 0; i < 3; i++) edit(h, `b${i}`, [{ op: 'set', path: ['name'], value: big + i }]);
  // Each entry holds ~8 MiB (forward + inverse), so only two fit in 20 MiB.
  assert.equal(h.stats().undo, 2);
  assert.ok(h.stats().bytes <= MAX_HISTORY_BYTES);

  const huge = 'y'.repeat(MAX_HISTORY_BYTES);
  const r = edit(h, 'huge', [{ op: 'set', path: ['name'], value: huge }]);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.notices[0]?.code, 'HISTORY_CLEARED_OVERSIZED');
  assert.equal(h.snapshot().name, huge);
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.stats().bytes, 0);
});
