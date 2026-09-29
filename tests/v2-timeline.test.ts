import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineInfo } from '../src/render/timeline.ts';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';

test('12 timeline: event markers (bursts, arrival, flash) and each part\'s active window come from the compiled plan', () => {
  let doc = insertComponent(createBlankDocument(), 'impact-flash').doc;
  doc = insertComponent(doc, 'fireball').doc;
  const p = compileParticlePreview(doc, { audioHandled: true, ribbonsHandled: true });
  if (!p.ok) assert.fail(JSON.stringify(p.errors));
  const t = timelineInfo(p.value, null);
  assert.ok(t.markers.some(m => m.kind === 'flash' && m.tick === 10), 'screen flash at the impact tick');
  assert.ok(t.markers.some(m => m.kind === 'arrival' && m.tick === 40), 'fireball arrives at its travel time');
  assert.ok(t.markers.every((m, i, a) => i === 0 || a[i - 1].tick <= m.tick), 'sorted');
  const w = t.windows.get('impact-flash-bb');
  assert.ok(w && w[0] === 10 && w[1] > 10, `sparks active from the burst (got ${w})`);
});
