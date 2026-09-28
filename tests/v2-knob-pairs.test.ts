import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_TEMPLATES } from '../src/graph/components.ts';

test('a knob that drives a *Max parameter also drives its *Min partner on the same node (so turning it down never inverts the range)', () => {
  const bad: string[] = [];
  for (const c of COMPONENT_TEMPLATES) for (const k of c.knobs) for (const b of k.bindings) {
    const m = /^(.*)(Max|Min)$/.exec(b.parameter);
    if (!m) continue;
    const partner = m[1] + (m[2] === 'Max' ? 'Min' : 'Max');
    const node = c.nodes.find(n => n.id === b.node);
    if (node?.params?.[partner] === undefined) continue; // Partner left at its default: not an authored range.
    if (!k.bindings.some(x => x.node === b.node && x.parameter === partner)) bad.push(`${c.id}.${k.id}: ${b.node}.${b.parameter}`);
  }
  assert.deepEqual(bad, []);
});
