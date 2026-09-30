import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelection } from '../src/editor/selection.ts';

test('select-new then deselect-old resolves to the new id', () => {
  assert.equal(resolveSelection([
    { type: 'select', id: 'b', selected: true },
    { type: 'select', id: 'a', selected: false },
  ], 'a'), 'b');
});

test('deselect-old then select-new resolves to the new id', () => {
  assert.equal(resolveSelection([
    { type: 'select', id: 'a', selected: false },
    { type: 'select', id: 'b', selected: true },
  ], 'a'), 'b');
});

test('deselecting only the current node clears selection', () => {
  assert.equal(resolveSelection([{ type: 'select', id: 'a', selected: false }], 'a'), null);
});

test('unrelated or non-select changes leave selection unchanged', () => {
  assert.equal(resolveSelection([{ type: 'select', id: 'x', selected: false }], 'a'), undefined);
  assert.equal(resolveSelection([{ type: 'position', id: 'a' }], 'a'), undefined);
  assert.equal(resolveSelection([{ type: 'select', id: 'a', selected: true }], 'a'), undefined);
});

test('heterogeneous batch with id-less add and unrelated remove leaves selection unchanged', () => {
  assert.equal(resolveSelection([
    { type: 'add' },
    { type: 'remove', id: 'z' },
    { type: 'select' },
  ], 'a'), undefined);
});

test('heterogeneous batch still resolves the select change', () => {
  assert.equal(resolveSelection([
    { type: 'add' },
    { type: 'select', id: 'a', selected: false },
    { type: 'remove', id: 'z' },
    { type: 'select', id: 'b', selected: true },
  ], 'a'), 'b');
});
