// MotionTrail Width over trail: a short trail with a pointed profile draws a flying spear (Force Lance, 2026-10-21).
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';

const compiled = (id: string) => {
  const { doc } = insertComponent(createBlankDocument(), id, undefined, { group: true });
  const r = compileParticlePreview(doc, { ribbonsHandled: true, audioHandled: true } as never);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors.slice(0, 3)));
  return r.value;
};

test('Force Lance: the lance trails carry the spear-shaped Width over trail (tip = 0 at the head)', () => {
  const trails = compiled('force-lance').trails.filter(t => /lance(core|inner|outer|halo)$/.test(t.nodeId));
  assert.equal(trails.length, 4);
  for (const t of trails) {
    const keys = t.widthOverTrail?.keys;
    assert.ok(keys, `${t.nodeId} has a width profile`);
    assert.equal(keys.at(-1)!.x, 1); assert.equal(keys.at(-1)!.y, 0, 'pointed tip at the head');
    assert.ok(Math.max(...keys.map(k => k.y)) === 1, 'broadest at the blade');
  }
});

test('MotionTrail without a profile (default constant 1) compiles no widthOverTrail', () => {
  const wakeless = compiled('fireball-sim').trails.find(t => /streak$/.test(t.nodeId));
  assert.ok(wakeless);
  assert.equal(wakeless.widthOverTrail, undefined);
});
