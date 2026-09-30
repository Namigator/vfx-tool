import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { timelineInfo, timelineLanes } from '../src/render/timeline.ts';

const lanesOf = (d: any) => {
  const p = compileParticlePreview(d, { ribbonsHandled: true, audioHandled: true }), q = compilePathPreview(d, 0, { audioHandled: true });
  return timelineLanes(d, timelineInfo(p.ok ? p.value : null, q.ok ? q.value : null).windows);
};
const three = () => {
  let d: any = insertComponent(createBlankDocument(), 'fire-jet', undefined, { group: true }).doc;
  d = insertComponent(d, 'fire-jet', undefined, { group: true }).doc;
  d = insertComponent(d, 'energy-bolt', undefined, { group: true }).doc;
  d.durationTicks = 400;
  return d;
};

test('three components give three lanes with longest-prefix attribution', () => {
  const d = three(), lanes = lanesOf(d);
  assert.deepEqual(lanes.map(l => l.prefix), ['fire-jet', 'fire-jet-2', 'energy-bolt']);
  for (const l of lanes) {
    assert.equal(l.label, d.controls[l.startControl!].section);
    assert.equal(l.groupNodeId, l.prefix);
    assert.ok(l.span, `${l.prefix} has a span`);
  }
  assert.deepEqual(lanes[0]!.span, lanes[1]!.span);
  assert.deepEqual(lanes.map(l => l.lengthControl !== undefined), [false, false, true]);
  assert.equal(d.controls[lanes[2]!.lengthControl!].label, 'Travel ticks');
});

test('Start at shifts only its own lane', () => {
  const d = three(), before = lanesOf(d);
  const c = d.controls.find((x: any) => x.id === 'ctl-fire-jet-2-start-at');
  c.value = 60;
  const after = lanesOf(d);
  assert.equal(after[1]!.span![0], before[1]!.span![0] + 60);
  assert.deepEqual(after[0]!.span, before[0]!.span);
});

test('flamethrower length knob is Burn time', () => {
  const { doc } = insertComponent(createBlankDocument(), 'flamethrower');
  const l = lanesOf(doc);
  assert.equal(l.length, 1);
  assert.equal(doc.controls[l[0]!.lengthControl!]!.label, 'Burn time');
});

test('blank document has no lanes', () => {
  assert.deepEqual(lanesOf(createBlankDocument()), []);
});
