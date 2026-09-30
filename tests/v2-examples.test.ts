import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { readPack } from '../src/model/vfxpack.ts';

test('WP27: every shipped example document validates and the example pack opens', async () => {
  const files = readdirSync('examples');
  const docs = files.filter(f => f.endsWith('.vfx.json'));
  assert.ok(docs.length >= 10);
  for (const f of docs) {
    const v = validateDocument(JSON.parse(readFileSync(`examples/${f}`, 'utf8')), { registry: createRegistry() });
    if (!v.ok) assert.fail(`${f}: ${JSON.stringify(v.errors.slice(0, 2))}`);
  }
  const pack = await readPack(new Uint8Array(readFileSync('examples/energy-bolt.vfxpack')));
  assert.ok(pack.ok, JSON.stringify(pack));
});
