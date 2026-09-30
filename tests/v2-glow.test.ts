import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GLOW, glowSettings } from '../src/graph/glow.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';

test('effect glow settings come from the EffectOutput node (defaults when unset) and validate their bounds', () => {
  const d = createBlankDocument();
  assert.deepEqual(glowSettings(d), DEFAULT_GLOW);
  const out = d.graphs[0].nodes.find(n => n.type === 'EffectOutput')!;
  out.params = { glowStrength: 0.5, glowRadius: 0.2, glowThreshold: 1.5, glowLimit: 1 };
  assert.ok(validateDocument(d, { registry: createRegistry() }).ok);
  assert.deepEqual(glowSettings(d), { strength: 0.5, radius: 0.2, threshold: 1.5, limit: 1 });
  out.params = { glowLimit: -1 };
  assert.ok(!validateDocument(d, { registry: createRegistry() }).ok);
});
