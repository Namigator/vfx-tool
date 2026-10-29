// Feature grid (tools/feature-grid/): every node type with a visible result has a case, so a new node cannot ship
// without an engine-parity check; and the scorer's verdicts follow its documented limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../src/graph/registry.ts';
// @ts-ignore plain .mjs tool module
import { CASES, NOT_VISUAL, stepsFor } from '../tools/feature-grid/cases.mjs';
// @ts-ignore plain .mjs tool module
import { LIMITS, verdict } from '../tools/feature-grid/score.mjs';

const types = new Set([...createRegistry().values()].map(s => s.type));

test('feature grid: every visual node type has a case (add one to tools/feature-grid/cases.mjs for a new node)', () => {
  const covered = new Set<string>(CASES.flatMap((c: { covers: string[] }) => c.covers));
  const missing = [...types].filter(t => !covered.has(t) && !(t in NOT_VISUAL));
  assert.deepEqual(missing, []);
  for (const t of [...covered, ...Object.keys(NOT_VISUAL)]) assert.ok(types.has(t), `${t} is not a node type`);
});

test('feature grid: case ids are unique and every case saves its document', () => {
  const ids = CASES.map((c: { id: string }) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('empty'), 'the empty plate case');
  for (const c of CASES) assert.deepEqual(stepsFor(c).at(-1), ['vfx_save_document', { docId: `fg-${c.id}`, path: `work/feature-grid/docs/${c.id}.json` }]);
});

test('feature grid: verdicts follow the limits', () => {
  const good = { shape: 0.8, bright: 1, colour: 0.02, area: 1 };
  assert.equal(verdict(good, 0.1, []).v, 'OK');
  assert.equal(verdict(good, 0.1, ['trail: dropped']).v, 'UNSUPPORTED');
  assert.equal(verdict(good, 0.0001, []).v, 'NO REF');
  assert.equal(verdict({ ...good, area: LIMITS.missing / 2 }, 0.1, []).v, 'MISSING');
  const off = verdict({ ...good, shape: LIMITS.shape - 0.1, bright: LIMITS.brightLo / 2 }, 0.1, []);
  assert.equal(off.v, 'CHECK');
  assert.match(off.why, /shape .*dimmer/);
});
