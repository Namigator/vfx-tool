import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../src/graph/registry.ts';
import { NODE_PORTABILITY, nodePortability, portabilityReport } from '../src/graph/portability.ts';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';

test('16: every registered node declares a portability class and capabilities', () => {
  for (const s of createRegistry().values()) {
    assert.ok(NODE_PORTABILITY[s.type], `${s.type} classified`);
    assert.ok(s.capabilities.some(c => c.startsWith('portability:')) && s.capabilities.length > 1, `${s.type} capabilities`);
  }
  assert.equal(nodePortability('Material', { dissolve: true }).class, 'approximation');
  assert.deepEqual(nodePortability('Material', { rim: 0.5, liquid: 0.8 }).reasons, ['rim', 'liquid shading']);
  assert.equal(nodePortability('Material', {}).class, 'core');
  assert.equal(nodePortability('ScreenFlash').class, 'enhancement');
  const r = portabilityReport(insertComponent(createBlankDocument(), 'lightning-strike').doc);
  assert.ok(r.approximations.some(a => /BranchPath|Jagged/.test(a)) && r.enhancements.includes('glow (bloom)'));
});
